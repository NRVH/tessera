// =============================================================================
// Un proceso de sesión del explorador (`src/tdb/sesion.cjs`) visto desde el main: lo lanza
// con `fork` (el binario de Electron haciendo de Node), le habla por el canal IPC, registra
// su ruido sin SQL ni secretos y avisa cuando sale. Al salir se rechaza todo lo que estaba en
// vuelo, como `perdida` o con el motivo de quien lo mató (el Stop de SQLite: `cancelada`).
// Sin `electron`: el log se inyecta y lo usa también `src/tdb/test-sesion-postgres.mts`.
// Decisiones: docs/decisiones/bd/sesiones-protocolo-del-trabajador.md
// =============================================================================

import { fork, type ChildProcess, type ForkOptions } from 'node:child_process'
import {
  Correlador,
  VERSION_PROTOCOLO,
  type ErrorTrabajador,
  type EventoTrabajador,
  type OpTrabajador,
  type OpcionesCorrelador,
  type Peticion,
  type PeticionSinIdDe,
  type Reloj,
  type RespuestaIniciar,
  type RespuestasPorOp
} from './protocoloTrabajador.ts'

/** Tope de una línea de log del trabajador. */
const LOG_MAX = 200
/** Tope de lo que se acumula de una línea sin '\n' antes de volcarla. */
const LINEA_MAX_ACUMULADA = 64 * 1024

/** Palabras que delatan SQL en una línea de log: esa línea no se registra. */
const PARECE_SQL =
  /\b(select|insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|declare|begin|with|call|exec|execute)\b[\s\S]*\b(from|into|set|table|where|values|end|as|to|on)\b/i

export interface OpcionesProcesoTrabajador {
  /** Ruta absoluta de `sesion.cjs`. */
  rutaScript: string
  /** Log inyectado (en la app: `(l) => dbLog('trabajador', l)`). */
  log: (linea: string) => void
  /** Binario que hace de Node. Por defecto `process.execPath`. */
  execPath?: string
  /** Entorno base. Por defecto `process.env`. */
  env?: NodeJS.ProcessEnv
  /**
   * Serialización del canal. 'advanced' (por defecto) exige el mismo V8 en los dos
   * extremos: en la app lo es. 'json' para un main que no es Electron (tests).
   */
  serializacion?: 'advanced' | 'json'
  reloj?: Reloj
  plazos?: OpcionesCorrelador['plazos']
  /** Para tests: sustituye a `child_process.fork`. */
  forkImpl?: (modulo: string, args: string[], opciones: ForkOptions) => ChildProcess
}

export interface SalidaTrabajador {
  codigo: number | null
  senal: string | null
}

/** Normaliza una línea del trabajador para el log. Pura, exportada para el test. */
export function lineaParaLog(linea: string, secretos: Iterable<string>): string | null {
  let l = linea.replace(/\r$/, '')
  if (!l.trim()) return null
  for (const s of secretos) {
    if (s && l.includes(s)) l = l.split(s).join('***')
  }
  // La expresión se pasa sobre un trozo acotado: una línea de 64 KiB no debe costar
  // una búsqueda cuadrática en el hilo principal.
  if (PARECE_SQL.test(l.slice(0, 2000))) return '[línea omitida: parece SQL]'
  return l.length > LOG_MAX ? l.slice(0, LOG_MAX) + '…' : l
}

/** Entorno del hijo: el del main sin `TESSERA_*`, más las dos variables propias. */
export function entornoTrabajador(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k.toUpperCase().startsWith('TESSERA_')) continue
    env[k] = v
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  env.UV_THREADPOOL_SIZE = '16'
  return env
}

export class ProcesoTrabajador {
  private readonly opciones: OpcionesProcesoTrabajador
  private readonly correlador: Correlador
  private hijo: ChildProcess | null = null
  private salido: SalidaTrabajador | null = null
  private readonly oyentesEvento = new Set<(e: EventoTrabajador) => void>()
  private readonly oyentesSalida = new Set<(s: SalidaTrabajador) => void>()
  private readonly esperasSalida = new Set<() => void>()
  /** Secretos vistos en `abrir`, SOLO para redactarlos del log si aparecieran. */
  private readonly secretos = new Set<string>()
  /** El error con el que `matar(motivo)` pidió rechazar lo que quede en vuelo (Stop de SQLite). */
  private motivoMuerte: ErrorTrabajador | null = null

  constructor(opciones: OpcionesProcesoTrabajador) {
    this.opciones = opciones
    this.correlador = new Correlador({
      reloj: opciones.reloj,
      plazos: opciones.plazos,
      alVencer: (op, id) => this.opciones.log(`vigilante vencido: op=${op} id=${id}`)
    })
  }

