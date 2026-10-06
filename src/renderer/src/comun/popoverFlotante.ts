// =============================================================================
// Lo común y sin hooks de los popovers flotantes de la app (los de la vista de BD —esquemas
// visibles, selector de esquema de la consola, historial— y la lista de conexiones SSH): el
// ancla, la posición acotada al viewport y el teclado de la lista. El foco y el cierre están en
// `usePopoverFlotante.ts`. Solo depende de React (tipos).
// Decisiones: docs/decisiones/bd/ui-consola-popovers.md, docs/decisiones/renderer/boton-dividido-y-capa-flotante.md
// =============================================================================

import type { Dispatch, SetStateAction } from 'react'

/** Rectángulo del que cuelga un popover (el de la insignia, o el de la fila). */
export interface AnclaPopover {
  left: number
  top: number
  bottom: number
}

/** Ancla de un popover que se alinea por el borde DERECHO de su botón. */
export interface AnclaDerecha extends AnclaPopover {
  right: number
}

/** Posición `fixed` de un popover. */
export interface PosicionPopover {
  left: number
  top: number
}

/** Separación con el ancla. */
export const HUECO = 4
/** Margen mínimo a los bordes del viewport. */
export const MARGEN = 8
/** Filas visibles de la lista antes de que scrollee. */
export const FILAS_MAX = 10

/**
 * Coloca el popover bajo el ancla (encima si no cabe) y siempre dentro del viewport;
 * `izquierda` da el borde izquierdo deseado a partir del ancho medido.
 */
export function recolocar(
  el: HTMLElement | null,
  izquierda: (ancho: number) => number,
  anclaTop: number,
  anclaBottom: number,
  setPos: Dispatch<SetStateAction<PosicionPopover>>
): void {
  if (!el) return
  const { width, height } = el.getBoundingClientRect()
  const left = Math.max(MARGEN, Math.min(izquierda(width), window.innerWidth - width - MARGEN))
  let top = anclaBottom + HUECO
  if (top + height > window.innerHeight - MARGEN) top = anclaTop - height - HUECO
  top = Math.max(MARGEN, Math.min(top, window.innerHeight - height - MARGEN))
  setPos((p) => (p.left === left && p.top === top ? p : { left, top }))
}

/** Qué hace cada tecla en la lista de un popover. */
export interface TeclasPopover {
  total: number
  setActivo: Dispatch<SetStateAction<number>>
  alEscape: () => void
  alEnter: () => void
  /** Re Pág / Av Pág saltan `FILAS_MAX` filas. */
  conPaginas?: boolean
  /** Espacio marca la fila activa (lista multiselección). */
  alEspacio?: () => void
}

function saltoDeTecla(tecla: string, conPaginas: boolean): number {
  if (tecla === 'ArrowDown') return 1
  if (tecla === 'ArrowUp') return -1
  if (!conPaginas) return 0
  if (tecla === 'PageDown') return FILAS_MAX
  if (tecla === 'PageUp') return -FILAS_MAX
  return 0
}

/** Teclado de un popover con filtro y lista: Esc, Enter, las flechas y, si toca, Espacio. */
export function teclaPopover(e: React.KeyboardEvent, t: TeclasPopover): void {
  // Nada de lo que se teclea aquí es para lo de debajo: el portal burbujea por el árbol
  // de React, no por el del DOM.
  e.stopPropagation()
  if (e.nativeEvent.isComposing) return
  if (e.key === 'Escape' || e.key === 'Enter') {
    e.preventDefault()
    if (e.key === 'Escape') t.alEscape()
    else t.alEnter()
    return
  }
  if (t.total === 0) return
  const salto = saltoDeTecla(e.key, t.conPaginas === true)
  if (salto !== 0) {
    e.preventDefault()
    t.setActivo((a) => Math.max(0, Math.min(t.total - 1, a + salto)))
    return
  }
  if (e.key === ' ' && t.alEspacio) {
    e.preventDefault()
    t.alEspacio()
  }
}
