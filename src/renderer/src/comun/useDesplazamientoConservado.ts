// =============================================================================
// El desplazamiento de una lista que se oculta y vuelve. Una capa viva oculta lo conserva sola,
// pero si un antepasado pasa a `display: none` (el panel de la terminal con la franja cerrada o
// con Git·Log) el navegador lo descarta. Mientras se ve se anota; al volver a verse se repone en
// el mismo commit, antes de pintar. Decisiones: docs/decisiones/renderer/vivos-y-ocultos.md
// =============================================================================
import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Conserva el desplazamiento vertical de `ref` a través de un ocultamiento. Solo escucha mientras
 * `visible`: lo que el navegador haga con el desplazamiento de una caja oculta no se anota.
 */
export function useDesplazamientoConservado(ref: RefObject<HTMLElement>, visible: boolean): void {
  const guardado = useRef(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!visible || !el) return
    if (el.scrollTop !== guardado.current) el.scrollTop = guardado.current
    const anotar = (): void => {
      guardado.current = el.scrollTop
    }
    el.addEventListener('scroll', anotar, { passive: true })
    return () => el.removeEventListener('scroll', anotar)
  }, [ref, visible])
}
