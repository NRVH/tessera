// =============================================================================
// Store del layout de la ventana: qué mira cada perfil (vista lateral y franja
// inferior), los tamaños redimensionables, el orden del riel y la columna del agente.
// Lo hidrata y persiste usePersistenciaAjustes (slice `settings`); aquí no hay E/S.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { create } from 'zustand'
import {
  ACTIVITY_BAR_DEFAULT_ORDER,
  BOTTOM_BAR_DEFAULT_ORDER,
  DEFAULT_CC_WIDTH,
  DEFAULT_DB_AGENTE_WIDTH,
  DEFAULT_DB_RESULTADOS_ALTO,
  DEFAULT_GIT_LOG_ARCHIVOS_H,
  DEFAULT_GIT_LOG_DETALLE,
  DEFAULT_GIT_LOG_RAMAS,
  DEFAULT_TERMINAL_HEIGHT
} from '../../../../shared/workspace-state-ipc'
import type { MotivoCcOculto } from '../editor'

/** Estado del layout; los mapas por perfil usan '' como clave de «sin perfil». */
export interface EstadoLayout {
  vistaPorPerfil: Record<string, string>
  panelPorPerfil: Record<string, string>
  /** La franja deja de retener `gitlog` en cuanto hay proyecto confirmado o el usuario la toca. */
  franjaLibre: boolean
  sidebarWidthByView: Record<string, number>
  ccWidth: number
  dbAgenteWidth: number
  dbResultadosAlto: number
  /** Alto de la franja inferior (se persiste como `terminalHeight`). */
  altoPanelInferior: number
  gitLogRamasWidth: number
  gitLogDetalleWidth: number
  gitLogArchivosH: number
  /** Ancho de la lista del historial de un archivo; solo de la sesión. */
  gitHistorialWidth: number
  activityBarOrder: string[]
  bottomBarOrder: string[]
  /** Maximizado CRUDO de la columna del agente; lo que se pinta es el coherente. */
  ccExpanded: boolean
  ccOculto: MotivoCcOculto
  /** Git·Log pedido a pantalla completa (CRUDO, efímero: no se persiste); se pinta el coherente. */
  gitPantallaCompleta: boolean
}

/** Estado del layout de la ventana. */
export const useStoreLayout = create<EstadoLayout>()(() => ({
  vistaPorPerfil: {},
  panelPorPerfil: {},
  franjaLibre: false,
  sidebarWidthByView: {},
  ccWidth: DEFAULT_CC_WIDTH,
  dbAgenteWidth: DEFAULT_DB_AGENTE_WIDTH,
  dbResultadosAlto: DEFAULT_DB_RESULTADOS_ALTO,
  altoPanelInferior: DEFAULT_TERMINAL_HEIGHT,
  gitLogRamasWidth: DEFAULT_GIT_LOG_RAMAS,
  gitLogDetalleWidth: DEFAULT_GIT_LOG_DETALLE,
  gitLogArchivosH: DEFAULT_GIT_LOG_ARCHIVOS_H,
  gitHistorialWidth: 420,
  activityBarOrder: [...ACTIVITY_BAR_DEFAULT_ORDER],
  bottomBarOrder: [...BOTTOM_BAR_DEFAULT_ORDER],
  ccExpanded: false,
  ccOculto: 'no',
  gitPantallaCompleta: false
}))

/** Setter estable de un campo numérico o de lista del layout (para `onResize` y similares). */
export function fijadorLayout<K extends keyof EstadoLayout>(clave: K): (valor: EstadoLayout[K]) => void {
  return (valor) => useStoreLayout.setState({ [clave]: valor } as Pick<EstadoLayout, K>)
}

/** Setters estables de los tamaños y órdenes, creados una sola vez. */
export const fijadoresLayout = {
  ccWidth: fijadorLayout('ccWidth'),
  dbAgenteWidth: fijadorLayout('dbAgenteWidth'),
  dbResultadosAlto: fijadorLayout('dbResultadosAlto'),
  altoPanelInferior: fijadorLayout('altoPanelInferior'),
  gitLogRamasWidth: fijadorLayout('gitLogRamasWidth'),
  gitLogDetalleWidth: fijadorLayout('gitLogDetalleWidth'),
  gitLogArchivosH: fijadorLayout('gitLogArchivosH'),
  gitHistorialWidth: fijadorLayout('gitHistorialWidth'),
  activityBarOrder: fijadorLayout('activityBarOrder'),
  bottomBarOrder: fijadorLayout('bottomBarOrder'),
  gitPantallaCompleta: fijadorLayout('gitPantallaCompleta')
}

/** Pone en `perfil` la vista `valor` solo si hoy es `si`; mismo objeto si no cambia. */
export function cambiarVistaSi(perfil: string, si: string, valor: string): void {
  useStoreLayout.setState((s) =>
    s.vistaPorPerfil[perfil] === si ? { vistaPorPerfil: { ...s.vistaPorPerfil, [perfil]: valor } } : {}
  )
}
