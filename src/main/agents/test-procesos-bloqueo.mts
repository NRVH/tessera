#!/usr/bin/env node
// =============================================================================
// Prueba de procesosBloqueo y de la tabla de procesos (npm run test:procesos-bloqueo):
// raíces con barra final, varias raíces, línea de comandos, descendencia de Tessera,
// huérfanos y ciclos; el parseo y el guion de la tabla; y la tabla real solo en Windows
// (en otra plataforma, la consulta dice que no aplica en vez de fingir una tabla vacía).
// Decisiones: docs/decisiones/agentes/nativos-bloqueadores-windows.md
// =============================================================================

import path from 'node:path'
import { desciendeDe, esDemonioCodex, procesosQueBloquean } from './procesosBloqueo.ts'
import {
  guionListado,
  listarProcesosWindows,
  listarProcesosWindowsSync,
  parsearTablaProcesos,
  type ProcesoSistema
} from '../update/procesosSistema.ts'
import { esWindows } from '../../shared/plataforma.ts'

let pasadas = 0
let total = 0
const omitidos: string[] = []
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
/** Un check que en ESTE sistema no se puede correr: no cuenta como PASS y se repite al final. */
function omitir(name: string, motivo: string): void {
  omitidos.push(`${name} -> ${motivo}`)
  console.log(`[NO APLICA] ${name}`)
  console.log(`        ${motivo}`)
}

const RAIZ = 'C:\\Users\\maria\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex'
const EXE = `${RAIZ}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`

/**
 * Una tabla de juguete con la forma real de esta máquina:
 *   Tessera.exe 10
 *     └ powershell.exe 100 (pty de una sesión de Codex)
 *         └ node.exe 101 (el shim codex.js)
 *             └ codex.exe 102
 *   Editor.exe 200
 *     └ codex.exe 201 app-server (la extensión de un editor)
 *   WindowsTerminal 300
 *     └ pwsh 301
 *         └ codex.exe 302 (Codex a mano en otra terminal)
 *   codex.exe 400 cuyo padre 399 ya murió (huérfano)
 *   codex.exe 500 desde la copia RETIRADA por npm (`.codex-cKSKa6Qh`)
 *   codexfoo.exe 600 desde un hermano con prefijo parecido
 *   OpenConsole.exe 700 sin ruta visible
 */
