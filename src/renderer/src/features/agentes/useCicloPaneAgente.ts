// =============================================================================
// Señales del ciclo de vida de un pane del agente: los menús de la cabecera de casilla
// (que se cierran al dejar de serlo), el latch `activated` de la apertura perezosa y lo
// que se reporta hacia arriba (estado de la sesión y si hay un agente en marcha).
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { estadoParaElPunto, type PropsPaneAgente } from './tiposPaneAgente'
import type { EstadoSesion } from './useEstadoPaneAgente'
import type { RefsPaneAgente } from './useRefsPaneAgente'

type Pos = { x: number; y: number } | null

/** Menú de la cabecera de casilla: a qué proyecto apunta. */
export interface MenusCasilla {
  menuDestinos: Pos
  setMenuDestinos: Dispatch<SetStateAction<Pos>>
}

/**
 * Al dejar de ser casilla se cierra: el menú solo se cierra solo con un clic fuera o
 * Escape, y el pane sobrevive (keep-alive), así que reaparecería en la próxima casilla.
 */
export function useMenusCasilla(esCasillaPane: boolean): MenusCasilla {
  const [menuDestinos, setMenuDestinos] = useState<Pos>(null)
  useEffect(() => {
    if (esCasillaPane) return
    setMenuDestinos(null)
  }, [esCasillaPane])
  return { menuDestinos, setMenuDestinos }
}

/**
 * Latch de la apertura PEREZOSA: la sesión se abre la primera vez que el pane se mira
 * (seleccionado o casilla a la vista) y nunca vuelve a false. Reporta el estado solo una
 * vez activado (un 'booting' previo sería fantasma) y si hay un agente DE VERDAD vivo.
 */
export function useActivacion(p: PropsPaneAgente, r: RefsPaneAgente, s: EstadoSesion, verSelector: boolean): boolean {
  const { seEstaMirando, onCambioEstado, hibernado } = p
  const { key: clave } = p.target
  const { estado, sesionId, recuperando } = s
  const [activado, setActivado] = useState(p.visible)
  useEffect(() => {
    if (seEstaMirando) setActivado(true)
  }, [seEstaMirando])
  useEffect(() => {
    if (!activado) return
    // `abriendo` no es estado de React: basta leerlo al dejar de mirarse el pane, que es cuando
    // decide; una apertura que termina después cambia `status` y vuelve a reportar.
    const abriendo = r.sesion.abriendo()
    onCambioEstado?.(clave, estadoParaElPunto(estado, { sinCuenta: verSelector, seEstaMirando, abriendo, recuperando }))
  }, [estado, verSelector, seEstaMirando, recuperando, activado, onCambioEstado, clave, r])
  // Exige el `sessionId`: tras hibernar el `status` se queda en 'live' sin nada detrás.
  const enVivo = activado && !hibernado && !verSelector && sesionId !== null && estado === 'live'
  useEffect(() => {
    r.onCambioVivo.current?.(enVivo)
  }, [enVivo, r])
  // Al desmontar deja de estar en marcha: si no, la clave quedaría "viva" en el store.
  useEffect(() => () => r.onCambioVivo.current?.(false), [r])
  return activado
}
