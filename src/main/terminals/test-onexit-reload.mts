#!/usr/bin/env node
// =============================================================================
// Prueba de `TerminalService.onExit` de primer nivel (npm run test:onexit): sobrevive a
// `reloadSession()` y no se dispara con el reload.
// Dos pasos nativos previos, sin Docker: un onExit tardío tras `detenerSesion()` no se anuncia (H)
// y escribir en un pty ya salido no deja una excepción sin capturar (E).
// Después, con Docker: la misma suscripción dispara una vez al salir de verdad, el sessionId se
// conserva y no quedan huérfanos.
// Solo Node core + SandboxManager + TerminalService + node-pty.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import type { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SandboxManager } from '../sandbox/SandboxManager.ts'
import { TerminalService } from './TerminalService.ts'
import { blindarEntradaPty, socketEntradaDe } from './entradaPty.ts'
import type { Profile } from '../profiles/types.ts'
import { esWindows } from '../../shared/plataforma.ts'
import { citarPowerShell, citarSh } from '../../shared/citarShell.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')
const PROJECT_HOST = path.join(REPO_ROOT, 'docker', 'sandbox', 'proyecto-demo')
// Id PROPIO del test: el nombre del contenedor y el `configDir` se derivan del id,
// así que con uno real este test mataba el contenedor de ese perfil del usuario.
const CONTAINER_NAME = 'tessera-onexitqa'

const PERFIL_QA: Profile = {
  id: 'onexitqa',
  nombre: 'OnExitQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/onexitqa/claude' }],
  sandbox: { habilitado: true }
}

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
async function esperarHasta(cond: () => boolean, ms: number): Promise<boolean> {
  const limite = Date.now() + ms
  while (!cond()) {
    if (Date.now() > limite) return false
    await sleep(50)
  }
  return true
}

/**
 * PASO E: escribir en un pty que ya salió no deja una excepción no capturada.
 *
 * (E0) con formas FALSAS, para fijar desde cualquier máquina lo que la función hace en
 * cada plataforma. (E1/E2) con un pty REAL de `TerminalService`: una sesión nativa cuyo
 * launch sale al momento, y dos escrituras tardías —una dentro de su onExit, como el
 * `exit` del cierre elegante que llega cuando el `^C` ya lo mató, y otra después, como
 * la del renderer tecleando en un pane muerto—. Sin el blindaje, en Windows la primera
 * acaba en un `write EAGAIN` no capturado (medido: 8 de 8 con `cmd.exe /c exit 0`).
 *
 * Mientras dura el paso se escucha `uncaughtException` para CONTAR en vez de morir:
 * así un fallo sale como FAIL con su evidencia y no como un proceso caído a medias.
 */
