// =============================================================================
// Store de los ajustes globales de la interfaz (slice `settings` del workspace-state)
// y del estado del modal de Configuración.
// Se hidrata y se persiste por IPC desde usePersistenciaAjustes; aquí no hay E/S.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { create } from 'zustand'
import type { DbTxModo } from '../../../../shared/db-explorador-ipc'
import type { PreferenciaIdioma } from '../../../../shared/i18n'
import {
  DB_FILAS_POR_PAGINA_POR_DEFECTO,
  DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO,
  DB_TX_INICIAL_POR_DEFECTO
} from '../../../../shared/ajustesBd'
import { AGENTE_INACTIVIDAD_MIN_POR_DEFECTO } from '../../../../shared/ajustesAgente'
import { POLITICA_POR_DEFECTO, type PrimeroEnPararse } from '../../../../shared/semaforoContenedores'
import { SATURACION_POR_DEFECTO } from '../../../../shared/saturacionDocker'
import { DEFAULT_TERMINAL_APPEARANCE, type TerminalAppearance } from '../../theme/terminalAppearance'
import { UI_FONT_DEFAULT } from '../../theme/densidad'
import { resolverCategoria, type CategoriaId } from './catalogo'

/** Ajustes globales persistidos y estado del modal de Configuración. */
export interface EstadoAjustes {
  hideProfileNames: boolean
  aplicarUpdateAlCerrar: boolean
  registroSalud: boolean
  volcadosCaida: boolean
  diffColapsar: boolean
  paquetesSandbox: string[]
  depsNavegadorSandbox: boolean
  menuWindowsCarpetas: boolean
  menuWindowsArchivos: boolean
  menuWindowsExtensiones: string[]
  menuWindowsAvisado: boolean
  accionRapidaFinder: boolean
  /** El idioma ELEGIDO; el que habla la ventana es el del arranque (`idiomaActual`). */
  idioma: PreferenciaIdioma
  /** El elegido al arrancar: si `idioma` ya no es este, el cambio espera a reiniciar. */
  idiomaAlArrancar: PreferenciaIdioma
  terminalAppearance: TerminalAppearance
  agentAppearance: TerminalAppearance
  uiFontSize: number
  /** Overrides de tamaño: 0 = hereda de la interfaz. */
  explorerFontSize: number
  gitFontSize: number
  dbFontSize: number
  dbFilasPorPagina: number
  dbTxInicial: DbTxModo
  dbConsolaInactividadMin: number
  /** Minutos tras los que se hiberna el agente de un proyecto fuera de pantalla; 0 = Nunca. */
  agenteInactividadMin: number
  /** Contenedores de Docker a la vez; `SIN_LIMITE` (0) = sin límite; sin valor = el recomendado. */
  limiteContenedores: number | undefined
  /** Qué se para primero al llegar al límite. */
  primeroEnPararse: PrimeroEnPararse
  /** No parar los que trabajan mientras haya otro. */
  protegerTrabajando: boolean
  /** Porcentaje de la memoria de Docker a partir del que se considera saturado. */
  saturacionUmbral: number
  /** Segundos por encima del umbral antes de parar un agente. */
  saturacionSegundos: number
  /** Avisar antes de parar por saturación; desmarcado, se para sin aviso. */
  avisarAntesDeParar: boolean
  /** Espejo del zoom de `webFrame` solo para pintarlo en su fila; la verdad es `webFrame`. */
  zoomLevel: number
  settingsOpen: boolean
  /** Categoría abierta del modal: navegación de la sesión, no se persiste. */
  ajustesCategoria: CategoriaId
  /** Ya se leyeron los ajustes persistidos (los panes nativos esperan a esto). */
  settingsLoaded: boolean
  alternarSettings: () => void
}

/** Estado de los ajustes globales; los valores por defecto son los de antes de hidratar. */
export const useStoreAjustes = create<EstadoAjustes>()((set) => ({
  hideProfileNames: false,
  aplicarUpdateAlCerrar: true,
  registroSalud: true,
  volcadosCaida: true,
  diffColapsar: false,
  paquetesSandbox: [],
  depsNavegadorSandbox: false,
  menuWindowsCarpetas: false,
  menuWindowsArchivos: false,
  menuWindowsExtensiones: [],
  menuWindowsAvisado: false,
  accionRapidaFinder: false,
  idioma: 'sistema',
  idiomaAlArrancar: 'sistema',
  terminalAppearance: DEFAULT_TERMINAL_APPEARANCE,
  agentAppearance: DEFAULT_TERMINAL_APPEARANCE,
  uiFontSize: UI_FONT_DEFAULT,
  explorerFontSize: 0,
  gitFontSize: 0,
  dbFontSize: 0,
  dbFilasPorPagina: DB_FILAS_POR_PAGINA_POR_DEFECTO,
  dbTxInicial: DB_TX_INICIAL_POR_DEFECTO,
  dbConsolaInactividadMin: DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO,
  agenteInactividadMin: AGENTE_INACTIVIDAD_MIN_POR_DEFECTO,
  limiteContenedores: undefined,
  primeroEnPararse: POLITICA_POR_DEFECTO.primero,
  protegerTrabajando: POLITICA_POR_DEFECTO.protegerTrabajando,
  saturacionUmbral: SATURACION_POR_DEFECTO.umbralPct,
  saturacionSegundos: SATURACION_POR_DEFECTO.segundos,
  avisarAntesDeParar: SATURACION_POR_DEFECTO.avisoPrevio,
  zoomLevel: 0,
  settingsOpen: false,
  ajustesCategoria: resolverCategoria(null),
  settingsLoaded: false,
  alternarSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen }))
}))

/** Fija un campo del store de ajustes; estable, apto para pasar como `onChange`. */
export function fijarAjuste<K extends keyof EstadoAjustes>(clave: K): (valor: EstadoAjustes[K]) => void {
  return (valor) => useStoreAjustes.setState({ [clave]: valor } as Pick<EstadoAjustes, K>)
}
