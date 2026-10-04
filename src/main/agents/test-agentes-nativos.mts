#!/usr/bin/env node
// =============================================================================
// Prueba del servicio de los agentes nativos y de su cableado en el controlador del
// agente (npm run test:agentes-nativos), todo con falsos (ejecutor, red, reloj, disco,
// tabla de procesos, terminales) y la plataforma por parámetro: piezas puras, sondas,
// comprobar, sesiones, instalar con su orden y su candado, bloqueadores, versiones
// hostiles, Mac, cadencia, y el controlador (parada atómica, vuelta al chat, sondas).
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import { register } from 'node:module'
import {
  AgentesNativos,
  baseUrl,
  canalClaude,
  candidatosPaquetePlataforma,
  candidatosRaizCodexWindows,
  installMethodDe,
  parsearDistTags,
  raizCodexDesdeRuta,
  raizCodexDesdeShim,
  urlDistTags,
  versionCaskBrew,
  type InfoSesionNativa
} from './agentesNativos.ts'
import { crearDetectorEnvio } from './lineaEnviada.ts'
import type { OpcionesEjecucion, ResultadoEjecucion } from './ejecutorShell.ts'
import type { AgentDetenerVariasResult, AgentKind } from '../../shared/agent-terminal-ipc.ts'
import type { EstadoAgentesNativos, ProgresoAgentesNativos } from '../../shared/agentes-nativos-ipc.ts'
import type { Plataforma } from '../../shared/plataforma.ts'
import type { ProcesoSistema } from '../update/procesosSistema.ts'
import type { Profile } from '../profiles/types.ts'

