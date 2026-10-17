#!/usr/bin/env node
// =============================================================================
// Prueba del registro de ptys (`adaptadores/registroPtys.ts`, npm run test:registro-ptys) y de cómo se
// lee un `taskkill` (`adaptadores/taskkill.ts`). Lo puro corre en todas las plataformas. En Windows,
// además, con Electron y node-pty reales: un pty suelto cuya raíz no muere con su consola deja colgada
// la salida de la app, y `rematarPtysSueltos` antes de `app.exit` la deja salir.
// =============================================================================

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { crearRegistroPtys, textoPendientes, type PtyRegistrable } from './registroPtys.ts'
import { clasificarTaskkill, notaTaskkill } from './taskkill.ts'
import { esWindows } from '../../../shared/plataforma.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

interface PtyFalso extends PtyRegistrable {
  kills: number
  /** La raíz terminó (lo que en Windows dice el aviso nativo). */
  fin: boolean
}
const falso = (pid: number): PtyFalso => ({ pid, kills: 0, fin: false })
/** Como POSIX: la raíz terminó cuando el pty avisó de su salida. */
const terminadoPosix = (_p: PtyFalso, aviso: boolean): boolean => aviso
/** Como Windows: la raíz terminó solo con el aviso nativo, avisara o no el pty. */
const terminadoWindows = (p: PtyFalso): boolean => p.fin

function casosRegistro(): void {
  hr('(a) el registro: quién queda pendiente y cómo se remata')
  const senales: number[] = []
  const reg = crearRegistroPtys<PtyFalso>({ matar: (p) => p.kills++, senalar: (pid) => senales.push(pid), terminado: terminadoPosix })
  const a = falso(10)
  const b = falso(20)
  const c = falso(30)
  reg.alta(a, 'pwsh.exe')
  reg.alta(b, 'ssh.exe')
  reg.alta(c, 'node.exe')
  reg.avisoDeSalida(a)
  check('(a1) solo quedan pendientes los que no terminaron', reg.pendientes().map((p) => p.pid).join() === '20,30', JSON.stringify(reg.pendientes()))
  check('(a2) kill() una sola vez por pty, aunque se pida dos', reg.matar(b) && !reg.matar(b) && b.kills === 1, `kills=${b.kills}`)
  check('(a3) uno que ya terminó también recibe su kill (cierra su pseudoconsola), una vez', reg.matar(a) && !reg.matar(a) && a.kills === 1, `kills=${a.kills}`)
  const cuenta = reg.rematarTodos()
  check(
    '(a4) rematar: kill al que nadie mató y la señal al que ya lo tuvo',
    cuenta.kill === 1 && cuenta.senal === 1 && c.kills === 1 && senales.join() === '20',
    `${JSON.stringify(cuenta)} señales=${senales.join()}`
  )
  check('(a5) rematar uno que terminó no hace nada', reg.rematar(a) === 'terminado' && a.kills === 1, `kills=${a.kills}`)
  check('(a6) los pendientes dicen si ya se les mandó kill', textoPendientes(reg.pendientes()) === 'pid 20 ssh.exe (matado), pid 30 node.exe (matado)', textoPendientes(reg.pendientes()))
  check('(a7) sin pendientes, «ninguno»', textoPendientes([]) === 'ninguno', textoPendientes([]))

  const win = crearRegistroPtys<PtyFalso>({ matar: (p) => p.kills++, senalar: null, terminado: terminadoWindows })
  const d = falso(40)
  win.alta(d, 'pwsh.exe')
  win.matar(d)
  check('(a8) donde no hay señal segura (Windows), un matado que sigue vivo no se señala', win.rematar(d) === 'nada', `kills=${d.kills}`)
  // El fallo que esto evita: en Windows el pty avisa de su salida al cerrarse su tubería, con la raíz
  // aún viva (un proceso que no usa la consola). Darlo por terminado lo dejaba fuera del remate.
  const e0 = falso(45)
  win.alta(e0, 'Tessera.exe')
  win.avisoDeSalida(e0)
  check('(a9) Windows: avisar de la salida con la raíz viva lo deja pendiente', win.pendientes().some((p) => p.pid === 45), JSON.stringify(win.pendientes()))
  check('(a10) y el remate le manda su kill', win.rematar(e0) === 'kill' && e0.kills === 1, `kills=${e0.kills}`)
  e0.fin = true
  d.fin = true
  check('(a11) con el aviso nativo de fin, sale del registro', win.pendientes().length === 0, JSON.stringify(win.pendientes()))
  const lanza = crearRegistroPtys<PtyFalso>({
    matar: () => {
      throw new Error('destruido')
    },
    senalar: () => {
      throw new Error('ESRCH')
    },
    terminado: () => {
      throw new Error('destruido')
    }
  })
  const e = falso(50)
  lanza.alta(e, 'x')
  let lanzo = false
  try {
    lanza.rematarTodos()
    lanza.rematarTodos()
  } catch {
    lanzo = true
  }
  check('(a12) un kill, una señal o una consulta que lanzan no rompen el remate', !lanzo, `lanzo=${lanzo}`)
}

