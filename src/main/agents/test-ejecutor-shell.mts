#!/usr/bin/env node
// =============================================================================
// Prueba de ejecutorShell (npm run test:ejecutor-shell). Lo puro, para las dos
// plataformas: muerte del árbol, envolturas, plan, sonda y compuerta. De verdad, con la
// shell nativa de esta máquina: sondas, códigos de salida, UTF-8 y el tope que mata al
// hijo y al nieto (bloque 6: el canario del control de trabajos en Mac).
// Decisiones: docs/decisiones/agentes/nativos-ejecucion-en-shell.md
// =============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MARCA_FIN,
  MARCA_INI,
  argumentosTaskkill,
  crearCompuerta,
  ejecutarEnShellNativa,
  envolverOrden,
  envolverPowerShell,
  envolverSonda,
  estrategiaMuerte,
  planEjecucion,
  salidaDeSonda
} from './ejecutorShell.ts'
import { citarPowerShell, citarSh } from '../../shared/citarShell.ts'
import { plataformaActual } from '../../shared/plataforma.ts'

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

const BARRA = String.fromCharCode(92)
const aqui = plataformaActual()
const enWindows = aqui === 'windows'
/** Cita para la shell que recibe la línea en ESTA plataforma. */
const citar = (v: string): string => (enWindows ? citarPowerShell(v) : citarSh(v))
/** Un ejecutable dado por ruta: PowerShell necesita `&` delante de una cadena. */
const ejecutable = (ruta: string): string => (enWindows ? `& ${citarPowerShell(ruta)}` : citarSh(ruta))
const NODE = ejecutable(process.execPath)

