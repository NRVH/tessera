// =============================================================================
// El mundo falso de los agentes para las pruebas de interfaz: `claude`, `codex` y `npm`
// de mentira por delante en el PATH, y un registro de versiones por HTTP local.
// `--version` contesta desde un fichero sin contar como arranque; `update` sube esa
// versión; lo demás es el AGENTE (tty crudo, apunta argv, pid y cada byte; sale al
// segundo ^C; la línea `fin` toca la campana). El paquete de Codex tiene la forma exacta
// que deja npm y su `codex.exe` (una copia del Node de las pruebas) cuelga de la raíz,
// para que uno vivo bloquee la carpeta (`EBUSY`) como el real. En Mac, `SHELL` es un guion
// sin perfiles. Lo importan 25 specs: un cambio aquí se verifica con la suite completa.
// =============================================================================

import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { Plataforma } from '../src/shared/plataforma.ts'
import { PLATAFORMA } from './tessera'

export type AgenteCli = 'claude' | 'codex'

/** Una línea del registro del mundo falso. */
export interface EventoFalso {
  /** Epoch ms de quien lo apuntó. */
  t: number
  tipo: 'arranque' | 'entrada' | 'salida' | 'campana' | 'update' | 'npm' | 'nieto'
  agente: AgenteCli | 'npm'
  pid: number
  cwd: string
  /** pid del proceso suelto que lanzó el agente (nieto; ver `conNieto`). */
  nieto?: number
  /** Argumentos (arranque, update, npm): lo que va DETRÁS del nombre del CLI. */
  argv?: string[]
  /** Bytes recibidos por stdin, en hexadecimal (entrada). */
  hex?: string
  /** Por qué salió el agente por su cuenta (salida). */
  motivo?: string
  /** ¿Salió bien la orden? (update, npm install). */
  ok?: boolean
  /** npm install: pids de Codex que seguían vivos al entrar. */
  codexVivos?: number[]
  /** npm install (Windows): el error al abrir `codex.exe` para escribir (`EBUSY`), o null. */
  bloqueo?: string | null
}

/**
 * El programa de los tres CLIs falsos. CommonJS a propósito (ver «Descartes»). Los
 * caracteres de control salen de `String.fromCharCode` y no de escapes, para que el
 * guion diga lo mismo lo lea quien lo lea.
 *
 * Uso: `node programa <carpetaEstado> <claude|codex|npm> ...args`
 */