const TABLA: ProcesoSistema[] = [
  { pid: 10, ppid: 5, nombre: 'Tessera.exe', ruta: 'C:\\Program Files\\Tessera\\Tessera.exe' },
  { pid: 100, ppid: 10, nombre: 'powershell.exe', ruta: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
  { pid: 101, ppid: 100, nombre: 'node.exe', ruta: 'C:\\Program Files\\nodejs\\node.exe', lineaComando: `node ${RAIZ}\\bin\\codex.js` },
  { pid: 102, ppid: 101, nombre: 'codex.exe', ruta: EXE, lineaComando: `"${EXE}" resume abc` },
  { pid: 200, ppid: 1, nombre: 'Editor.exe', ruta: 'C:\\Users\\maria\\AppData\\Local\\Programs\\Editor\\Editor.exe' },
  { pid: 201, ppid: 200, nombre: 'codex.exe', ruta: EXE, lineaComando: `"${EXE}" app-server --analytics-default-enabled` },
  { pid: 300, ppid: 1, nombre: 'WindowsTerminal.exe', ruta: 'C:\\Program Files\\WindowsApps\\wt\\WindowsTerminal.exe' },
  { pid: 301, ppid: 300, nombre: 'pwsh.exe', ruta: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
  { pid: 302, ppid: 301, nombre: 'codex.exe', ruta: EXE.toUpperCase(), lineaComando: 'codex' },
  { pid: 400, ppid: 399, nombre: 'codex.exe', ruta: EXE },
  {
    pid: 500,
    ppid: 1,
    nombre: 'codex.exe',
    ruta: 'C:\\Users\\maria\\AppData\\Roaming\\npm\\node_modules\\@openai\\.codex-cKSKa6Qh\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'
  },
  { pid: 600, ppid: 1, nombre: 'codexfoo.exe', ruta: `${RAIZ}foo\\bin\\codexfoo.exe` },
  { pid: 700, ppid: 10, nombre: 'OpenConsole.exe', ruta: '' }
]

// ---------------------------------------------------------------------------
hr('(1) procesosQueBloquean')
{
  const r = procesosQueBloquean(TABLA, [RAIZ], 'windows', [100])
  const pids = r.map((p) => p.pid).sort((a, b) => a - b)
  check(
    '(1a) bloquean: el editor (201), otra terminal (302) y el huérfano (400); NO la sesión de Tessera (102)',
    JSON.stringify(pids) === JSON.stringify([201, 302, 400]),
    JSON.stringify(pids)
  )
  check('(1b) la copia retirada por npm (500) no bloquea', !pids.includes(500), JSON.stringify(pids))
  check('(1c) un hermano con prefijo parecido (`codexfoo`, 600) no cuela', !pids.includes(600), JSON.stringify(pids))
  check('(1d) la caja no importa (302 va en MAYÚSCULAS)', pids.includes(302), JSON.stringify(pids))
  const editor = r.find((p) => p.pid === 201)
  const terminal = r.find((p) => p.pid === 302)
  check('(1e) el `app-server` del editor se marca como demonio', editor?.esDemonio === true, JSON.stringify(editor))
  check('(1f) un Codex normal NO es demonio', terminal?.esDemonio === false, JSON.stringify(terminal))
  check(
    '(1g) se devuelve nombre y ruta tal cual (para decir QUÉ está abierto)',
    terminal?.nombre === 'codex.exe' && terminal?.ruta === EXE.toUpperCase(),
    JSON.stringify(terminal)
  )
}
{
  const r = procesosQueBloquean(TABLA, [RAIZ], 'windows', [])
  check(
    '(1h) sin pids de Tessera, la sesión de Tessera TAMBIÉN bloquea (por eso hay que pasarlos)',
    r.some((p) => p.pid === 102),
    JSON.stringify(r.map((p) => p.pid))
  )
}
{
  const r = procesosQueBloquean(TABLA, [RAIZ], 'windows', [102])
  check('(1i) el propio pid en la lista también excluye', !r.some((p) => p.pid === 102), JSON.stringify(r.map((p) => p.pid)))
}
{
  const r = procesosQueBloquean(TABLA, [RAIZ.replace(/\\/g, '/').toLowerCase() + '/'], 'windows', [100])
  check(
    '(1j) raíz con `/`, en minúsculas y con barra final: el mismo resultado',
    JSON.stringify(r.map((p) => p.pid).sort((a, b) => a - b)) === JSON.stringify([201, 302, 400]),
    JSON.stringify(r.map((p) => p.pid))
  )
}
check('(1k) raíz vacía → nadie (casaría con TODO el equipo)', procesosQueBloquean(TABLA, [''], 'windows', []).length === 0, '[]')
check('(1l) raíz en blanco → nadie', procesosQueBloquean(TABLA, ['   '], 'windows', []).length === 0, '[]')
check('(1l2) sin raíces → nadie', procesosQueBloquean(TABLA, [], 'windows', []).length === 0, '[]')
{
  // Una vacía junto a una buena: la vacía se descarta sola, no arrastra a todo el equipo.
  const r = procesosQueBloquean(TABLA, ['', RAIZ], 'windows', [100])
  check(
    '(1l3) una raíz vacía junto a una buena no suma a nadie',
    JSON.stringify(r.map((p) => p.pid).sort((a, b) => a - b)) === JSON.stringify([201, 302, 400]),
    JSON.stringify(r.map((p) => p.pid))
  )
}
for (const p of ['mac', 'otra'] as const) {
  check(`(1m·${p}) fuera de Windows → [] (POSIX no bloquea por uso)`, procesosQueBloquean(TABLA, [RAIZ], p, []).length === 0, '[]')
}
check(
  '(1n) el proceso sin ruta visible (OpenConsole) no cuenta',
  !procesosQueBloquean(TABLA, ['C:\\'], 'windows', []).some((p) => p.pid === 700),
  'excluido'
)
{
  // Ciclo de padres (pid reutilizado): A→B→A. Tiene que terminar y contar como ajeno.
  const ciclo: ProcesoSistema[] = [
    { pid: 1, ppid: 2, nombre: 'codex.exe', ruta: EXE },
    { pid: 2, ppid: 1, nombre: 'node.exe', ruta: 'C:\\n\\node.exe' },
    { pid: 3, ppid: 3, nombre: 'codex.exe', ruta: EXE }
  ]
  const r = procesosQueBloquean(ciclo, [RAIZ], 'windows', [99])
  check('(1o) ciclos en la cadena de padres (A↔B y A→A): termina y cuentan como ajenos', r.length === 2, JSON.stringify(r.map((p) => p.pid)))
}
{
  // Cadena más profunda que la guarda: no se cuelga, y como no llega a Tessera, cuenta.
  const larga: ProcesoSistema[] = []
  for (let i = 1; i <= 200; i++) larga.push({ pid: i, ppid: i + 1, nombre: 'x.exe', ruta: i === 1 ? EXE : 'C:\\x.exe' })
  const r = procesosQueBloquean(larga, [RAIZ], 'windows', [200])
  check('(1p) una cadena de 200 eslabones no cuelga (la guarda corta)', Array.isArray(r), `${r.length} bloqueador(es)`)
}
{
  const padres = new Map<number, number | null>([
    [5, 4],
    [4, 3],
    [3, null]
  ])
  check('(1q) desciendeDe: nieto de 3', desciendeDe(5, padres, new Set([3])), 'true')
  check('(1r) desciendeDe: no de 9', !desciendeDe(5, padres, new Set([9])), 'false')
  check('(1s) desciendeDe: un pid que no está en la tabla sólo cuenta si es él mismo', desciendeDe(77, padres, new Set([77])), 'true')
}
{
  check('(1t) esDemonioCodex: `codex.exe app-server`', esDemonioCodex('C:\\x\\codex.exe app-server'), 'true')
  check('(1u) esDemonioCodex: con comillas y opciones', esDemonioCodex('"C:\\x\\codex.exe" app-server --listen'), 'true')
  check('(1v) esDemonioCodex: una ruta que CONTIENE app-server no basta', !esDemonioCodex('C:\\my-app-server-x\\codex.exe resume'), 'false')
  check('(1w) esDemonioCodex: sin línea de comandos', !esDemonioCodex(undefined), 'false')
}

// ---------------------------------------------------------------------------
hr('(1b) varias raíces: el paquete del binario fuera del paquete (bun, pnpm)')
{
  // bun: node_modules global PLANO; el binario vive en el HERMANO `codex-win32-x64`.
  const BUN = 'C:\\Users\\u\\.bun\\install\\global\\node_modules\\@openai'
  const raizBun = `${BUN}\\codex`
  const platBun = `${BUN}\\codex-win32-x64`
  const exeBun = `${platBun}\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`
  // pnpm: el alias `npm:@openai/codex@X-win32-x64` resuelve (realpath) a OTRO directorio del almacén.
  const PNPM = 'C:\\Users\\u\\AppData\\Local\\pnpm\\global\\5\\node_modules\\.pnpm'
  const raizPnpm = `${PNPM}\\@openai+codex@0.156.0\\node_modules\\@openai\\codex`
  const platPnpm = `${PNPM}\\@openai+codex@0.156.0-win32-x64\\node_modules\\@openai\\codex`
  const exePnpm = `${platPnpm}\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`
  const tabla: ProcesoSistema[] = [
    { pid: 1, ppid: 0, nombre: 'Editor.exe', ruta: 'C:\\Editor\\Editor.exe' },
    { pid: 11, ppid: 1, nombre: 'codex.exe', ruta: exeBun, lineaComando: `"${exeBun}" app-server` },
    { pid: 12, ppid: 1, nombre: 'codex.exe', ruta: exePnpm, lineaComando: `"${exePnpm}" app-server` },
    { pid: 13, ppid: 1, nombre: 'codexfoo.exe', ruta: `${BUN}\\codexfoo\\codexfoo.exe` },
    { pid: 14, ppid: 1, nombre: 'codex.exe', ruta: `${platBun}-extra\\codex.exe` }
  ]
  const soloRaiz = procesosQueBloquean(tabla, [raizBun], 'windows', [])
  check('(1x) bun con SÓLO la raíz del paquete: el codex.exe del hermano no se ve (el fallo de antes)', soloRaiz.length === 0, JSON.stringify(soloRaiz.map((p) => p.pid)))
  const conPlat = procesosQueBloquean(tabla, [raizBun, platBun], 'windows', [])
  check(
    '(1y) bun con la raíz del binario también: se ve, y `codexfoo` / `codex-win32-x64-extra` siguen sin colar',
    JSON.stringify(conPlat.map((p) => p.pid)) === JSON.stringify([11]) && conPlat[0].esDemonio,
    JSON.stringify(conPlat.map((p) => p.pid))
  )
  const pnpm = procesosQueBloquean(tabla, [raizPnpm, platPnpm], 'windows', [])
  check('(1z) pnpm: el directorio del almacén del binario cuenta como raíz', JSON.stringify(pnpm.map((p) => p.pid)) === JSON.stringify([12]), JSON.stringify(pnpm.map((p) => p.pid)))
  const doble = procesosQueBloquean(TABLA, [RAIZ, `${RAIZ}\\node_modules\\@openai\\codex-win32-x64`], 'windows', [100])
  check(
    '(1aa) npm con el binario ANIDADO pasado también como raíz: cada proceso sale una sola vez',
    JSON.stringify(doble.map((p) => p.pid).sort((a, b) => a - b)) === JSON.stringify([201, 302, 400]),
    JSON.stringify(doble.map((p) => p.pid))
  )
}

// ---------------------------------------------------------------------------
hr('(1c) por línea de comandos (Claude por npm)')
{
  const RAIZ_CLAUDE = 'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code'
  const tabla: ProcesoSistema[] = [
    // Una versión vieja de Claude: node.exe corriendo cli.js, con rutas `/` como las escribe el shim.
    {
      pid: 21,
      ppid: 1,
      nombre: 'node.exe',
      ruta: 'C:\\Program Files\\nodejs\\node.exe',
      lineaComando: '"C:/Program Files/nodejs/node.exe" "C:/Users/u/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/cli.js" --resume x'
    },
    // Un hermano con prefijo parecido no cuenta.
    {
      pid: 22,
      ppid: 1,
      nombre: 'node.exe',
      ruta: 'C:\\Program Files\\nodejs\\node.exe',
      lineaComando: '"C:/Program Files/nodejs/node.exe" "C:/Users/u/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-codefoo/cli.js"'
    },
    // La versión actual: `bin\claude.exe` corre DESDE la raíz (la ruta ya basta).
    { pid: 23, ppid: 1, nombre: 'claude.exe', ruta: `${RAIZ_CLAUDE}\\bin\\claude.exe`, lineaComando: `"${RAIZ_CLAUDE}\\bin\\claude.exe"` },
    // La sesión de Tessera (pty 300) con la versión vieja: excluida por descendencia.
    { pid: 300, ppid: 10, nombre: 'powershell.exe', ruta: 'C:\\Windows\\powershell.exe' },
    {
      pid: 301,
      ppid: 300,
      nombre: 'node.exe',
      ruta: 'C:\\Program Files\\nodejs\\node.exe',
      lineaComando: `node ${RAIZ_CLAUDE}\\cli.js`
    }
  ]
  const sin = procesosQueBloquean(tabla, [RAIZ_CLAUDE], 'windows', [300])
  check('(1ab) sin el criterio: sólo el claude.exe de dentro de la raíz; el node.exe de fuera no se ve', JSON.stringify(sin.map((p) => p.pid)) === JSON.stringify([23]), JSON.stringify(sin.map((p) => p.pid)))
  const con = procesosQueBloquean(tabla, [RAIZ_CLAUDE], 'windows', [300], { porLineaComando: true })
  const pids = con.map((p) => p.pid).sort((a, b) => a - b)
  check(
    '(1ac) con el criterio: el node.exe que corre <raiz>\\cli.js cuenta; `claude-codefoo` no; el de Tessera tampoco',
    JSON.stringify(pids) === JSON.stringify([21, 23]),
    JSON.stringify(pids)
  )
  check('(1ad) el que casa por ruta Y por línea sale una sola vez', con.filter((p) => p.pid === 23).length === 1, JSON.stringify(pids))
  check(
    '(1ae) se nombra por su ejecutable real (node.exe), que es lo que el usuario ve en el Administrador de tareas',
    con.find((p) => p.pid === 21)?.nombre === 'node.exe',
    JSON.stringify(con.find((p) => p.pid === 21))
  )
  check(
    '(1af) fuera de Windows, con el criterio también → []',
    procesosQueBloquean(tabla, [RAIZ_CLAUDE], 'mac', [], { porLineaComando: true }).length === 0,
    '[]'
  )
}

// ---------------------------------------------------------------------------
hr('(2) parsearTablaProcesos')
{
  const uno = parsearTablaProcesos('{"pid":42,"ppid":7,"name":"codex.exe","path":"C:\\\\x\\\\codex.exe"}\r\n')
  check(
    '(2a) un objeto suelto (ConvertTo-Json con un resultado)',
    uno !== null && uno.length === 1 && uno[0].pid === 42 && uno[0].ppid === 7 && uno[0].ruta === 'C:\\x\\codex.exe' && uno[0].lineaComando === undefined,
    JSON.stringify(uno)
  )
  const varios = parsearTablaProcesos(
    '[{"pid":1,"ppid":0,"name":"a","path":null},{"pid":2,"ppid":1,"name":"b","path":"C:\\\\b.exe","cmd":"b.exe --x"}]'
  )
  check(
    '(2b) un array; la entrada sin ruta se CONSERVA con ruta vacía (es un eslabón)',
    varios !== null && varios.length === 2 && varios[0].ruta === '' && varios[1].lineaComando === 'b.exe --x',
    JSON.stringify(varios)
  )
  check('(2c) salida vacía (cero procesos) → []', JSON.stringify(parsearTablaProcesos('  \r\n')) === '[]', '[]')
  check('(2d) basura → null (no es lo mismo que «nadie»)', parsearTablaProcesos('Get-CimInstance : Acceso denegado') === null, 'null')
  const raros = parsearTablaProcesos('[{"pid":"15","ppid":null,"name":"x"},{"pid":0,"name":"idle"},{"pid":-3},{"pid":"x"},null,7,{"pid":9,"ppid":"8"}]')
  check(
    '(2e) pid como texto vale; pid 0, negativo o no numérico fuera; ppid ausente → null; ppid texto → número',
    raros !== null && raros.length === 2 && raros[0].pid === 15 && raros[0].ppid === null && raros[1].ppid === 8,
    JSON.stringify(raros)
  )
}

// ---------------------------------------------------------------------------
hr('(3) guionListado')
{
  const conRaiz = guionListado({ bajoRaiz: true })
  check(
    '(3a) con raíz: filtra por StartsWith sin distinguir caja, leyendo la raíz del ENTORNO',
    conRaiz.includes('$env:TESSERA_RAIZ_PROCESOS') && conRaiz.includes('StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)'),
    conRaiz
  )
  const sinRaiz = guionListado()
  check('(3b) sin raíz: la tabla entera (sin Where-Object)', !sinRaiz.includes('Where-Object'), sinRaiz)
  check(
    '(3c) siempre pide el padre y fija la salida a UTF-8 dentro de un try',
    sinRaiz.includes('ppid = $_.ParentProcessId') && sinRaiz.includes('try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}'),
    sinRaiz
  )
  check(
    '(3d) la línea de comandos sólo si se pide (cuesta bytes)',
    !sinRaiz.includes('CommandLine') && guionListado({ conLineaComando: true }).includes('cmd = $_.CommandLine'),
    'ok'
  )
}

// ---------------------------------------------------------------------------
hr('(4) la tabla REAL')
if (esWindows()) {
  const t0 = Date.now()
  const r = await listarProcesosWindows({ conLineaComando: true })
  const ms = Date.now() - t0
  check('(4a) la consulta asíncrona responde ok', r.ok, r.ok ? `${r.procesos.length} procesos en ${ms} ms` : r.error)
  if (r.ok) {
    const yo = r.procesos.find((p) => p.pid === process.pid)
    check(
      '(4b) este proceso está, con su padre, su ruta y su línea de comandos',
      yo !== undefined &&
        yo.ppid === process.ppid &&
        yo.ruta.toLowerCase() === process.execPath.toLowerCase() &&
        (yo.lineaComando ?? '').includes('test-procesos-bloqueo'),
      JSON.stringify(yo)
    )
    // La decisión pura sobre la tabla de verdad: node corre desde la carpeta de node.
    const raizNode = path.dirname(process.execPath)
    const ajeno = procesosQueBloquean(r.procesos, [raizNode], 'windows', [])
    const deTessera = procesosQueBloquean(r.procesos, [raizNode], 'windows', [process.ppid])
    check(
      '(4c) con la tabla real: este node «bloquea» su carpeta… salvo si su padre es de Tessera',
      ajeno.some((p) => p.pid === process.pid) && !deTessera.some((p) => p.pid === process.pid),
      `sin pids: ${ajeno.length}, con el padre: ${deTessera.length}`
    )
  }
  // La variante síncrona es la que usa installDirLock, con el filtro en PowerShell.
  const raiz = path.dirname(process.execPath)
  const sync = listarProcesosWindowsSync({ bajoRaiz: raiz, timeoutMs: 8000 })
  check(
    '(4d) síncrona filtrada por raíz (la de installDirLock): este node dentro, y nada de fuera',
    sync.some((p) => p.pid === process.pid) &&
      sync.every((p) => p.ruta.toLowerCase().startsWith(raiz.toLowerCase() + '\\')),
    `${sync.length} proceso(s) bajo ${raiz}`
  )
  const conBarras = listarProcesosWindowsSync({ bajoRaiz: raiz.replace(/\\/g, '/'), timeoutMs: 8000 })
  check('(4e) la raíz con `/` filtra igual', conBarras.some((p) => p.pid === process.pid), `${conBarras.length} proceso(s)`)
  omitir('(4f) fuera de Windows la consulta dice que no aplica', 'esto es Windows: se comprueba en Mac')
} else {
  omitir('(4a-e) la tabla real', 'sólo existe en Windows (CIM); aquí se comprueba que la consulta no finge')
  const r = await listarProcesosWindows()
  check('(4f) fuera de Windows la consulta DICE que no aplica (ok:false), no finge una tabla vacía', !r.ok, JSON.stringify(r))
  let lanza = false
  try {
    listarProcesosWindowsSync()
  } catch {
    lanza = true
  }
  check('(4g) …y la síncrona lanza', lanza, String(lanza))
}

hr('RESULTADO')
for (const o of omitidos) console.log(`NO APLICA  ${o}`)
const cola = omitidos.length > 0 ? ` (${omitidos.length} NO APLICA en este sistema)` : ''
hr(`VEREDICTO: ${pasadas}/${total} PASS${cola}`)
process.exit(pasadas === total ? 0 : 1)
