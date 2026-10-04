// =============================================================================
// Clases de carácter y utilidades de línea del léxico SQL, por código y sin regex por carácter.
// Solo depende de las reglas de dialecto (tipo); las reexporta `lexicoSql.ts`.
// Decisiones: docs/decisiones/bd/sql-lexico-y-divisor-compartidos.md
// =============================================================================

import type { ReglasDialecto } from './dialectosSql.ts'

const C_TAB = 9
const C_LF = 10
const C_VT = 11
const C_FF = 12
const C_CR = 13
const C_ESPACIO = 32
const C_NBSP = 0xa0
const C_BOM = 0xfeff

/** Blanco que NO es salto de línea. NBSP y BOM cuentan como blancos: partirlos como palabra confundía el cursor. */
export function esBlancoDeLinea(c: number): boolean {
  return c === C_ESPACIO || c === C_TAB || c === C_VT || c === C_FF || c === C_NBSP || c === C_BOM
}

export function esSaltoDeLinea(c: number): boolean {
  return c === C_LF || c === C_CR
}

export function esBlanco(c: number): boolean {
  return esBlancoDeLinea(c) || esSaltoDeLinea(c)
}

export function esDigito(c: number): boolean {
  return c >= 48 && c <= 57
}

export function esHex(c: number): boolean {
  return esDigito(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

function esLetraAscii(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

/** Primer carácter de un identificador sin comillas. Lo no ASCII cuenta como letra (ñ, é…). */
export function esInicioIdent(c: number): boolean {
  return esLetraAscii(c) || c === 95 /* _ */ || (c >= 0x80 && c !== C_NBSP && c !== C_BOM)
}

/** Continuación de un identificador sin comillas, con la fila de reglas ya validada. */
export function parteIdent(c: number, r: ReglasDialecto): boolean {
  if (esInicioIdent(c) || esDigito(c) || c === 36 /* $ */) return true
  // SQL Server: `a@b` es un identificador regular (medido), y `@x` una variable.
  if (c === 64 /* @ */) return r.variablesArroba
  return c === 35 /* # */ && r.almohadillaEnIdent
}

/** Caracteres que forman operadores de varios símbolos (`<=`, `||`, `->>`, `@>`…). */
const CARACTERES_OPERADOR: ReadonlySet<number> = new Set([
  43, // +
  45, // -
  42, // *
  47, // /
  60, // <
  62, // >
  61, // =
  126, // ~
  33, // !
  64, // @
  35, // #
  37, // %
  94, // ^
  38, // &
  124, // |
  96, // `
  63 // ?
])

export function esCaracterOperador(c: number): boolean {
  return CARACTERES_OPERADOR.has(c)
}

/** Primer salto de línea (`\r` o `\n`) desde `pos`, o `fin`. */
export function finDeLinea(texto: string, pos: number, fin: number = texto.length): number {
  let i = pos
  while (i < fin && !esSaltoDeLinea(texto.charCodeAt(i))) i++
  return i
}

/** Solo hay blancos entre el inicio de la línea (o `inicio`) y `pos`. */
export function esInicioDeLinea(texto: string, pos: number, inicio = 0): boolean {
  let i = pos - 1
  while (i >= inicio) {
    const c = texto.charCodeAt(i)
    if (esSaltoDeLinea(c)) return true
    if (!esBlancoDeLinea(c)) return false
    i--
  }
  return true
}

/** El resto de la línea desde `pos` es blanco. */
export function restoDeLineaBlanco(texto: string, pos: number, fin: number): boolean {
  let i = pos
  while (i < fin) {
    const c = texto.charCodeAt(i)
    if (esSaltoDeLinea(c)) return true
    if (!esBlancoDeLinea(c)) return false
    i++
  }
  return true
}
