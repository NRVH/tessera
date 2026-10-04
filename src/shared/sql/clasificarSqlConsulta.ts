// =============================================================================
// Clasificación de consultas y DML: SELECT (con su tabla única y `SELECT … INTO`), WITH y
// INSERT/UPDATE/DELETE/MERGE (con su WHERE y RETURNING). Los usa `clasificarSqlDesde.ts`.
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

import {
  base,
  DML,
  esParteNombre,
  finDeSentencia,
  finDelParentesis,
  lectura,
  leerNombre,
  pal,
  refDe,
  type Vista
} from './clasificarSqlBase.ts'
import type { Clasificacion, RefObjeto } from './clasificarSqlTipos.ts'
import { conjunto } from './conjuntoSql.ts'

const OPERACIONES_CONJUNTO = conjunto('UNION INTERSECT MINUS EXCEPT')
/** Lo que puede seguir a la tabla de un SELECT de una sola tabla. */
const TRAS_TABLA_UNICA = conjunto(
  'WHERE GROUP ORDER HAVING CONNECT START UNION INTERSECT MINUS EXCEPT FETCH OFFSET LIMIT FOR WINDOW'
)
/** Palabras que NO pueden ser el alias de la tabla. */
const NO_ALIAS = conjunto(
  'WHERE GROUP ORDER HAVING CONNECT START UNION INTERSECT MINUS EXCEPT FETCH OFFSET LIMIT FOR WINDOW ' +
    'JOIN INNER LEFT RIGHT FULL CROSS NATURAL OUTER LATERAL PARTITION SAMPLE TABLESAMPLE PIVOT UNPIVOT ' +
    'MODEL VERSIONS AS ON USING WITH SUBPARTITION'
)
const EFECTOS = conjunto('NEXTVAL SETVAL')

function tieneForUpdate(v: Vista, desde: number, hasta: number): boolean {
  for (let k = desde; k < hasta; k++) {
    if (pal(v, k) !== 'FOR') continue
    const a = pal(v, k + 1)
    const b = pal(v, k + 2)
    if (a === 'UPDATE' || a === 'SHARE') return true
    if (a === 'NO' && b === 'KEY') return true
    if (a === 'KEY' && b === 'SHARE') return true
  }
  return false
}

function tieneEfectos(v: Vista, desde: number, hasta: number): boolean {
  for (let k = desde; k < hasta; k++) {
    const w = pal(v, k)
    if (w && EFECTOS.has(w)) return true
  }
  return false
}

/** Un UNION a este nivel o por fuera (`(SELECT … FROM a) UNION (…)`) lee más de una tabla. */
function hayOperacionDeConjunto(v: Vista, p0: number): boolean {
  for (let k = 0; k < v.t.length; k++) {
    const w = pal(v, k)
    if (w && v.prof[k] <= p0 && OPERACIONES_CONJUNTO.has(w)) return true
  }
  return false
}

function indiceDeFrom(v: Vista, i: number, fin: number, p0: number): number {
  for (let k = i + 1; k < fin; k++) {
    if (v.prof[k] === p0 && pal(v, k) === 'FROM') return k
  }
  return -1
}

/** Salta el alias de la tabla desde `k`; null si un `AS` no trae nombre detrás. */
function saltarAlias(v: Vista, k: number): number | null {
  const tk = v.t[k]
  if (pal(v, k) === 'AS') return esParteNombre(v.t[k + 1]) ? k + 2 : null
  if (tk && tk.tipo === 'identCitado') return k + 1
  if (tk && tk.tipo === 'palabra' && !NO_ALIAS.has(tk.valor)) return k + 1
  return k
}

function tablaUnicaDe(v: Vista, i: number): RefObjeto | null {
  const p0 = v.prof[i]
  const fin = finDeSentencia(v, i)
  if (hayOperacionDeConjunto(v, p0)) return null
  const iFrom = indiceDeFrom(v, i, fin, p0)
  if (iFrom < 0) return null
  const n = leerNombre(v, iFrom + 1)
  if (!n || n.partes.length > 2) return null
  if (!n.citado && n.partes[n.partes.length - 1].toUpperCase() === 'DUAL') return null
  const k = saltarAlias(v, n.siguiente)
  if (k === null) return null
  if (k >= fin) return refDe(n)
  const sig = v.t[k]
  if (sig.tipo === 'parenC') return refDe(n)
  if (sig.tipo === 'palabra' && TRAS_TABLA_UNICA.has(sig.valor)) return refDe(n)
  return null
}

