// =============================================================================
// El reparto de alto entre el editor y los resultados de una consola (SQL, MongoDB o Redis):
// el alto de resultados persistido se acota al de la columna menos lo fijo.
// Solo depende de React.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { MIN_EDITOR, MIN_RESULTADOS, altoRepartible } from './consolaComun'

/** El ref de la columna y el alto (y el máximo) que le toca al bloque de resultados. */
export function useRepartoAlto(altoResultados: number): {
  colRef: (node: HTMLElement | null) => void
  maxResultados: number
  altoEfectivo: number
} {
  const observerRef = useRef<ResizeObserver | null>(null)
  const [altoCol, setAltoCol] = useState(0)
  const colRef = useCallback((node: HTMLElement | null): void => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const ro = new ResizeObserver(() => setAltoCol(altoRepartible(node)))
    ro.observe(node)
    observerRef.current = ro
    setAltoCol(altoRepartible(node))
  }, [])
  useEffect(() => () => observerRef.current?.disconnect(), [])
  const maxResultados =
    altoCol > 0 ? Math.max(MIN_RESULTADOS, altoCol - MIN_EDITOR) : Math.max(MIN_RESULTADOS, altoResultados)
  const altoEfectivo = Math.min(Math.max(altoResultados, MIN_RESULTADOS), maxResultados)
  return { colRef, maxResultados, altoEfectivo }
}
