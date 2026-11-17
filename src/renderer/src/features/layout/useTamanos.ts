// =============================================================================
// Tamaños de las zonas redimensionables y sus topes dinámicos: el ancho de la
// ventana acota la columna del agente (dejando sitio al editor o al centro de BD) y
// las columnas laterales del log; la franja sube a su suelo al pasar a Git·Log.
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ANCHO_CC_MIN,
  ANCHO_LATERAL_DEFECTO,
  GIT_LOG_COL_MAX,
  GIT_LOG_COL_MIN,
  PANEL_GIT_MIN,
  ALTO_TERMINAL_MIN
} from '../../../../shared/workspace-state-ipc'
import type { VistaActividad, PanelInferior } from './RielActividadPuro'
import { useStoreLayout } from './store'

/** Ancho mínimo utilizable del editor al lado de la columna del agente. */
const ANCHO_EDITOR_MIN = 380
/** Ídem para el centro de la vista de BD: una rejilla pide más ancho que un editor. */
const ANCHO_AREA_DB_MIN = 420
/** Ancho mínimo de la columna central de Git·Log (el grafo). */
const GIT_LOG_CENTRO_MIN = 420
/**
 * Lo que la terminal a pantalla completa conserva junto a su agente (el suelo que también respeta el
 * riel de conexiones, `TERMINAL_ANCHO_MIN`), más el riel de actividad y los canales del lienzo.
 */
const TERMINAL_JUNTO_AL_AGENTE = 420 + 60

/** Tamaños derivados y topes de los divisores. */
export interface Tamanos {
  anchoLateral: number
  fijarAnchoLateral: (px: number) => void
  ccMax: number
  ccMaxDb: number
  /** Lo que se pinta ya acotado, sin esperar al efecto. */
  anchoAgenteDbVisible: number
  /** Tope del agente de la terminal: deja a la terminal su suelo. */
  ccMaxTerminal: number
  /** El ancho del agente de la terminal ya acotado a la ventana. */
  agenteTerminalAnchoVisible: number
  panelInferiorMin: number
  maxColumnaLogGit: number
}

/**
 * Sigue el ancho de la ventana con un solo listener. Estado local y no del store: solo
 * lo lee este hook, y así se lee en el PRIMER render (un store lo leería al importarse).
 */
function useAnchoVentana(): number {
  const [ancho, setAncho] = useState(() => window.innerWidth)
  useEffect(() => {
    const alRedimensionar = (): void => setAncho(window.innerWidth)
    window.addEventListener('resize', alRedimensionar)
    return () => window.removeEventListener('resize', alRedimensionar)
  }, [])
  return ancho
}

/** Tamaños y topes; recorta los valores guardados cuando la ventana o el panel cambian. */
export function useTamanos(vistaActiva: VistaActividad, panelInferior: PanelInferior | null): Tamanos {
  const anchoVentana = useAnchoVentana()
  const { anchoVista, anchoVistaDb, dbAgenteWidth, agenteTerminalAncho } = useStoreLayout(
    useShallow((s) => ({
      anchoVista: s.sidebarWidthByView[vistaActiva],
      anchoVistaDb: s.sidebarWidthByView['db'],
      dbAgenteWidth: s.dbAgenteWidth,
      agenteTerminalAncho: s.agenteTerminalAncho
    }))
  )
  // Cada vista recuerda su ancho lateral.
  const anchoLateral = anchoVista ?? ANCHO_LATERAL_DEFECTO
  const fijarAnchoLateral = useCallback(
    (px: number) => useStoreLayout.setState((s) => ({ sidebarWidthByView: { ...s.sidebarWidthByView, [vistaActiva]: px } })),
    [vistaActiva]
  )
  const ccMax = Math.max(ANCHO_CC_MIN, anchoVentana - anchoLateral - ANCHO_EDITOR_MIN)
  useEffect(() => {
    useStoreLayout.setState((s) => ({ ccWidth: s.ccWidth > ccMax ? ccMax : s.ccWidth }))
  }, [ccMax])
  const ccMaxDb = Math.max(ANCHO_CC_MIN, anchoVentana - (anchoVistaDb ?? ANCHO_LATERAL_DEFECTO) - ANCHO_AREA_DB_MIN)
  useEffect(() => {
    useStoreLayout.setState((s) => ({ dbAgenteWidth: s.dbAgenteWidth > ccMaxDb ? ccMaxDb : s.dbAgenteWidth }))
  }, [ccMaxDb])
  // Una terminal aguanta menos alto que las tres columnas de Git·Log.
  const panelInferiorMin = panelInferior === 'gitlog' ? PANEL_GIT_MIN : ALTO_TERMINAL_MIN
  useEffect(() => {
    useStoreLayout.setState((s) => ({
      altoPanelInferior: s.altoPanelInferior < panelInferiorMin ? panelInferiorMin : s.altoPanelInferior
    }))
  }, [panelInferiorMin])
  const maxColumnaLogGit = Math.max(GIT_LOG_COL_MIN, Math.min(GIT_LOG_COL_MAX, Math.floor((anchoVentana - GIT_LOG_CENTRO_MIN) / 2)))
  useEffect(() => {
    const acotar = (w: number): number => (w > maxColumnaLogGit ? maxColumnaLogGit : w)
    useStoreLayout.setState((s) => ({
      gitLogRamasWidth: acotar(s.gitLogRamasWidth),
      gitLogDetalleWidth: acotar(s.gitLogDetalleWidth),
      gitHistorialWidth: acotar(s.gitHistorialWidth)
    }))
  }, [maxColumnaLogGit])
  // Sin efecto que lo recorte: no se guarda, así que basta con acotar lo que se pinta.
  const ccMaxTerminal = Math.max(ANCHO_CC_MIN, anchoVentana - TERMINAL_JUNTO_AL_AGENTE)
  return {
    anchoLateral,
    fijarAnchoLateral,
    ccMax,
    ccMaxDb,
    anchoAgenteDbVisible: Math.min(dbAgenteWidth, ccMaxDb),
    ccMaxTerminal,
    agenteTerminalAnchoVisible: Math.min(agenteTerminalAncho, ccMaxTerminal),
    panelInferiorMin,
    maxColumnaLogGit
  }
}