async function pasoEscrituraTrasSalida(): Promise<void> {
  hr('PASO E - (nativo, sin Docker) escribir en un pty que ya salió NO deja una excepción no capturada')

  // --- E0: formas falsas -------------------------------------------------------
  const avisos: string[] = []
  const avisar = (m: string): void => {
    avisos.push(m)
  }
  const entradaFalsa = new EventEmitter()
  const puesto = blindarEntradaPty({ _agent: { inSocket: entradaFalsa } }, 'falsa-win', avisar, 'windows')
  let lanzo: unknown = null
  try {
    entradaFalsa.emit('error', Object.assign(new Error('write EAGAIN'), { code: 'EAGAIN' }))
  } catch (e) {
    lanzo = e
  }
  check(
    '(E0a) forma de Windows: pone el oyente y el error de escritura se registra en vez de lanzar',
    puesto && lanzo === null && avisos.length === 1 && avisos[0].includes('falsa-win') && avisos[0].includes('EAGAIN'),
    `puesto=${puesto} lanzó=${lanzo !== null} avisos=${JSON.stringify(avisos)}`
  )

  avisos.length = 0
  const enMac = blindarEntradaPty({}, 'falsa-mac', avisar, 'mac')
  check(
    '(E0b) forma de macOS (sin `_agent`): no pone nada ni avisa — allí node-pty escribe con fs.write y gestiona su error',
    !enMac && avisos.length === 0,
    `puesto=${enMac} avisos=${JSON.stringify(avisos)}`
  )

  const sinForma1 = blindarEntradaPty({}, 'falsa-1', avisar, 'windows')
  const sinForma2 = blindarEntradaPty({}, 'falsa-2', avisar, 'windows')
  check(
    '(E0c) Windows SIN la forma esperada (un node-pty que cambió): avisa, y una sola vez por proceso',
    !sinForma1 && !sinForma2 && avisos.length === 1 && avisos[0].includes('_agent.inSocket'),
    `puestos=${sinForma1},${sinForma2} avisos=${JSON.stringify(avisos)}`
  )

  // --- E1/E2: pty real -----------------------------------------------------------
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-entrada-'))
  const term = new TerminalService({} as unknown as SandboxManager)
  const noCapturadas: string[] = []
  const alNoCapturada = (e: unknown): void => {
    noCapturadas.push(e instanceof Error ? `${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}` : String(e))
  }
  process.on('uncaughtException', alNoCapturada)
  let sesion = ''
  try {
    // `exit 0` como launch: PowerShell `-Command` en Windows, `$SHELL -ilc` en macOS.
    const s = await term.createSession(
      { ...PERFIL_QA, id: 'onexitentrada', sandbox: { habilitado: false } },
      { project: tmp, host: true, launch: 'exit 0' }
    )
    sesion = s.id
    const entrada = socketEntradaDe(s.pty)
    const oyentes = entrada?.listenerCount('error') ?? 0
    let salio = false
    term.onExit(s.id, () => {
      salio = true
      term.write(s.id, 'x')
    })
    const salioATiempo = await esperarHasta(() => salio, 20000)
    await sleep(500) // el error de la escritura es ASÍNCRONO: se le deja llegar
    term.write(s.id, 'y')
    await sleep(500)

    check(
      esWindows()
        ? '(E1) Windows: el pty real tiene socket de entrada y TerminalService le puso oyente de error'
        : '(E1) macOS: el pty real no tiene socket de entrada que blindar (UnixTerminal)',
      esWindows() ? entrada !== null && oyentes >= 1 : entrada === null,
      `socket_de_entrada=${entrada !== null} oyentes_de_error=${oyentes}`
    )
    // En Windows se exige además que la escritura HAYA FALLADO de verdad: sin eso el
    // paso podría pasar en verde sin haber provocado nunca el error que vigila.
    const errorEntrada = (entrada as unknown as Writable | null)?.errored as NodeJS.ErrnoException | null | undefined
    check(
      '(E2) escribir tras la salida (dentro de su onExit y después) no deja ninguna excepción no capturada',
      salioATiempo && noCapturadas.length === 0 && (!esWindows() || errorEntrada != null),
      `salió=${salioATiempo} no_capturadas=${JSON.stringify(noCapturadas)} ` +
        `error_en_la_entrada=${errorEntrada ? errorEntrada.code ?? errorEntrada.message : 'ninguno'}`
    )
  } finally {
    // La sesión salió, así que `listSessions` ya no la lista: se cierra por su id.
    if (sesion) await term.closeSession(sesion)
    // Espera corta a errores rezagados antes de dejar de contarlos.
    await sleep(200)
    process.off('uncaughtException', alNoCapturada)
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* la carpeta temporal la recoge el sistema */
    }
  }
}

/**
 * PASO H: onExit TARDÍO tras detenerSesion. Nativo y sin Docker: el sandbox es un
 * objeto vacío que una sesión `host` no toca.
 *
 * Para que el onExit llegue DE VERDAD después de la parada hace falta que el agente
 * siga vivo cuando ésta termina, y eso sólo pasa si el kill de reserva no lo mata. Se
 * neutraliza, pues, `matarDeReserva` en ESTA instancia (su comentario explica que existe
 * aparte por esto): el agente falso en modo B ignora los `^C`, la recolección vence, la
 * parada termina con el proceso vivo, y es la prueba quien lo mata después. El onExit
 * que produce esa muerte se escucha directamente en el pty (fuera del servicio) para
 * DEMOSTRAR que llegó tarde; lo que se comprueba es que el servicio no lo anuncia.
 */
