// =============================================================================
// Referencias a tablas de una sentencia SQL: qué tablas nombra (FROM, JOIN, UPDATE,
// INTO, USING…) con su alias, y cómo se clasifica cada `(` que abre un nivel.
// Puro: depende de `tokensSql` y de `shared/sql`; lo usan `clausulasSql`,
// `estrellaSql`, `contextoSql` y la precarga de FKs.
// Decisiones: docs/decisiones/bd/ui-autocompletado-contexto.md
// =============================================================================

import { descriptorSql } from '../../../../../shared/motores/index.ts'
import { nunca } from '../../../../../shared/nunca.ts'
import { dialectoDeMotor, reglasDeMotor, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { Token } from '../../../../../shared/sql/lexicoSql.ts'
import { RESERVADAS } from '../../../../../shared/sql/palabrasSql.ts'
import { conjunto, es, escrito, esIdent, esPalabra, nombreDe, saltarGrupo, significativos } from './tokensSql.ts'

/** Una tabla (o vista, sinónimo…) que la sentencia nombra, con su alias. */
export interface RefTabla {
  /** Esquema escrito en la sentencia, ya plegado como lo guarda el motor; null si no se calificó. */
  esquema: string | null
  nombre: string
  alias: string | null
  /** La BASE de un nombre de tres partes (`ventas.dbo.t`) en un motor que los admite. */
  base?: string
  /**
   * Cómo se nombra la tabla al calificar una columna, TAL CUAL se escribió: el alias
   * si lo hay, si no el nombre (sin el esquema). Sin `texto` se reconstruye citando.
   */
  expuesto?: string
  /** Va por un enlace de base de datos (`emp@remota`): el catálogo local no la describe. */
  remota?: true
}

/**
 * Palabras que pueden seguir a una tabla del FROM y por tanto NO son su alias.
 * Hace falta además de las reservadas: en Oracle JOIN, LEFT o LIMIT no lo son.
 */
const NO_ALIAS = conjunto(`
  AS JOIN INNER LEFT RIGHT FULL CROSS NATURAL OUTER APPLY LATERAL ON USING
  WHERE GROUP ORDER HAVING UNION INTERSECT MINUS EXCEPT CONNECT START WINDOW
  LIMIT OFFSET FETCH FOR SET VALUES RETURNING RETURN PARTITION SAMPLE
  TABLESAMPLE PIVOT UNPIVOT MODEL WITH WHEN SELECT DEFAULT LOG QUALIFY ONLY
  OVERRIDING INTO FROM THEN ELSE END
`)

/**
 * Palabras tras las que un `(` abre un GRUPO (subconsulta, lista, expresión) y
 * no una llamada a función. Tras cualquier otro identificador, `(` es una llamada.
 */
const PREVIOS_DE_GRUPO = conjunto(`
  IN EXISTS FROM JOIN AS ON USING SELECT WHERE AND OR NOT VALUES SET ANY SOME
  ALL UNION INTERSECT MINUS EXCEPT WHEN THEN ELSE BY HAVING RETURN RETURNING
  LATERAL IS LIKE ILIKE BETWEEN DISTINCT CASE ELSIF IF WHILE PRIOR OVER GROUP
  KEEP FILTER ADD MODIFY INTO WITH
`)

function esNoAlias(valor: string, d: DialectoSql): boolean {
  return NO_ALIAS.has(valor) || RESERVADAS[dialectoDeMotor(d)].has(valor)
}

function leerAlias(
  sig: readonly Token[],
  k: number,
  d: DialectoSql,
  texto: string | undefined
): { alias: string | null; crudo: string | null; fin: number } {
  const t: Token | undefined = sig[k]
  if (t === undefined) return { alias: null, crudo: null, fin: k }
  if (esPalabra(t, 'AS') && esIdent(sig[k + 1])) {
    return { alias: nombreDe(sig[k + 1], d, texto), crudo: escrito(sig[k + 1], d, texto), fin: k + 2 }
  }
  if (t.tipo === 'identCitado') return { alias: t.valor, crudo: escrito(t, d, texto), fin: k + 1 }
  if (t.tipo === 'palabra' && !esNoAlias(t.valor, d)) return { alias: nombreDe(t, d, texto), crudo: escrito(t, d, texto), fin: k + 1 }
  return { alias: null, crudo: null, fin: k }
}

/**
 * ¿Admite el motor nombres de TRES partes `base.esquema.objeto` hacia otra base del
 * mismo servidor? Los que tienen nivel «Bases» en su descriptor (SQL Server).
 */
export function admiteTresPartes(d: DialectoSql): boolean {
  const n = descriptorSql(d).catalogo.nivelBases
  switch (n) {
    case 'ninguno':
      return false
    case 'sinBaseFija':
      return true
    default:
      return nunca(n, 'admiteTresPartes')
  }
}

/** `a.b.c` desde `k` hasta `fin` (exclusivo), como referencia sin alias. */
function refDeCadena(sig: readonly Token[], k: number, fin: number, d: DialectoSql, texto: string | undefined): RefTabla {
  const partes: string[] = []
  for (let j = k; j < fin; j += 2) partes.push(nombreDe(sig[j], d, texto))
  const n = partes.length
  const ref: RefTabla = { esquema: n >= 2 ? partes[n - 2] : null, nombre: partes[n - 1], alias: null }
  // `base.esquema.tabla`: la base solo en un motor de tres partes.
  if (n >= 3 && admiteTresPartes(d)) ref.base = partes[n - 3]
  return ref
}

/** Índice tras la cadena `.b.c` que empieza en `k` (o `k` si no sigue ninguna). */
function finDeCadena(sig: readonly Token[], k: number): number {
  let m = k
  while (es(sig[m], 'punto') && esIdent(sig[m + 1])) m += 2
  return m
}

// --- Clasificación de un `(` -------------------------------------------------

export type ClaseNivel = 'raiz' | 'grupo' | 'funcion' | 'columnasDe' | 'definicion'

export interface ClaseParen {
  clase: ClaseNivel
  /** Palabra que precede al `(` en un grupo (FROM, IN, USING…). */
  previo: string | null
  /** `columnasDe`: la tabla cuya lista de columnas abre el paréntesis. */
  ref: RefTabla | null
}

/** Qué abre el `(` de `sig[i]`: grupo, llamada, lista de columnas de una tabla o definición. */
export function clasificarParen(
  sig: readonly Token[],
  i: number,
  primeraRaiz: string | null,
  d: DialectoSql,
  texto: string | undefined
): ClaseParen {
  const prev = i > 0 ? sig[i - 1] : undefined
  if (prev === undefined) return { clase: 'grupo', previo: null, ref: null }
  if (prev.tipo === 'palabra' && PREVIOS_DE_GRUPO.has(prev.valor)) {
    return { clase: 'grupo', previo: prev.valor, ref: null }
  }
  if (!esIdent(prev)) return { clase: 'grupo', previo: null, ref: null }
  // Inicio de la cadena `a.b.c` que precede al paréntesis.
  let k = i - 1
  while (k >= 2 && sig[k - 1].tipo === 'punto' && esIdent(sig[k - 2])) k -= 2
  const antes = k > 0 ? sig[k - 1] : undefined
  if (esPalabra(antes, 'INTO', 'REFERENCES') || (esPalabra(antes, 'ON') && primeraRaiz === 'CREATE')) {
    return { clase: 'columnasDe', previo: null, ref: refDeCadena(sig, k, i, d, texto) }
  }
  if (esPalabra(antes, 'TABLE') && primeraRaiz === 'CREATE') return { clase: 'definicion', previo: null, ref: null }
  return { clase: 'funcion', previo: null, ref: null }
}

// --- Lectura de una referencia -------------------------------------------------

export interface Lectura {
  ref: RefTabla | null
  fin: number
}

/** Una tabla derivada `(…) x` o una función de tabla `f(…) x`: sin referencia. */
function derivada(sig: readonly Token[], k: number, d: DialectoSql, texto: string | undefined): Lectura {
  return { ref: null, fin: leerAlias(sig, saltarGrupo(sig, k), d, texto).fin }
}

/** Salta un enlace de base de datos `@enlace[.dominio]` tras la tabla y la marca remota. */
function saltarEnlace(sig: readonly Token[], k: number, ref: RefTabla): number {
  if (!(es(sig[k], 'operador') && sig[k].valor === '@' && esIdent(sig[k + 1]))) return k
  ref.remota = true
  return finDeCadena(sig, k + 2)
}

/**
 * Lee una referencia a tabla desde `j`: `[ONLY|LATERAL] a.b[@enlace] [[AS] alias]`.
 * Una tabla derivada o una función de tabla no dan referencia (sus columnas no están
 * en el catálogo). `parenEsFuncion` = false para INTO y UPDATE, donde el `(` tras el
 * nombre es la lista de columnas.
 */
export function leerRef(
  sig: readonly Token[],
  j: number,
  d: DialectoSql,
  texto: string | undefined,
  parenEsFuncion: boolean
): Lectura {
  let k = j
  if (esPalabra(sig[k], 'ONLY', 'LATERAL')) k++
  if (es(sig[k], 'parenA')) return derivada(sig, k, d, texto)
  const t = sig[k]
  if (!esIdent(t) || (t.tipo === 'palabra' && esNoAlias(t.valor, d))) return { ref: null, fin: k }
  const ini = k
  k = finDeCadena(sig, k + 1)
  const ref = refDeCadena(sig, ini, k, d, texto)
  ref.expuesto = escrito(sig[k - 1], d, texto)
  k = saltarEnlace(sig, k, ref)
  if (es(sig[k], 'parenA')) return parenEsFuncion ? derivada(sig, k, d, texto) : { ref, fin: k }
  const a = leerAlias(sig, k, d, texto)
  ref.alias = a.alias
  if (a.crudo !== null) ref.expuesto = a.crudo
  return { ref, fin: a.fin }
}

/** Las tablas de la lista del FROM de `sig[i]`, en orden. */
export function listaDelFrom(sig: readonly Token[], i: number, d: DialectoSql, texto: string | undefined): RefTabla[] {
  const out: RefTabla[] = []
  let l = leerRef(sig, i + 1, d, texto, true)
  if (l.ref) out.push(l.ref)
  while (es(sig[l.fin], 'coma')) {
    l = leerRef(sig, l.fin + 1, d, texto, true)
    if (l.ref) out.push(l.ref)
  }
  return out
}

/** `nombre` en `WITH nombre [(cols)] AS [NOT] [MATERIALIZED] (` o `, nombre AS (`. */
export function esNombreDeCte(sig: readonly Token[], i: number): boolean {
  const prev = sig[i - 1]
  const tras = esPalabra(prev, 'WITH', 'RECURSIVE') || es(prev, 'coma')
  if (!tras || (esPalabra(prev, 'WITH') && esPalabra(sig[i - 2], 'START'))) return false
  let k = i + 1
  if (es(sig[k], 'parenA')) k = saltarGrupo(sig, k)
  if (!esPalabra(sig[k], 'AS')) return false
  k++
  if (esPalabra(sig[k], 'NOT')) k++
  if (esPalabra(sig[k], 'MATERIALIZED')) k++
  return es(sig[k], 'parenA')
}

// --- Todas las referencias de la sentencia --------------------------------------

function primeraPalabra(sig: readonly Token[]): string | null {
  for (const t of sig) if (t.tipo === 'palabra') return t.valor
  return null
}

function unaRef(l: Lectura): RefTabla[] {
  return l.ref ? [l.ref] : []
}

/** Solo el INTO de INSERT/MERGE: el de `SELECT … INTO variable` no es una tabla. */
function esIntoDeTabla(prev: Token | undefined, primera: string | null): boolean {
  return esPalabra(prev, 'INSERT', 'MERGE', 'ALL', 'FIRST', 'THEN', 'ELSE') || (es(prev, 'parenC') && primera === 'INSERT')
}

/** Las tablas que introduce la palabra `sig[i]` (FROM, JOIN, UPDATE, INTO…). */
function refsTrasPalabra(
  sig: readonly Token[],
  i: number,
  primera: string | null,
  d: DialectoSql,
  texto: string | undefined
): RefTabla[] {
  const prev = sig[i - 1]
  switch (sig[i].valor) {
    case 'FROM':
      // `a IS DISTINCT FROM b` (PG) no es una cláusula.
      return esPalabra(prev, 'DISTINCT') ? [] : listaDelFrom(sig, i, d, texto)
    case 'JOIN':
    case 'APPLY':
    case 'USING':
      return unaRef(leerRef(sig, i + 1, d, texto, true))
    case 'UPDATE':
      return esPalabra(prev, 'FOR', 'DO', 'THEN') ? [] : unaRef(leerRef(sig, i + 1, d, texto, false))
    case 'INTO':
      return esIntoDeTabla(prev, primera) ? unaRef(leerRef(sig, i + 1, d, texto, false)) : []
    case 'DELETE':
      return esPalabra(sig[i + 1], 'FROM') ? [] : unaRef(leerRef(sig, i + 1, d, texto, false))
    default:
      return []
  }
}

/** Sin los CTE, sin la tabla de una fila del dialecto (`DUAL`) y sin repetidos. */
function depurarRefs(refs: readonly RefTabla[], ctes: ReadonlySet<string>, d: DialectoSql): RefTabla[] {
  const vistas = new Set<string>()
  const salida: RefTabla[] = []
  const tf = reglasDeMotor(d).tablaFicticia
  for (const r of refs) {
    if (r.esquema === null && ctes.has(r.nombre)) continue
    if (tf && r.nombre === tf.nombre && (r.esquema === null || r.esquema === tf.esquema)) continue
    const clave = JSON.stringify([r.esquema, r.nombre, r.alias])
    if (vistas.has(clave)) continue
    vistas.add(clave)
    salida.push(r)
  }
  return salida
}

/**
 * Tablas que nombra la sentencia: FROM (con su lista), JOIN, APPLY, UPDATE,
 * INSERT/MERGE INTO, USING y el `DELETE t` de Oracle, en todos los niveles y
 * con lo que va tras el cursor. Excluye los CTE y DUAL; sin duplicados.
 */
export function referencias(tokens: readonly Token[], d: DialectoSql, texto?: string): RefTabla[] {
  const sig = significativos(tokens)
  const refs: RefTabla[] = []
  const ctes = new Set<string>()
  // true = nivel de llamada a función: sus FROM (EXTRACT, TRIM…) no son cláusulas.
  const enFuncion: boolean[] = [false]
  const primera = primeraPalabra(sig)
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]
    if (t.tipo === 'parenA') {
      enFuncion.push(clasificarParen(sig, i, primera, d, texto).clase === 'funcion')
      continue
    }
    if (t.tipo === 'parenC') {
      if (enFuncion.length > 1) enFuncion.pop()
      continue
    }
    if (enFuncion[enFuncion.length - 1]) continue
    if (esIdent(t) && esNombreDeCte(sig, i)) ctes.add(nombreDe(t, d, texto))
    if (t.tipo === 'palabra') refs.push(...refsTrasPalabra(sig, i, primera, d, texto))
  }
  return depurarRefs(refs, ctes, d)
}
