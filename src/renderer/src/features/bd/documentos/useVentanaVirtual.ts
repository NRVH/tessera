// =============================================================================
// La ventana virtual de las tablas de filas de alto fijo de documentos y claves: el alto
// visible, el desplazamiento, qué filas se montan y la fila seleccionada siempre a la vista.
// La usan `TablaDocumentos` y `TablaValores`; el teclado puro está en `ventanaVirtual.ts`.
// =============================================================================

import { useEffect, useRef, useState } from 'react'

/** Filas de más que se montan por arriba y por abajo de lo visible. */
const RESERVA = 8

export interface VentanaVirtual {
  scrollRef: React.RefObject<HTMLDivElement>
  setScrollTop: (v: number) => void
  altoVista: number
  /** Primera fila que se monta (incluida). */
  primera: number
  /** Última fila que se monta (excluida). */
  ultima: number
}

/**
 * Mide el contenedor, sigue su desplazamiento y mantiene `seleccionado` a la vista. `onFin`
 * (opcional) avisa de que el final está a la vista; su efecto va ANTES del de la fila a la vista.
 */
export function useVentanaVirtual(
  n: number,
  alto: number,
  seleccionado: number | null,
  onFin?: () => void
): VentanaVirtual {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [altoVista, setAltoVista] = useState(400)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setAltoVista(el.clientHeight))
    ro.observe(el)
    setAltoVista(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const primera = Math.max(0, Math.floor(scrollTop / alto) - 1 - RESERVA)
  const ultima = Math.min(n, Math.ceil((scrollTop + altoVista) / alto) + RESERVA)

  // El final a la vista: que el llamador pida más (él decide si hay y si ya lo pidió).
  useEffect(() => {
    if (onFin && n > 0 && ultima >= n - 2) onFin()
  }, [ultima, n, onFin])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || seleccionado === null) return
    const arriba = (seleccionado + 1) * alto
    if (arriba < el.scrollTop + alto) el.scrollTop = Math.max(0, arriba - alto)
    else if (arriba + alto > el.scrollTop + el.clientHeight) el.scrollTop = arriba + alto - el.clientHeight
  }, [seleccionado, alto])

  return { scrollRef, setScrollTop, altoVista, primera, ultima }
}
