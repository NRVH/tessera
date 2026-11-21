// =============================================================================
// Contraste de colores sRGB por luminancia relativa.
// Recibe canales de 0 a 255 y devuelve una razón entre 1 y 21.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
export type ColorRgb = readonly [number, number, number]

function componenteLineal(canal: number): number {
  const valor = canal / 255
  return valor <= 0.04045 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4
}

function luminancia([rojo, verde, azul]: ColorRgb): number {
  return 0.2126 * componenteLineal(rojo) + 0.7152 * componenteLineal(verde) + 0.0722 * componenteLineal(azul)
}

export function contrasteColor(primero: ColorRgb, segundo: ColorRgb): number {
  const a = luminancia(primero) + 0.05
  const b = luminancia(segundo) + 0.05
  return Math.max(a, b) / Math.min(a, b)
}
