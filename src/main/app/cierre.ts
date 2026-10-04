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
import { conTope, esperar } from '../util/esperas'
import { CronometroCierre, TOPE_VACIAR_CONSOLAS_MS, TOPE_WORKSPACE_MS, notaTope, textoProgreso } from '../util/registroCierre'
import type { ReferenciasApp } from './referencias'

type Enviar = (p: ShutdownProgress) => void
type PlanInstalar = Extract<ReturnType<typeof planDeCierre>, { tipo: 'instalar' }>

/**
 * Pregunta al explorador de BD (transacciones y cambios sin enviar) ANTES de marcar el
 * cierre: si se cancela, la siguiente X tiene que volver a pasar por aquí.
 */
async function preguntarAntesDeSalir(
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
    cierre.sincrona('auto-update', () => stopAutoUpdate()) // no afecta a un install en curso
  } catch (err) {
    console.error('[tessera] cierre de watchers falló:', err)
  }
}

/** Consolas, workspace, sesiones de BD, recursos y contenedores, en ese orden. */
async function pararServicios(
  refs: ReferenciasApp,
  cierre: CronometroCierre,
  win: BrowserWindow | null,
  send: Enviar
): Promise<void> {
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
  try {
    // `docker rm -f` mata también los ptys y agentes de dentro; cada aviso deja su hito.
    const sandbox = refs.sandbox
    if (sandbox) {
      await cierre.etapa('docker', () =>
        sandbox.stopAllContainers((p) => {
          send(p)
          cierre.hito('docker', textoProgreso(p))
        })
      )
    }
  } catch (err) {
    console.error('[tessera] error en el cierre:', err)
  }
}

/** Escribe el «termina», destruye la ventana y sale del proceso. */
function salir(win: BrowserWindow | null, cierre: CronometroCierre, motivo: string): void {
  cierre.termina(motivo)
  if (win && !win.isDestroyed()) win.destroy()
  app.exit(0)
}

/**
 * Cierre GARANTIZADO y VISIBLE. Idempotente (`cerrando`) y best-effort: pase lo que pase
 * con Docker, termina saliendo, salvo el plan C de una actualización pedida que no arranca.
 */
export async function iniciarCierre(refs: ReferenciasApp): Promise<void> {
  if (refs.cerrando || refs.confirmandoCierre) return
  const cierre = new CronometroCierre()
  cierre.empieza(`v${app.getVersion()}, pid ${process.pid}`)
  const explorador = refs.explorador
  if (explorador && (await preguntarAntesDeSalir(refs, explorador, cierre)) === 'parar') return
  refs.cerrando = true
  const win = refs.ventana
  const send: Enviar = (p) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(SHUTDOWN_CHANNELS.PROGRESS, p)
    }
  }
  // El overlay, antes del primer `docker ps`.
  send({ phase: 'stopping', done: 0, total: 0, label: 'Cerrando Tessera…' })
  await pararServicios(refs, cierre, win, send)
  // Deja ver el «Listo» un instante antes de salir o de instalar.
  await cierre.etapa('pausa-listo', () => esperar(450))

  // «Actualizar ahora» relanza; «hay una preparada y estás cerrando» no.
  const plan = planDeCierre()
  if (plan.tipo === 'ninguno') {
    // `motivo` es prosa para el registro: no se ramifica sobre él.
    console.log(`[tessera] cierre normal: ${plan.motivo}`)
    salir(win, cierre, `sale (plan ninguno: ${plan.motivo})`)
    return
  }
  cierre.nota(`plan de cierre: instalar (origen ${plan.origen}, relanzar ${plan.relanzar ? 'sí' : 'no'})`)
  await aplicarActualizacion(refs, cierre, win, send, plan)
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
  plan: PlanInstalar
): Promise<void> {
  // En Windows los ptys cargan OpenConsole.exe de la carpeta de instalación; los huérfanos los remata `runInstaller`.
  const killed = cierre.sincrona(
    'forzar-ptys',
    () => (refs.terminales?.forceKillPtys() ?? 0) + (refs.agentes?.forceKillPtys() ?? 0),
    (n) => `${n} pty(s)`
  )
  console.log(`[tessera] update: ${killed} pty(s) forzado(s) a cerrar antes del instalador`)

  // Solo el main sabe si se va a relanzar.
  const sub = plan.relanzar
    ? 'Tessera volverá a abrirse sola al terminar.'
    : 'Tessera se cerrará; la nueva versión estará lista la próxima vez que la abras.'
  send({ phase: 'installing', done: 0, total: 0, label: 'Preparando la actualización…', sub })

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
  refs.cerrando = false
  // Sin quitar su pestillo, abrir una sesión fallaría con «Tessera se está cerrando».
  refs.explorador?.reanudarTrasCierreAbortado()
  // El puente se pausó arriba: vuelve al mismo pipe y tokens (o a uno nuevo si ya no sirve).
  void refs.bd?.reanudarPuente()
  send({ phase: 'aborted', done: 0, total: 0, label: 'Cierre cancelado.' })
  reportInstallAborted()
  cierre.termina('abortado: la actualización no pudo arrancar y la app sigue abierta')
}