const PROGRAMA = `'use strict'
const fs = require('node:fs')
const path = require('node:path')
const [estado, agente, ...args] = process.argv.slice(2)
const NL = String.fromCharCode(10)
const CRLF = String.fromCharCode(13, 10)
const BEL = String.fromCharCode(7)
const LOG = path.join(estado, 'eventos.log')
const fichero = (n) => path.join(estado, n)
const leer = (n, d) => { try { return fs.readFileSync(fichero(n), 'utf8').trim() } catch { return d } }
const existe = (n) => fs.existsSync(fichero(n))
const apunta = (tipo, extra) =>
  fs.appendFileSync(LOG, JSON.stringify(Object.assign({ t: Date.now(), tipo, agente, pid: process.pid, cwd: process.cwd() }, extra || {})) + NL)
const subirParche = (v) => { const p = String(v).split('.'); p[p.length - 1] = String(Number(p[p.length - 1]) + 1); return p.join('.') }
const vivo = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

function npm() {
  if (args[0] === 'prefix') {
    process.stdout.write(leer('npm.prefijo', '') + NL)
    return process.exit(0)
  }
  if (args[0] === 'install' || args[0] === 'i') {
    const codexVivos = []
    for (const l of fs.readFileSync(LOG, 'utf8').split(NL)) {
      if (!l) continue
      let e
      try { e = JSON.parse(l) } catch { continue }
      if (e.tipo === 'arranque' && e.agente === 'codex' && vivo(e.pid)) codexVivos.push(e.pid)
    }
    // Lo que npm no puede hacer con Codex en marcha: SOBRESCRIBIR su ejecutable. Windows
    // no deja abrir para escritura un .exe vivo (EBUSY), y ése es el fallo que se vigila.
    // Reintenta un par de segundos, como el graceful-fs de npm, para que un antivirus
    // que mira el .exe recién cerrado no pase por un Codex vivo.
    let bloqueo = null
    const exe = leer('npm.exe', '')
    if (exe && fs.existsSync(exe)) {
      const pausa = new Int32Array(new SharedArrayBuffer(4))
      for (let intento = 0; intento < 20; intento++) {
        try {
          fs.closeSync(fs.openSync(exe, 'r+'))
          bloqueo = null
          break
        } catch (err) {
          bloqueo = (err && err.code) || String(err)
          Atomics.wait(pausa, 0, 0, 100)
        }
      }
    }
    const falla = existe('npm.falla') || bloqueo !== null
    apunta('npm', { argv: args, ok: !falla, codexVivos, bloqueo })
    if (bloqueo !== null) {
      process.stderr.write('npm error code EBUSY' + NL + 'npm error syscall open' + NL + 'npm error path ' + exe + NL)
      return process.exit(1)
    }
    if (falla) {
      process.stderr.write('npm error code ETARGET' + NL + 'npm error notarget No matching version found.' + NL)
      return process.exit(1)
    }
    const spec = args.find((a) => a.startsWith('@openai/codex@'))
    if (spec) fs.writeFileSync(fichero('codex.version'), spec.slice('@openai/codex@'.length))
    process.stdout.write('changed 1 package in 1s' + NL)
    return process.exit(0)
  }
  apunta('npm', { argv: args, ok: true })
  process.exit(0)
}

function version() {
  const v = leer(agente + '.version', '0.0.0')
  process.stdout.write((agente === 'codex' ? 'codex-cli ' + v : v + ' (Claude Code)') + NL)
  process.exit(0)
}

function update() {
  const falla = existe(agente + '.update-falla')
  apunta('update', { argv: args, ok: !falla })
  if (falla) {
    process.stderr.write('Error: no se pudo descargar la versión nueva' + NL)
    return process.exit(1)
  }
  const destino = leer(agente + '.update-a', '') || subirParche(leer(agente + '.version', '0.0.0'))
  fs.writeFileSync(fichero(agente + '.version'), destino)
  process.stdout.write('Actualizado a ' + destino + NL)
  process.exit(0)
}

function agenteVivo() {
  apunta('arranque', { argv: args })
  if (existe('nieto')) {
    // Un proceso SUELTO y sordo, como un servidor MCP: cerrar el pty no se lo lleva; solo
    // muere si se mata el árbol entero.
    const hijo = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(function () {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true
    })
    hijo.unref()
    apunta('nieto', { nieto: hijo.pid })
  }
  process.stdout.write('AGENTE FALSO ' + agente + ' pid=' + process.pid + CRLF + process.cwd() + CRLF)
  // Algo vivo en la terminal, y además el latido que un CLI de verdad tiene mientras
  // piensa: sin él, un turno abierto se cerraría por silencio y no por la campana. Una
  // carpeta apuntada en «callados» deja de latir: es el CLI ocioso en su prompt.
  let n = 0
  const callado = () => leer('callados', '').split(NL).indexOf(process.cwd()) >= 0
  setInterval(() => { if (!callado()) process.stdout.write('tick ' + ++n + CRLF) }, 1000)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  let ultimoCtrlC = 0
  let linea = ''
  process.stdin.on('data', (b) => {
    apunta('entrada', { hex: b.toString('hex') })
    for (const byte of b) {
      if (byte === 3) {
        // Dos ^C seguidos (en menos de 3 s) salen; uno solo avisa, como los CLIs reales.
        const ahora = Date.now()
        if (ahora - ultimoCtrlC < 3000) {
          apunta('salida', { motivo: 'ctrl-c' })
          try { process.stdin.setRawMode(false) } catch {}
          return process.exit(0)
        }
        ultimoCtrlC = ahora
        linea = ''
        process.stdout.write('(pulsa Ctrl+C otra vez para salir)' + CRLF)
      } else if (byte === 13) {
        if (linea === 'fin') {
          apunta('campana')
          process.stdout.write(BEL)
        }
        linea = ''
      } else if (byte === 127 || byte === 8) {
        linea = linea.slice(0, -1)
      } else if (byte >= 32 && byte < 127) {
        linea += String.fromCharCode(byte)
      }
    }
  })
  process.stdin.resume()
}

if (agente === 'npm') npm()
else if (args[0] === '--version' || args[0] === '-v') version()
else if (args[0] === 'update') update()
else agenteVivo()
`