async function pasoOnExitTardioTrasDetener(): Promise<void> {
  hr('PASO H - (nativo, sin Docker) un onExit TARDÍO tras detenerSesion NO emite EXIT')
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-onexit-'))
  const registro = path.join(tmp, 'agente.log')
  const agente = path.join(MODULE_DIR, 'agenteFalsoDetener.mjs')
  const partes = [process.execPath, agente, 'B', registro]
  const launch = esWindows()
    ? '& ' + partes.map(citarPowerShell).join(' ')
    : partes.map(citarSh).join(' ')

  const term = new TerminalService({} as unknown as SandboxManager)
  ;(term as unknown as { matarDeReserva: () => Promise<void> }).matarDeReserva = async () => {}
  const s = await term.createSession(
    { ...PERFIL_QA, id: 'onexitnativo', sandbox: { habilitado: false } },
    { project: tmp, host: true, launch }
  )
  let salida = ''
  term.onData(s.id, (d) => {
    salida += d
  })
  const exits: Array<number | null> = []
  term.onExit(s.id, (code) => exits.push(code))
  let pidAgente = -1

  try {
    const listo = await esperarHasta(() => salida.includes('LISTO'), 20000)
    pidAgente = Number(/INICIO pid=(\d+)/.exec(readFileSync(registro, 'utf8'))?.[1] ?? -1)

    const viejo = s.pty
    let exitRealEn = 0
    viejo.onExit(() => {
      exitRealEn = Date.now()
    })

    const r = await term.detenerSesion(s.id)
    const finParada = Date.now()
    const vivoAlTerminar = exitRealEn === 0

    // Ahora sí: se mata desde FUERA del servicio, como lo haría un cierre de consola
    // que llega tarde.
    if (esWindows()) {
      spawnSync('taskkill', ['/PID', String(viejo.pid), '/T', '/F'], { windowsHide: true })
    }
    try {
      viejo.kill()
    } catch {
      /* ya muerto */
    }
    await esperarHasta(() => exitRealEn > 0, 8000)
    await sleep(500) // margen para un EXIT que no debe llegar

    check(
      '(H1) la parada terminó con el agente AÚN vivo (recolección vencida de verdad)',
      listo && !r.elegante && vivoAlTerminar,
      `LISTO=${listo} resultado=${JSON.stringify(r)} vivo al terminar=${vivoAlTerminar}`
    )
    check(
      '(H2) su onExit llegó DESPUÉS de la parada…',
      exitRealEn > finParada,
      `onExit del pty a +${exitRealEn > 0 ? exitRealEn - finParada : 'nunca'} ms del fin de la parada`
    )
    check(
      '(H3) …y NO se anunció a los exitListeners (onExit tardío silenciado)',
      exits.length === 0,
      `eventos=${JSON.stringify(exits)}`
    )
    const t0 = Date.now()
    await term.closeSession(s.id)
    const msCierre = Date.now() - t0
    check(
      '(H4) closeSession después vuelve enseguida: la parada dio la salida por hecha',
      msCierre < 500,
      `closeSession en ${msCierre} ms`
    )
  } finally {
    for (const x of term.listSessions()) await term.closeSession(x.id)
    if (pidAgente > 0) {
      try {
        process.kill(pidAgente) // red de seguridad: ningún agente falso sobrevive
      } catch {
        /* ya muerto */
      }
    }
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* la carpeta temporal la recoge el sistema */
    }
  }
}

