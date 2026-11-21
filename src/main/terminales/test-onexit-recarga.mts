#!/usr/bin/env node
// =============================================================================
// Prueba de `ServicioTerminal.onExit` de primer nivel (npm run test:onexit-recarga): sobrevive a
// `recargarSesion()` y no se dispara con el reload.
// Pasos nativos previos, sin Docker: un onExit tardío tras `detenerSesion()` no se anuncia (H),
// escribir en un pty ya salido no deja una excepción sin capturar (E) y una salida sin código se
// anuncia con el mismo -1 de la sesión (S).
// Después, con Docker: la misma suscripción dispara una vez al salir de verdad, el sessionId se
// conserva y no quedan huérfanos.
// Solo Node core + GestorSandbox + ServicioTerminal + node-pty.
// =============================================================================

import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import type { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { GestorSandbox, nombreContenedorPara } from '../sandbox/GestorSandbox.ts'
import { ServicioTerminal } from './ServicioTerminal.ts'
import { blindarEntradaPty, socketEntradaDe } from './entradaPty.ts'
import type { Perfil } from '../perfiles/types.ts'
import { esWindows } from '../../shared/plataforma.ts'
import { citarPowerShell, citarSh } from '../../shared/citarShell.ts'

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = path.resolve(DIR_MODULO, '../../..')
const RUTA_HOST_PROYECTO = path.join(RAIZ_REPO, 'docker', 'sandbox', 'proyecto-demo')
// Id PROPIO del test: el nombre del contenedor y el `configDir` se derivan del id,
// así que con uno real este test mataba el contenedor de ese perfil del usuario.
const NOMBRE_CONTENEDOR = nombreContenedorPara({ id: 'onexitqa' } as Parameters<typeof nombreContenedorPara>[0])

const PERFIL_QA: Perfil = {
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
function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
async function esperarHasta(cond: () => boolean, ms: number): Promise<boolean> {
  const limite = Date.now() + ms
  while (!cond()) {
    if (Date.now() > limite) return false
    await dormir(50)
  }
  return true
}

/**
 * PASO E: escribir en un pty que ya salió no deja una excepción no capturada.
 *
 * (E0) con formas FALSAS, para fijar desde cualquier máquina lo que la función hace en
 * cada plataforma. (E1/E2) con un pty REAL de `ServicioTerminal`: una sesión nativa cuyo
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
    entradaFalsa.emit('error', Object.assign(new Error('write EAGAIN'), { codigo: 'EAGAIN' }))
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
  const tmp = crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-entrada-'))
  const term = new ServicioTerminal({} as unknown as GestorSandbox)
  const noCapturadas: string[] = []
  const alNoCapturada = (e: unknown): void => {
    noCapturadas.push(e instanceof Error ? `${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}` : String(e))
  }
  process.on('uncaughtException', alNoCapturada)
  let sesion = ''
  try {
    // `exit 0` como launch: PowerShell `-Command` en Windows, `$SHELL -ilc` en macOS.
    const s = await term.crearSesion(
      { ...PERFIL_QA, id: 'onexitentrada', sandbox: { habilitado: false } },
      { proyecto: tmp, host: true, comandoLanzamiento: 'exit 0' }
    )
    sesion = s.id
    const entrada = socketEntradaDe(s.pty)
    const oyentes = entrada?.listenerCount('error') ?? 0
    let salio = false
    // La primera escritura va en el `onExit` del propio pty, en el instante en que muere: el de
    // ServicioTerminal puede llegar después si ConPTY avisó sin código (C98) y hubo que recuperarlo,
    // y para entonces node-pty ya destruyó la entrada y la escritura no llegaría a fallar.
    s.pty.onExit(() => term.write(s.id, 'x'))
    term.onExit(s.id, () => {
      salio = true
    })
    const salioATiempo = await esperarHasta(() => salio, 20000)
    await dormir(500) // el error de la escritura es ASÍNCRONO: se le deja llegar
    term.write(s.id, 'y')
    await dormir(500)

    check(
      esWindows()
        ? '(E1) Windows: el pty real tiene socket de entrada y ServicioTerminal le puso oyente de error'
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
    // La sesión salió, así que `listarSesiones` ya no la lista: se cierra por su id.
    if (sesion) await term.cerrarSesion(sesion)
    // Espera corta a errores rezagados antes de dejar de contarlos.
    await dormir(200)
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
async function pasoSalidaTardiaTrasDetener(): Promise<void> {
  hr('PASO H - (nativo, sin Docker) un onExit TARDÍO tras detenerSesion NO emite EXIT')
  const tmp = crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-onexit-'))
  const registro = path.join(tmp, 'agente.log')
  const agente = path.join(DIR_MODULO, 'agenteFalsoDetener.mjs')
  const partes = [process.execPath, agente, 'B', registro]
  const comandoLanzamiento = esWindows()
    ? '& ' + partes.map(citarPowerShell).join(' ')
    : partes.map(citarSh).join(' ')

  const term = new ServicioTerminal({} as unknown as GestorSandbox)
  ;(term as unknown as { matarDeReserva: () => Promise<void> }).matarDeReserva = async () => {}
  const s = await term.crearSesion(
    { ...PERFIL_QA, id: 'onexitnativo', sandbox: { habilitado: false } },
    { proyecto: tmp, host: true, comandoLanzamiento }
  )
  let salida = ''
  term.onData(s.id, (d) => {
    salida += d
  })
  const salidas: Array<number | null> = []
  term.onExit(s.id, (codigo) => salidas.push(codigo))
  let pidAgente = -1

  try {
    const listo = await esperarHasta(() => salida.includes('LISTO'), 20000)
    pidAgente = Number(/INICIO pid=(\d+)/.exec(readFileSync(registro, 'utf8'))?.[1] ?? -1)

    const viejo = s.pty
    let salidaRealEn = 0
    viejo.onExit(() => {
      salidaRealEn = Date.now()
    })

    const r = await term.detenerSesion(s.id)
    const finParada = Date.now()
    const vivoAlTerminar = salidaRealEn === 0

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
    await esperarHasta(() => salidaRealEn > 0, 8000)
    await dormir(500) // margen para un EXIT que no debe llegar

    check(
      '(H1) la parada terminó con el agente AÚN vivo (recolección vencida de verdad)',
      listo && !r.elegante && vivoAlTerminar,
      `LISTO=${listo} resultado=${JSON.stringify(r)} vivo al terminar=${vivoAlTerminar}`
    )
    check(
      '(H2) su onExit llegó DESPUÉS de la parada…',
      salidaRealEn > finParada,
      `onExit del pty a +${salidaRealEn > 0 ? salidaRealEn - finParada : 'nunca'} ms del fin de la parada`
    )
    check(
      '(H3) …y NO se anunció a los oyentesSalida (onExit tardío silenciado)',
      salidas.length === 0,
      `eventos=${JSON.stringify(salidas)}`
    )
    const t0 = Date.now()
    await term.cerrarSesion(s.id)
    const msCierre = Date.now() - t0
    check(
      '(H4) cerrarSesion después vuelve enseguida: la parada dio la salida por hecha',
      msCierre < 500,
      `cerrarSesion en ${msCierre} ms`
    )
  } finally {
    for (const x of term.listarSesiones()) await term.cerrarSesion(x.id)
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

/**
 * PASO S: una salida SIN código (ConPTY avisó con `onExit({})` y no lo dio ni tarde) se anuncia con
 * el MISMO valor que queda en la sesión, -1, y no con `null`: así una pestaña SSH sin código se
 * clasifica por lo que escribió. La salida sin código se fabrica llamando al anuncio del servicio
 * (privado) con `null`, que es lo que hace cuando el código tardío no llega.
 */
async function pasoSalidaSinCodigo(): Promise<void> {
  hr('PASO S - (nativo, sin Docker) una salida sin código se anuncia con el mismo -1 de la sesión')
  const tmp = crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-sincodigo-'))
  const registro = path.join(tmp, 'agente.log')
  const partes = [process.execPath, path.join(DIR_MODULO, 'agenteFalsoDetener.mjs'), 'B', registro]
  const comandoLanzamiento = esWindows() ? '& ' + partes.map(citarPowerShell).join(' ') : partes.map(citarSh).join(' ')
  const term = new ServicioTerminal({} as unknown as GestorSandbox)
  const s = await term.crearSesion({ ...PERFIL_QA, id: 'onexitsincodigo', sandbox: { habilitado: false } }, { proyecto: tmp, host: true, comandoLanzamiento })
  let salida = ''
  term.onData(s.id, (d) => {
    salida += d
  })
  const salidas: Array<number | null> = []
  term.onExit(s.id, (codigo) => salidas.push(codigo))
  const pty = s.pty
  let pidAgente = -1
  try {
    await esperarHasta(() => salida.includes('LISTO'), 20000)
    pidAgente = Number(/INICIO pid=(\d+)/.exec(readFileSync(registro, 'utf8'))?.[1] ?? -1)
    const interno = term as unknown as { sesiones: Map<string, unknown>; alSalir: (r: unknown, p: unknown, c: number | null) => void }
    interno.alSalir(interno.sesiones.get(s.id), pty, null)
    check(
      '(S1) sin código: el oyente recibe -1, el mismo valor que la sesión',
      salidas.length === 1 && salidas[0] === -1 && s.codigoSalida === -1,
      `oyente=${JSON.stringify(salidas)} sesión=${s.codigoSalida}`
    )
  } finally {
    if (esWindows()) spawnSync('taskkill', ['/PID', String(pty.pid), '/T', '/F'], { windowsHide: true })
    try {
      pty.kill()
    } catch {
      /* ya muerto */
    }
    if (pidAgente > 0) {
      try {
        process.kill(pidAgente) // red de seguridad: ningún agente falso sobrevive
      } catch {
        /* ya muerto */
      }
    }
    for (const x of term.listarSesiones()) await term.cerrarSesion(x.id)
    await term.cerrarSesion(s.id).catch(() => undefined)
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
  await pasoSalidaTardiaTrasDetener()
  await pasoSalidaSinCodigo()

  const sandbox = new GestorSandbox()

  hr('PASO 0 - checkDocker()')
  const comprobacionDocker = await sandbox.checkDocker()
  if (!comprobacionDocker.ok) {
    console.error('[FAIL] Docker no está disponible.\n' + comprobacionDocker.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', comprobacionDocker.detalle)

  hr('PASO 1 - ensureContainer(QA) + addProject(QA, proyecto-demo)')
  await sandbox.ensureContainer(PERFIL_QA)
  const montaje = await sandbox.addProject(PERFIL_QA, RUTA_HOST_PROYECTO)
  console.log('rutaWorkspace:', montaje.rutaWorkspace)

  const term = new ServicioTerminal(sandbox)

  try {
    hr('PASO 2 - crearSesion + suscribir onExit (de primer nivel) UNA sola vez')
    const s = await term.crearSesion(PERFIL_QA, { proyecto: RUTA_HOST_PROYECTO })
    const originalId = s.id
    console.log('Sesión creada:', { id: s.id, rutaWorkspace: s.rutaWorkspace })

    // La ÚNICA suscripción onExit del test. Se registra ANTES de cualquier reload
    // y NO se vuelve a tocar: si sobrevive al reload, es por el reenganche interno.
    const eventosSalida: Array<{ codigoSalida: number | null; en: string }> = []
    let fase = 'pre-reload'
    const unsub = term.onExit(s.id, (codigoSalida) => {
      eventosSalida.push({ codigoSalida, en: fase })
      console.log(`  >> onExit disparó: exitCode=${codigoSalida} (fase=${fase})`)
    })
    await dormir(900) // arranque de bash -il

    hr('PASO 3 - recargarSesion() x2: NO debe disparar onExit (no es salida real)')
    fase = 'durante-reload'
    const r1 = await term.recargarSesion(s.id)
    await dormir(700)
    const r2 = await term.recargarSesion(s.id)
    await dormir(700)
    const salidasDuranteRecarga = eventosSalida.length
    const mismoIdTrasRecarga = r1.id === originalId && r2.id === originalId
    check(
      '(1) recargarSesion NO dispara onExit (dos reloads seguidos, 0 eventos)',
      salidasDuranteRecarga === 0,
      `eventos onExit durante reload=${salidasDuranteRecarga} (esperado 0)`
    )
    check(
      '(3) el sessionId se conserva a través del reload',
      mismoIdTrasRecarga,
      `original=${originalId} tras_reload_1=${r1.id} tras_reload_2=${r2.id}`
    )

    hr('PASO 4 - salida REAL del shell (`exit`): la MISMA suscripción, viva tras 2 reloads, dispara 1 vez')
    fase = 'salida-real'
    // El shell vigente es el del segundo reload (pty NUEVO). Si la suscripción
    // hubiera quedado atada al pty original, aquí NO se enteraría.
    term.write(s.id, 'exit\n')

    // Espera a que llegue el evento de salida real (o timeout).
    const plazo = Date.now() + 8000
    while (eventosSalida.length === 0 && Date.now() < plazo) await dormir(50)

    const disparadoUnaVez = eventosSalida.length === 1
    const disparadoEnSalidaReal = eventosSalida[0]?.en === 'salida-real'
    check(
      '(2) onExit sobrevive al reload y dispara en la salida REAL del shell nuevo',
      disparadoUnaVez && disparadoEnSalidaReal,
      `eventos=${JSON.stringify(eventosSalida)} (esperado: exactamente 1, fase="salida-real")`
    )

    // La sesión debe haberse retirado sola al salir el shell (listarSesiones vacío).
    const ausente = term.listarSesiones().every((x) => x.id !== s.id)
    check(
      '(2b) la sesión se retira sola de listarSesiones tras la salida real',
      ausente,
      `sesión ${s.id} presente en listarSesiones=${!ausente}`
    )

    unsub()
  } finally {
    hr('PASO 5 - limpieza (cerrar sesiones vivas + detenerContenedor)')
    for (const x of term.listarSesiones()) {
      await term.cerrarSesion(x.id)
      console.log('cerrada sesión:', x.id)
    }
    await sandbox.detenerContenedor(PERFIL_QA)
    const ps = spawnSync(
      'docker',
      ['ps', '-a', '--filter', `name=^${NOMBRE_CONTENEDOR}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8' }
    )
    const sigueExistiendo = ps.stdout.trim().length > 0
    check(
      '(limpieza) contenedor detenido/eliminado; sin sesiones vivas',
      !sigueExistiendo && term.listarSesiones().length === 0,
      sigueExistiendo ? `docker ps -a aún lista ${NOMBRE_CONTENEDOR}` : 'sin contenedor ni sesiones'
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