/** PG: `SELECT … INTO nueva_tabla FROM …` crea una tabla (DDL); null si no es el caso. */
function selectIntoCreaTabla(v: Vista, i: number, fin: number): Clasificacion | null {
  const p0 = v.prof[i]
  for (let k = i + 1; k < fin; k++) {
    if (v.prof[k] !== p0) continue
    const w = pal(v, k)
    if (w === 'FROM') break
    if (w !== 'INTO') continue
    let j = k + 1
    while (pal(v, j) === 'TEMPORARY' || pal(v, j) === 'TEMP' || pal(v, j) === 'UNLOGGED' || pal(v, j) === 'TABLE') j++
    const n = leerNombre(v, j)
    const c = base('SELECT INTO')
    c.clase = 'ddl'
    if (n) {
      const ref = refDe(n)
      c.objetoCreado = { ...ref, tipo: 'TABLE', offsetTipo: v.t[k].desde }
      c.esquemaAfectado = ref.esquema
    }
    return c
  }
  return null
}

export function analizarSelect(v: Vista, i: number): Clasificacion {
  const fin = finDeSentencia(v, i)
  if (v.r.selectIntoCreaTabla) {
    const creaTabla = selectIntoCreaTabla(v, i, fin)
    if (creaTabla) return creaTabla
  }
  const bloqueo = tieneForUpdate(v, i, v.t.length)
  return lectura(bloqueo ? 'bloqueo' : 'consulta', 'SELECT', {
    devuelveFilas: true,
    consultaPura: !bloqueo && !tieneEfectos(v, 0, v.t.length),
    tablaUnica: tablaUnicaDe(v, i)
  })
}

export function analizarDml(v: Vista, iv: number, fin: number): Clasificacion {
  const verbo = pal(v, iv) || ''
  const p0 = v.prof[iv]
  let hayWhere = false
  let hayReturning = false
  for (let k = iv + 1; k < fin; k++) {
    if (v.prof[k] !== p0) continue
    const w = pal(v, k)
    if (w === 'WHERE') hayWhere = true
    else if (w === 'RETURNING') hayReturning = true
  }
  const c = base(verbo)
  c.clase = 'dml'
  c.sinWhere = (verbo === 'UPDATE' || verbo === 'DELETE') && !hayWhere
  c.peligro = c.sinWhere ? 'dmlSinWhere' : null
  // En Oracle, RETURNING en SQL exige INTO (solo PL/SQL): no devuelve un conjunto.
  c.devuelveFilas = v.r.returningDevuelveFilas && hayReturning
  return c
}

/** Índice del verbo principal (SELECT, VALUES, TABLE o un DML) tras las CTE, o -1. */
function verboPrincipalDeWith(v: Vista, i: number): number {
  const p0 = v.prof[i]
  for (let k = i + 1; k < v.t.length; k++) {
    if (v.prof[k] !== p0) continue
    const w = pal(v, k)
    if (w === 'SELECT' || w === 'VALUES' || w === 'TABLE' || (w && DML.has(w))) return k
  }
  return -1
}

/** CTE que modifica datos (PG): `WITH x AS (DELETE … RETURNING *) SELECT …`. */
function cteQueModifica(v: Vista, i: number): Clasificacion | null {
  const p0 = v.prof[i]
  for (let k = i + 1; k < v.t.length; k++) {
    const w = pal(v, k)
    const prev = v.t[k - 1]
    if (w && DML.has(w) && v.prof[k] > p0 && prev && prev.tipo === 'parenA') {
      const c = analizarDml(v, k, finDelParentesis(v, k))
      c.devuelveFilas = true
      return c
    }
  }
  return null
}

export function analizarWith(v: Vista, i: number): Clasificacion {
  const iPrincipal = verboPrincipalDeWith(v, i)
  const wp = iPrincipal >= 0 ? pal(v, iPrincipal) : null
  if (wp && DML.has(wp)) return { ...analizarDml(v, iPrincipal, v.t.length), tablaUnica: null }
  const cte = cteQueModifica(v, i)
  if (cte) return cte
  const bloqueo = tieneForUpdate(v, i, v.t.length)
  return lectura(bloqueo ? 'bloqueo' : 'consulta', wp || 'SELECT', {
    devuelveFilas: true,
    consultaPura: !bloqueo && !tieneEfectos(v, 0, v.t.length)
  })
}
