// =============================================================================
// Visor de valor, la parte pura: qué modo le toca a una celda (nulo, texto, JSON, binario),
// el JSON re-sangrado token a token SIN `JSON.stringify` (que cambia los números grandes y
// `1.10`), el volcado hexadecimal con tope y los textos de cabecera y avisos. Neutral:
// sin React, DOM ni Monaco; lo prueba `test-visor-valor.mts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-visor.md
// =============================================================================

import type { DbCelda, DbColumnaResultado, DbTipoLogico } from '../../../../../shared/db-explorador-ipc.ts'
import { HEX, TIPO_MOTOR_BINARIO, formatoEntero } from './celdasRejilla.ts'

export type ModoVisor = 'nulo' | 'texto' | 'json' | 'binario'

/** Bytes que se vuelcan en hex como mucho (ver la cabecera). */
export const TOPE_HEX_VISOR = 1024 * 1024
/** Caracteres por encima de los cuales el JSON se abre sin colorear. */
export const TOPE_JSON_COLOREADO = 2 * 1024 * 1024

// --- Modo ------------------------------------------------------------------------

/** ¿La columna guarda binario? Lo mismo que decide `textoCelda` al pintar. */
export function esColumnaBinaria(tipoLogico: DbTipoLogico, tipoMotor?: string): boolean {
  return tipoLogico === 'binario' || (tipoLogico === 'lob' && tipoMotor !== undefined && TIPO_MOTOR_BINARIO.test(tipoMotor))
}

function esEspacio(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13
}

/** Primer y último carácter no blanco (sin copiar el texto: puede tener 16 MiB). */
function extremos(s: string): { primero: string; ultimo: string } {
  let i = 0
  while (i < s.length && esEspacio(s.charCodeAt(i))) i++
  let k = s.length - 1
  while (k >= i && esEspacio(s.charCodeAt(k))) k--
  return { primero: i < s.length ? s[i] : '', ultimo: k >= i ? s[k] : '' }
}

/** ¿Es JSON válido? `JSON.parse` solo valida: su resultado se tira (ver la cabecera). */
export function esJsonValido(texto: string): boolean {
  try {
    JSON.parse(texto)
    return true
  } catch {
    return false
  }
}

/** ¿Se enseña como JSON? La columna json, o un objeto/lista válido en cualquier texto. */
export function pareceJson(texto: string, tipoLogico: DbTipoLogico): boolean {
  if (tipoLogico !== 'json') {
    const { primero, ultimo } = extremos(texto)
    const objeto = primero === '{' && ultimo === '}'
    const lista = primero === '[' && ultimo === ']'
    if (!objeto && !lista) return false
  } else if (texto.trim() === '') {
    return false
  }
  return esJsonValido(texto)
}

/** El modo de una celda. `tipoMotor` distingue el BLOB que el trabajador manda como `lob`. */
export function modoVisor(v: DbCelda | undefined, tipoLogico: DbTipoLogico, tipoMotor?: string): ModoVisor {
  if (v === null || v === undefined) return 'nulo'
  if (typeof v === 'boolean') return 'texto'
  if (esColumnaBinaria(tipoLogico, tipoMotor) && HEX.test(v)) return 'binario'
  if (pareceJson(v, tipoLogico)) return 'json'
  return 'texto'
}

/** El texto plano de una celda (el booleano como `true`/`false`, NULL vacío). */
export function textoDeCelda(v: DbCelda | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return v
}

// --- JSON --------------------------------------------------------------------------

/**
 * Re-sangra un JSON YA VALIDADO copiando cada token tal cual (ver la cabecera). Con
 * un texto que no es JSON el resultado no está definido: llama a `formatearJson`.
 */
