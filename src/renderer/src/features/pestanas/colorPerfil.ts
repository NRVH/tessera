// =============================================================================
// colorPerfil: convierte el color CRUDO de un perfil en la TINTA con la que se pinta
// (el mismo matiz, rebajado a una banda cenizo/quemado) y la del resaltado de búsqueda.
// Se aplica al pintar, no al guardar, y es idempotente. Módulo puro (sin React ni DOM)
// para que su prueba corra con `node` a secas.
// Decisiones: docs/decisiones/renderer/color-de-perfil-cenizo.md
// =============================================================================

// La banda cenizo/quemado se exporta para que la prueba afirme sobre ella y no sobre
// una copia: es la definición de "cenizo" y no debe haber dos versiones.

/** Techo de saturación. Por encima, el color empieza a gritar sobre el gris del marco. */
export const SAT_MAX = 32
/** Banda de luminosidad: por debajo no se lee sobre el fondo oscuro; por encima, brilla. */
export const LUM_MIN = 53
export const LUM_MAX = 64

/** Acota `v` al rango [min, max]. */
function acotar(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * `#rgb` o `#rrggbb` -> [r, g, b] en 0..255, o `null` si no es un hex válido.
 *
 * Devuelve null en vez de lanzar porque el color sale de `profiles.json`, que es
 * un archivo que un humano puede haber editado: un valor raro debe degradar a "sin
 * tinta", no tumbar la banda de pestañas.
 */
export function hexARgb(hex: string): [number, number, number] | null {
  const s = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(s)) return null
  if (s.length === 3) {
    const [r, g, b] = [...s].map((c) => parseInt(c + c, 16))
    return [r, g, b]
  }
  if (s.length === 6) {
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
  }
  return null
}

/** [r,g,b] 0..255 -> [h 0..360, s 0..100, l 0..100]. */
export function rgbAHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s * 100, l * 100]
}

/** [h 0..360, s 0..100, l 0..100] -> `#rrggbb`. */
export function hslAHex(h: number, s: number, l: number): string {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const m = ln - c / 2
  const hex = rgb
    .map((v) =>
      Math.round(acotar((v + m) * 255, 0, 255))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
  return `#${hex}`
}

/**
 * El color con el que se PINTA un perfil: su mismo matiz, rebajado a la banda
 * cenizo/quemado del tema.
 *
 * Un hex inválido se devuelve tal cual: el color viene de un archivo editable a
 * mano y aquí no es sitio para decidir que un perfil se queda sin color.
 */
export function tintaPerfil(color: string): string {
  const rgb = hexARgb(color)
  if (rgb === null) return color
  const [h, s, l] = rgbAHsl(...rgb)
  // Un gris de verdad (s ≈ 0) se queda gris: subirle la luminosidad a la banda le
  // daría un color que su dueño no eligió.
  if (s < 4) return hslAHex(h, s, acotar(l, LUM_MIN, LUM_MAX))
  return hslAHex(h, Math.min(s, SAT_MAX), acotar(l, LUM_MIN, LUM_MAX))
}

/** Luminosidad del resaltado de búsqueda: más alta que la banda para que la letra oscura se lea (ver el ADR). */
export const LUM_RESALTADO = 72

/**
 * El color con el que se RESALTA una coincidencia de búsqueda en este perfil: su
 * mismo matiz, subido a la luminosidad de resaltado. Ver `LUM_RESALTADO`.
 */
export function tintaResaltado(color: string): string {
  const rgb = hexARgb(color)
  if (rgb === null) return color
  const [h, s] = rgbAHsl(...rgb)
  if (s < 4) return hslAHex(h, s, LUM_RESALTADO)
  return hslAHex(h, Math.min(s, SAT_MAX), LUM_RESALTADO)
}
