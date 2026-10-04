// =============================================================================
// Léxico SQL de Oracle, PostgreSQL, SQLite y SQL Server: `tokenizar` y `leerToken`. Puro, sin DOM
// ni `process`, ES2020. Lo usan el renderer (marcas, cursor, avisos) y el main, que es la
// autoridad: vuelve a partir cada sentencia con este mismo código. Offsets en UTF-16 del texto.
// Cada diferencia entre motores sale de las banderas de `dialectosSql.ts`, nunca de comparar `d`.
// Decisiones: docs/decisiones/bd/sql-lexico-y-divisor-compartidos.md
// =============================================================================

import { reglasDe, type DialectoSql, type ReglasDialecto } from './dialectosSql.ts'
import {
  esBlanco,
  esBlancoDeLinea,
  esCaracterOperador,
  esDigito,
  esInicioDeLinea,
  esInicioIdent,
  esSaltoDeLinea,
  finDeLinea,
  parteIdent,
  restoDeLineaBlanco
} from './lexicoSqlCaracteres.ts'
import {
  cadena,
  finEtiquetaDolar,
  finVariableSqlite,
  leerCadenaE,
  leerCadenaQ,
  leerComentarioBloque,
  leerCorchetes,
  leerDelimitado,
  leerPalabra,
  metacomandosConBarra,
  separadorDeLote,
  token,
  valorCitado
} from './lexicoSqlLectores.ts'
import { leerNumero } from './lexicoSqlNumeros.ts'
import type { Token } from './lexicoSqlTipos.ts'

export type { TipoToken, Token } from './lexicoSqlTipos.ts'
export { esBlanco, esInicioDeLinea, esInicioIdent, esSaltoDeLinea, finDeLinea }

/** Carácter de continuación de un identificador sin comillas en el motor `d`. */
export function esParteIdent(c: number, d: DialectoSql): boolean {
  return parteIdent(c, reglasDe(d))
}

/** Firma común de los lectores de un token: el texto, dónde empieza, el fin del rango y sus reglas. */
type Lector = (texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean, c1: number) => Token | null

const leerComentarioOBarra: Lector = (texto, i, fin, r, ini, c1) => {
  const c = texto.charCodeAt(i)
  if (c === 45 && c1 === 45) return token('comentario', texto, i, finDeLinea(texto, i, fin), ini)
  if (c === 47 && c1 === 42) {
    const f = leerComentarioBloque(texto, i, fin, r.comentariosAnidados)
    return token('comentario', texto, i, f.hasta, ini, f.sinCerrar)
  }
  if (c === 47 && r.barraTermina && ini && restoDeLineaBlanco(texto, i + 1, fin)) return token('barraSola', texto, i, i + 1, ini)
  return null
}

const leerMetacomando: Lector = (texto, i, fin, r, ini) => {
  if (texto.charCodeAt(i) !== 92 || !metacomandosConBarra(r.comandosCliente) || !ini) return null
  let f = finDeLinea(texto, i, fin)
  while (f > i && esBlancoDeLinea(texto.charCodeAt(f - 1))) f--
  return token('lineaCliente', texto, i, f, ini)
}

function identCitado(texto: string, i: number, fin: number, ini: boolean, q: string): Token {
  const f = leerDelimitado(texto, i, fin, q)
  return token('identCitado', texto, i, f.hasta, ini, f.sinCerrar, valorCitado(texto, i, f, q))
}

/** SQLite `[x]` (sin escape dentro) o SQL Server `[a]]b]` (`]]` es un `]`). */
function leerIdentCorchetes(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean): Token {
  if (r.corcheteEscapeDoble) return identCitado(texto, i, fin, ini, ']')
  const f = leerCorchetes(texto, i, fin)
  return token('identCitado', texto, i, f.hasta, ini, f.sinCerrar, texto.slice(i + 1, f.sinCerrar ? f.hasta : f.hasta - 1))
}

const leerCitado: Lector = (texto, i, fin, r, ini) => {
  const c = texto.charCodeAt(i)
  if (c === 39) return cadena(texto, i, leerDelimitado(texto, i, fin, "'"), ini)
  if (c === 34) return identCitado(texto, i, fin, ini, '"')
  if (c === 91 && r.identCorchetes) return leerIdentCorchetes(texto, i, fin, r, ini)
  if (c === 96 && r.identAcentoGrave) return identCitado(texto, i, fin, ini, '`')
  return null
}

