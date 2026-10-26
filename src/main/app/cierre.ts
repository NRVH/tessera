// =============================================================================
// El cierre ordenado y visible: pregunta si hay trabajo de BD sin confirmar, pinta el
// overlay de progreso, apaga los servicios en orden, mata los contenedores y, si hay una
// actualización, lanza el instalador (con sus planes B y C). Lo piden la X, Salir y
// «Reiniciar para actualizar»; cada etapa deja su duración en `logs/cierre.log`.
// Decisiones: docs/decisiones/app/cierre-ordenado.md
// =============================================================================
import { app, type BrowserWindow } from 'electron'
import { SHUTDOWN_CHANNELS, type ShutdownProgress } from '../../shared/shutdown-ipc'
import {
  anticiparRelevo,
  cancelarRelevoAnticipado,
  cierreCanceladoAntesDeInstalar,
  openInstallerManually,
  planDeCierre,
  reportInstallAborted,
  runInstaller,
  stopAutoUpdate
} from '../update/AutoUpdate'
import { flushWorkspaceState } from '../workspace/workspaceStateStore'
import { ACUSE_VACIADO_MS, CIERRE_TRABAJADORES_MS } from '../db/explorador/limites'
import type { ExploradorController } from '../db/explorador/ExploradorController'
import { conTope, conTopeSinAvance, esperar, type Desenlace, type EsperaSinAvance } from '../util/esperas'
import {
  CronometroCierre,
  TOPE_DOCKER_MS,
  TOPE_PTYS_MS,
  TOPE_VACIAR_CONSOLAS_MS,
  TOPE_WORKSPACE_MS,
  notaSinAvance,
  notaTope,
  resumenRecursos,
  rutaLogCierre,
  textoProgreso
} from '../util/registroCierre'
import { ptysPendientes, rematarPtysSueltos } from '../terminals/adaptadores/pty'
import { textoPendientes } from '../terminals/adaptadores/registroPtys'
import { armarGuardianSalida } from './guardianSalida'
import { plazoGuardian } from './planGuardianSalida'
import { actualizarJumpList } from './integracionVentanas'
import type { ReferenciasApp } from './referencias'
import { opcionesReinicio } from './reinicio'
import { txApp } from './textos.ts'

type Enviar = (p: ShutdownProgress) => void
type PlanInstalar = Extract<ReturnType<typeof planDeCierre>, { tipo: 'instalar' }>

/**
 * Pregunta al explorador de BD (transacciones y cambios sin enviar) ANTES de marcar el
 * cierre: si se cancela, la siguiente X tiene que volver a pasar por aquí.
 */
export async function preguntarAntesDeSalir(
  refs: ReferenciasApp,
  explorador: ExploradorController,
  cierre: CronometroCierre
): Promise<'seguir' | 'parar'> {
  refs.confirmandoCierre = true
  let decision: 'seguir' | 'cancelar' = 'seguir'
  try {
    decision = await cierre.etapa('confirmar-salida', () => explorador.confirmarSalida(refs.ventana), (d) => d)
  } catch (err) {
    // Sin diálogo no se puede preguntar; cerrar revierte, como si la app se cayera.
    console.error('[tessera] el diálogo de salida del explorador de BD falló:', err)
  } finally {
    refs.confirmandoCierre = false
  }
  if (decision === 'cancelar') {
    // Si venía de «Reiniciar para actualizar», la actualización vuelve a quedar lista.
    cierreCanceladoAntesDeInstalar()
    cierre.termina('cancelado en el diálogo de salida')
    return 'parar'
  }
  if (refs.cerrando) {
    cierre.termina('el cierre ya estaba en curso por otra vía')
    return 'parar'
  }
  return 'seguir'
}

/** Vigilantes y temporizadores; uno que lanza se salta los siguientes (`sincrona` relanza). */
function soltarRecursos(refs: ReferenciasApp, cierre: CronometroCierre): void {
  try {
    // El puente de `tdb` se PAUSA, no se para: si el cierre se aborta hay que devolverlo.
    cierre.sincrona('puente-bd', () => refs.bd?.pararPuente())
    cierre.sincrona('archivos', () => refs.archivos?.dispose())
    cierre.sincrona('jar', () => refs.jar?.dispose())
    cierre.sincrona('java', () => refs.java?.dispose())
    cierre.sincrona('comprimidos', () => refs.comprimidos?.dispose())
    cierre.sincrona('busqueda', () => refs.busqueda?.dispose())
    cierre.sincrona('uso', () => refs.vigilanteUso?.disposeAll())
    cierre.sincrona('turnos', () => refs.vigilanteTurnos?.disposeAll())
    cierre.sincrona('agentes-nativos', () => refs.agentesNativos?.parar())
    cierre.sincrona('registro-salud', () => refs.registroSalud?.detener())
    cierre.sincrona('auto-update', () => stopAutoUpdate()) // no afecta a un install en curso
  } catch (err) {
    console.error('[tessera] cierre de watchers falló:', err)
  }
}