export function resangrarJson(texto: string, sangria = 2): string {
  const salto = (nivel: number): string => '\n' + ' '.repeat(nivel * sangria)
  let out = ''
  let nivel = 0
  let i = 0
  while (i < texto.length) {
    const ch = texto[i]
    if (esEspacio(texto.charCodeAt(i))) {
      i++
      continue
    }
    if (ch === '"') {
      // Cadena entera, con sus escapes tal cual.
      const k = finCadena(texto, i)
      out += texto.slice(i, k)
      i = k
      continue
    }
    if (ch === '{' || ch === '[') {
      const k = cierreVacio(texto, i)
      if (k >= 0) {
        out += ch + texto[k]
        i = k + 1
        continue
      }
      nivel++
      out += ch + salto(nivel)
    } else if (ch === '}' || ch === ']') {
      nivel = Math.max(0, nivel - 1)
      out += salto(nivel) + ch
    } else if (ch === ',') {
      out += ',' + salto(nivel)
    } else if (ch === ':') {
      out += ': '
    } else {
      // Número, true, false o null: hasta el siguiente delimitador, sin tocarlo.
      const k = finLiteral(texto, i)
      out += texto.slice(i, k)
      i = k
      continue
    }
    i++
  }
  return out
}

/** Dónde termina la cadena JSON que abre la comilla de `i` (tras la comilla de cierre). */
function finCadena(texto: string, i: number): number {
  let k = i + 1
  while (k < texto.length) {
    const d = texto.charCodeAt(k)
    if (d === 92) k += 2
    else if (d === 34) return k + 1
    else k++
  }
  return k
}

/** Si el contenedor que abre en `i` está vacío, la posición de su cierre; si no, -1. */
function cierreVacio(texto: string, i: number): number {
  const cierre = texto[i] === '{' ? '}' : ']'
  let k = i + 1
  while (k < texto.length && esEspacio(texto.charCodeAt(k))) k++
  return texto[k] === cierre ? k : -1
}

/** Dónde termina un número o literal que empieza en `i`: en el siguiente delimitador. */
function finLiteral(texto: string, i: number): number {
  let k = i
  while (k < texto.length) {
    const d = texto[k]
    if (d === ',' || d === '}' || d === ']' || d === ':' || esEspacio(texto.charCodeAt(k))) break
    k++
  }
  return k
}

/** JSON formateado con sangría de 2, o null si el texto no es JSON. */
export function formatearJson(texto: string, sangria = 2): string | null {
  return esJsonValido(texto) ? resangrarJson(texto, sangria) : null
}

// --- Binario -----------------------------------------------------------------------

export interface HexAgrupado {
  texto: string
  /** Bytes del valor. */
  bytes: number
  /** Bytes volcados (como mucho `tope`). */
  mostrados: number
}

function imprimible(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
}

/**
 * Volcado a lo `hexdump -C` de un valor `0x…` (o hex sin prefijo), hasta `tope`
 * bytes. null si no es hex de bytes enteros.
 */
export function hexAgrupado(valor: string, tope: number = TOPE_HEX_VISOR): HexAgrupado | null {
  const hex = valor.startsWith('0x') || valor.startsWith('0X') ? valor.slice(2) : valor
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null
  const bytes = hex.length / 2
  const mostrados = Math.min(bytes, Math.max(0, Math.trunc(tope)))
  const lineas: string[] = []
  for (let desde = 0; desde < mostrados; desde += 16) {
    let linea = desde.toString(16).padStart(8, '0') + '  '
    let ascii = ''
    for (let k = 0; k < 16; k++) {
      if (k === 8) linea += ' '
      const i = desde + k
      if (i < mostrados) {
        const par = hex.slice(i * 2, i * 2 + 2).toLowerCase()
        linea += par + ' '
        ascii += imprimible(parseInt(par, 16))
      } else {
        linea += '   '
      }
    }
    lineas.push(linea + ' |' + ascii + '|')
  }
  return { texto: lineas.join('\n'), bytes, mostrados }
}

// --- Textos -------------------------------------------------------------------------

/** «1 carácter», «12 345 caracteres», «1 byte», «2 048 bytes». */
export function describirLongitud(longitud: number, binario: boolean): string {
  const n = Number.isFinite(longitud) && longitud > 0 ? Math.trunc(longitud) : 0
  if (binario) return `${formatoEntero(n)} ${n === 1 ? 'byte' : 'bytes'}`
  return `${formatoEntero(n)} ${n === 1 ? 'carácter' : 'caracteres'}`
}

/**
 * Longitud de lo que se TIENE de una celda: caracteres (unidades UTF-16, las mismas
 * que cuenta el main al recortar) o bytes del hex.
 */