function casosTaskkill(): void {
  hr('(b) el desenlace de taskkill')
  check('(b1) sin error: ok, sin nota', clasificarTaskkill(null).estado === 'ok' && notaTaskkill({ estado: 'ok' }) === null, 'ok')
  const tope = clasificarTaskkill({ killed: true, signal: 'SIGTERM', code: null })
  check('(b2) cortado por su tope: tope, y se anota', tope.estado === 'tope' && notaTaskkill(tope) !== null, JSON.stringify(tope))
  const sin = clasificarTaskkill({ code: 128 })
  check('(b3) algún pid ya no existía: sin nota (lo normal en un cierre)', sin.estado === 'sin-proceso' && notaTaskkill(sin) === null, JSON.stringify(sin))
  const fallo = clasificarTaskkill({ code: 1, message: 'x' }, 'ERROR: Acceso denegado.\r\n')
  check('(b4) otro código: fallo con su código y su texto, y se anota', fallo.estado === 'fallo' && /código 1: ERROR: Acceso denegado\./.test(fallo.detalle ?? '') && notaTaskkill(fallo) !== null, JSON.stringify(fallo))
}

/** Main de Electron: abre un pty cuya raíz es de subsistema GUI y lo deja suelto; con REMATAR, lo remata antes de salir. */
const MAIN_ELECTRON = `
import { app } from 'electron'
const pty = await import(process.env.PTY_TS)
app.whenReady().then(async () => {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  pty.lanzarPty(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cols: 80, rows: 24, cwd: process.cwd(), env })
  await new Promise((r) => setTimeout(r, 2500))
  if (process.env.REMATAR === '1') await pty.rematarPtysSueltos()
  process.stdout.write('SALE\\n')
  app.exit(0)
})
`

/** Arranca el main y mide si el proceso sale tras «SALE»; si no, lo mata por pid con su árbol. */
async function correrElectron(electron: string, main: string, rematar: boolean, topeMs: number): Promise<{ sale: boolean; ms: number }> {
  const env: Record<string, string | undefined> = { ...process.env, PTY_TS: pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'pty.ts')).href, REMATAR: rematar ? '1' : '0' }
  delete env.ELECTRON_RUN_AS_NODE
  const hijo = spawn(electron, [main, `--user-data-dir=${path.join(path.dirname(main), rematar ? 'ud-r' : 'ud-s')}`], { env, stdio: ['ignore', 'pipe', 'ignore'] })
  let tSale = 0
  hijo.stdout.on('data', (d: Buffer) => {
    if (String(d).includes('SALE') && tSale === 0) tSale = Date.now()
  })
  const fin = new Promise<boolean>((r) => hijo.on('exit', () => r(true)))
  const arranque = Date.now()
  const sale = await Promise.race([fin, new Promise<boolean>((r) => setTimeout(() => r(false), topeMs))])
  if (!sale && hijo.pid !== undefined) {
    try {
      execFileSync('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], { stdio: 'ignore', timeout: 15_000 })
    } catch {
      /* ya muerto */
    }
  }
  return { sale, ms: Date.now() - (tSale || arranque) }
}

