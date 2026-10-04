// =============================================================================
// bytesClaves: cómo se PINTAN los bytes de una conexión de claves (`DbKvBytes`: una clave, un
// campo, un valor) en el árbol, el visor y la consola: el texto si es UTF-8 válido, y si no
// los escapes `\xHH`. Puro; lo prueba `test-visor-claves.mts`. La identidad es siempre el base64.
// Decisiones: docs/decisiones/bd/ui-claves-arbol.md
// =============================================================================

import type { DbKvBytes } from '../../../../../shared/db-claves-ipc.ts'

/** Los bytes crudos (cada carácter de la cadena es un byte 0-255), o null si el base64 no vale. */
export function binarioDe(b: DbKvBytes): string | null {
  try {
    return atob(b.base64)
  } catch {
    return null
  }
}

/** Cuántos bytes son (del base64, sin decodificarlo: el visor lo pide en cada fila). */
export function tamanoBytes(b: DbKvBytes): number {
  const s = b.base64
  if (s.length === 0) return 0
  const relleno = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return Math.floor((s.length * 3) / 4) - relleno
}

/** ¿Son bytes que NO son UTF-8 válido? (el visor los enseña en hex). */
export function esBinario(b: DbKvBytes): boolean {
  return b.texto === undefined
}

/** Los escapes de unos bytes crudos: ASCII imprimible tal cual, `\\` y `\"` escapados y lo demás `\xHH`. */
export function escaparBinario(binario: string): string {
  let out = ''
  for (let i = 0; i < binario.length; i++) {
    const n = binario.charCodeAt(i)
    if (n === 0x5c) out += '\\\\'
    else if (n === 0x22) out += '\\"'
    else if (n >= 0x20 && n < 0x7f) out += binario[i]
    else out += '\\x' + n.toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Unos bytes tal como se pintan: el texto si es UTF-8 válido; si no, con escapes. Si el base64 no se puede leer (no debería pasar), el propio base64.
 */
export function pintarBytes(b: DbKvBytes): string {
  if (b.texto !== undefined) return b.texto
  const binario = binarioDe(b)
  return binario === null ? b.base64 : escaparBinario(binario)
}

/** ¿Hace falta entrecomillar este texto en un comando de la consola? */
function necesitaComillas(texto: string): boolean {
  if (texto === '') return true
  for (let i = 0; i < texto.length; i++) {
    const n = texto.charCodeAt(i)
    // Blancos y control, comillas, barra: todo lo que el partidor de comandos trata aparte.
    if (n <= 0x20 || n === 0x7f || n === 0x22 || n === 0x27 || n === 0x5c) return true
  }
  return false
}

/** Escapa un texto UTF-8 para ir entre comillas dobles (el UTF-8 se deja legible). */
function escaparTexto(texto: string): string {
  let out = ''
  for (const ch of texto) {
    const n = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (n < 0x20 || n === 0x7f) out += '\\x' + n.toString(16).padStart(2, '0')
    else out += ch
  }
  return out
}

/**
 * Unos bytes como ARGUMENTO de un comando de la consola: a pelo si se puede (`usuario:1`),
 * entre comillas dobles con escapes si no (`"a b"`, `"\xff"`). Lo que sale se parte de
 * vuelta en los MISMOS bytes. Solo cita cuando hace falta, para que se lea como lo escribiría el usuario.
 */
export function citarRedisCli(b: DbKvBytes): string {
  if (b.texto !== undefined) return necesitaComillas(b.texto) ? `"${escaparTexto(b.texto)}"` : b.texto
  const binario = binarioDe(b)
  return binario === null ? `"${b.base64}"` : `"${escaparBinario(binario)}"`
}

/**
 * Una línea para una CELDA o una fila del árbol: los saltos y tabuladores como `↵` y `→`
 * (una celda es de una línea y un valor con saltos se leería cortado) y recortada a `max`
 * caracteres con «…». El valor entero se ve en el panel de detalle.
 */
export function unaLinea(texto: string, max = 400): string {
  let t = texto.length > max ? texto.slice(0, max) : texto
  t = t.replace(/\r\n|\n|\r/g, '↵').replace(/\t/g, '→')
  return texto.length > max ? `${t}…` : t
}

/** Los bytes en hex separados por espacios (`48 65 6c`), como mucho `max` bytes. */
export function hexCorto(b: DbKvBytes, max = 64): string {
  const binario = binarioDe(b)
  if (binario === null) return b.base64
  const n = Math.min(binario.length, max)
  const partes: string[] = []
  for (let i = 0; i < n; i++) partes.push(binario.charCodeAt(i).toString(16).padStart(2, '0'))
  return partes.join(' ') + (binario.length > max ? ' …' : '')
}

/** Bytes por línea del volcado hex. */
export const BYTES_POR_LINEA_HEX = 16

/**
 * El VOLCADO HEX de unos bytes, como `hexdump -C`: desplazamiento, 16 bytes en hex (con un
 * hueco a la mitad) y su ASCII (lo no imprimible como `.`). Como mucho `maxBytes`: un string
 * de Redis puede ser enorme y cada línea es DOM; el visor dice cuánto se dejó fuera.
 */
export function volcadoHex(b: DbKvBytes, maxBytes = 64 * 1024): { lineas: string[]; recortado: boolean } {
  const binario = binarioDe(b) ?? ''
  const n = Math.min(binario.length, maxBytes)
  const lineas: string[] = []
  for (let base = 0; base < n; base += BYTES_POR_LINEA_HEX) {
    let hex = ''
    let ascii = ''
    for (let k = 0; k < BYTES_POR_LINEA_HEX; k++) {
      const i = base + k
      if (k === 8) hex += ' '
      if (i < n) {
        const c = binario.charCodeAt(i)
        hex += c.toString(16).padStart(2, '0') + ' '
        ascii += c >= 0x20 && c < 0x7f ? binario[i] : '.'
      } else {
        hex += '   '
      }
    }
    lineas.push(`${base.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`)
  }
  return { lineas, recortado: binario.length > maxBytes }
}