/** Un guion de Mac que ejecuta el `-c` SIN perfiles (ver la cabecera). */
const SHELL_DE_PRUEBAS =
  '#!/bin/sh\n# Ejecuta el -c sin perfiles: el PATH es el de la prueba.\n' +
  'if [ "$1" = "-ilc" ]; then exec /bin/sh -c "$2"; fi\nexec /bin/sh\n'

export interface OpcionesAgenteFalso {
  /** Versiones instaladas de partida. */
  versiones?: Partial<Record<AgenteCli, string>>
  /** Por PARÁMETRO, con la de las pruebas por defecto (la plataforma es un parámetro). */
  plataforma?: Plataforma
}

export interface AgenteFalso {
  /** Carpeta temporal del montaje (resuelta: en Mac, `/private/var/…`). La borra quien llama. */
  raiz: string
  /** Carpeta que va delante en el PATH (y prefijo de npm en Windows). */
  bin: string
  /** Registro de eventos (JSON por línea). */
  log: string
  /** Raíz del paquete de Codex tal como la verá el servicio. */
  raizCodex: string
  /** Variables para `abrirTessera`: PATH (y SHELL en Mac). */
  env: Record<string, string>
  eventos: () => EventoFalso[]
  /** Arranques de agente (no cuenta sondas ni `update`), de uno o de los dos. */
  arranques: (agente?: AgenteCli) => EventoFalso[]
  version: (agente: AgenteCli) => string
  /** Cambia la versión INSTALADA en disco (lo que hace el auto-update de Claude). */
  fijarVersion: (agente: AgenteCli, v: string) => void
  /** A qué versión sube `<cli> update` (si no, sube un parche). */
  destinoUpdate: (agente: AgenteCli, v: string) => void
  /** Hace fallar (o no) `npm install` o `<cli> update`. */
  fallar: (que: 'npm' | 'update-claude' | 'update-codex', si: boolean) => void
  /**
   * Calla (o devuelve la voz a) los agentes que corren en esa carpeta: dejan de latir, como
   * un CLI ocioso en su prompt. `cwd` es el que el propio agente apuntó al arrancar.
   */
  callar: (cwd: string, si: boolean) => void
  /** Los agentes que arranquen a partir de ahora lanzan (o no) un proceso suelto y lo apuntan. */
  conNieto: (si: boolean) => void
}

/** ¿Sigue vivo ese proceso? `kill(pid, 0)` no mata: sólo pregunta. */
export function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Ruta del ejecutable de un proceso (sólo Windows; null si no existe o no se puede
 * leer). Sirve para comprobar la PREMISA de las pruebas de Windows: que el Codex falso
 * corre desde la carpeta del paquete y, por tanto, bloquea lo que bloquearía el de
 * verdad. Si un día corriera desde otro sitio, «npm entró sin Codex vivo» pasaría por
 * bueno sin demostrar nada.
 */
export function rutaEjecutable(pid: number): string | null {
  try {
    const consulta = `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Math.trunc(pid)}').ExecutablePath`
    const salida = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', consulta], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000
    }).trim()
    return salida || null
  } catch {
    return null
  }
}

/**
 * Entradas de cada pid concatenadas en orden: un `exit` y su Enter pueden llegar en
 * dos trozos, y mirarlos por separado no los vería.
 */
export function entradaPorPid(eventos: readonly EventoFalso[]): Map<number, string> {
  const out = new Map<number, string>()
  for (const e of eventos) {
    if (e.tipo !== 'entrada') continue
    out.set(e.pid, (out.get(e.pid) ?? '') + (e.hex ?? ''))
  }
  return out
}

/**
 * `exit` seguido de CR o LF, en hexadecimal y ALINEADO A BYTES (un `65` a caballo entre
 * dos bytes no es una `e`): lo que teclea el cierre elegante de una shell.
 */
const HEX_EXIT = /^(?:..)*?65786974(?:0d|0a)/

/** Los pids que recibieron un `exit` + Enter. */
export function pidsConExit(eventos: readonly EventoFalso[]): number[] {
  return [...entradaPorPid(eventos)].filter(([, hex]) => HEX_EXIT.test(hex)).map(([pid]) => pid)
}

