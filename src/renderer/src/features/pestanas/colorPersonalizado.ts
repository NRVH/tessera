// =============================================================================
// Lo puro del selector de color de un perfil: el color «Personalizado» sale de un TONO y una
// LUZ dentro de la banda cenizo de `colorPerfil.ts` (lo que se elige es lo que se pinta), un
// hex escrito a mano se lee con tolerancia, y la lista de colores fijados se mantiene sin
// repetidos y con tope. Sin React ni DOM: lo usa `SelectorColorPerfil.tsx`.
// Decisiones: docs/decisiones/renderer/color-de-perfil-cenizo.md
// =============================================================================
import { hexARgb, hslAHex, LUM_MAX, LUM_MIN, rgbAHsl, SAT_MAX } from './colorPerfil.ts'

/** Tono (0..360) y luz (0..1 dentro de la banda) de un color. */
export interface TonoYLuz {
  tono: number
  luz: number
}

/** El color de un tono y una luz: saturación al techo de la banda y luz repartida en ella. */
export function colorDeTonoYLuz({ tono, luz }: TonoYLuz): string {
  const l = LUM_MIN + Math.max(0, Math.min(1, luz)) * (LUM_MAX - LUM_MIN)
  return hslAHex(tono, SAT_MAX, l)
}

/** El tono y la luz de un color, para colocar los deslizadores; un hex inválido da el centro. */
export function tonoYLuzDe(color: string): TonoYLuz {
  const rgb = hexARgb(color)
  if (rgb === null) return { tono: 0, luz: 0.5 }
  const [h, , l] = rgbAHsl(...rgb)
  return { tono: Math.round(h), luz: Math.max(0, Math.min(1, (l - LUM_MIN) / (LUM_MAX - LUM_MIN))) }
}

/** Un hex escrito a mano (`abc`, `#abc`, `#aabbcc`) como `#rrggbb` en minúsculas, o null. */
export function leerHex(texto: string): string | null {
  const s = texto.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(s)) return `#${[...s].map((c) => c + c).join('')}`
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`
  return null
}

/** La lista con `color` fijado al principio, sin repetirlo y con como mucho `max`. */
export function fijarColor(lista: readonly string[], color: string, max: number): string[] {
  const c = color.toLowerCase()
  return [c, ...lista.filter((x) => x.toLowerCase() !== c)].slice(0, max)
}

/** La lista sin `color`. */
export function quitarFijado(lista: readonly string[], color: string): string[] {
  const c = color.toLowerCase()
  return lista.filter((x) => x.toLowerCase() !== c)
}