/**
 * Cierra las terminales y los agentes con el proceso aún entero. En Windows, cerrar una
 * pseudoconsola espera a que alguien lea su salida: dejarlo al apagado del proceso, cuando sus
 * lectores ya no existen, puede dejarlo vivo con la ventana cerrada. Además, sus OpenConsole.exe
 * salen de la carpeta de instalación y el instalador no podría reemplazarla. Se mata el ÁRBOL de
 * cada uno: con solo el pty, el agente que lanzó la shell seguiría vivo sin la app. Terminales y
 * agentes a la vez, cada uno con su tope, y el fallo de uno no salva al otro ni frena el cierre.
 * Después se remata todo pty cuya raíz no conste como terminada, también los que ya no tenía ninguna sesión: con
 * su raíz viva, el proceso no termina tras `app.exit` (ver `adaptadores/pty.ts`).
 */
async function cerrarPtys(refs: ReferenciasApp, cierre: CronometroCierre): Promise<void> {
  const anotar = (quien: string) => (msg: string) => cierre.nota(`cerrar-ptys · ${quien}: ${msg}`)
  try {
    await cierre.etapa(
      'cerrar-ptys',
      async () => {
        const muertes = await Promise.allSettled([
          refs.terminales?.matarPtysConArbol(TOPE_PTYS_MS, anotar('terminales')) ?? 0,
          refs.agentes?.matarPtysConArbol(TOPE_PTYS_MS, anotar('agentes')) ?? 0
        ])
        return muertes.reduce((n, m) => n + (m.status === 'fulfilled' ? m.value : 0), 0)
      },
      (n) => `${n} pty(s)`
    )
  } catch (err) {
    console.error('[tessera] cierre de las terminales falló:', err)
  }
  try {
    await cierre.etapa(
      'ptys-sueltos',
      () => rematarPtysSueltos(),
      (r) => `${r.rematados} rematado(s); con la raíz viva: ${textoPendientes(r.quedan)}`
    )
  } catch (err) {
    console.error('[tessera] el remate de los ptys sueltos falló:', err)
  }
}

/**
 * `docker rm -f` de todos los contenedores, que mata también los ptys y agentes de dentro; cada
 * aviso deja su hito. Con tope SIN AVANZAR: Docker sin responder no deja la ventana colgada
 * minutos, y muchos contenedores que van cayendo no se cortan. Devuelve la limpieza que siguió
 * tras el tope (null si acabó), que el plan C espera antes de devolver la app.
 */
async function detenerContenedores(refs: ReferenciasApp, cierre: CronometroCierre, send: Enviar): Promise<DockerPendiente | null> {
  const sandbox = refs.sandbox
  if (!sandbox) return null
  // Parar los contenedores no es que mueran: el supervisor deja de escuchar antes.
  sandbox.detenerSupervision()
  // Tras el tope, lo que llegue tarde ya no es de este cierre: ni al overlay ni al registro.
  const progresoCon =
    (avanzar: () => boolean) =>
    (p: ShutdownProgress): void => {
      if (!avanzar()) return
      send(p)
      cierre.hito('docker', textoProgreso(p))
    }
  let espera: EsperaSinAvance | null = null
  const empezar = (): Promise<Desenlace> => {
    espera = conTopeSinAvance((avanzar) => sandbox.stopAllContainers(progresoCon(avanzar)), TOPE_DOCKER_MS)
    return espera.desenlace
  }
  const d = await cierre.etapa('docker', empezar, notaSinAvance(TOPE_DOCKER_MS))
  if (d === 'a-tiempo' || espera === null) return null
  send({ phase: 'done', done: 0, total: 0, label: txApp().cierre.dockerNoResponde })
  return { trabajo: (espera as EsperaSinAvance).trabajo }
}

/** La limpieza de Docker que siguió tras su tope (en un objeto: una promesa devuelta por un `async` se desenvolvería). */
interface DockerPendiente {
  trabajo: Promise<void>
}

