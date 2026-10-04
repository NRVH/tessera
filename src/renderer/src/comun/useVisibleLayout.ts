// =============================================================================
// Reflow de un editor de Monaco al pasar de oculto (display:none) a visible: reintenta unos
// frames hasta que el host tiene caja real y entonces llama a `layout()` con dimensiones
// explícitas; si pasado el tope sigue sin caja, se abandona. Solo depende de React.
// Decisiones: docs/decisiones/renderer/reflow-monaco-oculto.md
// =============================================================================

import { useEffect } from 'react'

/** Cualquier editor de Monaco (código o diff): ambos exponen layout(dim). */
interface Layoutable {
  layout(dimension?: { width: number; height: number }): void
}

/** Nº máximo de frames a esperar la caja real (~200ms) antes de rendirse. */
const MAX_FRAMES = 12

/**
 * Fuerza el reflow de un editor de Monaco al volver de oculto a visible.
 * `hostRef`/`editorRef` son refs estables, así que el efecto solo depende de
 * `visible`.
 */
export function useVisibleLayout<E extends HTMLElement>(
  hostRef: React.RefObject<E | null>,
  editorRef: React.RefObject<Layoutable | null>,
  visible: boolean
): void {
  useEffect(() => {
    if (!visible) return
    let raf = 0
    let frames = 0
    const relayout = (): void => {
      const host = hostRef.current
      const ed = editorRef.current
      if (!host || !ed) return
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        ed.layout({ width: host.clientWidth, height: host.clientHeight })
        return
      }
      if (++frames < MAX_FRAMES) raf = requestAnimationFrame(relayout)
    }
    raf = requestAnimationFrame(relayout)
    return () => cancelAnimationFrame(raf)
    // hostRef/editorRef son estables (refs); el reflow solo se re-dispara al
    // cambiar la visibilidad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
}
