// =============================================================================
// Señales del ciclo de vida de un pane del agente: los menús de la cabecera de casilla
// (que se cierran al dejar de serlo), el latch `activated` de la apertura perezosa y lo
// que se reporta hacia arriba (estado de la sesión y si hay un agente en marcha).
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { PropsAgentPane } from './agentPaneTipos'
import type { EstadoSesion } from './useEstadoAgentPane'
import type { RefsAgentPane } from './useRefsAgentPane'

type Pos = { x: number; y: number } | null

/** Menús de la cabecera de casilla: a qué proyecto apunta y en qué modo corre. */
export interface MenusCasilla {
  menuDestinos: Pos
  setMenuDestinos: Dispatch<SetStateAction<Pos>>
  menuModo: Pos
  setMenuModo: Dispatch<SetStateAction<Pos>>
}

/**
 * Al dejar de ser casilla se cierran: el menú solo se cierra solo con un clic fuera o
 * Escape, y el pane sobrevive (keep-alive), así que reaparecería en la próxima casilla.
 */
export function useMenusCasilla(esCasillaPane: boolean): MenusCasilla {
  const [menuDestinos, setMenuDestinos] = useState<Pos>(null)
  const [menuModo, setMenuModo] = useState<Pos>(null)
  useEffect(() => {
    if (esCasillaPane) return
    setMenuDestinos(null)
    setMenuModo(null)
  }, [esCasillaPane])
  return { menuDestinos, setMenuDestinos, menuModo, setMenuModo }
}

/**
 * Latch de la apertura PEREZOSA: la sesión se abre la primera vez que el pane se mira
 * (seleccionado o casilla a la vista) y nunca vuelve a false. Reporta el estado solo una
 * vez activado (un 'booting' previo sería fantasma) y si hay un agente DE VERDAD vivo.
 */
export function useActivacion(p: PropsAgentPane, r: RefsAgentPane, s: EstadoSesion, showSelector: boolean): boolean {
  const { seEstaMirando, onStatusChange, hibernated } = p
  const { key } = p.target
  const { status, sessionId } = s
  const [activated, setActivated] = useState(p.visible)
  useEffect(() => {
    if (seEstaMirando) setActivated(true)
  }, [seEstaMirando])
  useEffect(() => {
    if (!activated) return
    // Sin cuenta no hay contenedor arrancando: 'exited' deja el punto en el modelo.
    onStatusChange?.(key, showSelector ? 'exited' : status)
  }, [status, showSelector, activated, onStatusChange, key])
  // Exige el `sessionId`: tras hibernar el `status` se queda en 'live' sin nada detrás.
  const enVivo = activated && !hibernated && !showSelector && sessionId !== null && status === 'live'
  useEffect(() => {
    r.onVivoChange.current?.(enVivo)
  }, [enVivo, r])
  // Al desmontar deja de estar en marcha: si no, la clave quedaría "viva" en el store.
  useEffect(() => () => r.onVivoChange.current?.(false), [r])
  return activated
}