/**
 * Crea el mundo falso: la carpeta `bin` con `claude`, `codex` y `npm`, el paquete de
 * Codex con la forma de npm, el estado (versiones, fallos) y el registro de eventos.
 */
export function montarAgenteFalso(opts: OpcionesAgenteFalso = {}): AgenteFalso {
  const plataforma = opts.plataforma ?? PLATAFORMA
  const windows = plataforma === 'windows'
  // `realpathSync`: en macOS `/var` es un enlace a `/private/var`, y el agente apunta el
  // `getcwd()` ya resuelto; sin esto sus eventos no casarían nunca con las rutas de la
  // prueba (la misma trampa que documenta `arranque.spec.ts`). En Windows no cambia nada.
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'tessera-e2e-agentes-')))
  const bin = join(raiz, 'bin')
  const estado = join(raiz, 'estado')
  mkdirSync(bin)
  mkdirSync(estado)
  const log = join(estado, 'eventos.log')
  writeFileSync(log, '')
  const programa = join(raiz, 'agente-falso.cjs')
  writeFileSync(programa, PROGRAMA)
  // El Node del propio runner: seguro que existe y que entiende el programa.
  const node = process.execPath

  const versiones = { claude: '2.1.281', codex: '0.156.0', ...opts.versiones }
  writeFileSync(join(estado, 'claude.version'), versiones.claude)
  writeFileSync(join(estado, 'codex.version'), versiones.codex)

  let raizCodex: string
  if (windows) {
    // El paquete con la forma de npm: `<prefijo>\node_modules\@openai\codex`.
    raizCodex = join(bin, 'node_modules', '@openai', 'codex')
    mkdirSync(join(raizCodex, 'bin'), { recursive: true })
    writeFileSync(join(raizCodex, 'bin', 'codex.js'), PROGRAMA)
    const vendor = join(raizCodex, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'codex')
    mkdirSync(vendor, { recursive: true })
    const exe = join(vendor, 'codex.exe')
    // COPIA, y lo que se vigila es abrir el .exe para ESCRITURA. Medido antes de elegir:
    // renombrar la carpeta con el .exe vivo dentro SÍ funciona (npm la aparta y lo que falla
    // es borrar la apartada), así que una comprobación por rename no tiene dientes; abrir para
    // escribir da `EBUSY` con él vivo y se libera a los pocos ms de salir. Un enlace duro al
    // `node.exe` de Archivos de programa da `EPERM` a un usuario normal; la copia de ~86 MB
    // tarda unos 20 ms.
    copyFileSync(node, exe)
    // El shim, con la ruta RELATIVA que el servicio lee de él (ver la cabecera).
    const relExe = 'node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe'
    writeFileSync(
      join(bin, 'codex.cmd'),
      `@echo off\r\n"%~dp0${relExe}" "%~dp0node_modules\\@openai\\codex\\bin\\codex.js" "${estado}" codex %*\r\n`
    )
    for (const cli of ['claude', 'npm']) {
      writeFileSync(join(bin, `${cli}.cmd`), `@echo off\r\n"${node}" "${programa}" "${estado}" ${cli} %*\r\n`)
    }
    writeFileSync(join(estado, 'npm.prefijo'), bin)
    writeFileSync(join(estado, 'npm.exe'), exe)
  } else {
    raizCodex = join(bin, 'codex')
    for (const cli of ['claude', 'codex', 'npm']) {
      const ruta = join(bin, cli)
      writeFileSync(ruta, `#!/bin/sh\nexec "${node}" "${programa}" "${estado}" ${cli} "$@"\n`)
      chmodSync(ruta, 0o755)
    }
    writeFileSync(join(estado, 'npm.prefijo'), dirname(bin))
  }

  const env: Record<string, string> = { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` }
  if (!windows) {
    const shell = join(bin, 'shell-pruebas.sh')
    writeFileSync(shell, SHELL_DE_PRUEBAS)
    chmodSync(shell, 0o755)
    env.SHELL = shell
  }

  const eventos = (): EventoFalso[] =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as EventoFalso)

  const marca = (nombre: string, si: boolean): void => {
    const ruta = join(estado, nombre)
    if (si) writeFileSync(ruta, '1')
    else rmSync(ruta, { force: true })
  }

  return {
    raiz,
    bin,
    log,
    raizCodex,
    env,
    eventos,
    arranques: (agente) =>
      eventos().filter((e) => e.tipo === 'arranque' && (agente === undefined || e.agente === agente)),
    version: (agente) => readFileSync(join(estado, `${agente}.version`), 'utf8').trim(),
    fijarVersion: (agente, v) => writeFileSync(join(estado, `${agente}.version`), v),
    destinoUpdate: (agente, v) => writeFileSync(join(estado, `${agente}.update-a`), v),
    fallar: (que, si) => marca(que === 'npm' ? 'npm.falla' : `${que.slice('update-'.length)}.update-falla`, si),
    callar: (cwd, si) => {
      const ruta = join(estado, 'callados')
      let lista: string[] = []
      try {
        lista = readFileSync(ruta, 'utf8').split('\n').filter(Boolean)
      } catch {
        // Aún no hay ninguno.
      }
      const sin = lista.filter((c) => c !== cwd)
      writeFileSync(ruta, (si ? [...sin, cwd] : sin).join('\n'))
    },
    conNieto: (si) => marca('nieto', si)
  }
}

// -----------------------------------------------------------------------------
// Registro de versiones falso
// -----------------------------------------------------------------------------

export interface VersionesPublicadas {
  /** `latest` de `@openai/codex` (con sus binarios de plataforma ya publicados). */
  codex: string
  /** `latest` del servidor de versiones de Claude Code (y de su paquete de npm). */
  claude: string
  /** `stable` de Claude Code. */
  claudeStable: string
}

export interface RegistroFalso {
  /** `TESSERA_REGISTRO_NPM` y `TESSERA_RELEASES_CLAUDE` apuntando aquí. */
  env: Record<string, string>
  /** Lo publicado AHORA; se puede cambiar a mitad de prueba. */
  publicado: VersionesPublicadas
  /** Rutas pedidas, en orden (para depurar un «no vio la versión nueva»). */
  peticiones: string[]
  cerrar: () => Promise<void>
}

/** dist-tags de Codex con el binario de cada `<so>-<arch>` ya publicado. */
function distTagsCodex(v: string): Record<string, string> {
  const tags: Record<string, string> = { latest: v }
  for (const so of ['win32', 'darwin', 'linux']) {
    for (const arch of ['x64', 'arm64']) tags[`${so}-${arch}`] = `${v}-${so}-${arch}`
  }
  return tags
}

/**
 * Levanta el registro falso en `127.0.0.1` con un puerto libre. Responde lo mismo que
 * el de verdad para las tres URLs que pide el servicio; el resto, 404.
 */
export async function abrirRegistroFalso(inicial: Partial<VersionesPublicadas> = {}): Promise<RegistroFalso> {
  const publicado: VersionesPublicadas = { codex: '0.156.0', claude: '2.1.281', claudeStable: '2.1.273', ...inicial }
  const peticiones: string[] = []
  const servidor = createServer((req, res) => {
    let ruta = req.url ?? ''
    try {
      ruta = decodeURIComponent(ruta)
    } catch {
      // Tal cual: sólo sirve para comparar.
    }
    peticiones.push(ruta)
    const json = (datos: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(datos))
    }
    const texto = (t: string): void => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(t)
    }
    if (ruta === '/npm/-/package/@openai/codex/dist-tags') return json(distTagsCodex(publicado.codex))
    if (ruta === '/npm/-/package/@anthropic-ai/claude-code/dist-tags') {
      return json({ latest: publicado.claude, stable: publicado.claudeStable })
    }
    if (ruta === '/claude/latest') return texto(publicado.claude)
    if (ruta === '/claude/stable') return texto(publicado.claudeStable)
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
  const { port } = servidor.address() as AddressInfo
  const base = `http://127.0.0.1:${port}`
  return {
    env: { TESSERA_REGISTRO_NPM: `${base}/npm`, TESSERA_RELEASES_CLAUDE: `${base}/claude` },
    publicado,
    peticiones,
    cerrar: () =>
      new Promise<void>((listo) => {
        servidor.closeAllConnections()
        servidor.close(() => listo())
      })
  }
}