async function casosReales(): Promise<void> {
  hr('(c) Electron real: un pty suelto con la raíz viva y app.exit')
  const electron = path.resolve('node_modules', 'electron', 'dist', 'electron.exe')
  if (!existsSync(electron)) {
    console.log('  (c) se salta: no está el Electron del repo')
    return
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tessera-registro-ptys-'))
  try {
    const main = path.join(dir, 'main.mjs')
    writeFileSync(main, MAIN_ELECTRON)
    const sin = await correrElectron(electron, main, false, 20_000)
    check('(c1) sin rematar, la app no sale (el mecanismo del cuelgue)', !sin.sale, `sale=${sin.sale}`)
    const con = await correrElectron(electron, main, true, 20_000)
    check('(c2) con rematarPtysSueltos antes de app.exit, sale enseguida', con.sale && con.ms < 5_000, `sale=${con.sale} ms=${con.ms}`)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
}

/** Un resize pedido antes del primer byte y luego `matarPty`: no queda nada aplazado que corra sobre el pty muerto. */
async function casoAplazadosTrasMatar(): Promise<void> {
  hr('(d) Windows: matar antes del primer byte descarta lo aplazado')
  const { lanzarPty, matarPty } = await import('./pty.ts')
  const pty = lanzarPty(process.env.ComSpec ?? 'cmd.exe', [], { cols: 80, rows: 24, cwd: os.tmpdir(), env: { ...process.env } as Record<string, string> })
  const interno = pty as unknown as { _isReady?: boolean; _deferreds?: unknown[] }
  let lanzo = ''
  try {
    pty.resize(100, 30)
    const aplazadosAntes = interno._deferreds?.length ?? -1
    matarPty(pty)
    await new Promise((r) => setTimeout(r, 1500))
    check('(d1) el resize quedó aplazado antes de matar', aplazadosAntes === 1 && interno._isReady === false, `aplazados=${aplazadosAntes} listo=${interno._isReady}`)
    check('(d2) tras matar, la cola aplazada está vacía', (interno._deferreds?.length ?? -1) === 0, `aplazados=${interno._deferreds?.length}`)
  } catch (e) {
    lanzo = String(e)
  }
  check('(d3) matar con un resize aplazado no lanza', lanzo === '', lanzo || 'sin error')
}

/** Un programa que hace eco y sale al recibir `exit` + Intro, como el ssh de una pestaña SSH. */
const PROGRAMA_EXIT =
  "process.stdout.write('listo\\r\\n'); try { process.stdin.setRawMode(true) } catch {} let l = ''; " +
  "process.stdin.on('data', (b) => { l += String(b); if (/exit\\r/.test(l)) process.exit(0) })"

/**
 * Reconectar una sesión cuyo proceso ya terminó no espera a la cola de muertes del proceso (las
 * paradas y cierres de otras sesiones, de hasta unos segundos cada una): solo entra en ella si el pty
 * viejo sigue con la raíz viva y hay algo que rematar.
 */
async function casoRecargaSinCola(): Promise<void> {
  hr('(e) reconectar una sesión que ya terminó no espera a la cola de muertes')
  const { TerminalService } = await import('../TerminalService.ts')
  const { colaMuertesDelProceso } = await import('../colaMuertes.ts')
  const perfil = { id: 'recargaqa', nombre: 'RecargaQA', color: '#1D9E75', agentes: [], sandbox: { habilitado: false } }
  const term = new TerminalService({} as never)
  const ejecutable = { archivo: process.execPath, args: ['-e', PROGRAMA_EXIT] }
  const s = await term.createSession(perfil as never, { project: os.homedir(), host: true, ejecutable } as never)
  let salida = ''
  term.onData(s.id, (d) => {
    salida += d
  })
  const salidas: Array<number | null> = []
  term.onExit(s.id, (c) => salidas.push(c))
  const esperarHasta = async (cond: () => boolean, ms: number): Promise<boolean> => {
    const fin = Date.now() + ms
    while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 50))
    return cond()
  }
  const ocupada = colaMuertesDelProceso.coger()
  try {
    await esperarHasta(() => salida.includes('listo'), 15_000)
    term.write(s.id, 'exit\r')
    const salio = await esperarHasta(() => salidas.length > 0, 15_000)
    const t0 = Date.now()
    const r = await Promise.race([
      term.reloadSession(s.id, { ejecutable }).then(() => 'recargada'),
      new Promise<string>((res) => setTimeout(() => res('colgada'), 8_000))
    ])
    check('(e1) con la cola ocupada, reconectar tras la salida relanza enseguida', salio && r === 'recargada', `salió=${salio} ${r} en ${Date.now() - t0} ms`)
  } finally {
    ocupada.soltar()
    for (const x of term.listSessions()) await term.closeSession(x.id)
    await term.closeSession(s.id).catch(() => undefined)
  }
}

async function main(): Promise<void> {
  casosRegistro()
  casosTaskkill()
  await casoRecargaSinCola()
  if (esWindows()) await casoAplazadosTrasMatar()
  if (esWindows()) await casosReales()
  else console.log('\n(c) se salta: el cuelgue por el hilo de espera de node-pty es de ConPTY')
  const pasan = results.filter((r) => r.pass).length
  hr(`VEREDICTO: ${pasan}/${results.length} PASS`)
  process.exit(pasan === results.length ? 0 : 1)
}

void main()