/** Consolas, workspace, sesiones de BD, recursos y contenedores, en ese orden. Devuelve la limpieza de Docker que quedó en curso. */
async function pararServicios(
  refs: ReferenciasApp,
  cierre: CronometroCierre,
  win: BrowserWindow | null,
  send: Enviar
): Promise<DockerPendiente | null> {
  // Con acuse del renderer y con tope: pasado el tope se sigue y la escritura acaba sola.
  try {
    await cierre.etapa(
      'vaciar-consolas',
      () => conTope(refs.explorador?.vaciarConsolas(win, ACUSE_VACIADO_MS), TOPE_VACIAR_CONSOLAS_MS),
      notaTope(TOPE_VACIAR_CONSOLAS_MS)
    )
  } catch (err) {
    console.error('[tessera] vaciado de consolas falló:', err)
  }
  try {
    await cierre.etapa('workspace-state', () => conTope(flushWorkspaceState(), TOPE_WORKSPACE_MS), notaTope(TOPE_WORKSPACE_MS))
  } catch (err) {
    console.error('[tessera] flush de workspace-state falló:', err)
  }
  // Antes de Docker y del instalador: tienen cargados drivers nativos (EBUSY al desinstalar).
  try {
    await cierre.etapa('sesiones-bd', () => refs.explorador?.cerrarTodo(CIERRE_TRABAJADORES_MS))
  } catch (err) {
    console.error('[tessera] cierre de los procesos de sesión falló:', err)
  }
  soltarRecursos(refs, cierre)
  await cerrarPtys(refs, cierre)
  try {
    return await detenerContenedores(refs, cierre, send)
  } catch (err) {
    console.error('[tessera] error en el cierre:', err)
    return null
  }
}

/**
 * Escribe el «termina», destruye la ventana y sale del proceso. Tras `app.exit`, Node se desmonta
 * esperando lo que quede (el hilo de un pty con la raíz viva, una petición que no vuelve) sin JS que
 * pueda cortarlo: antes se deja escrito qué ptys quedan, el `exit` de Node dice cuánto tardó en llegar
 * y qué seguía activo, y el guardián termina el proceso si no sale en su plazo, más corto si queda
 * algún pty sin su fin anotado (`plazoGuardian`).
 */
function salir(win: BrowserWindow | null, cierre: CronometroCierre, motivo: string): void {
  const pendientes = ptysPendientes()
  cierre.nota(`ptys con la raíz viva al salir: ${textoPendientes(pendientes)}`)
  anotarFinDeNode(cierre)
  armarGuardianSalida({ log: rutaLogCierre(), plazoMs: plazoGuardian(pendientes.length) })
  cierre.termina(motivo)
  if (win && !win.isDestroyed()) win.destroy()
  app.exit(0)
}

/** Deja en el registro cuándo llega el `exit` de Node tras «sale» y qué seguía activo en su bucle. */
function anotarFinDeNode(cierre: CronometroCierre): void {
  const t = performance.now()
  process.once('exit', () => {
    cierre.nota(`node: exit (+${Math.round(performance.now() - t)} ms tras sale); activos: ${resumenRecursos(process.getActiveResourcesInfo())}`)
  })
}

/**
 * Cierre GARANTIZADO y VISIBLE. Idempotente (`cerrando`) y best-effort: pase lo que pase
 * con Docker, termina saliendo, salvo el plan C de una actualización pedida que no arranca.
 */
export async function iniciarCierre(refs: ReferenciasApp, opciones: { reabrir?: boolean } = {}): Promise<void> {
  if (refs.cerrando || refs.confirmandoCierre) return
  const cierre = new CronometroCierre()
  cierre.empieza(`v${app.getVersion()}, pid ${process.pid}`)
  const explorador = refs.explorador
  if (explorador && (await preguntarAntesDeSalir(refs, explorador, cierre)) === 'parar') return
  refs.cerrando = true
  // Antes de matar nada: si este proceso muere a mitad del cierre, la actualización sigue.
  try {
    cierre.sincrona('relevo', () => anticiparRelevo(), (lanzado) => (lanzado ? 'lanzado' : 'no aplica'))
  } catch (err) {
    console.error('[tessera] no se pudo anticipar el relevo:', err)
  }
  // Con las sesiones aún vivas: si el cierre relanza tras actualizar, las ventanas de agente se reabren.
  const recuerdo = recordarVentanas(refs)
  // La Jump List queda en el sistema con la app cerrada: sin «Abrir Tessera», que ahí sobra.
  actualizarJumpList(refs, false)
  const win = refs.ventana
  const send: Enviar = (p) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(SHUTDOWN_CHANNELS.PROGRESS, p)
    }
  }
  // El overlay, antes del primer `docker ps`.
  send({ phase: 'stopping', done: 0, total: 0, label: txApp().cierre.cerrando })
  const dockerPendiente = await pararServicios(refs, cierre, win, send)
  // Deja ver el «Listo» un instante antes de salir o de instalar.
  await cierre.etapa('pausa-listo', () => esperar(450))

  // «Actualizar ahora» relanza; «hay una preparada y estás cerrando» no. Reiniciar (cambiar de
  // idioma) relanza siempre, y se pide aquí, pasada la pregunta que podía cancelar el cierre.
  const plan = planDeCierre()
  if (plan.tipo === 'ninguno') {
    // `motivo` es prosa para el registro: no se ramifica sobre él.
    console.log(`[tessera] cierre normal: ${plan.motivo}`)
    // Sin instalar no puede quedar un relevo esperando nuestra muerte para instalar.
    cancelarRelevoAnticipado()
    if (opciones.reabrir) app.relaunch(opcionesReinicio(process.argv, app.isPackaged, process.env.APPIMAGE))
    salir(win, cierre, `sale (plan ninguno: ${plan.motivo})`)
    return
  }
  const instalar = opciones.reabrir ? { ...plan, relanzar: true } : plan
  cierre.nota(`plan de cierre: instalar (origen ${instalar.origen}, relanzar ${instalar.relanzar ? 'sí' : 'no'})`)
  await aplicarActualizacion(refs, cierre, win, send, instalar, dockerPendiente, recuerdo)
}

