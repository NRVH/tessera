// =============================================================================
// La mecánica común de los selectores de base de las consolas de MongoDB y de Redis: cerrar
// con un clic fuera y el teclado (flechas, Intro, Escape); el foco es el de los popovers
// (`comun/usePopoverFlotante.ts`).
// Nada de lo que se teclea en el selector es para la consola de debajo, porque el portal
// burbuja los eventos por el árbol de React. Solo depende de React.
// =============================================================================

import { useEffect } from 'react'

/** Cierra el selector con un `mousedown` fuera de su raíz. */
export function useCierreFuera(raizRef: React.RefObject<HTMLElement>, cerrarRef: React.MutableRefObject<() => void>): void {
  useEffect(() => {
    function fuera(e: MouseEvent): void {
      const raiz = raizRef.current
      if (raiz && e.target instanceof Node && raiz.contains(e.target)) return
      cerrarRef.current()
    }
    window.addEventListener('mousedown', fuera)
    return () => window.removeEventListener('mousedown', fuera)
  }, [raizRef, cerrarRef])
}

/** El teclado del selector: Escape cierra, Intro elige la fila activa, las flechas la mueven. */
export function teclaSelector(
  e: React.KeyboardEvent,
  h: { cerrar: () => void; elegir: () => void; mover: (delta: number) => void }
): void {
  e.stopPropagation()
  if (e.nativeEvent.isComposing) return
  if (e.key === 'Escape') {
    e.preventDefault()
    h.cerrar()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    h.elegir()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    h.mover(e.key === 'ArrowDown' ? 1 : -1)
  }
}