async function main(): Promise<void> {
  // Primero lo nativo: no depende de Docker, así que corre y deja su veredicto aunque
  // Docker no esté levantado (en ese caso el proceso sale abajo con código 2, como
  // siempre, y los [PASS]/[FAIL] de estos pasos quedan impresos arriba). El E va antes
  // que el H porque su (E0c) cuenta un aviso que se da una sola vez por proceso.
  await pasoEscrituraTrasSalida()
  await pasoOnExitTardioTrasDetener()

  const sandbox = new SandboxManager()

  hr('PASO 0 - checkDocker()')
  const dockerCheck = await sandbox.checkDocker()
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no está disponible.\n' + dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', dockerCheck.detalle)

  hr('PASO 1 - ensureContainer(QA) + addProject(QA, proyecto-demo)')
  await sandbox.ensureContainer(PERFIL_QA)
  const mount = await sandbox.addProject(PERFIL_QA, PROJECT_HOST)
  console.log('workspacePath:', mount.workspacePath)

  const term = new TerminalService(sandbox)

  try {
    hr('PASO 2 - createSession + suscribir onExit (de primer nivel) UNA sola vez')
    const s = await term.createSession(PERFIL_QA, { project: PROJECT_HOST })
    const originalId = s.id
    console.log('Sesión creada:', { id: s.id, workspacePath: s.workspacePath })

    // La ÚNICA suscripción onExit del test. Se registra ANTES de cualquier reload
    // y NO se vuelve a tocar: si sobrevive al reload, es por el reenganche interno.
    const exitEvents: Array<{ exitCode: number | null; at: string }> = []
    let phase = 'pre-reload'
    const unsub = term.onExit(s.id, (exitCode) => {
      exitEvents.push({ exitCode, at: phase })
      console.log(`  >> onExit disparó: exitCode=${exitCode} (fase=${phase})`)
    })
    await sleep(900) // arranque de bash -il

    hr('PASO 3 - reloadSession() x2: NO debe disparar onExit (no es salida real)')
    phase = 'durante-reload'
    const r1 = await term.reloadSession(s.id)
    await sleep(700)
    const r2 = await term.reloadSession(s.id)
    await sleep(700)
    const exitsDuringReload = exitEvents.length
    const sameIdAfterReload = r1.id === originalId && r2.id === originalId
    check(
      '(1) reloadSession NO dispara onExit (dos reloads seguidos, 0 eventos)',
      exitsDuringReload === 0,
      `eventos onExit durante reload=${exitsDuringReload} (esperado 0)`
    )
    check(
      '(3) el sessionId se conserva a través del reload',
      sameIdAfterReload,
      `original=${originalId} tras_reload_1=${r1.id} tras_reload_2=${r2.id}`
    )

    hr('PASO 4 - salida REAL del shell (`exit`): la MISMA suscripción, viva tras 2 reloads, dispara 1 vez')
    phase = 'salida-real'
    // El shell vigente es el del segundo reload (pty NUEVO). Si la suscripción
    // hubiera quedado atada al pty original, aquí NO se enteraría.
    term.write(s.id, 'exit\n')

    // Espera a que llegue el evento de salida real (o timeout).
    const deadline = Date.now() + 8000
    while (exitEvents.length === 0 && Date.now() < deadline) await sleep(50)

    const firedOnce = exitEvents.length === 1
    const firedOnRealExit = exitEvents[0]?.at === 'salida-real'
    check(
      '(2) onExit sobrevive al reload y dispara en la salida REAL del shell nuevo',
      firedOnce && firedOnRealExit,
      `eventos=${JSON.stringify(exitEvents)} (esperado: exactamente 1, fase="salida-real")`
    )

    // La sesión debe haberse retirado sola al salir el shell (listSessions vacío).
    const gone = term.listSessions().every((x) => x.id !== s.id)
    check(
      '(2b) la sesión se retira sola de listSessions tras la salida real',
      gone,
      `sesión ${s.id} presente en listSessions=${!gone}`
    )

    unsub()
  } finally {
    hr('PASO 5 - limpieza (cerrar sesiones vivas + stopContainer)')
    for (const x of term.listSessions()) {
      await term.closeSession(x.id)
      console.log('cerrada sesión:', x.id)
    }
    await sandbox.stopContainer(PERFIL_QA)
    const ps = spawnSync(
      'docker',
      ['ps', '-a', '--filter', `name=^${CONTAINER_NAME}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8' }
    )
    const stillExists = ps.stdout.trim().length > 0
    check(
      '(limpieza) contenedor detenido/eliminado; sin sesiones vivas',
      !stillExists && term.listSessions().length === 0,
      stillExists ? `docker ps -a aún lista ${CONTAINER_NAME}` : 'sin contenedor ni sesiones'
    )
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === results.length
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  process.exit(1)
})