/** Las ventanas de agente que habría que reabrir, o null; un fallo aquí no frena el cierre. */
function recordarVentanas(refs: ReferenciasApp): unknown {
  try {
    return refs.restauracion?.recordar() ?? null
  } catch (err) {
    console.error('[tessera] no se pudieron recordar las ventanas de agente:', err)
    return null
  }
}

/**
 * Camino de actualización: la ventana sigue VIVA durante la instalación para poder
 * enseñar el error si el instalador no toma el control.
 */
async function aplicarActualizacion(
  refs: ReferenciasApp,
  cierre: CronometroCierre,
  win: BrowserWindow | null,
  send: Enviar,
  plan: PlanInstalar,
  dockerPendiente: DockerPendiente | null,
  recuerdo: unknown
): Promise<void> {
  // Tras un cierre normal las ventanas de agente no vuelven; tras actualizar y relanzar, sí.
  if (plan.relanzar) refs.restauracion?.guardar(recuerdo)
  // Solo el main sabe si se va a relanzar.
  const tc = txApp().cierre
  const sub = plan.relanzar ? tc.volveraAbrirse : tc.seCerrara
  send({ phase: 'installing', done: 0, total: 0, label: tc.preparando, sub })

  // Si el instalador toma el control, esto NUNCA resuelve (el proceso muere).
  await cierre.etapa('instalador', () =>
    runInstaller({
      relanzar: plan.relanzar,
      origen: plan.origen,
      progreso: (label) => send({ phase: 'installing', done: 0, total: 0, label, sub })
    })
  )

  // Cerrar es cerrar: la app ya está vaciada por dentro; el fallo lo verá al volver a abrirla.
  if (plan.origen === 'cierre') {
    console.error('[tessera] la actualización no se pudo aplicar al cerrar; se completa el cierre.')
    salir(win, cierre, 'sale sin actualizar: el instalador no tomó el control al cerrar')
    return
  }

  // El usuario PIDIÓ actualizar. Plan B: abrir el instalador descargado con el shell del sistema.
  console.error('[tessera] el instalador no tomó el control; intentando abrirlo a mano…')
  if (await cierre.etapa('abrir-instalador', () => openInstallerManually(), (ok) => (ok ? 'abierto' : 'no se pudo'))) {
    salir(win, cierre, 'sale: instalador abierto a mano')
    return
  }

  // Plan C: se aborta el cierre y la ventana vuelve con el error; la app sigue usable.
  console.error('[tessera] update imposible; se aborta el cierre y se informa al usuario.')
  // La limpieza de Docker que siguió tras su tope borra los contenedores y vacía el estado del
  // sandbox: con la app ya de vuelta se llevaría los que se abrieran entretanto.
  if (dockerPendiente) {
    send({ phase: 'stopping', done: 0, total: 0, label: txApp().cierre.esperandoDocker })
    await cierre.etapa('docker-pendiente', () => dockerPendiente.trabajo)
  }
  refs.cerrando = false
  // No hay arranque nuevo que las reabra: las ventanas de agente siguen ahí.
  refs.restauracion?.olvidar()
  // Sin quitar su pestillo, abrir una sesión fallaría con «Tessera se está cerrando».
  refs.explorador?.reanudarTrasCierreAbortado()
  // El puente se pausó arriba: vuelve al mismo pipe y tokens (o a uno nuevo si ya no sirve).
  void refs.bd?.reanudarPuente()
  send({ phase: 'aborted', done: 0, total: 0, label: txApp().cierre.cancelado })
  reportInstallAborted()
  cierre.termina('abortado: la actualización no pudo arrancar y la app sigue abierta')
}