export function longitudDe(v: DbCelda | undefined, modo: ModoVisor): number {
  if (v === null || v === undefined) return 0
  const t = textoDeCelda(v)
  if (modo === 'binario') return Math.floor((t.length - 2) / 2)
  return t.length
}

/**
 * El tipo que se ENSEÑA de una columna (el tooltip de la cabecera de la rejilla y la del
 * visor): el DECLARADO del catálogo si lo hay (`tipoDeclarado`, pestañas de tabla de Oracle:
 * 'VARCHAR2(40 CHAR)'), y si no, el del trabajador (`tipoMotor`). Solo para enseñar: lo que
 * se DECIDE con el tipo (binaria, qué original se compara, RAW o BLOB al exportar) sigue
 * mirando `tipoMotor`, que es lo que el driver sabe de verdad (ver `DbColumnaResultado`).
 */
export function tipoVisible(col: Pick<DbColumnaResultado, 'tipoMotor' | 'tipoDeclarado'>): string {
  const declarado = typeof col.tipoDeclarado === 'string' ? col.tipoDeclarado.trim() : ''
  return declarado !== '' ? declarado : col.tipoMotor
}

/** Metadatos de la cabecera: «VARCHAR2(40 CHAR) · 12 345 caracteres», «BLOB · NULL». */
export function metadatosVisor(tipoMotor: string, modo: ModoVisor, longitud: number): string {
  const tipo = tipoMotor.trim()
  const partes = tipo ? [tipo] : []
  partes.push(modo === 'nulo' ? 'NULL' : describirLongitud(longitud, modo === 'binario'))
  return partes.join(' · ')
}

/** Aviso de lo que falta: «Se muestran 65 536 de 180 000 caracteres». */
export function avisoParcial(mostrado: number, total: number, binario: boolean): string {
  const unidad = binario ? (total === 1 ? 'byte' : 'bytes') : total === 1 ? 'carácter' : 'caracteres'
  return `Se muestran ${formatoEntero(mostrado)} de ${formatoEntero(total)} ${unidad}`
}

/** Lenguaje de Monaco para el visor (ver la cabecera: el JSON grande va sin colorear). */
export function lenguajeVisor(modo: ModoVisor, largo: number): 'json' | 'plaintext' {
  return modo === 'json' && largo <= TOPE_JSON_COLOREADO ? 'json' : 'plaintext'
}

// --- Volver a encontrar la fila (valor completo de la pestaña de datos) -------------

/**
 * Por qué una tabla sin clave primaria no puede dar el valor completo. ROWID/ctid se
 * descartaron para esta entrega: llegan con la edición de celdas, que los necesita
 * igual, y un ctid de PG cambia con cada UPDATE (VACUUM FULL, HOT…) sin avisar.
 */
export const RAZON_SIN_CLAVE_PRIMARIA =
  'La tabla no tiene clave primaria: no hay forma fiable de volver a encontrar la fila.'

export type ClaveDeFila = { ok: true; valores: DbCelda[] } | { ok: false; error: string }

/**
 * Los valores de la clave primaria de una fila, en el orden de `clavePrimaria` (el que
 * espera `DbPedirValor.clave`). Por NOMBRE EXACTO de columna: en PG `"ID"` e `id` son
 * dos columnas distintas, y casar sin distinguir mayúsculas podría leer la otra. Una
 * celda de la clave que llegó recortada no sirve para buscar (el valor no es el suyo).
 */
export function claveDeFila(
  nombresColumnas: readonly string[],
  clavePrimaria: readonly string[],
  fila: readonly DbCelda[] | undefined,
  recortada: (columna: number) => boolean
): ClaveDeFila {
  if (clavePrimaria.length === 0) return { ok: false, error: RAZON_SIN_CLAVE_PRIMARIA }
  if (!fila) return { ok: false, error: 'La fila ya no está cargada.' }
  const valores: DbCelda[] = []
  for (const pk of clavePrimaria) {
    const c = nombresColumnas.indexOf(pk)
    if (c < 0) return { ok: false, error: `La columna ${pk} de la clave primaria no está en el resultado.` }
    if (recortada(c)) return { ok: false, error: `El valor de ${pk} (clave primaria) llegó recortado.` }
    valores.push(c < fila.length ? fila[c] : null)
  }
  return { ok: true, valores }
}
