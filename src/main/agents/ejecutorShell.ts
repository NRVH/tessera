// =============================================================================
// Ejecuta una orden en la shell nativa de las sesiones (PowerShell `-NoProfile` en
// Windows, `$SHELL -ilc` en POSIX), con un tope de tiempo que se cumple y muerte del
// árbol entero. Lo usa el servicio de los agentes nativos para sondas (`--version`,
// `npm prefix -g`) y órdenes de instalación. Nunca rechaza: todo fallo va en el resultado.
// Decisiones: docs/decisiones/agentes/nativos-ejecucion-en-shell.md
// =============================================================================

import { spawn, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { shellNativoPara } from '../terminals/shellNativo.ts'
import { extraerEntreMarcas } from '../util/pathDeLogin.ts'

/** 'sonda' devuelve el stdout útil; 'orden' la salida intercalada y el código del CLI. */
export type ModoEjecucion = 'sonda' | 'orden'

/** Opciones de `ejecutarEnShellNativa`. */
export interface OpcionesEjecucion {
  /** Dónde corre; la actual por defecto. */
  plataforma?: Plataforma
  /** `$SHELL` del usuario (sólo POSIX); por defecto el de `env` o el del proceso. */
  shellEnv?: string
  /** Tope de tiempo, en ms. Al vencer se resuelve YA y se mata el árbol. */
  timeoutMs: number
  modo: ModoEjecucion
  /** Cada línea útil de la salida (sólo en 'orden'), en el orden en que llega. */
  onLinea?: (linea: string) => void
  /** Entorno del hijo; `process.env` por defecto. */
  env?: NodeJS.ProcessEnv
  /** Tope de salida en bytes; 1 MiB por defecto. */
  topeBytes?: number
  /** Directorio de trabajo; el HOME por defecto (el de Tessera retendría su carpeta de instalación). */
  cwd?: string
}

/** Resultado de `ejecutarEnShellNativa`. */
export interface ResultadoEjecucion {
  /**
   * 'orden': salió con 0 (y en POSIX llegó a ejecutarse tras el marcador).
   * 'sonda': en Windows, salió con 0; en POSIX, la salida trae los dos marcadores.
   */
  ok: boolean
  /** Código de salida; null si se mató (tope), murió por señal o no llegó a lanzarse. */
  codigo: number | null
  /**
   * 'orden': stdout y stderr intercalados (en POSIX, lo posterior al marcador; sin
   * marcador, todo). 'sonda': SOLO el stdout útil, recortado; el stderr no entra.
   */
  salida: string
  /** ¿Venció el tope de tiempo? */
  tope: boolean
  /** Motivo del fallo, en español, cuando `ok` es false. */
  error?: string
}

/** Marcadores de la salida útil en POSIX. Sin `$`, comillas ni delimitadores. */
export const MARCA_INI = '__TESSERA_EJEC_INI__'
export const MARCA_FIN = '__TESSERA_EJEC_FIN__'

export const TOPE_SALIDA_POR_DEFECTO = 1024 * 1024
/** Tras 'exit', lo que se espera a 'close' antes de resolver con lo que haya. */
const GRACIA_TRAS_SALIR_MS = 500
/** El stderr de una sonda sólo sirve para explicar un fallo: con esto sobra. */
const TOPE_STDERR_SONDA = 16 * 1024

/** Una barra invertida, sin escribirla literal: no hay escape que pueda colapsarse por el camino. */
const BARRA = String.fromCharCode(92)
/** `printf '%s\n'`: imprime su argumento y un salto de línea, en cualquier shell. */
const PRINTF_LINEA = `printf '%s${BARRA}n'`

// -----------------------------------------------------------------------------
// Parte pura
// -----------------------------------------------------------------------------

/** Cómo se mata el árbol de un hijo en cada plataforma. */
export type EstrategiaMuerte = { tipo: 'taskkill' } | { tipo: 'grupo'; senal: 'SIGKILL' }

/** `taskkill` del árbol en Windows; en POSIX, SIGKILL al grupo del hijo `detached`. */
export function estrategiaMuerte(plataforma: Plataforma): EstrategiaMuerte {
  return plataforma === 'windows' ? { tipo: 'taskkill' } : { tipo: 'grupo', senal: 'SIGKILL' }
}

/** Argumentos de `taskkill` para matar `pid` y todos sus descendientes, sin preguntar. */
export function argumentosTaskkill(pid: number): string[] {
  return ['/PID', String(pid), '/T', '/F']
}

/** El guion de PowerShell: salida UTF-8, `<cmd>`, y un código de salida que no miente. */
export function envolverPowerShell(cmd: string): string {
  return (
    'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}; ' +
    "$ProgressPreference = 'SilentlyContinue'; " +
    '$global:LASTEXITCODE = $null; ' +
    `${cmd}; ` +
    '$__ok = $?; $__c = $global:LASTEXITCODE; ' +
    'if ($__c -is [int]) { exit $__c } elseif ($__ok) { exit 0 } else { exit 1 }'
  )
}

/** POSIX, 'sonda': la salida de `<cmd>` entre dos marcadores. */
export function envolverSonda(cmd: string): string {
  return `${PRINTF_LINEA} '${MARCA_INI}'; ${cmd}; ${PRINTF_LINEA} '${MARCA_FIN}'`
}

/** POSIX, 'orden': marcador y `exec` (comando SIMPLE), para que el código de salida sea el del CLI. */
export function envolverOrden(cmd: string): string {
  return `${PRINTF_LINEA} '${MARCA_INI}'; exec ${cmd} 2>&1`
}

/** Qué se lanza exactamente. */
export interface PlanEjecucion {
  archivo: string
  args: string[]
  /** POSIX: grupo de procesos propio, para poder matarlo entero. */
  detached: boolean
  /** ¿Hay que buscar marcadores en la salida? (sólo POSIX) */
  conMarcas: boolean
}

/** El proceso, sus argumentos y cómo se mata, para `cmd` en esa plataforma y modo. */
export function planEjecucion(
  cmd: string,
  opts: { plataforma: Plataforma; shellEnv: string | undefined; modo: ModoEjecucion }
): PlanEjecucion {
  if (opts.plataforma === 'windows') {
    return {
      archivo: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', envolverPowerShell(cmd)],
      detached: false,
      conMarcas: false
    }
  }
  const envuelto = opts.modo === 'sonda' ? envolverSonda(cmd) : envolverOrden(cmd)
  const shell = shellNativoPara(envuelto, opts.shellEnv, opts.plataforma)
  return {
    archivo: shell.archivo,
    args: shell.args,
    detached: estrategiaMuerte(opts.plataforma).tipo === 'grupo',
    conMarcas: true
  }
}

/**
 * La salida útil de una SONDA: en POSIX lo de entre los marcadores (null si falta
 * alguno); en Windows el stdout entero. Recortada en los dos casos.
 */
export function salidaDeSonda(stdout: string, plataforma: Plataforma): string | null {
  if (plataforma === 'windows') return stdout.trim()
  const entre = extraerEntreMarcas(stdout, MARCA_INI, MARCA_FIN)
  return entre === null ? null : entre.trim()
}

export type Flujo = 'stdout' | 'stderr'

/**
 * Qué líneas de una ORDEN llegan a la salida y a `onLinea`. Windows: todas. POSIX: nada
 * hasta la línea del marcador en stdout (se emite lo que venga detrás de él en esa misma
 * línea, si algo); después, todo. El stderr antes del marcador es el ruido de arranque
 * de la shell y se descarta.
 */
export interface Compuerta {
  pasar(linea: string, flujo: Flujo): string | null
  readonly abierta: boolean
}

/** Compuerta de las líneas de una orden (ver `Compuerta`). */
export function crearCompuerta(plataforma: Plataforma): Compuerta {
  let abierta = plataforma === 'windows'
  return {
    get abierta() {
      return abierta
    },
    pasar(linea: string, flujo: Flujo): string | null {
      if (abierta) return linea
      if (flujo !== 'stdout') return null
      const i = linea.indexOf(MARCA_INI)
      if (i < 0) return null
      abierta = true
      const resto = linea.slice(i + MARCA_INI.length)
      return resto === '' ? null : resto
    }
  }
}

// -----------------------------------------------------------------------------
// Con proceso
// -----------------------------------------------------------------------------

/** Mata el árbol de `hijo` según la plataforma. Nunca lanza; no espera a que muera. */
function matarArbol(hijo: ChildProcess, plataforma: Plataforma): void {
  const pid = hijo.pid
  if (pid === undefined) return
  const estrategia = estrategiaMuerte(plataforma)
  const ultimoRecurso = (): void => {
    try {
      hijo.kill('SIGKILL')
    } catch {
      /* ya no existe */
    }
  }
  if (estrategia.tipo === 'taskkill') {
    try {
      const k = spawn('taskkill', argumentosTaskkill(pid), { windowsHide: true, stdio: 'ignore' })
      k.on('error', ultimoRecurso)
    } catch {
      ultimoRecurso()
    }
    return
  }
  try {
    process.kill(-pid, estrategia.senal)
  } catch {
    ultimoRecurso()
  }
}

/** Parte un flujo en líneas (`\r?\n`) decodificando UTF-8 sin romper caracteres. */
function lectorDeLineas(alLinea: (linea: string) => void): { escribir(trozo: Buffer): void; cerrar(): void } {
  const decoder = new StringDecoder('utf8')
  let pendiente = ''
  const volcar = (texto: string): void => {
    pendiente += texto
    const partes = pendiente.split(/\r?\n/)
    pendiente = partes.pop() ?? ''
    for (const l of partes) alLinea(l)
  }
  return {
    escribir: (trozo) => volcar(decoder.write(trozo)),
    cerrar: () => {
      volcar(decoder.end())
      if (pendiente !== '') {
        const l = pendiente
        pendiente = ''
        alLinea(l)
      }
    }
  }
}

type Extra = { tope?: boolean; error?: string }

/** Lo que se va recogiendo de la salida del hijo y el resultado que sale de ello. */
interface Recolector {
  datos(flujo: Flujo, trozo: Buffer): void
  /** Vacía lo pendiente de los lectores de líneas. */
  cerrar(): void
  resultado(codigo: number | null, extra: Extra): ResultadoEjecucion
}

/** 'sonda': el stdout en bruto (para los marcadores) y el stderr (para explicar un fallo). */
function recolectorSonda(plataforma: Plataforma, topeBytes: number, conMarcas: boolean): Recolector {
  let stdoutSonda = ''
  let stderrSonda = ''
  const decoderSondaOut = new StringDecoder('utf8')
  const decoderSondaErr = new StringDecoder('utf8')
  return {
    datos(flujo, trozo) {
      if (flujo === 'stdout') {
        if (stdoutSonda.length < topeBytes) stdoutSonda += decoderSondaOut.write(trozo)
      } else if (stderrSonda.length < TOPE_STDERR_SONDA) stderrSonda += decoderSondaErr.write(trozo)
    },
    cerrar() {},
    resultado(codigo, extra) {
      const tope = extra.tope === true
      stdoutSonda += decoderSondaOut.end()
      stderrSonda += decoderSondaErr.end()
      const salida = salidaDeSonda(stdoutSonda, plataforma)
      const primeraErr = stderrSonda.trim().split(/\r?\n/)[0] ?? ''
      let ok: boolean
      let error = extra.error
      if (tope || error) ok = false
      else if (conMarcas) {
        ok = salida !== null
        if (!ok) error = `la shell respondió sin los marcadores${primeraErr ? `: ${primeraErr}` : ''}`
      } else {
        ok = codigo === 0
        if (!ok) error = `la sonda salió con código ${String(codigo)}${primeraErr ? `: ${primeraErr}` : ''}`
      }
      return { ok, codigo, salida: salida ?? '', tope, ...(error ? { error } : {}) }
    }
  }
}

/** Líneas acumuladas hasta `topeBytes`; `conAviso` deja una última línea que dice que se recortó. */
function acumulador(
  topeBytes: number,
  conAviso: ((aviso: string) => void) | null,
  alPasar: (linea: string) => void
): { lineas: string[]; anotar(linea: string): void } {
  const lineas: string[] = []
  let bytes = 0
  let recortada = false
  return {
    lineas,
    anotar(linea) {
      if (recortada) return
      const b = Buffer.byteLength(linea, 'utf8') + 1
      if (bytes + b > topeBytes) {
        if (!conAviso) return
        recortada = true
        conAviso(`[… salida recortada: superó ${Math.round(topeBytes / 1024)} KiB]`)
        return
      }
      bytes += b
      lineas.push(linea)
      alPasar(linea)
    }
  }
}

/** 'orden': las líneas que pasan la compuerta y, para diagnosticar, todo lo que llega. */
function recolectorOrden(
  plataforma: Plataforma,
  topeBytes: number,
  onLinea: ((linea: string) => void) | undefined,
  conMarcas: boolean
): Recolector {
  const notificar = (linea: string): void => {
    if (!onLinea) return
    try {
      onLinea(linea)
    } catch {
      /* un observador roto no tumba la orden */
    }
  }
  const util = acumulador(
    topeBytes,
    (aviso) => {
      util.lineas.push(aviso)
      notificar(aviso)
    },
    notificar
  )
  const crudo = acumulador(topeBytes, null, () => {})
  const compuerta = crearCompuerta(plataforma)
  const alLinea = (flujo: Flujo) => (linea: string) => {
    crudo.anotar(linea)
    const pasa = compuerta.pasar(linea, flujo)
    if (pasa !== null) util.anotar(pasa)
  }
  const lectorOut = lectorDeLineas(alLinea('stdout'))
  const lectorErr = lectorDeLineas(alLinea('stderr'))
  return {
    datos: (flujo, trozo) => (flujo === 'stdout' ? lectorOut : lectorErr).escribir(trozo),
    cerrar() {
      lectorOut.cerrar()
      lectorErr.cerrar()
    },
    resultado(codigo, extra) {
      const tope = extra.tope === true
      const llegoAEjecutarse = !conMarcas || compuerta.abierta
      let salida = util.lineas.join('\n')
      let error = extra.error
      let ok = !tope && !error && codigo === 0 && llegoAEjecutarse
      if (!llegoAEjecutarse && !tope && !error) {
        // Sin marcador la shell murió arrancando: lo visto es lo único que lo explica.
        salida = crudo.lineas.join('\n')
        error = 'la shell de inicio de sesión terminó sin llegar a ejecutar la orden'
        ok = false
      } else if (!ok && !error) {
        error = `la orden salió con código ${String(codigo)}`
      }
      return { ok, codigo, salida, tope, ...(error ? { error } : {}) }
    }
  }
}

/**
 * Lanza el plan y resuelve una sola vez: al cerrarse los pipes, medio segundo después de
 * 'exit' (un hijo en segundo plano puede retenerlos) o al vencer el tope, que mata el árbol.
 */
function ejecutarPlan(
  plan: PlanEjecucion,
  plataforma: Plataforma,
  env: NodeJS.ProcessEnv,
  rec: Recolector,
  opciones: OpcionesEjecucion,
  resolve: (r: ResultadoEjecucion) => void
): void {
  let resuelta = false
  let temporizador: ReturnType<typeof setTimeout> | null = null
  let gracia: ReturnType<typeof setTimeout> | null = null
  let hijo: ChildProcess | null = null
  const terminar = (codigo: number | null, extra: Extra = {}): void => {
    if (resuelta) return
    resuelta = true
    if (temporizador) clearTimeout(temporizador)
    if (gracia) clearTimeout(gracia)
    temporizador = null
    gracia = null
    rec.cerrar()
    // Deja de escuchar: si un nieto mantiene los pipes abiertos, que no retenga nada.
    try {
      hijo?.stdout?.destroy()
      hijo?.stderr?.destroy()
    } catch {
      /* ya cerrados */
    }
    resolve(rec.resultado(codigo, extra))
  }
  try {
    hijo = spawn(plan.archivo, plan.args, {
      cwd: opciones.cwd ?? os.homedir(),
      env,
      windowsHide: true,
      detached: plan.detached,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    terminar(null, { error: `no se pudo lanzar ${plan.archivo}: ${e instanceof Error ? e.message : String(e)}` })
    return
  }
  const h = hijo
  temporizador = setTimeout(() => {
    const ms = opciones.timeoutMs
    const cuanto = ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`
    terminar(null, { tope: true, error: `superó el tope de ${cuanto} y se detuvo` })
    matarArbol(h, plataforma)
  }, opciones.timeoutMs)
  h.stdout?.on('data', (trozo: Buffer) => rec.datos('stdout', trozo))
  h.stderr?.on('data', (trozo: Buffer) => rec.datos('stderr', trozo))
  h.on('error', (err) => terminar(null, { error: `no se pudo lanzar ${plan.archivo}: ${err.message}` }))
  let codigoSalida: number | null = null
  h.on('exit', (codigo) => {
    codigoSalida = codigo
    if (resuelta || gracia) return
    gracia = setTimeout(() => terminar(codigoSalida), GRACIA_TRAS_SALIR_MS)
  })
  h.on('close', (codigo) => terminar(codigo ?? codigoSalida))
}

/** Ejecuta `cmd` en la shell nativa, con tope y muerte del árbol. Nunca rechaza. */
export function ejecutarEnShellNativa(cmd: string, opciones: OpcionesEjecucion): Promise<ResultadoEjecucion> {
  const plataforma = opciones.plataforma ?? plataformaActual()
  const env = opciones.env ?? process.env
  const topeBytes = opciones.topeBytes ?? TOPE_SALIDA_POR_DEFECTO
  const { modo } = opciones
  const plan = planEjecucion(cmd, {
    plataforma,
    shellEnv: opciones.shellEnv ?? env.SHELL ?? process.env.SHELL,
    modo
  })
  return new Promise<ResultadoEjecucion>((resolve) => {
    const rec =
      modo === 'sonda'
        ? recolectorSonda(plataforma, topeBytes, plan.conMarcas)
        : recolectorOrden(plataforma, topeBytes, opciones.onLinea, plan.conMarcas)
    ejecutarPlan(plan, plataforma, env, rec, opciones, resolve)
  })
}
