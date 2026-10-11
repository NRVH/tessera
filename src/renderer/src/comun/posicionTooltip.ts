// =============================================================================
// Dónde va el tooltip propio respecto a lo que lo lleva: centrado debajo, encima si abajo no cabe,
// y siempre dentro de la ventana con un margen. Puro (sin DOM), para probarlo bajo `node`. Lo usa
// `TooltipPropio.tsx`.
// Decisiones: docs/decisiones/renderer/tooltip-propio.md
// =============================================================================

/** Un rectángulo en coordenadas de la ventana. */
export interface Caja {
  left: number
  top: number
  width: number
  height: number
}

/** Separación entre el ancla y el tooltip, y margen mínimo con el borde de la ventana. */
export const SEPARACION = 6
export const MARGEN = 4

/** La esquina superior izquierda del tooltip de tamaño `t` para el ancla `a` en una ventana `v`. */
export function posicionTooltip(a: Caja, t: { width: number; height: number }, v: { width: number; height: number }): { left: number; top: number } {
  const debajo = a.top + a.height + SEPARACION
  const encima = a.top - SEPARACION - t.height
  const cabeDebajo = debajo + t.height <= v.height - MARGEN
  const top = cabeDebajo || encima < MARGEN ? Math.min(debajo, v.height - MARGEN - t.height) : encima
  const centrado = a.left + a.width / 2 - t.width / 2
  const left = Math.max(MARGEN, Math.min(centrado, v.width - MARGEN - t.width))
  return { left: Math.round(left), top: Math.round(Math.max(MARGEN, top)) }
}