/** SQL Server: `@x`/`@@x` y `#tmp`/`##glob` son UNA palabra; sin nombre detrás siguen siendo el carácter suelto. */
function leerPalabraConPrefijo(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean, c1: number): Token | null {
  const c = texto.charCodeAt(i)
  if (!((c === 64 && r.variablesArroba) || (c === 35 && r.almohadillaInicial))) return null
  const j = c1 === c ? i + 2 : i + 1
  if (j >= fin || !parteIdent(texto.charCodeAt(j), r)) return null
  let h = j + 1
  while (h < fin && parteIdent(texto.charCodeAt(h), r)) h++
  return token('palabra', texto, i, h, ini, false, texto.slice(i, h).toUpperCase())
}

/** SQLite: `?` y `?NNN` (`bindInterrogacion`), `@x` (`bindArroba`); SQL Server: `@x`/`#tmp` como palabra. */
const leerVariable: Lector = (texto, i, fin, r, ini, c1) => {
  const c = texto.charCodeAt(i)
  if (c === 63 && r.bindInterrogacion) {
    let j = i + 1
    while (j < fin && esDigito(texto.charCodeAt(j))) j++
    return token('bind', texto, i, j, ini)
  }
  if (c === 64 && r.bindArroba) {
    const j = finVariableSqlite(texto, i, fin, r)
    if (j > 0) return token('bind', texto, i, j, ini)
  }
  return leerPalabraConPrefijo(texto, i, fin, r, ini, c1)
}

/** SQL Server: `GO` solo en su línea es el separador de lotes; `GO n`, la palabra marcada. */
function leerGo(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean): Token | null {
  if (r.separadorLote === null || !ini) return null
  const sep = separadorDeLote(texto, i, fin, r.separadorLote, r)
  if (sep === 'solo') return token('separadorLote', texto, i, i + 2, ini, false, 'GO')
  if (sep !== 'repetido') return null
  const t = token('palabra', texto, i, i + 2, ini, false, 'GO')
  t.loteRepetido = true
  return t
}

/** q-quote de Oracle: q'…' / nq'…'. */
function leerQuote(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean, c1: number): Token | null {
  // Solo `n`/`N` o `q`/`Q` pueden abrir una: `| 32` pasa la letra a minúscula.
  const minuscula = texto.charCodeAt(i) | 32
  if (!r.cadenaQ || (minuscula !== 110 && minuscula !== 113)) return null
  const ch = texto[i]
  const q = (ch === 'n' || ch === 'N') && (c1 === 113 || c1 === 81) ? i + 1 : i
  const cq = texto[q]
  if (!((cq === 'q' || cq === 'Q') && q + 1 < fin && texto[q + 1] === "'")) return null
  const f = leerCadenaQ(texto, q, fin)
  return f ? cadena(texto, i, f, ini) : null
}

/** Cadenas con prefijo de una letra: `N'…'` (todos), `E'…'` (PG), `B'…'`/`X'…'` (PG). */
function leerCadenaConPrefijo(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean, c1: number): Token | null {
  if (c1 !== 39) return null
  const ch = texto[i]
  if (ch === 'n' || ch === 'N') return cadena(texto, i, leerDelimitado(texto, i + 1, fin, "'"), ini)
  if (r.cadenaE && (ch === 'e' || ch === 'E')) return cadena(texto, i, leerCadenaE(texto, i + 1, fin), ini)
  if (r.cadenaBits && (ch === 'b' || ch === 'B' || ch === 'x' || ch === 'X')) {
    return cadena(texto, i, leerDelimitado(texto, i + 1, fin, "'"), ini)
  }
  return null
}

/** PG: `U&'…'` y `U&"…"`. */
function leerUnicode(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean, c1: number): Token | null {
  const ch = texto[i]
  if (!r.cadenaUnicode || !(ch === 'u' || ch === 'U') || c1 !== 38 /* & */ || i + 2 >= fin) return null
  const q = texto[i + 2]
  if (q === "'") return cadena(texto, i, leerDelimitado(texto, i + 2, fin, "'"), ini)
  if (q !== '"') return null
  const f = leerDelimitado(texto, i + 2, fin, '"')
  return token('identCitado', texto, i, f.hasta, ini, f.sinCerrar, valorCitado(texto, i + 2, f))
}

const leerPalabraOCadena: Lector = (texto, i, fin, r, ini, c1) => {
  if (!esInicioIdent(texto.charCodeAt(i))) return null
  const especial =
    leerGo(texto, i, fin, r, ini) ??
    leerQuote(texto, i, fin, r, ini, c1) ??
    leerCadenaConPrefijo(texto, i, fin, r, ini, c1) ??
    leerUnicode(texto, i, fin, r, ini, c1)
  if (especial) return especial
  const h = leerPalabra(texto, i, fin, r)
  return token('palabra', texto, i, h, ini, false, texto.slice(i, h).toUpperCase())
}

