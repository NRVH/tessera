// =============================================================================
// Lectores de cada forma del léxico SQL: cadenas, q-quote, comentarios, dólar-comillas, corchetes,
// `GO` y parámetros de SQLite. Devuelven dónde acaba lo leído; el token lo arma `lexicoSql.ts`.
// Decisiones: docs/decisiones/bd/sql-lexico-y-divisor-compartidos.md
// =============================================================================

import type { ReglasDialecto } from './dialectosSql.ts'
import { esBlanco, esBlancoDeLinea, esDigito, esInicioIdent, esSaltoDeLinea, parteIdent } from './lexicoSqlCaracteres.ts'
import type { Fin, TipoToken, Token } from './lexicoSqlTipos.ts'
import { nunca } from '../nunca.ts'

/** Cadena o identificador delimitado por `q` con el delimitador duplicado como escape. */
export function leerDelimitado(texto: string, i: number, fin: number, q: string): Fin {
  let j = i + 1
  for (;;) {
    const k = texto.indexOf(q, j)
    if (k === -1 || k >= fin) return { hasta: fin, sinCerrar: true }
    if (k + 1 < fin && texto[k + 1] === q) {
      j = k + 2
      continue
    }
    return { hasta: k + 1, sinCerrar: false }
  }
}

/** `E'…'`: la barra escapa el carácter siguiente; `''` también escapa. `i` apunta a la comilla. */
export function leerCadenaE(texto: string, i: number, fin: number): Fin {
  let j = i + 1
  while (j < fin) {
    const c = texto[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === "'") {
      if (j + 1 < fin && texto[j + 1] === "'") {
        j += 2
        continue
      }
      return { hasta: j + 1, sinCerrar: false }
    }
    j++
  }
  return { hasta: fin, sinCerrar: true }
}

const CIERRE_Q: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' }

/**
 * q-quote de Oracle. `i` apunta a la `q`/`Q` (la `n` opcional ya se saltó) y `texto[i+1]` es la
 * comilla. Devuelve null si no es válida (el delimitador es un blanco): `q` es un identificador suelto.
 */
export function leerCadenaQ(texto: string, i: number, fin: number): Fin | null {
  const posDelim = i + 2
  if (posDelim >= fin) return { hasta: fin, sinCerrar: true }
  const delim = texto[posDelim]
  if (esBlanco(delim.charCodeAt(0))) return null
  const cierre = (CIERRE_Q[delim] ?? delim) + "'"
  const k = texto.indexOf(cierre, posDelim + 1)
  if (k === -1 || k + 2 > fin) return { hasta: fin, sinCerrar: true }
  return { hasta: k + 2, sinCerrar: false }
}

/** Comentario de bloque; `i` apunta a la barra. Con `anidan`, los `/*` de dentro abren otro nivel. */
export function leerComentarioBloque(texto: string, i: number, fin: number, anidan: boolean): Fin {
  let j = i + 2
  let prof = 1
  while (j < fin) {
    const c = texto.charCodeAt(j)
    if (anidan && c === 47 && j + 1 < fin && texto.charCodeAt(j + 1) === 42) {
      prof++
      j += 2
    } else if (c === 42 && j + 1 < fin && texto.charCodeAt(j + 1) === 47) {
      prof--
      j += 2
      if (prof === 0) return { hasta: j, sinCerrar: false }
    } else {
      j++
    }
  }
  return { hasta: fin, sinCerrar: true }
}

/**
 * Etiqueta de dólar-comillas que empieza en `i` (el primer `$`): la posición tras el segundo
 * `$`, o -1 si no es una etiqueta (`$1`, `$ `…).
 */
export function finEtiquetaDolar(texto: string, i: number, fin: number): number {
  let j = i + 1
  if (j < fin && texto.charCodeAt(j) === 36) return j + 1 // $$
  if (j >= fin || !esInicioIdent(texto.charCodeAt(j))) return -1
  j++
  while (j < fin) {
    const c = texto.charCodeAt(j)
    if (c === 36) return j + 1
    if (!(esInicioIdent(c) || esDigito(c))) return -1
    j++
  }
  return -1
}

/** Identificador `[…]` de SQLite: llega hasta el PRIMER `]`, sin escape dentro (medido). */
export function leerCorchetes(texto: string, i: number, fin: number): Fin {
  const k = texto.indexOf(']', i + 1)
  if (k === -1 || k >= fin) return { hasta: fin, sinCerrar: true }
  return { hasta: k + 1, sinCerrar: false }
}

function saltarBlancosDeLinea(texto: string, desde: number, fin: number): number {
  let k = desde
  while (k < fin && esBlancoDeLinea(texto.charCodeAt(k))) k++
  return k
}

