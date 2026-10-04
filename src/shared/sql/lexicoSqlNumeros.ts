// =============================================================================
// Números del léxico SQL: dónde acaba el que empieza en `i`, con las reglas de cada dialecto.
// Los de T-SQL se cortan donde los corta el servidor; `hex0x` y `numerosConBase` son banderas.
// Decisiones: docs/decisiones/bd/sql-lexico-y-divisor-compartidos.md
// =============================================================================

import type { ReglasDialecto } from './dialectosSql.ts'
import { esDigito, esHex, parteIdent } from './lexicoSqlCaracteres.ts'

function saltarDigitos(texto: string, desde: number, fin: number): number {
  let j = desde
  while (j < fin && esDigito(texto.charCodeAt(j))) j++
  return j
}

function saltarDigitosYGuiones(texto: string, desde: number, fin: number): number {
  let j = desde
  while (j < fin && (esDigito(texto.charCodeAt(j)) || texto.charCodeAt(j) === 95)) j++
  return j
}

function saltarHex(texto: string, desde: number, fin: number): number {
  let j = desde
  while (j < fin && esHex(texto.charCodeAt(j))) j++
  return j
}

function saltarHexYGuiones(texto: string, desde: number, fin: number): number {
  let j = desde
  while (j < fin && (esHex(texto.charCodeAt(j)) || texto.charCodeAt(j) === 95)) j++
  return j
}

function esExponente(texto: string, j: number, fin: number): boolean {
  return j < fin && (texto[j] === 'e' || texto[j] === 'E')
}

function esSigno(texto: string, k: number, fin: number): boolean {
  return k < fin && (texto[k] === '+' || texto[k] === '-')
}

/** El exponente de T-SQL se lleva la `e` y el signo aunque no traigan dígitos. */
function saltarExponenteTsql(texto: string, desde: number, fin: number): number {
  if (!esExponente(texto, desde, fin)) return desde
  let j = desde + 1
  if (esSigno(texto, j, fin)) j++
  return saltarDigitos(texto, j, fin)
}

/**
 * El número de T-SQL (`numerosTsql`), cortado donde lo corta el servidor: `0x` y CERO o más
 * dígitos hexadecimales; dinero (`dinero`: la llamada empieza detrás del `$`) con dígitos y
 * decimales pero sin exponente; y el decimal con su exponente. Ni `_` ni sufijos.
 */
function leerNumeroTsql(texto: string, i: number, fin: number, dinero: boolean): number {
  if (!dinero && texto.charCodeAt(i) === 48 && i + 1 < fin && (texto[i + 1] === 'x' || texto[i + 1] === 'X')) {
    return saltarHex(texto, i + 2, fin)
  }
  let j = saltarDigitos(texto, i, fin)
  if (j < fin && texto[j] === '.') j = saltarDigitos(texto, j + 1, fin)
  return dinero ? j : saltarExponenteTsql(texto, j, fin)
}

/** `0x1F` de SQLite (`hex0x`) o `0x1F`/`0o17`/`0b101` de PG (`numerosConBase`); -1 si no es de esos. */
function leerNumeroConPrefijo(texto: string, i: number, fin: number, r: ReglasDialecto): number {
  if (texto.charCodeAt(i) !== 48 || i + 2 >= fin) return -1
  const p = texto[i + 1]
  if (r.hex0x && (p === 'x' || p === 'X') && esHex(texto.charCodeAt(i + 2))) return saltarHex(texto, i + 2, fin)
  if (r.numerosConBase && 'xXoObB'.indexOf(p) >= 0 && esHex(texto.charCodeAt(i + 2))) {
    return saltarHexYGuiones(texto, i + 2, fin)
  }
  return -1
}

/** El exponente decimal solo si trae dígitos (`1e` no lo lleva). */
function saltarExponente(texto: string, desde: number, fin: number): number {
  if (!esExponente(texto, desde, fin)) return desde
  let k = desde + 1
  if (esSigno(texto, k, fin)) k++
  return k < fin && esDigito(texto.charCodeAt(k)) ? saltarDigitos(texto, k, fin) : desde
}

/** Oracle: `1.5f` / `2d` (BINARY_FLOAT / BINARY_DOUBLE), si no sigue más identificador. */
function saltarSufijoFlotante(texto: string, j: number, fin: number, r: ReglasDialecto): number {
  if (!r.sufijoFlotante || j >= fin || 'fFdD'.indexOf(texto[j]) < 0) return j
  return j + 1 < fin && parteIdent(texto.charCodeAt(j + 1), r) ? j : j + 1
}

/** Fin del número que empieza en `i`; con `dinero`, `i` está detrás del `$` (T-SQL). */
export function leerNumero(texto: string, i: number, fin: number, r: ReglasDialecto, dinero = false): number {
  if (r.numerosTsql) return leerNumeroTsql(texto, i, fin, dinero)
  const conPrefijo = leerNumeroConPrefijo(texto, i, fin, r)
  if (conPrefijo >= 0) return conPrefijo
  let j = saltarDigitosYGuiones(texto, i, fin)
  // `1..10` es un rango de PL/SQL: el primer punto NO es decimal.
  if (j < fin && texto[j] === '.' && !(j + 1 < fin && texto[j + 1] === '.')) j = saltarDigitosYGuiones(texto, j + 1, fin)
  return saltarSufijoFlotante(texto, saltarExponente(texto, j, fin), fin, r)
}
