// =============================================================================
// El popover del historial de una consola (SQL o de documentos): si está abierto y dónde cuelga.
// Cuelga del botón del reloj (`.db-consola-historial-btn`) de la sección, lo abra el ratón o el
// acorde, y una consola que se oculta lo cierra: por portal seguiría flotando sobre lo de después.
// Decisiones: docs/decisiones/bd/ui-consola-historial.md
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import type { AnclaDerecha } from '../../../comun/popoverFlotante'

/** Si el popover del historial (que es del pane) está abierto. */
export function useHistorialAbierto(): { historialAbierto: boolean; alternarHistorial: () => void; cerrarHistorial: () => void } {
  const [historialAbierto, setHistorialAbierto] = useState(false)
  const alternarHistorial = useCallback((): void => setHistorialAbierto((v) => !v), [])
  const cerrarHistorial = useCallback((): void => setHistorialAbierto(false), [])
  return { historialAbierto, alternarHistorial, cerrarHistorial }
}

/** Dónde cuelga el popover: el botón del reloj de `seccionRef`, medido al abrirse. */
export function useAnclaHistorial(
  seccionRef: RefObject<HTMLElement | null>,
  abierto: boolean,
  visible: boolean,
  cerrar: () => void
): AnclaDerecha | null {
  const [ancla, setAncla] = useState<AnclaDerecha | null>(null)
  useLayoutEffect(() => {
    if (!abierto) {
      setAncla(null)
      return
    }
    const r = seccionRef.current?.querySelector('.db-consola-historial-btn')?.getBoundingClientRect()
    if (r) setAncla({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }, [seccionRef, abierto])
  useEffect(() => {
    if (!visible && abierto) cerrar()
  }, [visible, abierto, cerrar])
  return ancla
}
