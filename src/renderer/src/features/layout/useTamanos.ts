// =============================================================================
// Tamaños de las zonas redimensionables y sus topes dinámicos: el ancho de la
// ventana acota la columna del agente (dejando sitio al editor o al centro de BD) y
// las columnas laterales del log; la franja sube a su suelo al pasar a Git·Log.
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  CC_WIDTH_MIN,
  DEFAULT_SIDEBAR_WIDTH,
  GIT_LOG_COL_MAX,
  GIT_LOG_COL_MIN,
  PANEL_GIT_MIN,
  TERMINAL_HEIGHT_MIN
} from '../../../../shared/workspace-state-ipc'
import type { ActivityView, PanelInferior } from './ActivityBar'
import { useStoreLayout } from './store'

/** Ancho mínimo utilizable del editor al lado de la columna del agente. */
const EDITOR_MIN_WIDTH = 380
/** Ídem para el centro de la vista de BD: una rejilla pide más ancho que un editor. */
const DB_AREA_MIN_WIDTH = 420
/** Ancho mínimo de la columna central de Git·Log (el grafo). */
const GIT_LOG_CENTRO_MIN = 420

/** Tamaños derivados y topes de los divisores. */
export interface Tamanos {
  sidebarWidth: number
  setSidebarWidth: (px: number) => void
  ccMax: number
  ccMaxDb: number
  /** Lo que se pinta ya acotado, sin esperar al efecto. */
  dbAgenteWidthVisible: number
  panelInferiorMin: number
  gitLogColMax: number
}

/**
 * Sigue el ancho de la ventana con un solo listener. Estado local y no del store: solo
 * lo lee este hook, y así se lee en el PRIMER render (un store lo leería al importarse).
 */
function useAnchoVentana(): number {
  const [ancho, setAncho] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setAncho(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return ancho
}

/** Tamaños y topes; recorta los valores guardados cuando la ventana o el panel cambian. */
export function useTamanos(activeView: ActivityView, panelInferior: PanelInferior | null): Tamanos {
  const windowWidth = useAnchoVentana()
  const { anchoVista, anchoVistaDb, dbAgenteWidth } = useStoreLayout(
    useShallow((s) => ({
      anchoVista: s.sidebarWidthByView[activeView],
      anchoVistaDb: s.sidebarWidthByView['db'],
      dbAgenteWidth: s.dbAgenteWidth
    }))
  )
  // Cada vista recuerda su ancho lateral.
  const sidebarWidth = anchoVista ?? DEFAULT_SIDEBAR_WIDTH
  const setSidebarWidth = useCallback(
    (px: number) => useStoreLayout.setState((s) => ({ sidebarWidthByView: { ...s.sidebarWidthByView, [activeView]: px } })),
    [activeView]
  )
  const ccMax = Math.max(CC_WIDTH_MIN, windowWidth - sidebarWidth - EDITOR_MIN_WIDTH)
  useEffect(() => {
    useStoreLayout.setState((s) => ({ ccWidth: s.ccWidth > ccMax ? ccMax : s.ccWidth }))
  }, [ccMax])
  const ccMaxDb = Math.max(CC_WIDTH_MIN, windowWidth - (anchoVistaDb ?? DEFAULT_SIDEBAR_WIDTH) - DB_AREA_MIN_WIDTH)
  useEffect(() => {
    useStoreLayout.setState((s) => ({ dbAgenteWidth: s.dbAgenteWidth > ccMaxDb ? ccMaxDb : s.dbAgenteWidth }))
  }, [ccMaxDb])
  // Una terminal aguanta menos alto que las tres columnas de Git·Log.
  const panelInferiorMin = panelInferior === 'gitlog' ? PANEL_GIT_MIN : TERMINAL_HEIGHT_MIN
  useEffect(() => {
    useStoreLayout.setState((s) => ({
      altoPanelInferior: s.altoPanelInferior < panelInferiorMin ? panelInferiorMin : s.altoPanelInferior
    }))
  }, [panelInferiorMin])
  const gitLogColMax = Math.max(GIT_LOG_COL_MIN, Math.min(GIT_LOG_COL_MAX, Math.floor((windowWidth - GIT_LOG_CENTRO_MIN) / 2)))
  useEffect(() => {
    const acotar = (w: number): number => (w > gitLogColMax ? gitLogColMax : w)
    useStoreLayout.setState((s) => ({
      gitLogRamasWidth: acotar(s.gitLogRamasWidth),
      gitLogDetalleWidth: acotar(s.gitLogDetalleWidth),
      gitHistorialWidth: acotar(s.gitHistorialWidth)
    }))
  }, [gitLogColMax])
  return {
    sidebarWidth,
    setSidebarWidth,
    ccMax,
    ccMaxDb,
    dbAgenteWidthVisible: Math.min(dbAgenteWidth, ccMaxDb),
    panelInferiorMin,
    gitLogColMax
  }
}