let pasadas = 0
let total = 0
function hr(t: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(t)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasadas++
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}`)
  console.log(`        ${evidence}`)
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))
async function hasta(cond: () => boolean, max = 400): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    if (cond()) return true
    await tick()
  }
  return cond()
}
function diferido<T>(): { promesa: Promise<T>; resolver: (v: T) => void } {
  let resolver: (v: T) => void = () => {}
  const promesa = new Promise<T>((r) => {
    resolver = r
  })
  return { promesa, resolver }
}

// -----------------------------------------------------------------------------
// El mundo falso
// -----------------------------------------------------------------------------

const W = {
  home: 'C:\\Users\\u',
  shim: 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.ps1',
  prefijo: 'C:\\Users\\u\\AppData\\Roaming\\npm',
  raiz: 'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex',
  claudeExe: 'C:\\Users\\u\\.local\\bin\\claude.exe'
}
const EXE_CODEX = `${W.raiz}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe`
const MAC = {
  home: '/Users/u',
  codexBin: '/opt/homebrew/bin/codex',
  codexReal: '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js',
  prefijo: '/opt/homebrew',
  claudeBin: '/Users/u/.local/bin/claude',
  claudeReal: '/Users/u/.local/share/claude/versions/2.1.280'
}

/** El `codex.ps1` que npm genera (medido en esta máquina, recortado). */
const SHIM_PS1 = [
  '#!/usr/bin/env pwsh',
  '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent',
  'if (Test-Path "$basedir/node$exe") {',
  '    & "$basedir/node$exe"  "$basedir/node_modules/@openai/codex/bin/codex.js" $args',
  '}'
].join('\n')
const SHIM_CMD = 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*'

const URL_TAGS_CODEX = 'https://registry.npmjs.org/-/package/@openai/codex/dist-tags'
const URL_TAGS_CLAUDE = 'https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags'
const URL_CLAUDE_LATEST = 'https://downloads.claude.ai/claude-code-releases/latest'
const URL_CLAUDE_STABLE = 'https://downloads.claude.ai/claude-code-releases/stable'
const URL_CASK_CODEX = 'https://formulae.brew.sh/api/cask/codex.json'

/**
 * Claude Code por npm en Windows. La forma ACTUAL del paquete (medida en 2.1.281): su
 * `bin` es `bin\claude.exe`, un enlace duro al binario nativo del paquete de plataforma
 * que coloca su `postinstall`, así que el proceso corre DESDE la raíz. Las versiones
 * viejas corrían como `node.exe <raiz>\cli.js`.
 */
const NPM_CLAUDE = {
  shim: `${W.prefijo}\\claude.ps1`,
  raiz: `${W.prefijo}\\node_modules\\@anthropic-ai\\claude-code`
}
const EXE_CLAUDE_NPM = `${NPM_CLAUDE.raiz}\\bin\\claude.exe`
const LINEA_CLAUDE_VIEJO = `"C:\\Program Files\\nodejs\\node.exe" "${W.prefijo}/node_modules/@anthropic-ai/claude-code/cli.js" --resume x`

/** bun: node_modules global PLANO; el binario vive en el HERMANO `codex-win32-x64`. */
const BUN = {
  exe: 'C:\\Users\\u\\.bun\\bin\\codex.exe',
  raiz: 'C:\\Users\\u\\.bun\\install\\global\\node_modules\\@openai\\codex',
  plat: 'C:\\Users\\u\\.bun\\install\\global\\node_modules\\@openai\\codex-win32-x64'
}
const EXE_BUN = `${BUN.plat}\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`

/** pnpm: el shim apunta a un ENLACE; `realpath` lleva la raíz y su binario al almacén. */
const PNPM_ALMACEN = 'C:\\Users\\u\\AppData\\Local\\pnpm\\global\\5\\node_modules\\.pnpm'
const PNPM = {
  shim: 'C:\\Users\\u\\AppData\\Local\\pnpm\\codex.ps1',
  textoShim: '"$basedir/global/5/node_modules/@openai/codex/bin/codex.js" $args',
  enlace: 'C:\\Users\\u\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@openai\\codex',
  raiz: `${PNPM_ALMACEN}\\@openai+codex@0.156.0\\node_modules\\@openai\\codex`,
  enlacePlat: `${PNPM_ALMACEN}\\@openai+codex@0.156.0\\node_modules\\@openai\\codex-win32-x64`,
  plat: `${PNPM_ALMACEN}\\@openai+codex@0.156.0-win32-x64\\node_modules\\@openai\\codex`
}
const EXE_PNPM = `${PNPM.plat}\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`

/** Codex por el cask de Homebrew (Mac): `bin/codex` del cask, según su API. */
const MAC_CASK = '/opt/homebrew/Caskroom/codex/0.156.0/bin/codex'
const MAC_FORMULA = '/opt/homebrew/Cellar/codex/0.156.0/bin/codex'

function redPorDefecto(): Record<string, string | Error> {
  return {
    [URL_TAGS_CODEX]: JSON.stringify({
      latest: '0.156.1',
      'win32-x64': '0.156.1-win32-x64',
      'darwin-arm64': '0.156.1-darwin-arm64',
      alpha: '0.155.0-alpha.16.4'
    }),
    [URL_TAGS_CLAUDE]: JSON.stringify({ latest: '2.1.281', stable: '2.1.273', next: '2.1.281' }),
    [URL_CLAUDE_LATEST]: '2.1.281\n',
    [URL_CLAUDE_STABLE]: '2.1.273\n'
  }
}

interface OpcionesMundo {
  plataforma?: Plataforma
  claude?: string | null
  codex?: string | null
  archivos?: Record<string, string>
  red?: Record<string, string | Error>
  procesos?: () => ProcesoSistema[]
  sesiones?: () => InfoSesionNativa[]
  detener?: (ids: string[]) => AgentDetenerVariasResult
  /** Sustituye a las órdenes de instalación (no a las sondas). */
  orden?: (cmd: string, op: OpcionesEjecucion) => Promise<ResultadoEjecucion> | ResultadoEjecucion
  env?: Record<string, string>
  rutaCodex?: string
  /** Lo que responde `(Get-Command claude).Source` en Windows. */
  rutaClaude?: string
  /** Más entradas (o sustitutas) para el `realpath` falso: ruta -> ruta real. */
  reales?: Record<string, string>
}

const ok = (salida: string): ResultadoEjecucion => ({ ok: true, codigo: 0, salida, tope: false })
const no = (salida = ''): ResultadoEjecucion => ({ ok: false, codigo: 1, salida, tope: false, error: 'falló' })

function crearMundo(o: OpcionesMundo = {}) {
  const plataforma: Plataforma = o.plataforma ?? 'windows'
  const windows = plataforma === 'windows'
  const m = {
    t: 1_000_000,
    ver: {
      claude: o.claude === undefined ? '2.1.280' : o.claude,
      codex: o.codex === undefined ? '0.156.0' : o.codex
    } as Record<'claude' | 'codex', string | null>,
    llamadas: [] as string[],
    pasos: [] as string[],
    emitidos: [] as EstadoAgentesNativos[],
    progreso: [] as ProgresoAgentesNativos[],
    timers: [] as Array<{ fn: () => void; ms: number; vivo: boolean }>,
    detenerPedidos: [] as string[][],
    pausarSondas: false,
    sondasEnEspera: [] as Array<() => void>,
    red: { ...redPorDefecto(), ...(o.red ?? {}) },
    cuenta(cmd: string): number {
      return m.llamadas.filter((c) => c === cmd).length
    },
    soltarSondas(): void {
      const s = m.sondasEnEspera.splice(0)
      for (const r of s) r()
    },
    correrTimers(): number {
      const vivos = m.timers.filter((x) => x.vivo)
      for (const x of vivos) x.vivo = false
      for (const x of vivos) x.fn()
      return vivos.length
    }
  }
  const archivos: Record<string, string> = windows
    ? { [`${W.home}\\.claude.json`]: '{"installMethod":"native","otro":1}', [W.shim]: SHIM_PS1, ...(o.archivos ?? {}) }
    : { [`${MAC.home}/.claude.json`]: '{"installMethod":"native"}', ...(o.archivos ?? {}) }
  const reales: Record<string, string> = {
    ...(windows
      ? { [W.shim]: W.shim, [W.raiz]: W.raiz, [W.prefijo]: W.prefijo, [W.claudeExe]: W.claudeExe }
      : { [MAC.codexBin]: MAC.codexReal, [MAC.prefijo]: MAC.prefijo, [MAC.claudeBin]: MAC.claudeReal }),
    ...(o.reales ?? {})
  }

  async function ejecutar(cmd: string, op: OpcionesEjecucion): Promise<ResultadoEjecucion> {
    m.llamadas.push(cmd)
    m.pasos.push(`ejec:${cmd}`)
    if (cmd === 'claude --version' || cmd === 'codex --version') {
      if (m.pausarSondas) await new Promise<void>((r) => m.sondasEnEspera.push(r))
      const clave = cmd.startsWith('claude') ? 'claude' : 'codex'
      const v = m.ver[clave]
      return v === null ? no() : ok(clave === 'claude' ? `${v} (Claude Code)` : `codex-cli ${v}`)
    }
    if (cmd === '(Get-Command codex -ErrorAction Stop).Source') return windows ? ok(o.rutaCodex ?? W.shim) : no()
    if (cmd === '(Get-Command claude -ErrorAction Stop).Source') return windows ? ok(o.rutaClaude ?? W.claudeExe) : no()
    if (cmd === 'command -v codex') return windows ? no() : ok(MAC.codexBin)
    if (cmd === 'command -v claude') return windows ? no() : ok(MAC.claudeBin)
    if (cmd === 'npm prefix -g') return ok(windows ? W.prefijo : MAC.prefijo)
    if (o.orden) return o.orden(cmd, op)
    if (cmd.startsWith('npm install -g') && cmd.includes('@openai/codex@')) {
      const v = /@openai\/codex@([^'"\s]+)/.exec(cmd)
      m.ver.codex = v ? v[1] : null
      op.onLinea?.('added 1 package in 3s')
      return ok('added 1 package in 3s')
    }
    if (cmd === 'claude update') {
      m.ver.claude = '2.1.281'
      op.onLinea?.('Successfully updated')
      return ok('Successfully updated')
    }
    if (cmd === 'codex update') {
      m.ver.codex = '0.156.1'
      return ok('')
    }
    return no(`orden inesperada: ${cmd}`)
  }

  const svc = new AgentesNativos({
    plataforma,
    arch: windows ? 'x64' : 'arm64',
    ejecutar,
    fetchTexto: async (url) => {
      m.pasos.push(`red:${url}`)
      const r = m.red[url]
      if (r instanceof Error) throw r
      if (r === undefined) throw new Error('HTTP 404')
      return r
    },
    ahora: () => m.t,
    listarProcesos: async () => {
      m.pasos.push('listar')
      return o.procesos ? o.procesos() : []
    },
    leerTexto: async (ruta) => {
      const t = archivos[ruta]
      if (t === undefined) throw new Error(`ENOENT ${ruta}`)
      return t
    },
    env: o.env ?? {},
    homedir: windows ? W.home : MAC.home,
    sesiones: o.sesiones ?? (() => []),
    detenerVarias: async (ids) => {
      m.pasos.push('detener')
      m.detenerPedidos.push(ids)
      return o.detener ? o.detener(ids) : { ok: true, detenidas: ids }
    },
    // Por agente, como el controlador: 100 es el pty de una sesión de Codex y 300 el de
    // una de Claude.
    pidsTessera: (agente) => (agente === 'codex' ? [100] : [300]),
    emitirCambio: (e) => {
      m.emitidos.push(e)
      m.pasos.push(`cambio:${e.instalando}`)
    },
    emitirProgreso: (p) => m.progreso.push(p),
    log: () => {},
    resolverRuta: async (r) => {
      const real = reales[r]
      if (real === undefined) throw new Error(`ENOENT ${r}`)
      return real
    },
    esperar: async (ms) => {
      m.t += ms
    },
    programar: (fn, ms) => {
      const x = { fn, ms, vivo: true }
      m.timers.push(x)
      return () => {
        x.vivo = false
      }
    }
  })
  return { m, svc }
}

// =============================================================================
hr('(1) Piezas puras')
// =============================================================================

check(
  '(1a) baseUrl acepta http(s) y quita las barras finales',
  baseUrl('http://127.0.0.1:4873//', 'X') === 'http://127.0.0.1:4873' && baseUrl(' https://r.x/npm ', 'X') === 'https://r.x/npm',
  `${baseUrl('http://127.0.0.1:4873//', 'X')} | ${baseUrl(' https://r.x/npm ', 'X')}`
)
check(
  '(1b) baseUrl rechaza lo que no es http(s) y manda el defecto',
  ['file:///etc', 'javascript:alert(1)', '', 'http://a b', undefined].every((v) => baseUrl(v, 'DEF') === 'DEF'),
  'file:, javascript:, vacío, con espacio, ausente -> DEF'
)
check(
  '(1c) urlDistTags con el scope tal cual',
  urlDistTags('https://registry.npmjs.org', '@openai/codex') === URL_TAGS_CODEX,
  urlDistTags('https://registry.npmjs.org', '@openai/codex')
)
{
  const t = parsearDistTags('{"latest":"1.0.0","n":3,"x":null}')
  check(
    '(1d) parsearDistTags: sólo entradas de texto; array y basura -> null',
    t !== null && t.latest === '1.0.0' && !('n' in t) && parsearDistTags('[1]') === null && parsearDistTags('<html>') === null,
    JSON.stringify(t)
  )
}
check(
  '(1e) canalClaude: stable, y todo lo demás latest',
  canalClaude('{"autoUpdatesChannel":"stable"}') === 'stable' &&
    canalClaude('{"autoUpdatesChannel":"beta/../x"}') === 'latest' &&
    canalClaude('{}') === 'latest' &&
    canalClaude('{roto') === 'latest' &&
    canalClaude(null) === 'latest',
  'stable | valor raro | ausente | JSON roto | sin fichero'
)
check(
  '(1f) installMethodDe',
  installMethodDe('{"installMethod":"native"}') === 'native' &&
    installMethodDe('{"installMethod":""}') === null &&
    installMethodDe('{}') === null &&
    installMethodDe('no json') === null,
  'native | vacío | ausente | basura'
)
check(
  '(1g) raíz desde el shim .ps1 de npm',
  raizCodexDesdeShim(SHIM_PS1, 'C:\\Users\\u\\AppData\\Roaming\\npm') === W.raiz,
  String(raizCodexDesdeShim(SHIM_PS1, 'C:\\Users\\u\\AppData\\Roaming\\npm'))
)
check(
  '(1h) raíz desde el shim .cmd de npm',
  raizCodexDesdeShim(SHIM_CMD, 'C:\\Users\\u\\AppData\\Roaming\\npm') === W.raiz,
  String(raizCodexDesdeShim(SHIM_CMD, 'C:\\Users\\u\\AppData\\Roaming\\npm'))
)
{
  const pnpm = '"$basedir/global/5/node_modules/@openai/codex/bin/codex.js" $args'
  const r = raizCodexDesdeShim(pnpm, 'C:\\Users\\u\\AppData\\Local\\pnpm')
  check(
    '(1i) raíz desde un shim de pnpm (ruta relativa más larga)',
    r === 'C:\\Users\\u\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@openai\\codex',
    String(r)
  )
  check('(1j) un shim sin la ruta del paquete -> null', raizCodexDesdeShim('echo hola', 'C:\\x') === null, 'null')
}
{
  const c = candidatosRaizCodexWindows('C:\\Users\\u\\.bun\\bin\\codex.exe', null)
  check(
    '(1k) candidatas de Windows: npm y la forma de bun',
    c.includes('C:\\Users\\u\\.bun\\bin\\node_modules\\@openai\\codex') &&
      c.includes('C:\\Users\\u\\.bun\\install\\global\\node_modules\\@openai\\codex'),
    JSON.stringify(c)
  )
  const d = candidatosRaizCodexWindows(W.shim, SHIM_PS1)
  check('(1l) la del shim va primera y sin duplicados', d[0] === W.raiz && d.length === 1, JSON.stringify(d))
}
check(
  '(1m) POSIX: sube desde el bin real hasta @openai/codex; Homebrew -> null',
  raizCodexDesdeRuta(MAC.codexReal) === '/opt/homebrew/lib/node_modules/@openai/codex' &&
    raizCodexDesdeRuta('/opt/homebrew/Caskroom/codex/0.156.1/codex-aarch64-apple-darwin') === null &&
    raizCodexDesdeRuta('/opt/homebrew/Cellar/codex/0.156.1/bin/codex') === null,
  String(raizCodexDesdeRuta(MAC.codexReal))
)
{
  const c = candidatosPaquetePlataforma(W.raiz, '@openai', 'codex', 'x64')
  check(
    '(1n) paquete del binario: primero ANIDADO (npm), luego el HERMANO del scope (bun, enlace de pnpm), como require.resolve',
    c.length === 2 &&
      c[0] === `${W.raiz}\\node_modules\\@openai\\codex-win32-x64` &&
      c[1] === 'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex-win32-x64',
    JSON.stringify(c)
  )
  const a = candidatosPaquetePlataforma(NPM_CLAUDE.raiz, '@anthropic-ai', 'claude-code', 'arm64')
  check(
    '(1o) …y con Claude en arm64 el nombre sale de su paquete y de la arquitectura',
    a[0] === `${NPM_CLAUDE.raiz}\\node_modules\\@anthropic-ai\\claude-code-win32-arm64`,
    JSON.stringify(a)
  )
}
check(
  '(1p) versionCaskBrew: `version` exacta; con `,build`, no JSON, array o no texto -> null',
  versionCaskBrew('{"token":"codex","tap":"homebrew/cask","version":"0.156.1"}') === '0.156.1' &&
    versionCaskBrew('{"version":"0.156.1,20260901"}') === null &&
    versionCaskBrew('{"version":"latest"}') === null &&
    versionCaskBrew('{"version":3}') === null &&
    versionCaskBrew('<html>proxy</html>') === null &&
    versionCaskBrew('[{"version":"1.0.0"}]') === null,
  'exacta | ,build | latest | número | html | array'
)

// =============================================================================
hr('(2) Sondas: una en vuelo por agente, sin caché de tiempo')
// =============================================================================
{
  const { m, svc } = crearMundo()
  m.pausarSondas = true
  const a = svc.instalada('codex')
  const b = svc.instalada('codex')
  await hasta(() => m.sondasEnEspera.length > 0)
  check('(2a) dos peticiones a la vez -> UNA sonda', m.cuenta('codex --version') === 1, `${m.cuenta('codex --version')} sonda(s)`)
  m.pausarSondas = false
  m.soltarSondas()
  const [va, vb] = await Promise.all([a, b])
  check('(2b) las dos reciben la misma versión', va === '0.156.0' && vb === '0.156.0', `${va} / ${vb}`)

  await svc.instalada('codex')
  await svc.instalada('codex')
  check(
    '(2c) dos llamadas SEGUIDAS, no simultáneas, sondean dos veces: no hay caché de tiempo',
    m.cuenta('codex --version') === 3,
    `${m.cuenta('codex --version')} sonda(s)`
  )

  m.pausarSondas = true
  const c = svc.instalada('codex')
  await hasta(() => m.sondasEnEspera.length > 0)
  const d = svc.instalada('codex')
  check('(2d) una llamada durante una sonda en vuelo se une a ella', m.cuenta('codex --version') === 4, `${m.cuenta('codex --version')} sonda(s)`)
  m.pausarSondas = false
  m.soltarSondas()
  const [vc1, vd] = await Promise.all([c, d])
  check('(2e) …y recibe su mismo resultado', vc1 === '0.156.0' && vd === '0.156.0', `${vc1} / ${vd}`)

  // Lo que la caché habría roto: un CLI cambia en disco por su cuenta (Claude se
  // actualiza solo; cualquiera, desde otra terminal), y la versión con la que arranca una
  // sesión tiene que ser la del binario de AHORA, no la de hace 30 s.
  m.ver.codex = '0.156.1'
  const tras = await svc.instalada('codex')
  check('(2f) el binario cambió en disco: la siguiente sonda ya lo ve', tras === '0.156.1', String(tras))

  m.ver.claude = null
  const vc = await svc.instalada('claude-code')
  const e = svc.estado()
  check(
    '(2g) una sonda fallida da null y un error legible (con el nombre del sistema, no a mano)',
    vc === null && e.claude.instalada === null && (e.claude.error ?? '').includes('Claude Code') && (e.claude.error ?? '').includes('tu Windows'),
    String(e.claude.error)
  )
}

// =============================================================================
hr('(3) Comprobar en Windows')
// =============================================================================
{
  const procesos: ProcesoSistema[] = [
    { pid: 100, ppid: 10, nombre: 'powershell.exe', ruta: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
    { pid: 101, ppid: 100, nombre: 'node.exe', ruta: 'C:\\Program Files\\nodejs\\node.exe' },
    { pid: 102, ppid: 101, nombre: 'codex.exe', ruta: EXE_CODEX },
    { pid: 500, ppid: 5, nombre: 'codex.exe', ruta: EXE_CODEX, lineaComando: `"${EXE_CODEX}" app-server` }
  ]
  const { m, svc } = crearMundo({ procesos: () => procesos })
  const e = await svc.comprobar()
  const cx = e.codex
  check(
    '(3a) Codex: método npm por el shim + `npm prefix -g`, instalable y hay que parar',
    cx.metodo === 'npm' && cx.instalable && cx.requiereParar && cx.hayNueva && cx.ultima === '0.156.1' && cx.instalada === '0.156.0',
    JSON.stringify({ metodo: cx.metodo, instalable: cx.instalable, parar: cx.requiereParar, nueva: cx.hayNueva, ultima: cx.ultima })
  )
  check(
    '(3b) vista previa: el Codex ajeno (app-server de un editor) bloquea; el de la sesión de Tessera no',
    cx.bloqueadores.length === 1 && cx.bloqueadores[0].pid === 500 && cx.bloqueadores[0].esDemonio,
    JSON.stringify(cx.bloqueadores)
  )
  const cl = e.claude
  check(
    '(3c) Claude: nativo por installMethod de ~/.claude.json, canal latest, `claude update` sin parar',
    cl.metodo === 'nativo' && cl.canal === 'latest' && cl.ultima === '2.1.281' && cl.hayNueva && cl.instalable && !cl.requiereParar,
    JSON.stringify({ metodo: cl.metodo, canal: cl.canal, ultima: cl.ultima, nueva: cl.hayNueva })
  )
  check('(3d) Claude nativo no pide la tabla de procesos (sólo una consulta: la de Codex)', m.pasos.filter((p) => p === 'listar').length === 1, `${m.pasos.filter((p) => p === 'listar').length} listado(s)`)
  check('(3e) comprobar emite CAMBIO y fecha la comprobación', m.emitidos.length >= 1 && cx.comprobadoEn === m.t, `${m.emitidos.length} emisión(es)`)
  check('(3f) nada de «tu Windows» en errores cuando todo fue bien', cx.error === null && cl.error === null, `${cx.error} / ${cl.error}`)
}

// --- Claude por npm en Windows: su orden exige parar, así que tiene que tener raíz ---
const mundoClaudeNpm = (procesos: () => ProcesoSistema[]): ReturnType<typeof crearMundo> => {
  const mundo: { m?: ReturnType<typeof crearMundo>['m'] } = {}
  const r = crearMundo({
    rutaClaude: NPM_CLAUDE.shim,
    archivos: { [`${W.home}\\.claude.json`]: '{"installMethod":"npm-global"}' },
    reales: { [NPM_CLAUDE.shim]: NPM_CLAUDE.shim, [NPM_CLAUDE.raiz]: NPM_CLAUDE.raiz },
    procesos,
    orden: (cmd, op) => {
      if (!cmd.startsWith('npm install -g') || !cmd.includes('@anthropic-ai/claude-code@')) return no(`orden inesperada: ${cmd}`)
      if (mundo.m) mundo.m.ver.claude = '2.1.281'
      op.onLinea?.('changed 1 package in 4s')
      return ok('changed 1 package in 4s')
    }
  })
  mundo.m = r.m
  return r
}
{
  const procesos: ProcesoSistema[] = [
    // La sesión de Tessera (pty 300) con Claude: la para el propio flujo.
    { pid: 300, ppid: 10, nombre: 'powershell.exe', ruta: 'C:\\Windows\\powershell.exe' },
    { pid: 301, ppid: 300, nombre: 'claude.exe', ruta: EXE_CLAUDE_NPM },
    // Otra terminal con la versión ACTUAL (corre desde la raíz)…
    { pid: 400, ppid: 1, nombre: 'pwsh.exe', ruta: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
    { pid: 401, ppid: 400, nombre: 'claude.exe', ruta: EXE_CLAUDE_NPM },
    // …y otra con una versión VIEJA: node.exe (de fuera) corriendo <raiz>\cli.js.
    { pid: 500, ppid: 1, nombre: 'node.exe', ruta: 'C:\\Program Files\\nodejs\\node.exe', lineaComando: LINEA_CLAUDE_VIEJO },
    // Un Claude lanzado desde una sesión de CODEX (pty 100): el flujo de Claude no la para.
    { pid: 100, ppid: 10, nombre: 'powershell.exe', ruta: 'C:\\Windows\\powershell.exe' },
    { pid: 110, ppid: 100, nombre: 'claude.exe', ruta: EXE_CLAUDE_NPM }
  ]
  const { m, svc } = mundoClaudeNpm(() => procesos)
  const e = await svc.comprobar()
  const cl = e.claude
  check(
    '(3g) Claude por npm en Windows: instalable, hay que parar, y con raíz (mira la tabla de procesos)',
    cl.metodo === 'npm' && cl.instalable && cl.requiereParar && cl.hayNueva && m.cuenta('npm prefix -g') >= 2,
    JSON.stringify({ metodo: cl.metodo, parar: cl.requiereParar, nueva: cl.hayNueva, prefijos: m.cuenta('npm prefix -g') })
  )
  const pids = cl.bloqueadores.map((b) => b.pid).sort((a, b) => a - b)
  check(
    '(3h) vista previa: avisan el Claude de otra terminal (bin\\claude.exe), el viejo (node.exe <raiz>\\cli.js) y el colgado de una sesión de CODEX; el de la sesión de Claude no',
    JSON.stringify(pids) === JSON.stringify([110, 401, 500]),
    JSON.stringify(cl.bloqueadores)
  )
}
{
  // Un claude.exe huérfano (su pty ya murió) que tarda tres vueltas en irse.
  let vueltas = 0
  const { m, svc } = mundoClaudeNpm(() => {
    vueltas++
    return vueltas <= 3 ? [{ pid: 302, ppid: 301, nombre: 'claude.exe', ruta: EXE_CLAUDE_NPM }] : []
  })
  await svc.comprobar()
  vueltas = 0
  const t0 = m.t
  const r = await svc.instalar({ agente: 'claude-code', detener: ['s1'] })
  const orden = m.llamadas.find((c) => c.startsWith('npm install -g'))
  check(
    '(3i) instalar Claude por npm: para, ESPERA al que tarda en morir y ejecuta npm',
    r.ok && r.detenidas.join() === 's1' && m.t - t0 === 900 && vueltas === 4 && (orden ?? '').includes("'@anthropic-ai/claude-code@2.1.281'"),
    `${JSON.stringify({ ok: r.ok, motivo: r.motivo })}, ${m.t - t0} ms, ${vueltas} listados, ${orden}`
  )
}
{
  const { m, svc } = mundoClaudeNpm(() => [
    { pid: 500, ppid: 1, nombre: 'node.exe', ruta: 'C:\\Program Files\\nodejs\\node.exe', lineaComando: LINEA_CLAUDE_VIEJO }
  ])
  await svc.comprobar()
  const t0 = m.t
  const r = await svc.instalar({ agente: 'claude-code', detener: ['s1'] })
  check(
    "(3j) …y si sigue vivo tras el presupuesto: 'bloqueado', lo nombra y NO ejecuta npm",
    !r.ok &&
      r.motivo === 'bloqueado' &&
      r.bloqueadores?.[0]?.pid === 500 &&
      (r.detalle ?? '').includes('node.exe (pid 500)') &&
      m.t - t0 >= 8000 &&
      !m.llamadas.some((c) => c.startsWith('npm install')),
    `${r.motivo}, ${m.t - t0} ms, ${String(r.detalle)}`
  )
}
{
  // Mac: Claude por npm no para a nadie, así que ni `npm prefix -g` de más ni tabla.
  const { m, svc } = crearMundo({
    plataforma: 'mac',
    archivos: { [`${MAC.home}/.claude.json`]: '{"installMethod":"npm-global"}' },
    reales: { [MAC.claudeBin]: '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe' }
  })
  const e = await svc.comprobar()
  check(
    '(3k) Claude por npm en Mac: sin parar, sin tabla de procesos y sin sondear el prefijo para él',
    e.claude.metodo === 'npm' && !e.claude.requiereParar && !m.pasos.includes('listar') && m.cuenta('npm prefix -g') === 1,
    JSON.stringify({ metodo: e.claude.metodo, parar: e.claude.requiereParar, prefijos: m.cuenta('npm prefix -g') })
  )
}

// =============================================================================
hr('(4) Sesiones y atrasada')
// =============================================================================
{
  const sesiones: InfoSesionNativa[] = [
    { sessionId: 'a', profileId: 'p', projectHostPath: 'C:\\p', agente: 'codex', versionLanzada: '0.156.0', trabajando: false, esperandoRespuesta: false, puedeTenerTextoSinEnviar: false },
    { sessionId: 'b', profileId: 'p', projectHostPath: 'C:\\p', agente: 'claude-code', versionLanzada: '2.1.281', trabajando: true, esperandoRespuesta: false, puedeTenerTextoSinEnviar: true },
    { sessionId: 'c', profileId: 'p', projectHostPath: 'C:\\p', agente: 'claude-code', versionLanzada: null, trabajando: false, esperandoRespuesta: true, puedeTenerTextoSinEnviar: false }
  ]
  const { svc } = crearMundo({ codex: '0.156.1', claude: '2.1.281', sesiones: () => sesiones })
  await svc.comprobar()
  const e = svc.estado()
  const at = Object.fromEntries(e.sesiones.map((s) => [s.sessionId, s.atrasada]))
  check(
    '(4a) atrasada = lanzada < instalada; al día no; desconocida no',
    at.a === true && at.b === false && at.c === false,
    JSON.stringify(at)
  )
  check(
    '(4b) las sesiones son exactamente las del controlador (el filtro de nativas vive allí, ver (12))',
    e.sesiones.length === 3 && e.sesiones[1].trabajando && e.sesiones[1].puedeTenerTextoSinEnviar,
    JSON.stringify(e.sesiones.map((s) => s.sessionId))
  )
  check(
    '(4c) «espera tu respuesta» llega tal cual al estado (el renderer no para esa sesión)',
    e.sesiones[2].esperandoRespuesta === true && e.sesiones[0].esperandoRespuesta === false,
    JSON.stringify(e.sesiones.map((s) => s.esperandoRespuesta))
  )
}

// =============================================================================
hr('(5) Instalar Codex en Windows: orden de los pasos y candado')
// =============================================================================
{
  const puerta = diferido<void>()
  let enOrden = false
  const { m, svc } = crearMundo({
    orden: async (cmd, op) => {
      if (!cmd.startsWith('npm install -g')) return no()
      enOrden = true
      await puerta.promesa
      m.ver.codex = '0.156.1'
      op.onLinea?.('added 1 package in 3s')
      return ok('added 1 package in 3s')
    }
  })
  await svc.comprobar()
  m.pasos.length = 0
  const inst = svc.instalar({ agente: 'codex', detener: ['s1', 's2', 's1'] })
  await hasta(() => enOrden)

  const sondasAntes = m.cuenta('codex --version')
  const v = await svc.instalada('codex')
  check(
    '(5a) con el candado tomado, la sonda NO se lanza y devuelve la última medida',
    v === '0.156.0' && m.cuenta('codex --version') === sondasAntes,
    `v=${v}, sondas ${sondasAntes} -> ${m.cuenta('codex --version')}`
  )
  let codexLibre = false
  void svc.esperarCandado('codex').then(() => {
    codexLibre = true
  })
  let claudeLibre = false
  void svc.esperarCandado('claude-code').then(() => {
    claudeLibre = true
  })
  for (let i = 0; i < 20; i++) await tick()
  check('(5b) esperarCandado(codex) espera; el de Claude no', !codexLibre && claudeLibre, `codex=${codexLibre} claude=${claudeLibre}`)
  check('(5c) el estado dice qué se instala', svc.estado().instalando === 'codex', String(svc.estado().instalando))
  const claudeAntes = m.cuenta('claude --version')
  await svc.comprobar()
  check(
    '(5d) comprobar a mitad salta el agente con candado y refresca el otro',
    m.cuenta('codex --version') === sondasAntes && m.cuenta('claude --version') === claudeAntes + 1,
    `codex ${m.cuenta('codex --version')}, claude ${claudeAntes} -> ${m.cuenta('claude --version')}`
  )
  const ocupado = await svc.instalar({ agente: 'claude-code', detener: [] })
  check('(5e) otra instalación a la vez -> ocupado, sin tocar nada', !ocupado.ok && ocupado.motivo === 'ocupado' && ocupado.detenidas.length === 0, JSON.stringify(ocupado))

  puerta.resolver()
  const r = await inst
  check('(5f) termina bien: 0.156.0 -> 0.156.1, con las paradas', r.ok && r.antes === '0.156.0' && r.despues === '0.156.1' && r.detenidas.join() === 's1,s2', JSON.stringify(r))
  check('(5g) el lote se pidió UNA vez y sin duplicados', m.detenerPedidos.length === 1 && m.detenerPedidos[0].join() === 's1,s2', JSON.stringify(m.detenerPedidos))
  await tick()
  check('(5h) al terminar, el candado se suelta', codexLibre && svc.estado().instalando === null, `libre=${codexLibre}`)

  const p = m.pasos
  const iCandado = p.indexOf('cambio:codex')
  const iDetener = p.indexOf('detener')
  const iListar = p.indexOf('listar')
  const iOrden = p.findIndex((x) => x.startsWith('ejec:npm install -g'))
  const iSondaTras = p.lastIndexOf('ejec:codex --version')
  const iSoltar = p.lastIndexOf('cambio:null')
  check(
    '(5i) orden: candado -> detener -> bloqueadores -> orden -> re-sondeo -> soltar',
    iCandado >= 0 && iCandado < iDetener && iDetener < iListar && iListar < iOrden && iOrden < iSondaTras && iSondaTras < iSoltar,
    `candado=${iCandado} detener=${iDetener} listar=${iListar} orden=${iOrden} sonda=${iSondaTras} soltar=${iSoltar}`
  )
  const orden = p[iOrden]
  check('(5j) la orden lleva la versión exacta, entrecomillada para PowerShell', orden.includes("'@openai/codex@0.156.1'"), orden)
  check(
    '(5k) progreso: la orden al empezar, cada línea, y el cierre',
    m.progreso.some((x) => x.fase === 'inicio' && x.agente === 'codex') &&
      m.progreso.some((x) => x.linea === 'added 1 package in 3s') &&
      m.progreso.some((x) => x.fase === 'fin' && x.linea.includes('0.156.1')),
    JSON.stringify(m.progreso.map((x) => x.linea))
  )
  check('(5l) el estado final ya no tiene nada nuevo', !svc.estado().codex.hayNueva && svc.estado().codex.instalada === '0.156.1', JSON.stringify(svc.estado().codex.instalada))
}

// =============================================================================
hr('(6) trabajando, no-instalable')
// =============================================================================
{
  const { m, svc } = crearMundo({
    detener: () => ({ ok: false, rechazos: [{ sessionId: 's2', causa: 'trabajando' }] })
  })
  await svc.comprobar()
  const r = await svc.instalar({ agente: 'codex', detener: ['s1', 's2'] })
  check(
    "(6a) una sesión trabajando -> 'trabajando', con el rechazo y nada parado",
    !r.ok && r.motivo === 'trabajando' && r.rechazos?.[0]?.causa === 'trabajando' && r.detenidas.length === 0,
    JSON.stringify(r)
  )
  check(
    '(6b) …y NO se ejecuta la orden ni se mira la tabla de procesos después',
    !m.llamadas.some((c) => c.startsWith('npm install')) && m.pasos.lastIndexOf('listar') < m.pasos.indexOf('detener'),
    JSON.stringify(m.llamadas.filter((c) => c.startsWith('npm')))
  )
  check('(6c) el candado se suelta también al rechazar', svc.estado().instalando === null, String(svc.estado().instalando))
}
{
  const winget = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages\\OpenAI.Codex_x\\codex.exe'
  const { m, svc } = crearMundo({ rutaCodex: winget })
  const e = await svc.comprobar()
  check('(6d) Codex de winget: gestor, no instalable, sin orden inventada', e.codex.metodo === 'gestor' && !e.codex.instalable && e.codex.ordenManual === null, JSON.stringify({ m: e.codex.metodo, i: e.codex.instalable }))
  const r = await svc.instalar({ agente: 'codex', detener: ['s1'] })
  check(
    "(6e) instalar -> 'no-instalable', sin parar a nadie",
    !r.ok && r.motivo === 'no-instalable' && m.detenerPedidos.length === 0 && r.detenidas.length === 0,
    JSON.stringify(r)
  )
}

// =============================================================================
hr('(7) Bloqueadores tras parar')
// =============================================================================
{
  // codex.exe huérfano (su shell ya murió) que tarda tres vueltas en irse.
  let vueltas = 0
  const { m, svc } = crearMundo({
    procesos: () => {
      vueltas++
      return vueltas <= 3 ? [{ pid: 102, ppid: 101, nombre: 'codex.exe', ruta: EXE_CODEX }] : []
    }
  })
  await svc.comprobar()
  vueltas = 0
  const t0 = m.t
  const r = await svc.instalar({ agente: 'codex', detener: ['s1'] })
  check('(7a) uno que tarda en morir se espera y la instalación sigue', r.ok && r.despues === '0.156.1', JSON.stringify({ ok: r.ok, motivo: r.motivo }))
  check('(7b) …sondeando cada 300 ms', m.t - t0 === 900 && vueltas === 4, `esperado 900 ms, ${m.t - t0} ms; ${vueltas} listados`)
}
{
  const { m, svc } = crearMundo({
    // Desciende del pty de Tessera (100): en la VISTA PREVIA no cuenta, TRAS PARAR sí.
    procesos: () => [
      { pid: 100, ppid: 10, nombre: 'powershell.exe', ruta: 'C:\\Windows\\powershell.exe' },
      { pid: 102, ppid: 100, nombre: 'codex.exe', ruta: EXE_CODEX }
    ]
  })
  const e = await svc.comprobar()
  check('(7c) vista previa: el Codex que cuelga de una sesión de Tessera no se avisa', e.codex.bloqueadores.length === 0, JSON.stringify(e.codex.bloqueadores))
  const t0 = m.t
  const r = await svc.instalar({ agente: 'codex', detener: ['s1'] })
  check(
    "(7d) tras parar, lo que siga vivo bajo la raíz da 'bloqueado' al agotar el presupuesto",
    !r.ok && r.motivo === 'bloqueado' && r.bloqueadores?.[0]?.pid === 102 && m.t - t0 >= 8000,
    `${r.motivo}, ${m.t - t0} ms`
  )
  check('(7e) …con las detenidas (el renderer las relanza) y sin ejecutar la orden', r.detenidas.join() === 's1' && !m.llamadas.some((c) => c.startsWith('npm install')), JSON.stringify(r.detenidas))
  check('(7f) …y el detalle nombra el proceso', (r.detalle ?? '').includes('codex.exe (pid 102)'), String(r.detalle))
}
{
  // Codex como servidor MCP de Claude Code: cuelga del pty de una sesión de CLAUDE (300),
  // que el flujo de Codex no va a parar. Con los pids de todas las nativas la vista
  // previa lo daba por «de Tessera» y no avisaba; tiene que avisar como uno ajeno.
  const { svc } = crearMundo({
    procesos: () => [
      { pid: 300, ppid: 10, nombre: 'powershell.exe', ruta: 'C:\\Windows\\powershell.exe' },
      { pid: 301, ppid: 300, nombre: 'claude.exe', ruta: W.claudeExe },
      { pid: 302, ppid: 301, nombre: 'codex.exe', ruta: EXE_CODEX }
    ]
  })
  const e = await svc.comprobar()
  check(
    '(7g) vista previa de Codex: el codex.exe colgado de una sesión de CLAUDE sí se avisa',
    e.codex.bloqueadores.some((b) => b.pid === 302),
    JSON.stringify(e.codex.bloqueadores)
  )
}
{
  // bun: el binario vive en el HERMANO `codex-win32-x64`, fuera de la raíz del paquete.
  // Con una sola raíz, esto daba cero bloqueadores: ni aviso, ni espera, ni nombres.
  let fase: 'vista' | 'tras' = 'vista'
  let vueltas = 0
  const { m, svc } = crearMundo({
    rutaCodex: BUN.exe,
    reales: { [BUN.raiz]: BUN.raiz, [BUN.plat]: BUN.plat },
    procesos: () => {
      if (fase === 'vista') {
        return [
          { pid: 100, ppid: 10, nombre: 'powershell.exe', ruta: 'C:\\Windows\\powershell.exe' },
          { pid: 101, ppid: 100, nombre: 'codex.exe', ruta: EXE_BUN },
          { pid: 700, ppid: 699, nombre: 'codex.exe', ruta: EXE_BUN, lineaComando: `"${EXE_BUN}" app-server` }
        ]
      }
      vueltas++
      return vueltas <= 3 ? [{ pid: 101, ppid: 100, nombre: 'codex.exe', ruta: EXE_BUN }] : []
    },
    orden: (cmd) => {
      if (!cmd.startsWith('bun add -g')) return no(`orden inesperada: ${cmd}`)
      m.ver.codex = '0.156.1'
      return ok('installed @openai/codex@0.156.1')
    }
  })
  const e = await svc.comprobar()
  check(
    '(7h) bun: método bun, y la vista previa ve el app-server ajeno bajo el paquete del binario (el de Tessera no)',
    e.codex.metodo === 'bun' && JSON.stringify(e.codex.bloqueadores.map((b) => b.pid)) === '[700]',
    JSON.stringify({ metodo: e.codex.metodo, b: e.codex.bloqueadores })
  )
  fase = 'tras'
  const t0 = m.t
  const r = await svc.instalar({ agente: 'codex', detener: ['s1'] })
  check(
    '(7i) …y tras parar ESPERA al codex.exe del hermano que tarda en morir antes de `bun add -g`',
    r.ok && m.t - t0 === 900 && vueltas === 4 && m.llamadas.some((c) => c.startsWith('bun add -g')),
    `${JSON.stringify({ ok: r.ok, motivo: r.motivo })}, ${m.t - t0} ms, ${vueltas} listados`
  )
}
{
  // pnpm: el shim apunta a un enlace; la raíz real y la de su binario son DOS directorios
  // del almacén (`@openai+codex@X` y `@openai+codex@X-win32-x64`).
  const { svc } = crearMundo({
    rutaCodex: PNPM.shim,
    archivos: { [PNPM.shim]: PNPM.textoShim },
    reales: { [PNPM.enlace]: PNPM.raiz, [PNPM.enlacePlat]: PNPM.plat },
    procesos: () => [{ pid: 800, ppid: 799, nombre: 'codex.exe', ruta: EXE_PNPM, lineaComando: `"${EXE_PNPM}" app-server` }]
  })
  const e = await svc.comprobar()
  check(
    '(7j) pnpm: método pnpm, y el realpath del enlace lleva la segunda raíz al almacén: se avisa',
    e.codex.metodo === 'pnpm' && e.codex.requiereParar && JSON.stringify(e.codex.bloqueadores.map((b) => b.pid)) === '[800]',
    JSON.stringify({ metodo: e.codex.metodo, b: e.codex.bloqueadores })
  )
}

// =============================================================================
hr('(8) Tope, EBUSY, CLI sin responder, versión sin cambiar')
// =============================================================================
{
  const { svc } = crearMundo({ orden: () => ({ ok: false, codigo: null, salida: 'npm http fetch GET 200', tope: true }) })
  await svc.comprobar()
  const r = await svc.instalar({ agente: 'codex', detener: ['s1'] })
  check("(8a) tope vencido -> 'tope', con las detenidas y la versión de antes", !r.ok && r.motivo === 'tope' && r.detenidas.join() === 's1' && r.despues === '0.156.0', JSON.stringify(r))
  check('(8b) …y la orden queda como ayuda en el estado', (svc.estado().codex.ordenManual ?? '').startsWith('npm install -g'), String(svc.estado().codex.ordenManual))
}
{
  let fallo = false
  const { svc } = crearMundo({
    orden: () => {
      fallo = true
      return { ok: false, codigo: 1, salida: 'npm error code EBUSY\nnpm error syscall rename', tope: false }
    },
    procesos: () => (fallo ? [{ pid: 777, ppid: 1, nombre: 'codex.exe', ruta: EXE_CODEX }] : [])
  })
  await svc.comprobar()
  const r = await svc.instalar({ agente: 'codex', detener: ['s1'] })
  check("(8c) EBUSY -> 'bloqueado' con quién lo tiene abierto", !r.ok && r.motivo === 'bloqueado' && r.bloqueadores?.[0]?.pid === 777, JSON.stringify({ motivo: r.motivo, b: r.bloqueadores }))
}
{
  const { m, svc } = crearMundo({
    orden: () => {
      m.ver.codex = null
      return ok('')
    }
  })
  await svc.comprobar()
  const r = await svc.instalar({ agente: 'codex', detener: [] })
  check('(8d) la orden sale bien pero el CLI deja de responder -> fallo', !r.ok && r.motivo === 'fallo' && r.despues === null && (r.detalle ?? '').includes('sin responder'), JSON.stringify(r))
}
{
  const { svc } = crearMundo({ orden: () => ok('') })
  await svc.comprobar()
  const r = await svc.instalar({ agente: 'codex', detener: [] })
  check('(8e) la orden sale bien pero la versión no cambió -> fallo, no «actualizado»', !r.ok && r.motivo === 'fallo' && r.despues === '0.156.0', String(r.detalle))
}
{
  const { svc } = crearMundo()
  const r = await svc.instalar({ agente: 'claude-code', detener: [] })
  check('(8f) instalar sin haber comprobado nunca: comprueba primero y sigue (claude update)', r.ok && r.antes === '2.1.280' && r.despues === '2.1.281', JSON.stringify(r))
}

// =============================================================================
hr('(9) La red: versiones hostiles, canal stable, binario, CLAUDE_CONFIG_DIR, fallos')
// =============================================================================
{
  const { m, svc } = crearMundo({
    red: {
      [URL_TAGS_CODEX]: JSON.stringify({ latest: "0.157.0'; Remove-Item -Recurse ~ #", 'win32-x64': '0.157.0-win32-x64' }),
      [URL_CLAUDE_LATEST]: '<html>proxy</html>'
    }
  })
  const e = await svc.comprobar()
  check(
    '(9a) versión hostil de la red -> última desconocida, sin «hay nueva»',
    e.codex.ultima === null && !e.codex.hayNueva && e.claude.ultima === null && !e.claude.hayNueva,
    `${e.codex.ultima} / ${e.claude.ultima}`
  )
  const r = await svc.instalar({ agente: 'codex', detener: ['s1'] })
  check(
    "(9b) …e instalar no construye NINGUNA orden: 'sin-version', sin parar a nadie",
    !r.ok && r.motivo === 'sin-version' && !m.llamadas.some((c) => c.startsWith('npm install')) && m.detenerPedidos.length === 0,
    JSON.stringify({ motivo: r.motivo, llamadas: m.llamadas.filter((c) => !c.includes('--version')) })
  )
}
{
  const { svc } = crearMundo({ claude: '2.1.281', archivos: { [`${W.home}\\.claude\\settings.json`]: '{"autoUpdatesChannel":"stable"}' } })
  const e = await svc.comprobar()
  check(
    '(9c) canal stable con la instalada POR DELANTE -> no hay nueva (no se instala una más vieja)',
    e.claude.canal === 'stable' && e.claude.ultima === '2.1.273' && !e.claude.hayNueva,
    JSON.stringify({ canal: e.claude.canal, ultima: e.claude.ultima, instalada: e.claude.instalada })
  )
}
{
  const { svc } = crearMundo({ red: { [URL_TAGS_CODEX]: JSON.stringify({ latest: '0.156.1', 'win32-x64': '0.156.0-win32-x64' }) } })
  const e = await svc.comprobar()
  check('(9d) `latest` publicado sin el binario de win32-x64 -> no hay nueva', e.codex.ultima === '0.156.1' && !e.codex.hayNueva, JSON.stringify({ ultima: e.codex.ultima, nueva: e.codex.hayNueva }))
  const r = await svc.instalar({ agente: 'codex', detener: ['s1'] })
  check("(9e) …e instalar dice 'sin-version' y por qué", r.motivo === 'sin-version' && (r.detalle ?? '').includes('binario') && (r.detalle ?? '').includes('Windows'), String(r.detalle))
}
{
  const { m, svc } = crearMundo({
    env: { CLAUDE_CONFIG_DIR: 'D:\\cfg', TESSERA_REGISTRO_NPM: 'http://127.0.0.1:4873/' },
    archivos: {
      'D:\\cfg\\.claude.json': '{"installMethod":"npm-global"}',
      'D:\\cfg\\settings.json': '{"autoUpdatesChannel":"stable"}'
    },
    red: {
      'http://127.0.0.1:4873/-/package/@anthropic-ai/claude-code/dist-tags': JSON.stringify({ latest: '2.1.281', stable: '2.1.290' }),
      'http://127.0.0.1:4873/-/package/@openai/codex/dist-tags': JSON.stringify({ latest: '0.156.0' })
    }
  })
  const e = await svc.comprobar()
  check(
    '(9f) CLAUDE_CONFIG_DIR manda sobre ~/.claude.json y ~/.claude, y el registro de diagnóstico se usa',
    e.claude.metodo === 'npm' && e.claude.canal === 'stable' && e.claude.ultima === '2.1.290' && m.pasos.some((p) => p.startsWith('red:http://127.0.0.1:4873/')),
    JSON.stringify({ metodo: e.claude.metodo, canal: e.claude.canal, ultima: e.claude.ultima })
  )
  check('(9g) Claude por npm en Windows: orden de npm y hay que parar', e.claude.instalable && e.claude.requiereParar, JSON.stringify({ i: e.claude.instalable, p: e.claude.requiereParar }))
}
{
  const { svc } = crearMundo({ red: { [URL_TAGS_CODEX]: new Error('getaddrinfo ENOTFOUND registry.npmjs.org') } })
  let rechazo = false
  const e = await svc.comprobar().catch(() => {
    rechazo = true
    return null
  })
  check(
    '(9h) error de red: no rechaza, estado con error y sin «hay nueva»',
    !rechazo && e !== null && e.codex.ultima === null && !e.codex.hayNueva && (e.codex.error ?? '').includes('ENOTFOUND'),
    String(e?.codex.error)
  )
}

// =============================================================================
hr('(10) Mac: sin parar y sin tabla de procesos')
// =============================================================================
{
  const { m, svc } = crearMundo({ plataforma: 'mac' })
  const e = await svc.comprobar()
  check(
    '(10a) Codex por npm en Mac: `codex update`, sin parar, binario darwin-arm64 publicado',
    e.codex.metodo === 'npm' && e.codex.instalable && !e.codex.requiereParar && e.codex.hayNueva,
    JSON.stringify({ metodo: e.codex.metodo, parar: e.codex.requiereParar, nueva: e.codex.hayNueva })
  )
  check('(10b) Claude nativo en Mac por la huella del binario + installMethod', e.claude.metodo === 'nativo' && e.claude.instalable, e.claude.metodo)
  const r = await svc.instalar({ agente: 'codex', detener: [] })
  check('(10c) instalar ejecuta `codex update` y no mira procesos', r.ok && m.llamadas.includes('codex update') && !m.pasos.includes('listar'), JSON.stringify(r))
  const rc = await svc.instalar({ agente: 'claude-code', detener: [] })
  check('(10d) y Claude con `claude update`', rc.ok && m.llamadas.includes('claude update') && rc.despues === '2.1.281', JSON.stringify(rc))
  m.ver.claude = null
  await svc.instalada('claude-code')
  check('(10e) el error de sonda nombra el equipo de Mac', (svc.estado().claude.error ?? '').includes('tu Mac'), String(svc.estado().claude.error))
}

// --- Codex por el cask de Homebrew: la última es la del CASK, no la de npm ---
const TAGS_NPM_157 = JSON.stringify({ latest: '0.157.0', 'darwin-arm64': '0.157.0-darwin-arm64', 'win32-x64': '0.157.0-win32-x64' })
{
  // Homebrew va por detrás de npm: con npm habría un «hay nueva» que `brew` no puede atender.
  const { m, svc } = crearMundo({
    plataforma: 'mac',
    reales: { [MAC.codexBin]: MAC_CASK },
    red: { [URL_TAGS_CODEX]: TAGS_NPM_157, [URL_CASK_CODEX]: JSON.stringify({ token: 'codex', version: '0.156.0' }) }
  })
  const e = await svc.comprobar()
  check(
    '(10f) cask en 0.156.0 y npm en 0.157.0: método brew, la última es la del cask y NO hay nueva',
    e.codex.metodo === 'brew' && e.codex.ultima === '0.156.0' && !e.codex.hayNueva && e.codex.error === null,
    JSON.stringify({ metodo: e.codex.metodo, ultima: e.codex.ultima, nueva: e.codex.hayNueva, error: e.codex.error })
  )
  check('(10g) …y a npm ni se le pregunta por Codex', !m.pasos.includes(`red:${URL_TAGS_CODEX}`), JSON.stringify(m.pasos.filter((p) => p.startsWith('red:'))))
}
{
  const { m, svc } = crearMundo({
    plataforma: 'mac',
    reales: { [MAC.codexBin]: MAC_CASK },
    red: { [URL_CASK_CODEX]: JSON.stringify({ token: 'codex', version: '0.157.0' }) },
    orden: (cmd) => {
      if (cmd !== 'codex update') return no(`orden inesperada: ${cmd}`)
      m.ver.codex = '0.157.0'
      return ok('')
    }
  })
  const e = await svc.comprobar()
  check(
    '(10h) cask en 0.157.0: hay nueva e instalable sin parar',
    e.codex.hayNueva && e.codex.instalable && !e.codex.requiereParar && e.codex.ultima === '0.157.0',
    JSON.stringify({ nueva: e.codex.hayNueva, instalable: e.codex.instalable, ultima: e.codex.ultima })
  )
  const r = await svc.instalar({ agente: 'codex', detener: [] })
  check('(10i) …e instalar ejecuta `codex update` (que con brew es `brew upgrade --cask codex`)', r.ok && r.despues === '0.157.0' && m.llamadas.includes('codex update'), JSON.stringify(r))
}
for (const [nombre, respuesta] of [
  ['JSON roto', '<html>proxy</html>'],
  ['versión no exacta', JSON.stringify({ version: '0.157.0,20260901' })],
  ['error de red', new Error('getaddrinfo ENOTFOUND formulae.brew.sh')]
] as const) {
  const { svc } = crearMundo({ plataforma: 'mac', reales: { [MAC.codexBin]: MAC_CASK }, red: { [URL_CASK_CODEX]: respuesta } })
  const e = await svc.comprobar()
  check(
    `(10j·${nombre}) cask ilegible: última desconocida, sin punto, con el error`,
    e.codex.ultima === null && !e.codex.hayNueva && (e.codex.error ?? '').includes('Homebrew'),
    String(e.codex.error)
  )
}
{
  const { m, svc } = crearMundo({ plataforma: 'mac', reales: { [MAC.codexBin]: MAC_FORMULA } })
  const e = await svc.comprobar()
  check(
    '(10k) fórmula (`/Cellar/`, un tap ajeno sin API): última null, sin punto, con el porqué y sin pedir nada a la red',
    e.codex.metodo === 'brew' &&
      e.codex.ultima === null &&
      !e.codex.hayNueva &&
      (e.codex.error ?? '').includes('fórmula') &&
      !m.pasos.some((p) => p.startsWith('red:') && p.includes('codex')),
    `${String(e.codex.error)} | ${JSON.stringify(m.pasos.filter((p) => p.startsWith('red:')))}`
  )
}
{
  const { m, svc } = crearMundo({
    plataforma: 'mac',
    env: { TESSERA_API_BREW: 'http://127.0.0.1:4874/api/' },
    reales: { [MAC.codexBin]: MAC_CASK },
    red: { 'http://127.0.0.1:4874/api/cask/codex.json': JSON.stringify({ version: '0.157.0' }) }
  })
  const e = await svc.comprobar()
  check(
    '(10l) TESSERA_API_BREW cambia la base (mando de diagnóstico y de los e2e)',
    e.codex.ultima === '0.157.0' && m.pasos.includes('red:http://127.0.0.1:4874/api/cask/codex.json'),
    JSON.stringify(m.pasos.filter((p) => p.startsWith('red:')))
  )
}

// =============================================================================
hr('(11) Cadencia y rebote')
// =============================================================================
{
  const { m, svc } = crearMundo()
  svc.start()
  svc.start()
  check('(11a) start programa UNA primera comprobación diferida (~20 s)', m.timers.filter((x) => x.vivo).length === 1 && m.timers[0].ms === 20_000, JSON.stringify(m.timers.map((x) => x.ms)))
  m.t += 20_000
  m.correrTimers()
  await hasta(() => m.emitidos.length > 0)
  await tick()
  const siguiente = m.timers.filter((x) => x.vivo)
  check('(11b) tras comprobar, la siguiente va a 4 h', siguiente.length === 1 && siguiente[0].ms === 4 * 3600_000, JSON.stringify(siguiente.map((x) => x.ms)))
  const sondas = m.cuenta('codex --version')
  svc.alRecuperarFoco()
  await tick()
  check('(11c) volver a la app enseguida no comprueba', m.cuenta('codex --version') === sondas, `${m.cuenta('codex --version')} sondas`)
  m.t += 31 * 60_000
  svc.alRecuperarFoco()
  await hasta(() => m.cuenta('codex --version') > sondas)
  check('(11d) volver tras más de 30 min sí', m.cuenta('codex --version') === sondas + 1, `${m.cuenta('codex --version')} sondas`)
  await tick()
  svc.parar()
  check('(11e) parar cancela los temporizadores', m.timers.every((x) => !x.vivo), `${m.timers.filter((x) => x.vivo).length} vivos`)
}
{
  const { m, svc } = crearMundo()
  svc.notificarSesiones()
  svc.notificarSesiones()
  svc.notificarSesiones()
  const programados = m.timers.filter((x) => x.vivo && x.ms === 250).length
  const antes = m.emitidos.length
  m.correrTimers()
  check('(11f) tres avisos seguidos -> UNA emisión rebotada', programados === 1 && m.emitidos.length === antes + 1, `${programados} programado(s), ${m.emitidos.length - antes} emisión(es)`)
}

// =============================================================================
hr('(12) Controlador: sólo nativas, parada atómica, chat exacto, candado, sonda')
// =============================================================================
// Mismo resolver-hook que test-agent-terminal: el controlador hace imports de VALOR sin
// extensión y trae `electron` (sólo `clipboard`, que aquí no se usa). Se registra ANTES
// del import dinámico. El TerminalService se sustituye por uno falso: aquí se prueba
// el cableado del controlador, no los ptys (eso es test-detener-sesion).
const electronStub =
  'export const app = {}; export const clipboard = {}; export const shell = {};' +
  ' export const dialog = {}; export const safeStorage = {}; export default {};'
const resolveTsHook = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronStub)});
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') return { url: ELECTRON_STUB, shortCircuit: true };
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook), import.meta.url)
const { AgentTerminalController } = await import('./AgentTerminalController.ts')
const { registrarIpcTerminalAgente } = await import('./ipc.ts')
const { crearRegistroAnclas, claveAncla } = await import('../context/anclaConversacion.ts')

interface SesionFalsa {
  viva: boolean
  ocupada: boolean
  pid: number
}
class TerminalesFalsas {
  sesiones = new Map<string, SesionFalsa>()
  n = 0
  creadas: string[] = []
  detenidas: string[] = []
  recargas: Array<{ id: string; launch?: string }> = []
  async createSession(_p: unknown, opts: { project: string }): Promise<{ id: string; workspacePath: string; project: string }> {
    const id = `t${++this.n}`
    this.sesiones.set(id, { viva: true, ocupada: false, pid: 1000 + this.n })
    this.creadas.push(id)
    return { id, workspacePath: opts.project, project: opts.project }
  }
  onData(): () => void {
    return () => {}
  }
  onExit(): () => void {
    return () => {}
  }
  write(): void {}
  estaViva(id: string): boolean {
    const s = this.sesiones.get(id)
    return s !== undefined && s.viva && !s.ocupada
  }
  estaOcupada(id: string): boolean {
    return this.sesiones.get(id)?.ocupada === true
  }
  pidDe(id: string): number | null {
    const s = this.sesiones.get(id)
    return s && s.viva ? s.pid : null
  }
  async detenerSesion(id: string): Promise<{ elegante: boolean }> {
    const s = this.sesiones.get(id)
    if (!s) throw new Error('no existe')
    // Como el real: lo síncrono (marcar) antes del primer await.
    s.ocupada = true
    s.viva = false
    this.detenidas.push(id)
    await tick()
    return { elegante: true }
  }
  async reloadSession(id: string, overrides?: { launch?: string }): Promise<{ id: string; workspacePath: string; project: string }> {
    const s = this.sesiones.get(id)
    if (!s) throw new Error('no existe')
    s.viva = true
    s.ocupada = false
    s.pid = 2000 + ++this.n
    this.recargas.push({ id, launch: overrides?.launch })
    return { id, workspacePath: 'x', project: 'x' }
  }
  async closeSession(id: string): Promise<void> {
    this.sesiones.delete(id)
  }
}

{
  const terminales = new TerminalesFalsas()
  const anclas = crearRegistroAnclas()
  const base = (agente: string): string => `C:\\base\\${agente}`
  let candadoCodex: Promise<void> = Promise.resolve()
  let versionCodex = '0.156.0'
  let sondasManuales: Array<{ resolver: (v: string | null) => void }> | null = null
  let cambios = 0
  const perfil = { id: 'p1', nombre: 'P1', color: '#000000', agentes: [] } as unknown as Profile
  const ctrl = new AgentTerminalController({
    profiles: [perfil],
    sandbox: {} as never,
    accounts: {} as never,
    eventos: { emitir: () => {}, hayDestino: () => false },
    portapapeles: { leerPng: () => null },
    anclas,
    getAgentBase: (agente) => base(agente),
    sondearVersion: (agente) => {
      if (sondasManuales) {
        const d = diferido<string | null>()
        sondasManuales.push(d)
        return d.promesa
      }
      return Promise.resolve(agente === 'codex' ? versionCodex : '2.1.281')
    },
    esperarCandado: (agente) => (agente === 'codex' ? candadoCodex : Promise.resolve()),
    alCambiarSesiones: () => {
      cambios++
    },
    log: () => {}
  })
  ;(ctrl as unknown as { terminals: TerminalesFalsas }).terminals = terminales
  type SesionInterna = {
    activity: {
      state: () => string
      esperandoRespuesta: () => boolean
      onData: (chunk: string) => void
      finish: () => void
      dispose: () => void
    }
    resumeSessionId?: string
  }
  const internas = (ctrl as unknown as { sessions: Map<string, SesionInterna> }).sessions
  const abrir = async (agente: AgentKind, proyecto: string, resumeSessionId?: string): Promise<string> =>
    (await ctrl.open({ profileId: 'p1', agente, projectHostPath: proyecto, mode: 'host', resumeSessionId })).sessionId

  const A = await abrir('codex', 'C:\\proy\\a')
  const B = await abrir('claude-code', 'C:\\proy\\b')
  const C = await abrir('codex', 'C:\\proy\\c')
  await tick()
  const sA = ctrl.sesionesNativas().find((s) => s.sessionId === A)
  check('(12a) al abrir una nativa se sondea y se guarda su versionLanzada, y se avisa', sA?.versionLanzada === '0.156.0' && cambios > 0, `${sA?.versionLanzada}, ${cambios} aviso(s)`)

  // Una sesión de Docker (inyectada: abrirla de verdad exige un sandbox) y C muerta.
  const actividadReposo = {
    state: () => 'idle',
    esperandoRespuesta: () => false,
    onData: () => {},
    finish: () => {},
    dispose: () => {},
    onInput: () => {}
  }
  internas.set('d1', {
    sessionId: 'd1',
    profileId: 'p1',
    agente: 'codex',
    accountId: 'x',
    projectHostPath: 'C:\\proy\\d',
    host: false,
    claveAncla: '',
    detectorEnvio: crearDetectorEnvio(),
    versionLanzada: null,
    lanzamiento: 1,
    activity: actividadReposo,
    unsubData: () => {},
    unsubExit: () => {}
  } as unknown as SesionInterna)
  terminales.sesiones.set('d1', { viva: true, ocupada: false, pid: 999 })
  const fc = terminales.sesiones.get(C)
  if (fc) fc.viva = false
  const ids = ctrl.sesionesNativas().map((s) => s.sessionId)
  check('(12b) sesionesNativas: sólo nativas y vivas (fuera Docker y la que salió)', ids.join() === `${A},${B}`, JSON.stringify(ids))
  const pidsCodex = ctrl.pidsNativos('codex')
  const pidsClaude = ctrl.pidsNativos('claude-code')
  const pidDe = (id: string): number | undefined => terminales.sesiones.get(id)?.pid
  check(
    '(12c) pidsNativos(agente): los ptys nativos vivos DE ESE agente (ni Docker, ni la que salió, ni los de Claude para Codex)',
    pidsCodex.join() === String(pidDe(A)) && pidsClaude.join() === String(pidDe(B)) && !pidsCodex.includes(999),
    `codex=${JSON.stringify(pidsCodex)} claude=${JSON.stringify(pidsClaude)}`
  )

  // --- Parada atómica: cada causa, y nada parado ---
  const r1 = await ctrl.detenerVarias([A, 'nope'])
  const r2 = await ctrl.detenerVarias([A, 'd1'])
  const r3 = await ctrl.detenerVarias([C])
  const fa = terminales.sesiones.get(A)
  if (fa) fa.ocupada = true
  const r4 = await ctrl.detenerVarias([A])
  if (fa) fa.ocupada = false
  const sesB = internas.get(B)
  const actB = sesB?.activity
  if (sesB) sesB.activity = { ...actividadReposo, state: () => 'working' }
  const r5 = await ctrl.detenerVarias([A, B])
  // Un diálogo de permiso: el rastreador ya cerró el turno (idle), pero espera respuesta.
  if (sesB) sesB.activity = { ...actividadReposo, esperandoRespuesta: () => true }
  const r6 = await ctrl.detenerVarias([A, B])
  const infoB = ctrl.sesionesNativas().find((s) => s.sessionId === B)
  if (sesB && actB) sesB.activity = actB
  const causa = (r: AgentDetenerVariasResult): string => (r.ok ? 'ok' : r.rechazos.map((x) => x.causa).join())
  check(
    '(12d) causas: no-existe, no-nativa, muerta, ocupada, trabajando, esperando-respuesta',
    causa(r1) === 'no-existe' &&
      causa(r2) === 'no-nativa' &&
      causa(r3) === 'muerta' &&
      causa(r4) === 'ocupada' &&
      causa(r5) === 'trabajando' &&
      causa(r6) === 'esperando-respuesta',
    [r1, r2, r3, r4, r5, r6].map(causa).join(' | ')
  )
  check(
    '(12d2) sesionesNativas lo cuenta aparte: no trabaja, pero espera tu respuesta',
    infoB?.trabajando === false && infoB.esperandoRespuesta === true,
    JSON.stringify({ trabajando: infoB?.trabajando, esperandoRespuesta: infoB?.esperandoRespuesta })
  )
  check('(12e) un lote rechazado no para NINGUNA (A estaba bien en todos)', terminales.detenidas.length === 0, JSON.stringify(terminales.detenidas))

  // --- Vuelta al chat EXACTO ---
  const CHAT = 'aaaaaaaa-1111-2222-3333-444444444444'
  anclas.aprender(claveAncla('codex', base('codex'), 'C:\\proy\\a'), CHAT)
  const E = await abrir('codex', 'C:\\proy\\e')
  const F = await abrir('codex', 'C:\\proy\\e') // comparte clave con E: refs = 2
  anclas.aprender(claveAncla('codex', base('codex'), 'C:\\proy\\e'), CHAT.replace('aaaaaaaa', 'bbbbbbbb'))
  const cambiosAntes = cambios
  const ok5 = await ctrl.detenerVarias([A, B, E, A])
  check('(12f) lote válido: se paran todas, una vez cada una', ok5.ok && terminales.detenidas.join() === `${A},${B},${E}` && ok5.ok && ok5.detenidas.length === 3, JSON.stringify(ok5))
  check('(12g) …y se avisa al servicio', cambios > cambiosAntes, `${cambios - cambiosAntes} aviso(s)`)
  check(
    '(12h) la que arrancó sin reanudar y tiene su ancla aprendida (refs 1) vuelve a ESE chat',
    internas.get(A)?.resumeSessionId === CHAT,
    String(internas.get(A)?.resumeSessionId)
  )
  check('(12i) con la clave compartida (refs 2) no se adivina', internas.get(E)?.resumeSessionId === undefined && internas.get(F)?.resumeSessionId === undefined, String(internas.get(E)?.resumeSessionId))
  check('(12j) las paradas ya no cuentan como sesiones vivas', !ctrl.sesionesNativas().some((s) => [A, B, E].includes(s.sessionId)), JSON.stringify(ctrl.sesionesNativas().map((s) => s.sessionId)))

  // --- Relanzar: vuelve con --resume <chat>, nueva sonda ---
  versionCodex = '0.156.1'
  await ctrl.reload(A, [])
  await tick()
  const recA = terminales.recargas.find((x) => x.id === A)
  check('(12k) el reinicio de A lleva su chat exacto', (recA?.launch ?? '').includes(CHAT), String(recA?.launch))
  check('(12l) …y su versionLanzada es la del binario nuevo', ctrl.sesionesNativas().find((s) => s.sessionId === A)?.versionLanzada === '0.156.1', 'sonda tras relanzar')

  // --- Candado: abrir y reiniciar esperan ---
  const puerta = diferido<void>()
  candadoCodex = puerta.promesa
  const creadasAntes = terminales.creadas.length
  const abriendo = abrir('codex', 'C:\\proy\\g')
  const recargasAntes = terminales.recargas.length
  const reiniciando = ctrl.reload(E, [])
  const cerrado = ctrl.reload(B, []) // Claude: no espera al candado de Codex
  for (let i = 0; i < 20; i++) await tick()
  check('(12m) con el candado de Codex, abrir Codex no crea el pty', terminales.creadas.length === creadasAntes, `${terminales.creadas.length - creadasAntes} creada(s)`)
  check(
    '(12n) …reiniciar Codex tampoco, y Claude sí',
    terminales.recargas.length === recargasAntes + 1 && terminales.recargas[terminales.recargas.length - 1].id === B,
    JSON.stringify(terminales.recargas.slice(recargasAntes))
  )
  await cerrado
  // Mientras espera, el usuario cierra F y pide reiniciarla: al soltar, no se resucita.
  const reiniciandoF = ctrl.reload(F, [])
  await tick()
  await ctrl.close(F)
  candadoCodex = Promise.resolve()
  puerta.resolver()
  await abriendo
  await reiniciando
  let errorF = ''
  await reiniciandoF.catch((err: unknown) => {
    errorF = err instanceof Error ? err.message : String(err)
  })
  check('(12o) al soltar el candado se abren y reinician', terminales.creadas.length === creadasAntes + 1 && terminales.recargas.some((x) => x.id === E), `${terminales.creadas.length - creadasAntes} creada(s)`)
  check('(12p) una sesión cerrada durante la espera no se resucita', errorF.includes('se cerró mientras esperaba') && !terminales.recargas.some((x) => x.id === F), errorF)

  // --- Guarda de lanzamiento: la sonda VIEJA no pisa a la nueva ---
  sondasManuales = []
  const H = await abrir('codex', 'C:\\proy\\h')
  await ctrl.reload(H, [])
  const [primera, segunda] = sondasManuales
  segunda.resolver('0.156.1')
  await tick()
  primera.resolver('0.156.0')
  await tick()
  sondasManuales = null
  check(
    '(12q) una sonda tardía de un arranque anterior no pisa la del relanzamiento',
    ctrl.sesionesNativas().find((s) => s.sessionId === H)?.versionLanzada === '0.156.1',
    String(ctrl.sesionesNativas().find((s) => s.sessionId === H)?.versionLanzada)
  )

  // --- IPC: el detector se alimenta y DETENER_VARIAS está registrado ---
  const handlers = new Map<string, (e: unknown, arg: unknown) => unknown>()
  const ipcFalso = {
    handle: (canal: string, fn: (e: unknown, arg: unknown) => unknown) => handlers.set(canal, fn),
    on: (canal: string, fn: (e: unknown, arg: unknown) => unknown) => handlers.set(canal, fn)
  }
  registrarIpcTerminalAgente({ ipc: ipcFalso as never, agentes: ctrl })
  handlers.get('agentTerminal:write')?.({}, { sessionId: H, data: 'arregla el test' })
  check('(12r) lo tecleado sin Enter enciende «puede tener texto sin enviar»', ctrl.sesionesNativas().find((s) => s.sessionId === H)?.puedeTenerTextoSinEnviar === true, 'tras WRITE sin \\r')
  handlers.get('agentTerminal:write')?.({}, { sessionId: H, data: '\r' })
  check('(12s) …y el Enter la apaga', ctrl.sesionesNativas().find((s) => s.sessionId === H)?.puedeTenerTextoSinEnviar === false, 'tras \\r')
  const viaIpc = (await handlers.get('agentTerminal:detenerVarias')?.({}, { sessionIds: 'basura' })) as AgentDetenerVariasResult | undefined
  check('(12t) DETENER_VARIAS registrado y robusto ante basura (lote vacío)', viaIpc?.ok === true && viaIpc.detenidas.length === 0, JSON.stringify(viaIpc))

  // --- Diálogo de permiso, con el rastreador DE VERDAD (reloj real: un tick, 500 ms) ---
  // H tiene el turno abierto por el Enter de (12s). El agente se para a preguntar y toca
  // la campana, que cierra el turno; la apertura del transcript se lee DESPUÉS (el
  // vigilante llega tarde), y es ella sola la que tiene que avisar al servicio: no hay
  // cambio de actividad que lo haga por ella.
  const infoH = (): { trabajando?: boolean; esperandoRespuesta?: boolean } | undefined =>
    ctrl.sesionesNativas().find((s) => s.sessionId === H)
  internas.get(H)?.activity.onData('\x07')
  for (let i = 0; i < 30 && infoH()?.trabajando !== false; i++) await new Promise((r) => setTimeout(r, 100))
  const trasCampana = infoH()?.esperandoRespuesta
  const cambiosAntesDialogo = cambios
  ctrl.aplicarMarcaTurno(H, { tipo: 'abre', at: Date.now() })
  check(
    '(12u) campana + apertura en disco: no trabaja, espera tu respuesta, y se avisa al servicio',
    trasCampana === false && infoH()?.trabajando === false && infoH()?.esperandoRespuesta === true && cambios > cambiosAntesDialogo,
    `trasCampana=${trasCampana} ${JSON.stringify(infoH())}, ${cambios - cambiosAntesDialogo} aviso(s)`
  )
  const detenidasAntes = terminales.detenidas.length
  const rDialogo = await ctrl.detenerVarias([H])
  check(
    "(12v) …y el lote se rechaza con 'esperando-respuesta', sin parar nada",
    causa(rDialogo) === 'esperando-respuesta' && terminales.detenidas.length === detenidasAntes,
    `${causa(rDialogo)}, ${terminales.detenidas.length - detenidasAntes} parada(s)`
  )
  handlers.get('agentTerminal:write')?.({}, { sessionId: H, data: '\x1b[O' })
  check('(12w) el foco que se va al pulsar el botón (`ESC [O`) NO contesta', infoH()?.esperandoRespuesta === true, JSON.stringify(infoH()))
  handlers.get('agentTerminal:write')?.({}, { sessionId: H, data: 'y' })
  check('(12x) una tecla tuya sí: se apaga', infoH()?.esperandoRespuesta === false, JSON.stringify(infoH()))

  // --- El chat en el que ESTÁ, no aquel con el que arrancó ---
  const VIEJO = 'cccccccc-1111-2222-3333-444444444444'
  const NUEVO = 'dddddddd-1111-2222-3333-444444444444'
  const DEL_RENDERER = 'eeeeeeee-1111-2222-3333-444444444444'
  const lanzamientoDe = (id: string): string => terminales.recargas.filter((x) => x.id === id).at(-1)?.launch ?? ''
  // (1) Abrió con --resume VIEJO; tecleaste /resume y el anillo ya aprendió el NUEVO.
  const R1 = await abrir('codex', 'C:\\proy\\r1', VIEJO)
  const claveR1 = claveAncla('codex', base('codex'), 'C:\\proy\\r1')
  anclas.dudar(claveR1)
  anclas.aprender(claveR1, NUEVO)
  const rR1 = await ctrl.detenerVarias([R1])
  check('(12y) ancla aprendida tras un /resume: el lote adopta el chat NUEVO', rR1.ok && internas.get(R1)?.resumeSessionId === NUEVO, String(internas.get(R1)?.resumeSessionId))
  await ctrl.reload(R1, [], DEL_RENDERER)
  check(
    '(12z) …y el relanzamiento lleva el nuevo, ni el de apertura ni el del renderer',
    lanzamientoDe(R1).includes(NUEVO) && !lanzamientoDe(R1).includes(VIEJO) && !lanzamientoDe(R1).includes(DEL_RENDERER),
    lanzamientoDe(R1)
  )
  // (2) Abrió con VIEJO y tecleaste /clear, pero el anillo aún no sabe adónde: dudosa.
  const R2 = await abrir('codex', 'C:\\proy\\r2', VIEJO)
  anclas.dudar(claveAncla('codex', base('codex'), 'C:\\proy\\r2'))
  const rR2 = await ctrl.detenerVarias([R2])
  check('(12aa) ancla dudosa: se olvida el de apertura (es el que abandonaste)', rR2.ok && internas.get(R2)?.resumeSessionId === undefined, String(internas.get(R2)?.resumeSessionId))
  await ctrl.reload(R2, [], DEL_RENDERER)
  check(
    '(12ab) …y el relanzamiento usa el que resuelve el renderer, no el viejo',
    lanzamientoDe(R2).includes(DEL_RENDERER) && !lanzamientoDe(R2).includes(VIEJO),
    lanzamientoDe(R2)
  )
  // (3) Dos sesiones con la misma clave (refs 2): lo aprendido no se sabe de cuál es.
  const R3 = await abrir('codex', 'C:\\proy\\r3', VIEJO)
  await abrir('codex', 'C:\\proy\\r3', VIEJO)
  const claveR3 = claveAncla('codex', base('codex'), 'C:\\proy\\r3')
  anclas.dudar(claveR3)
  anclas.aprender(claveR3, NUEVO)
  const rR3 = await ctrl.detenerVarias([R3])
  check('(12ac) con la clave compartida (refs 2) no se toca: sigue el de apertura', rR3.ok && internas.get(R3)?.resumeSessionId === VIEJO, String(internas.get(R3)?.resumeSessionId))
}

hr(`VEREDICTO: ${pasadas}/${total} PASS`)
process.exit(pasadas === total ? 0 : 1)
