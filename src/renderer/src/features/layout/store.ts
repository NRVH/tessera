// =============================================================================
// Store del layout de la ventana: qué mira cada perfil (vista lateral y franja
// inferior), los tamaños redimensionables, el orden del riel y la columna del agente.
// Lo hidrata y persiste usePersistenciaAjustes (slice `settings`); aquí no hay E/S.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { create } from 'zustand'
import {
  ORDEN_DEFECTO_BARRA_ACTIVIDAD,
  ORDEN_DEFECTO_BARRA_INFERIOR,
  ANCHO_TERMINAL_AGENTE_DEFECTO,
  ANCHO_CC_DEFECTO,
  ANCHO_HISTORIAL_GIT_DEFECTO,
  ANCHO_AGENTE_BD_DEFECTO,
  ALTO_RESULTADOS_BD_DEFECTO,
  ALTO_ARCHIVOS_LOG_GIT_DEFECTO,
  ANCHO_DETALLE_LOG_GIT_DEFECTO,
  ANCHO_RAMAS_LOG_GIT_DEFECTO,
  ALTO_TERMINAL_DEFECTO
} from '../../../../shared/workspace-state-ipc'
import { conMaximizado, type MaximizadosPerfil, type PanelInferiorCentro } from './layoutCentro'
import { conColumna, type ColumnaPerfil } from './columnaPorPerfil'

/** Estado del layout; los mapas por perfil usan '' como clave de «sin perfil». */
export interface EstadoLayout {
  vistaPorPerfil: Record<string, string>
  panelPorPerfil: Record<string, string>
  /** La franja deja de retener `gitlog` en cuanto hay un proyecto que mirar o el usuario la toca. */
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
  /** Ancho de la lista del historial de un archivo. */
  gitHistorialWidth: number
  /** Ancho del agente de la terminal junto a la terminal a pantalla completa. */
  agenteTerminalAncho: number
  activityBarOrder: string[]
  bottomBarOrder: string[]
  /** Maximizado y oculto de la columna del agente de cada perfil (efímero): `columnaPorPerfil.ts`. */
  columnaPorPerfil: Readonly<Record<string, ColumnaPerfil>>
  /** Lo que cada perfil tiene maximizado (efímero: no se persiste). Es la verdad; lo que se pinta se deriva. */
  maximizadoPorPerfil: Record<string, MaximizadosPerfil>
  /**
   * ESPEJO de lo que se pinta a pantalla completa y del perfil a la vista, que escribe
   * `useEspejoPantallaCompleta` tras cada commit: para los manejadores de eventos, que no tienen el perfil.
   */
  franjaPantallaCompleta: PanelInferiorCentro | null
  perfilALaVista: string
}

/**
 * Ancho por defecto del agente de la terminal: unas 80 columnas con la letra por defecto (13 px),
 * no los 340 de la columna del agente, que le dejarían la mitad. Con él, a 1366 px de ancho la
 * terminal también conserva sus 80 (el riel de conexiones se pliega solo si no cabe). En macOS la
 * letra por defecto es más ancha y son 78 y 78: 80 y 80 no caben a 1366 px.
 */
export const AGENTE_TERMINAL_ANCHO_POR_DEFECTO = ANCHO_TERMINAL_AGENTE_DEFECTO

/** Estado del layout de la ventana. */
export const useStoreLayout = create<EstadoLayout>()(() => ({
  vistaPorPerfil: {},
  panelPorPerfil: {},
  franjaLibre: false,
  sidebarWidthByView: {},
  ccWidth: ANCHO_CC_DEFECTO,
  dbAgenteWidth: ANCHO_AGENTE_BD_DEFECTO,
  dbResultadosAlto: ALTO_RESULTADOS_BD_DEFECTO,
  altoPanelInferior: ALTO_TERMINAL_DEFECTO,
  gitLogRamasWidth: ANCHO_RAMAS_LOG_GIT_DEFECTO,
  gitLogDetalleWidth: ANCHO_DETALLE_LOG_GIT_DEFECTO,
  gitLogArchivosH: ALTO_ARCHIVOS_LOG_GIT_DEFECTO,
  gitHistorialWidth: ANCHO_HISTORIAL_GIT_DEFECTO,
  agenteTerminalAncho: AGENTE_TERMINAL_ANCHO_POR_DEFECTO,
  activityBarOrder: [...ORDEN_DEFECTO_BARRA_ACTIVIDAD],
  bottomBarOrder: [...ORDEN_DEFECTO_BARRA_INFERIOR],
  columnaPorPerfil: {},
  maximizadoPorPerfil: {},
  franjaPantallaCompleta: null,
  perfilALaVista: ''
}))

/** Maximiza o restaura `clave` en el perfil a la vista (o en `perfil`). */
export function fijarMaximizado(
  clave: keyof MaximizadosPerfil,
  valor: boolean,
  perfil: string = useStoreLayout.getState().perfilALaVista
): void {
  useStoreLayout.setState((s) => {
    const siguiente = conMaximizado(s.maximizadoPorPerfil, perfil, clave, valor)
    return siguiente === s.maximizadoPorPerfil ? s : { maximizadoPorPerfil: siguiente }
  })
}

/**
 * Pasa la pantalla completa de un panel de la franja al otro (el riel a pantalla completa): el elegido entra
 * maximizado y el que se deja sale del modo, así que el maximizado acompaña a la franja y no se queda
 * esperando en el panel que se dejó. Quien llama pone después el elegido en la franja.
 */
export function pasarPantallaCompleta(de: PanelInferiorCentro, a: PanelInferiorCentro): void {
  if (de === a) return
  fijarMaximizado(a, true)
  fijarMaximizado(de, false)
}

/** Cambia la columna del agente de `perfil` ('' = sin perfil; de serie, el que está a la vista); no repinta si no cambia nada. */
export function fijarColumna(
  cambio: Partial<ColumnaPerfil> | ((actual: ColumnaPerfil) => Partial<ColumnaPerfil>),
  perfil: string = useStoreLayout.getState().perfilALaVista
): void {
  useStoreLayout.setState((s) => {
    const siguiente = conColumna(s.columnaPorPerfil, perfil, cambio)
    return siguiente === s.columnaPorPerfil ? s : { columnaPorPerfil: siguiente }
  })
}

/**
 * Restaura el panel de la franja del perfil a la vista, aunque el mosaico o la vista de datos no lo pinten:
 * así, al volver, no tapa lo que se acaba de abrir. Elegir otra vista o abrir un archivo lo piden.
 */
export function salirDePantallaCompleta(): void {
  const s = useStoreLayout.getState()
  const panel = s.panelPorPerfil[s.perfilALaVista]
  if (panel === 'terminal' || panel === 'gitlog') fijarMaximizado(panel, false)
}

/** Setter estable de un campo numérico o de lista del layout (para `onRedimensionar` y similares). */
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
  agenteTerminalAncho: fijadorLayout('agenteTerminalAncho'),
  activityBarOrder: fijadorLayout('activityBarOrder'),
  bottomBarOrder: fijadorLayout('bottomBarOrder')
}

/** Pone en `perfil` la vista `valor` solo si hoy es `si`; mismo objeto si no cambia. */
export function cambiarVistaSi(perfil: string, si: string, valor: string): void {
  useStoreLayout.setState((s) =>
    s.vistaPorPerfil[perfil] === si ? { vistaPorPerfil: { ...s.vistaPorPerfil, [perfil]: valor } } : {}
  )
}