function existe(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
hr('(1) estrategiaMuerte')
{
  const w = estrategiaMuerte('windows')
  const m = estrategiaMuerte('mac')
  const o = estrategiaMuerte('otra')
  check('(1a) Windows → taskkill', w.tipo === 'taskkill', JSON.stringify(w))
  check('(1b) Mac → grupo de procesos con SIGKILL', m.tipo === 'grupo' && m.senal === 'SIGKILL', JSON.stringify(m))
  check('(1c) otra (POSIX) → grupo', o.tipo === 'grupo', JSON.stringify(o))
  const args = argumentosTaskkill(1234)
  check('(1d) taskkill /PID <pid> /T /F (el ÁRBOL, sin preguntar)', JSON.stringify(args) === JSON.stringify(['/PID', '1234', '/T', '/F']), args.join(' '))
}

// ---------------------------------------------------------------------------
hr('(2) envolturas')
{
  const ps = envolverPowerShell('claude update')
  check('(2a) PowerShell: la orden va dentro', ps.includes('claude update; '), ps)
  check(
    '(2b) PowerShell: $LASTEXITCODE a $null ANTES, y 0/1 por $? si no hubo nativo',
    ps.indexOf('$global:LASTEXITCODE = $null') < ps.indexOf('claude update') &&
      ps.includes('if ($__c -is [int]) { exit $__c } elseif ($__ok) { exit 0 } else { exit 1 }'),
    ps
  )
  check('(2c) PowerShell: salida en UTF-8 dentro de un try', ps.startsWith('try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}'), ps)

  const sonda = envolverSonda('codex --version')
  const printf = `printf '%s${BARRA}n'`
  check(
    "(2d) sonda: printf '%s\\n' INI; <cmd>; printf '%s\\n' FIN",
    sonda === `${printf} '${MARCA_INI}'; codex --version; ${printf} '${MARCA_FIN}'`,
    sonda
  )
  const orden = envolverOrden("npm install -g '@openai/codex@0.156.1'")
  check(
    '(2e) orden: marcador y `exec <cmd> 2>&1` (el código es el del CLI)',
    orden === `${printf} '${MARCA_INI}'; exec npm install -g '@openai/codex@0.156.1' 2>&1`,
    orden
  )
  check(
    '(2f) las envolturas POSIX no interpolan variables (válidas en fish)',
    !envolverSonda('x').includes('$') && !envolverOrden('x').includes('$'),
    'sin $'
  )
  check(
    '(2g) el `\\n` del printf es UNA barra y una n (no se colapsó ni se duplicó)',
    sonda.includes(`%s${BARRA}n`) && !sonda.includes(`%s${BARRA}${BARRA}n`),
    sonda.slice(0, 16)
  )
  check('(2h) los marcadores no llevan comillas, $ ni delimitadores', !/[:;"'$ ]/.test(MARCA_INI + MARCA_FIN), `${MARCA_INI} ${MARCA_FIN}`)
}

// ---------------------------------------------------------------------------
hr('(3) planEjecucion')
{
  const w = planEjecucion('codex --version', { plataforma: 'windows', shellEnv: '/bin/zsh', modo: 'sonda' })
  check(
    '(3a) Windows: powershell.exe -NoLogo -NoProfile -NonInteractive -Command, sin detached ni marcas',
    w.archivo === 'powershell.exe' &&
      JSON.stringify(w.args.slice(0, 4)) === JSON.stringify(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']) &&
      w.args[4] === envolverPowerShell('codex --version') &&
      !w.detached &&
      !w.conMarcas,
    JSON.stringify(w.args.slice(0, 4))
  )
  const m = planEjecucion('codex --version', { plataforma: 'mac', shellEnv: '/opt/homebrew/bin/fish', modo: 'sonda' })
  check(
    '(3b) Mac: el $SHELL del usuario con -ilc y la sonda envuelta, en grupo propio',
    m.archivo === '/opt/homebrew/bin/fish' && m.args[0] === '-ilc' && m.args[1] === envolverSonda('codex --version') && m.detached && m.conMarcas,
    JSON.stringify(m)
  )
  const sinShell = planEjecucion('codex update', { plataforma: 'mac', shellEnv: undefined, modo: 'orden' })
  check(
    '(3c) Mac sin $SHELL: /bin/zsh, y en modo orden la envoltura con exec',
    sinShell.archivo === '/bin/zsh' && sinShell.args[1] === envolverOrden('codex update'),
    JSON.stringify(sinShell)
  )
}

// ---------------------------------------------------------------------------
hr('(4) salidaDeSonda y compuerta')
{
  const banner = `Último inicio de sesión: hoy\nzsh: no job control in this shell\n${MARCA_INI}\ncodex-cli 0.156.0\n${MARCA_FIN}\nadiós\n`
  check('(4a) Mac: sólo lo de entre marcas, recortado', salidaDeSonda(banner, 'mac') === 'codex-cli 0.156.0', JSON.stringify(salidaDeSonda(banner, 'mac')))
  check('(4b) Mac: sin marcas → null (no se leen banners como versión)', salidaDeSonda('zsh 5.9 (x86_64)\n', 'mac') === null, 'null')
  check('(4c) Windows: el stdout recortado', salidaDeSonda('codex-cli 0.156.0\r\n', 'windows') === 'codex-cli 0.156.0', 'ok')

  const c = crearCompuerta('mac')
  const pasa = [
    c.pasar('Bienvenido', 'stdout'),
    c.pasar('zsh: no job control', 'stderr'),
    c.pasar(`banner sin salto${MARCA_INI}`, 'stdout'),
    c.pasar('added 1 package', 'stdout'),
    c.pasar('npm warn algo', 'stderr')
  ]
  check(
    '(4d) Mac: nada hasta el marcador (tampoco el stderr de arranque); después, todo',
    JSON.stringify(pasa) === JSON.stringify([null, null, null, 'added 1 package', 'npm warn algo']) && c.abierta,
    JSON.stringify(pasa)
  )
  const c2 = crearCompuerta('mac')
  check('(4e) Mac: lo que venga detrás del marcador en su misma línea se conserva', c2.pasar(`${MARCA_INI}resto`, 'stdout') === 'resto', 'resto')
  const cw = crearCompuerta('windows')
  check('(4f) Windows: todo pasa desde el principio, por los dos flujos', cw.pasar('a', 'stdout') === 'a' && cw.pasar('b', 'stderr') === 'b' && cw.abierta, 'ok')
}

// ---------------------------------------------------------------------------
hr(`(5) de verdad, en esta plataforma (${aqui})`)
{
  const r = await ejecutarEnShellNativa(`${NODE} --version`, { timeoutMs: 30_000, modo: 'sonda' })
  check('(5a) sonda real: `node --version` → ok y la versión, sin ruido', r.ok && r.salida === process.version && !r.tope, JSON.stringify(r))
}
{
  const r = await ejecutarEnShellNativa(`${NODE} -e ${citar('process.exit(3)')}`, { timeoutMs: 30_000, modo: 'orden' })
  check('(5b) orden que sale con 3 → ok:false, codigo:3', !r.ok && r.codigo === 3 && !r.tope, JSON.stringify(r))
}
{
  const cmd = enWindows ? 'Write-Output hola' : 'true'
  const r = await ejecutarEnShellNativa(cmd, { timeoutMs: 30_000, modo: 'orden' })
  check(
    `(5c) \`${cmd}\` (sin código nativo en Windows) → ok, codigo 0`,
    r.ok && r.codigo === 0,
    JSON.stringify(r)
  )
}
{
  const r = await ejecutarEnShellNativa('tessera-no-existe-xyz --version', { timeoutMs: 30_000, modo: 'orden' })
  check('(5d) una orden que no existe → ok:false y código distinto de 0', !r.ok && r.codigo !== 0 && r.codigo !== null, JSON.stringify(r))
}
{
  const lineas: string[] = []
  const script = "console.log('uno'); console.error('dos'); console.log('José ✓ tres')"
  const r = await ejecutarEnShellNativa(`${NODE} -e ${citar(script)}`, {
    timeoutMs: 30_000,
    modo: 'orden',
    onLinea: (l) => lineas.push(l)
  })
  check(
    '(5e) onLinea recibe stdout y stderr, línea a línea y con UTF-8 intacto',
    r.ok && lineas.includes('uno') && lineas.includes('dos') && lineas.includes('José ✓ tres') && lineas.length === 3,
    JSON.stringify(lineas)
  )
  check('(5f) la salida de la orden las junta', r.salida.includes('uno') && r.salida.includes('dos') && r.salida.includes('José ✓ tres'), JSON.stringify(r.salida))
}
{
  const r = await ejecutarEnShellNativa(`${NODE} -e ${citar("console.log('x'.repeat(5000))")}`, {
    timeoutMs: 30_000,
    modo: 'orden',
    topeBytes: 1024
  })
  check('(5g) tope de salida: se corta y se avisa, sin romper la orden', r.ok && r.salida.length < 1200 && r.salida.includes('recortada'), `${r.salida.length} caracteres`)
}

// ---------------------------------------------------------------------------
hr('(6) EL TOPE: resuelve a tiempo y mata el ÁRBOL')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-ejecutor-'))
  const guion = path.join(dir, 'dormilon.mjs')
  // Hijo que lanza un NIETO (otro node) y los dos duermen un minuto. Cada uno dice su pid.
  fs.writeFileSync(
    guion,
    [
      "import { spawn } from 'node:child_process'",
      "const nieto = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })",
      "console.log('PID=' + process.pid)",
      "console.log('NIETO=' + nieto.pid)",
      'setTimeout(() => {}, 60000)',
      ''
    ].join('\n')
  )
  const pids: Record<string, number> = {}
  const TOPE = 4000
  const t0 = Date.now()
  const r = await ejecutarEnShellNativa(`${NODE} ${citar(guion)}`, {
    timeoutMs: TOPE,
    modo: 'orden',
    onLinea: (l) => {
      const m = /^(PID|NIETO)=(\d+)$/.exec(l.trim())
      if (m) pids[m[1]] = Number(m[2])
    }
  })
  const ms = Date.now() - t0
  check('(6a) resuelve con tope:true, ok:false y codigo null', r.tope && !r.ok && r.codigo === null && (r.error ?? '').includes('tope'), JSON.stringify(r))
  check(`(6b) resuelve A TIEMPO (tope ${TOPE} ms, sin esperar al minuto del hijo)`, ms >= TOPE - 50 && ms < TOPE + 1500, `${ms} ms`)
  check('(6c) el hijo y el nieto llegaron a arrancar (hay a quién matar)', pids.PID > 0 && pids.NIETO > 0, JSON.stringify(pids))
  // La muerte del árbol no es instantánea (taskkill es otro proceso): hasta 5 s.
  let vivos = [pids.PID, pids.NIETO].filter((p) => p > 0 && existe(p))
  for (let i = 0; i < 50 && vivos.length > 0; i++) {
    await esperar(100)
    vivos = vivos.filter(existe)
  }
  check('(6d) ni el hijo ni el NIETO siguen vivos', vivos.length === 0, vivos.length ? `vivos: ${vivos.join(', ')}` : 'muertos los dos')
  for (const p of vivos) {
    try {
      process.kill(p, 'SIGKILL')
    } catch {
      /* limpieza best-effort */
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

hr(`VEREDICTO: ${pasadas}/${total} PASS`)
process.exit(pasadas === total ? 0 : 1)
