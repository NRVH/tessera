// =============================================================================
// La X de la ventana principal con ventanas de agente abiertas: cierra en orden lo SUYO (consolas y
// sesiones de BD, el estado de las pestañas, sus terminales y conexiones SSH, sus agentes) y la
// destruye, sin tocar las sesiones de las ventanas de agente ni lo que es de la app entera
// (servicios, contenedores, puente de `tdb`, guardián de salida), que sigue hasta el cierre final.
// Decisiones: docs/decisiones/app/cierre-ordenado.md, docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================
import { SHUTDOWN_CHANNELS, type ShutdownProgress } from '../../shared/shutdown-ipc'
import { flushWorkspaceState } from '../workspace/workspaceStateStore'
import { ACUSE_VACIADO_MS, CIERRE_TRABAJADORES_MS } from '../db/explorador/limites'
import { conTope } from '../util/esperas'
import { CronometroCierre, TOPE_PTYS_MS, TOPE_VACIAR_CONSOLAS_MS, TOPE_WORKSPACE_MS, notaTope } from '../util/registroCierre'
import { preguntarAntesDeSalir } from './cierre'
import type { ReferenciasApp } from './referencias'
import { txApp } from './textos.ts'

/** Consolas, estado de las pestañas y sesiones de BD; el explorador queda listo para otra principal. */
async function guardarLoDeLaVentana(refs: ReferenciasApp, cierre: CronometroCierre): Promise<void> {
  const win = refs.ventana
  try {
    await cierre.etapa('vaciar-consolas', () => conTope(refs.explorador?.vaciarConsolas(win, ACUSE_VACIADO_MS), TOPE_VACIAR_CONSOLAS_MS), notaTope(TOPE_VACIAR_CONSOLAS_MS))
  } catch (err) {
    console.error('[tessera] vaciado de consolas falló:', err)
  }
  try {
    await cierre.etapa('workspace-state', () => conTope(flushWorkspaceState(), TOPE_WORKSPACE_MS), notaTope(TOPE_WORKSPACE_MS))
  } catch (err) {
    console.error('[tessera] flush de workspace-state falló:', err)
  }
  try {
    await cierre.etapa('sesiones-bd', () => refs.explorador?.cerrarTodo(CIERRE_TRABAJADORES_MS))
  } catch (err) {
    console.error('[tessera] cierre de los procesos de sesión falló:', err)
  }
  // Quita el pestillo de `cerrarTodo`: sin él, la próxima principal no podría abrir una sesión.
  refs.explorador?.reanudarTrasCierreAbortado()
}

/** Las terminales (y sus SSH) y los agentes de la principal, cada uno con su árbol y con tope. */
async function cerrarSesionesDeLaVentana(refs: ReferenciasApp, cierre: CronometroCierre, ventana: number): Promise<void> {
  const anotar = (quien: string) => (msg: string) => cierre.nota(`cerrar-ptys · ${quien}: ${msg}`)
  try {
    await cierre.etapa(
      'cerrar-ptys',
      async () => {
        const r = await Promise.allSettled([
          refs.terminales?.cerrarTodasConArbol(TOPE_PTYS_MS, anotar('terminales')) ?? 0,
          refs.agentes?.cerrarDeVentana(ventana, TOPE_PTYS_MS, anotar('agentes')).then((ids) => ids.length) ?? 0
        ])
        return r.reduce((n, x) => n + (x.status === 'fulfilled' ? x.value : 0), 0)
      },
      (n) => `${n} sesión(es) de la principal`
    )
  } catch (err) {
    console.error('[tessera] el cierre de las sesiones de la principal falló:', err)
  }
}

/**
 * Las sesiones SFTP, que solo abre la principal: sin cerrarlas, cada ssh se queda esperando su
 * entrada hasta que sale la app. Va con la ventana ya destruida, para que no abra otra entretanto.
 */
function cerrarSftp(refs: ReferenciasApp): void {
  try {
    refs.sftp?.cerrarTodas()
  } catch (err) {
    console.error('[tessera] el cierre de las sesiones SFTP de la principal falló:', err)
  }
}

/**
 * Cierra solo la ventana principal. Pregunta antes (transacciones y cambios de la rejilla sin
 * enviar) y, si se cancela, no toca nada. Si al terminar ya no queda ninguna ventana de agente,
 * sigue con el cierre de la app (`cerrarApp`).
 */
export async function cerrarSoloPrincipal(refs: ReferenciasApp, cerrarApp: () => void): Promise<void> {
  const win = refs.ventana
  if (!win || win.isDestroyed() || refs.cerrando || refs.confirmandoCierre || refs.cerrandoPrincipal) return
  const cierre = new CronometroCierre()
  cierre.empieza(`solo la ventana principal; siguen ${refs.ventanasAgente.size} ventana(s) de agente, pid ${process.pid}`)
  const explorador = refs.explorador
  if (explorador && (await preguntarAntesDeSalir(refs, explorador, cierre)) === 'parar') return
  refs.cerrandoPrincipal = true
  try {
    const progreso: ShutdownProgress = { phase: 'stopping', done: 0, total: 0, label: txApp().cierre.cerrandoVentana }
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(SHUTDOWN_CHANNELS.PROGRESS, progreso)
    await guardarLoDeLaVentana(refs, cierre)
    cierre.sincrona('archivos', () => refs.archivos?.dispose())
    cierre.sincrona('busqueda', () => refs.busqueda?.dispose())
    await cerrarSesionesDeLaVentana(refs, cierre, win.webContents.id)
  } finally {
    // Antes de destruirla: quien mire `refs.ventana` en sus `closed` ya no la ve.
    if (refs.ventana === win) refs.ventana = null
    refs.cerrandoPrincipal = false
    cierre.termina(`principal cerrada; siguen ${refs.ventanasAgente.size} ventana(s) de agente`)
    if (!win.isDestroyed()) win.destroy()
    cerrarSftp(refs)
  }
  // Las ventanas de agente pudieron cerrarse mientras tanto: sin ninguna, la app no sigue sola.
  if (refs.ventanasAgente.size === 0 && !refs.cerrando) cerrarApp()
}