  /** ¿Lanzado y sin salir? */
  get vivo(): boolean {
    return this.hijo !== null && this.salido === null
  }

  get pid(): number | undefined {
    return this.hijo?.pid
  }

  /** Peticiones en vuelo (para saber si está ocioso). */
  get pendientes(): number {
    return this.correlador.pendientes
  }

  /** Lanza el proceso y hace el saludo `iniciar` (15 s). */
  async arrancar(): Promise<RespuestaIniciar> {
    if (this.hijo) throw new Error('El proceso de sesión ya se lanzó.')
    const lanzar = this.opciones.forkImpl ?? fork
    // `windowsHide` no figura en los tipos de `ForkOptions`, pero `fork` pasa sus
    // opciones tal cual a `spawn`, que sí lo aplica. Con el binario de Electron (una
    // app de ventana) no abriría consola de todos modos: es la red por si el
    // `execPath` fuera algún día un Node de consola.
    const opcionesFork: ForkOptions & { windowsHide: boolean } = {
      execPath: this.opciones.execPath ?? process.execPath,
      execArgv: [],
      env: entornoTrabajador(this.opciones.env ?? process.env),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: this.opciones.serializacion ?? 'advanced',
      windowsHide: true
    }
    const hijo = lanzar(this.opciones.rutaScript, [], opcionesFork)
    this.hijo = hijo
    this.engancharSalida(hijo.stdout, 'stdout')
    this.engancharSalida(hijo.stderr, 'stderr')
    hijo.on('message', (m: unknown) => this.alMensaje(m))
    hijo.on('error', (err: Error) => {
      // Fallo al lanzar o al enviar. Si no llegó a arrancar, no habrá 'exit'.
      this.opciones.log(`error del proceso: ${err.message}`)
      if (hijo.pid === undefined) this.alSalir(null, null)
    })
    hijo.on('exit', (codigo: number | null, senal: NodeJS.Signals | null) => this.alSalir(codigo, senal))
    const r = await this.enviar<'iniciar'>({ op: 'iniciar', v: VERSION_PROTOCOLO })
    if (r.v !== VERSION_PROTOCOLO) {
      this.matar()
      throw new Error(`El proceso de sesión habla el protocolo ${r.v} y el main el ${VERSION_PROTOCOLO}.`)
    }
    this.opciones.log(`arrancado pid=${r.pid} node=${r.versiones.node}${r.versiones.electron ? ` electron=${r.versiones.electron}` : ''}`)
    return r
  }

  /**
   * Envía una petición y espera su respuesta. Rechaza con `FalloTrabajador` (error
   * del trabajador, vigilante vencido o proceso muerto).
   */
  enviar<O extends OpTrabajador>(peticion: PeticionSinIdDe<O>, plazoMs?: number | null): Promise<RespuestasPorOp[O]> {
    const hijo = this.hijo
    const { mensaje, promesa } = this.correlador.preparar<O>(peticion, plazoMs)
    const id = mensaje.id
    if (!hijo || this.salido || !hijo.connected) {
      this.correlador.fallar(id, {
        clase: 'perdida',
        codigo: 'TESSERA-PROCESO',
        mensaje: 'El proceso de la conexión no está en marcha.'
      })
      return promesa
    }
    const general = mensaje as Peticion
    if (general.op === 'abrir' && general.secreto) this.secretos.add(general.secreto)
    this.opciones.log(`-> op=${general.op} id=${id}`)
    try {
      hijo.send(mensaje, (err: Error | null) => {
        if (err) {
          this.correlador.fallar(id, {
            clase: 'perdida',
            codigo: 'TESSERA-CANAL',
            mensaje: `No se pudo hablar con el proceso de la conexión: ${err.message}`
          })
        }
      })
    } catch (err) {
      this.correlador.fallar(id, {
        clase: 'perdida',
        codigo: 'TESSERA-CANAL',
        mensaje: `No se pudo hablar con el proceso de la conexión: ${(err as Error).message}`
      })
    }
    return promesa
  }

  /** Suscribe a los eventos del trabajador (`perdida`, `fatal`). Devuelve la baja. */
  onEvento(cb: (e: EventoTrabajador) => void): () => void {
    this.oyentesEvento.add(cb)
    return () => this.oyentesEvento.delete(cb)
  }

  /** Suscribe a la salida del proceso. Si ya salió, avisa en el siguiente tic. */
  onSalida(cb: (s: SalidaTrabajador) => void): () => void {
    this.oyentesSalida.add(cb)
    if (this.salido) {
      const s = this.salido
      queueMicrotask(() => {
        if (this.oyentesSalida.has(cb)) cb(s)
      })
    }
    return () => this.oyentesSalida.delete(cb)
  }