/** `.5` también; en el rango `1..10` de PL/SQL el `.10` que sigue al primer punto NO es un decimal. */
function leerNumeroToken(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean, c1: number, inicio: number): Token | null {
  const c = texto.charCodeAt(i)
  const empieza = esDigito(c) || (c === 46 && c1 >= 48 && c1 <= 57 && !(i > inicio && texto.charCodeAt(i - 1) === 46))
  return empieza ? token('numero', texto, i, leerNumero(texto, i, fin, r), ini) : null
}

/** SQL Server: `$12.50` es UN número (money) y `$action`/`$identity` UNA palabra. */
function leerDinero(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean, c1: number): Token | null {
  if (esDigito(c1) || (c1 === 46 && i + 2 < fin && esDigito(texto.charCodeAt(i + 2)))) {
    return token('numero', texto, i, leerNumero(texto, i + 1, fin, r, true), ini)
  }
  if (c1 < 0 || !esInicioIdent(c1)) return null
  const h = leerPalabra(texto, i + 1, fin, r)
  return token('palabra', texto, i, h, ini, false, texto.slice(i, h).toUpperCase())
}

/** PG: `$tag$…$tag$` y `$$…$$`; sin cierre, llega al final del rango. */
function leerDolarComillas(texto: string, i: number, fin: number, ini: boolean): Token | null {
  const finEtiqueta = finEtiquetaDolar(texto, i, fin)
  if (finEtiqueta <= 0) return null
  const etiqueta = texto.slice(i, finEtiqueta)
  const k = texto.indexOf(etiqueta, finEtiqueta)
  if (k === -1 || k + etiqueta.length > fin) return token('cadena', texto, i, fin, ini, true)
  return token('cadena', texto, i, k + etiqueta.length, ini)
}

/** `$`: dinero o pseudo-columna (SQL Server), parámetro por nombre (SQLite), bind posicional o dólar-comillas (PG). */
const leerDolar: Lector = (texto, i, fin, r, ini, c1) => {
  if (texto.charCodeAt(i) !== 36) return null
  const dinero = r.literalDinero ? leerDinero(texto, i, fin, r, ini, c1) : null
  if (dinero) return dinero
  if (r.bindDolarNombre) {
    const j = finVariableSqlite(texto, i, fin, r)
    if (j > 0) return token('bind', texto, i, j, ini)
  }
  if (r.bindDolar && c1 >= 48 && c1 <= 57) {
    let j = i + 1
    while (j < fin && esDigito(texto.charCodeAt(j))) j++
    return token('bind', texto, i, j, ini)
  }
  const dolares = r.cadenaDolar ? leerDolarComillas(texto, i, fin, ini) : null
  return dolares ?? token('operador', texto, i, i + 1, ini)
}

/** `:x`/`:1` (Oracle y SQLite) y `:"x"` (Oracle): el bind cuyo prefijo `:` está en `i`. */
function leerBindDosPuntos(texto: string, i: number, fin: number, r: ReglasDialecto, ini: boolean, c1: number): Token | null {
  // `:"x"` es un bind citado de Oracle; con las variables de SQLite no es un parámetro.
  if (c1 === 34 && !r.bindDolarNombre) {
    const f = leerDelimitado(texto, i + 1, fin, '"')
    return token('bind', texto, i, f.hasta, ini, f.sinCerrar)
  }
  if (!(esInicioIdent(c1) || esDigito(c1))) return null
  if (r.bindDolarNombre) {
    const k = finVariableSqlite(texto, i, fin, r)
    if (k > 0) return token('bind', texto, i, k, ini)
  }
  let j = i + 2
  while (j < fin && parteIdent(texto.charCodeAt(j), r)) j++
  return token('bind', texto, i, j, ini)
}

/** `:` — `:=` y `::` son operadores; después, bind si el dialecto los tiene, y si no, el operador suelto. */
const leerDosPuntos: Lector = (texto, i, fin, r, ini, c1) => {
  if (texto.charCodeAt(i) !== 58) return null
  if (c1 === 61 || c1 === 58) return token('operador', texto, i, i + 2, ini)
  const bind = r.bindDosPuntos && c1 >= 0 ? leerBindDosPuntos(texto, i, fin, r, ini, c1) : null
  return bind ?? token('operador', texto, i, i + 1, ini)
}