/** Tras el `GO`: fin de línea, fin del rango o un comentario `--`. */
function restoDeLoteVacio(texto: string, p: number, fin: number): boolean {
  return p >= fin || esSaltoDeLinea(texto.charCodeAt(p)) || (texto.charCodeAt(p) === 45 && p + 1 < fin && texto.charCodeAt(p + 1) === 45)
}

function separadorGo(texto: string, i: number, fin: number, r: ReglasDialecto): 'solo' | 'repetido' | null {
  if (i + 2 > fin || texto.slice(i, i + 2).toUpperCase() !== 'GO') return null
  if (i + 2 < fin && parteIdent(texto.charCodeAt(i + 2), r)) return null
  let k = saltarBlancosDeLinea(texto, i + 2, fin)
  if (restoDeLoteVacio(texto, k, fin)) return 'solo'
  if (k === i + 2 || !esDigito(texto.charCodeAt(k))) return null
  while (k < fin && esDigito(texto.charCodeAt(k))) k++
  return restoDeLoteVacio(texto, saltarBlancosDeLinea(texto, k, fin), fin) ? 'repetido' : null
}

/**
 * ¿La palabra que empieza en `i` (al inicio de su línea) es el separador de lotes del dialecto?
 * 'solo': `GO` y, detrás, blancos o un `--`; 'repetido': `GO n`; null: no lo es (`GOTO`, `go.x`, `GO;`).
 * Un `switch` que cierra con `nunca`: un separador nuevo no compila hasta decir cómo se reconoce.
 */
export function separadorDeLote(
  texto: string,
  i: number,
  fin: number,
  sep: NonNullable<ReglasDialecto['separadorLote']>,
  r: ReglasDialecto
): 'solo' | 'repetido' | null {
  switch (sep) {
    case 'go':
      return separadorGo(texto, i, fin, r)
    default:
      return nunca(sep, 'separadorDeLote')
  }
}

/** Sufijo `(…)` de una variable de SQLite: acaba en el primer `)`; sin él, el `(` no es del nombre. */
function finSufijoParentesis(texto: string, j: number, fin: number): number {
  let k = j + 1
  while (k < fin && texto.charCodeAt(k) !== 41 && !esBlanco(texto.charCodeAt(k))) k++
  return k < fin && texto.charCodeAt(k) === 41 ? k + 1 : j
}

/**
 * Fin de un parámetro por nombre de SQLite (`:x`, `@x`, `$x`) cuyo prefijo está en `i`: los
 * caracteres de identificador, `::` sin más condiciones y, tras al menos uno, un sufijo `(…)`
 * (`sqlite3GetToken`, TK_VARIABLE). -1 si no hay nombre (`@` suelto, `$ `).
 */
export function finVariableSqlite(texto: string, i: number, fin: number, r: ReglasDialecto): number {
  let n = 0
  let j = i + 1
  while (j < fin) {
    const c = texto.charCodeAt(j)
    if (parteIdent(c, r)) {
      n++
      j++
    } else if (c === 40 /* ( */ && n > 0) {
      return finSufijoParentesis(texto, j, fin)
    } else if (c === 58 /* : */ && j + 1 < fin && texto.charCodeAt(j + 1) === 58) {
      j += 2
    } else {
      break
    }
  }
  return n > 0 ? j : -1
}

export function leerPalabra(texto: string, i: number, fin: number, r: ReglasDialecto): number {
  let j = i + 1
  while (j < fin && parteIdent(texto.charCodeAt(j), r)) j++
  return j
}

export function token(
  tipo: TipoToken,
  texto: string,
  desde: number,
  hasta: number,
  inicioDeLinea: boolean,
  sinCerrar = false,
  valor?: string
): Token {
  const t: Token = {
    tipo,
    desde,
    hasta,
    valor: valor !== undefined ? valor : texto.slice(desde, hasta),
    inicioDeLinea
  }
  if (sinCerrar) t.sinCerrar = true
  return t
}

export function cadena(texto: string, desde: number, f: Fin, inicioDeLinea: boolean): Token {
  return token('cadena', texto, desde, f.hasta, inicioDeLinea, f.sinCerrar)
}

/** Contenido de un identificador citado: sin comillas y con el delimitador duplicado -> uno. */
export function valorCitado(texto: string, abre: number, f: Fin, q = '"'): string {
  const fin = f.sinCerrar ? f.hasta : f.hasta - 1
  return texto.slice(abre + 1, fin).split(q + q).join(q)
}

/**
 * ¿El cliente de línea del dialecto tiene metacomandos `\cmd` (psql)? Un `switch` que cierra con
 * `nunca` y no un `=== 'psql'`: el cliente de un dialecto nuevo no compila hasta decirlo.
 */
export function metacomandosConBarra(cliente: ReglasDialecto['comandosCliente']): boolean {
  switch (cliente) {
    case 'psql':
      return true
    case 'sqlplus':
    case 'sqlite3':
    case null:
      return false
    default:
      return nunca(cliente, 'metacomandosConBarra')
  }
}