  /**
   * Salida ordenada: `salir` (rollback + close + exit en el trabajador), espera al
   * `exit` hasta `plazoMs` y luego SIGKILL. Nunca lanza.
   */
  async salir(plazoMs = 3000): Promise<void> {
    if (!this.hijo || this.salido) return
    const salido = this.esperarSalida()
    this.enviar<'salir'>({ op: 'salir' }, null).catch(() => {
      // la respuesta da igual: lo que cuenta es el `exit`
    })
    if (await this.conPlazo(salido, plazoMs)) return
    this.opciones.log(`no salió en ${plazoMs} ms: SIGKILL`)
    this.matar()
    await this.conPlazo(salido, 500)
  }

  /**
   * Mata el proceso sin más (Forzar, o respaldo de `salir`). `motivo`: el error con el que
   * se rechaza lo que siga en vuelo, en vez de la pérdida genérica. Es el Stop de SQLite:
   * node:sqlite no se interrumpe, así que parar una consulta es matar el
   * proceso de su consola, y la sentencia en vuelo tiene que volver como `cancelada`.
   */
  matar(motivo?: ErrorTrabajador): void {
    const hijo = this.hijo
    if (!hijo || this.salido) return
    if (motivo && !this.motivoMuerte) this.motivoMuerte = motivo
    try {
      hijo.kill('SIGKILL')
    } catch (err) {
      this.opciones.log(`no se pudo matar: ${(err as Error).message}`)
    }
  }

  // --- Internos --------------------------------------------------------------------------

  private alMensaje(m: unknown): void {
    const r = this.correlador.recibir(m)
    if (r.tipo === 'ruido') {
      this.opciones.log('mensaje del trabajador con forma desconocida (ignorado)')
      return
    }
    if (r.tipo === 'respuesta') {
      if (!r.encontrada) this.opciones.log(`respuesta tardía o desconocida id=${r.id} (ignorada)`)
      return
    }
    const evento = r.evento
    this.opciones.log(evento.ev === 'fatal' ? `fatal: ${this.limpiar(evento.mensaje)}` : `sesión perdida: ${evento.sesion}`)
    for (const cb of [...this.oyentesEvento]) {
      try {
        cb(evento)
      } catch (err) {
        this.opciones.log(`oyente de evento lanzó: ${(err as Error).message}`)
      }
    }
  }

  private alSalir(codigo: number | null, senal: string | null): void {
    if (this.salido) return
    const s: SalidaTrabajador = { codigo, senal }
    this.salido = s
    this.secretos.clear()
    const error: ErrorTrabajador = this.motivoMuerte ?? {
      clase: 'perdida',
      codigo: 'TESSERA-PROCESO',
      mensaje: `El proceso de la conexión terminó (${senal ? `señal ${senal}` : `código ${codigo}`}).`
    }
    const n = this.correlador.rechazarTodo(error)
    this.opciones.log(`salió codigo=${codigo} senal=${senal}${n ? `; ${n} petición(es) rechazada(s)` : ''}`)
    for (const f of [...this.esperasSalida]) f()
    this.esperasSalida.clear()
    for (const cb of [...this.oyentesSalida]) {
      try {
        cb(s)
      } catch (err) {
        this.opciones.log(`oyente de salida lanzó: ${(err as Error).message}`)
      }
    }
  }

  private esperarSalida(): Promise<void> {
    if (this.salido) return Promise.resolve()
    return new Promise((resolve) => this.esperasSalida.add(resolve))
  }

  /** true si `p` terminó antes del plazo. */
  private conPlazo(p: Promise<void>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms)
      p.then(() => {
        clearTimeout(t)
        resolve(true)
      })
    })
  }

  private limpiar(linea: string): string {
    return lineaParaLog(linea, this.secretos) ?? ''
  }

  private engancharSalida(flujo: NodeJS.ReadableStream | null, nombre: string): void {
    if (!flujo) return
    flujo.setEncoding('utf8')
    let resto = ''
    const volcar = (linea: string): void => {
      const l = lineaParaLog(linea, this.secretos)
      if (l !== null) this.opciones.log(`[${nombre}] ${l}`)
    }
    flujo.on('data', (trozo: string) => {
      resto += trozo
      let i = resto.indexOf('\n')
      while (i >= 0) {
        volcar(resto.slice(0, i))
        resto = resto.slice(i + 1)
        i = resto.indexOf('\n')
      }
      if (resto.length > LINEA_MAX_ACUMULADA) {
        volcar(resto)
        resto = ''
      }
    })
    flujo.on('end', () => {
      if (resto) volcar(resto)
      resto = ''
    })
  }
}