/** Puntuación de un carácter, operadores de varios símbolos y cualquier otro carácter suelto. */
function leerSimbolo(texto: string, i: number, fin: number, ini: boolean): Token {
  switch (texto.charCodeAt(i)) {
    case 59:
      return token('puntoYComa', texto, i, i + 1, ini)
    case 40:
      return token('parenA', texto, i, i + 1, ini)
    case 41:
      return token('parenC', texto, i, i + 1, ini)
    case 46:
      return token('punto', texto, i, i + 1, ini)
    case 44:
      return token('coma', texto, i, i + 1, ini)
  }
  let j = i + 1
  if (esCaracterOperador(texto.charCodeAt(i))) {
    while (j < fin && esCaracterOperador(texto.charCodeAt(j))) {
      // Un operador nunca se come el inicio de un comentario.
      const cn = j + 1 < fin ? texto.charCodeAt(j + 1) : -1
      const cj = texto.charCodeAt(j)
      if ((cj === 45 && cn === 45) || (cj === 47 && cn === 42)) break
      j++
    }
  }
  return token('operador', texto, i, j, ini)
}

/**
 * El lector de cada carácter ASCII que empieza un token propio. Cada lector solo reconoce su
 * clase de carácter y las clases son disjuntas, así que elegirlo por el primer carácter da lo
 * mismo que probarlos todos en cadena; y `tokenizar` corre en cada tecla, donde probar nueve
 * funciones por token (una coma pasaba por ocho antes de llegar a `leerSimbolo`) costaba un 20 %.
 */
const LECTORES_ASCII: Array<Lector | undefined> = new Array<Lector | undefined>(128)
for (let c = 0; c < 128; c++) if (esInicioIdent(c)) LECTORES_ASCII[c] = leerPalabraOCadena
for (const [lector, caracteres] of [
  [leerComentarioOBarra, '-/'],
  [leerMetacomando, '\\'],
  [leerCitado, `'"[\``],
  [leerVariable, '?@#'],
  [leerDolar, '$'],
  [leerDosPuntos, ':']
] as Array<[Lector, string]>) {
  for (let k = 0; k < caracteres.length; k++) LECTORES_ASCII[caracteres.charCodeAt(k)] = lector
}

/**
 * Un lector cede (null) cuando su carácter no abre nada en el dialecto (`@` sin nombre, `[` sin
 * corchetes, `-` que no es comentario): entonces queda el número (`.5`) y, al final, el símbolo.
 */
function leerTokenEn(texto: string, i: number, fin: number, r: ReglasDialecto, inicio: number): Token {
  const ini = esInicioDeLinea(texto, i, inicio)
  const c1 = i + 1 < fin ? texto.charCodeAt(i + 1) : -1
  const c = texto.charCodeAt(i)
  const lector = c < 128 ? LECTORES_ASCII[c] : esInicioIdent(c) ? leerPalabraOCadena : undefined
  return (
    (lector ? lector(texto, i, fin, r, ini, c1) : null) ??
    leerNumeroToken(texto, i, fin, r, ini, c1, inicio) ??
    leerSimbolo(texto, i, fin, ini)
  )
}

/**
 * Lee el token que empieza en `pos` o después (se saltan los blancos); null si no queda nada
 * antes de `fin`. `inicio` es el principio del rango tokenizado y cuenta como inicio de línea.
 * Recibe la FILA de reglas y no el dialecto: quien la llama ya la validó con `reglasDe`.
 */
export function leerToken(texto: string, pos: number, r: ReglasDialecto, inicio = 0, fin: number = texto.length): Token | null {
  let i = pos
  while (i < fin && esBlanco(texto.charCodeAt(i))) i++
  return i >= fin ? null : leerTokenEn(texto, i, fin, r, inicio)
}

/**
 * Tokeniza `[desde, hasta)` de `texto` como si fuera un texto independiente.
 * Los offsets de los tokens son del texto COMPLETO.
 */
export function tokenizar(texto: string, d: DialectoSql, desde = 0, hasta: number = texto.length): Token[] {
  // Valida el dialecto ANTES de nada, también con un rango vacío.
  const r = reglasDe(d)
  const fin = Math.min(hasta, texto.length)
  const tokens: Token[] = []
  let pos = Math.max(0, desde)
  for (;;) {
    const t = leerToken(texto, pos, r, desde, fin)
    if (!t) break
    tokens.push(t)
    pos = t.hasta
  }
  return tokens
}

/** Los comentarios no cuentan para nada que no sea pintarlos. */
export function esSignificativo(t: Token): boolean {
  return t.tipo !== 'comentario'
}
