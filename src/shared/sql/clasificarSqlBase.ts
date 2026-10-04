// =============================================================================
// Base del clasificador SQL: la vista sobre los tokens significativos, los nombres, los conjuntos
// de palabras y la clasificación de partida. Las diferencias de gramática que solo mira el
// clasificador viven en `PROPIO` (un `Record` por dialecto, exhaustivo).
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

import { reglasDe, type DialectoSql, type ReglasDialecto } from './dialectosSql.ts'
import type { Clasificacion, ClaseSentencia, RefObjeto } from './clasificarSqlTipos.ts'
import { esSignificativo, type Token } from './lexicoSql.ts'
import { plegarSinComillas } from './identificadoresSql.ts'
import { conjunto } from './conjuntoSql.ts'

export interface Vista {
  t: readonly Token[]
  /** Profundidad de paréntesis de cada token (el `(` y su `)` quedan en la exterior). */
  prof: number[]
  d: DialectoSql
  /** Las reglas de `d`, tomadas y VALIDADAS una vez al crear la vista (`reglasDe`). */
  r: ReglasDialecto
  texto?: string
}

/** La vista de los tokens significativos; valida el dialecto (`reglasDe`). */
export function crearVista(tokens: readonly Token[], d: DialectoSql, texto?: string): Vista {
  const r = reglasDe(d)
  const t = tokens.filter(esSignificativo)
  const prof: number[] = new Array(t.length)
  let p = 0
  for (let i = 0; i < t.length; i++) {
    if (t[i].tipo === 'parenC' && p > 0) p--
    prof[i] = p
    if (t[i].tipo === 'parenA') p++
  }
  return { t, prof, d, r, texto }
}

export function pal(v: Vista, i: number): string | null {
  const t = v.t[i]
  return t && t.tipo === 'palabra' ? t.valor : null
}

export function esParteNombre(t: Token | undefined): t is Token {
  return !!t && (t.tipo === 'palabra' || t.tipo === 'identCitado')
}

function plegar(v: Vista, t: Token): string {
  if (t.tipo === 'identCitado') return t.valor
  const crudo = v.texto !== undefined ? v.texto.slice(t.desde, t.hasta) : t.valor
  return plegarSinComillas(crudo, v.d)
}

export interface NombreLeido {
  partes: string[]
  citado: boolean
  siguiente: number
  dblink?: string
}

/** `a`, `a.b`, `a.b.c`, con `@enlace` opcional. */
export function leerNombre(v: Vista, i: number, conEnlace = true): NombreLeido | null {
  if (!esParteNombre(v.t[i])) return null
  const partes: string[] = []
  let citado = false
  let j = i
  for (;;) {
    const t = v.t[j]
    partes.push(plegar(v, t))
    citado = t.tipo === 'identCitado'
    j++
    const p = v.t[j]
    if (p && p.tipo === 'punto' && esParteNombre(v.t[j + 1])) {
      j++
      continue
    }
    break
  }
  const n: NombreLeido = { partes, citado, siguiente: j }
  const arroba = v.t[j]
  if (conEnlace && arroba && arroba.tipo === 'operador' && arroba.valor === '@') {
    const enlace = leerNombre(v, j + 1, false)
    if (enlace) {
      n.dblink = enlace.partes.join('.')
      n.siguiente = enlace.siguiente
    }
  }
  return n
}

export function refDe(n: NombreLeido): RefObjeto {
  const r: RefObjeto = {
    esquema: n.partes.length >= 2 ? n.partes[n.partes.length - 2] : null,
    nombre: n.partes[n.partes.length - 1],
    citado: n.citado
  }
  if (n.dblink) r.dblink = n.dblink
  return r
}

/** Índice del `)` que cierra el paréntesis que contiene a `i` (o el final). */
export function finDelParentesis(v: Vista, i: number): number {
  const p = v.prof[i]
  for (let k = i + 1; k < v.t.length; k++) if (v.prof[k] < p) return k
  return v.t.length
}

/** Fin del ámbito de una sentencia que empieza en `i`: el de su paréntesis, o el final. */
export function finDeSentencia(v: Vista, i: number): number {
  return v.prof[i] > 0 ? finDelParentesis(v, i) : v.t.length
}

export const DML = conjunto('INSERT UPDATE DELETE MERGE')

/** Diferencias de gramática que solo mira este clasificador (ver `PROPIO`). */
interface PropioDelDialecto {
  /** `ALTER DATABASE` no admite transacción (SQL Server: 226); en PG `ALTER DATABASE … SET` sí. */
  alterDatabaseFueraDeTx: boolean
  /** `REINDEX` lleva el TIPO detrás y esas palabras deciden si admite transacción (PG); en SQLite es un NOMBRE. */
  reindexConTipo: boolean
  /** `REPLACE INTO t …` es un DML, el `INSERT OR REPLACE` de SQLite. */
  replaceEsDml: boolean
  /** `VACUUM … INTO 'archivo'` existe y escribe una copia (SQLite). */
  vacuumInto: boolean
}

/** Por dialecto y exhaustiva: uno nuevo no compila hasta que dé la suya. */
export const PROPIO: Readonly<Record<DialectoSql, PropioDelDialecto>> = {
  oracle: { reindexConTipo: false, replaceEsDml: false, vacuumInto: false, alterDatabaseFueraDeTx: false },
  postgres: { reindexConTipo: true, replaceEsDml: false, vacuumInto: false, alterDatabaseFueraDeTx: false },
  sqlite: { reindexConTipo: false, replaceEsDml: true, vacuumInto: true, alterDatabaseFueraDeTx: false },
  // T-SQL no tiene REINDEX (es ALTER INDEX … REBUILD), ni `REPLACE INTO`, ni VACUUM.
  sqlserver: { reindexConTipo: false, replaceEsDml: false, vacuumInto: false, alterDatabaseFueraDeTx: true }
}

/** La clasificación de partida: `otra`, que cuenta como que escribe (lo desconocido no pasa en solo lectura). */
export function base(verbo: string): Clasificacion {
  return {
    clase: 'otra',
    verbo,
    plsql: false,
    escribe: true,
    sinWhere: false,
    peligro: null,
    tablaUnica: null,
    objetoCreado: null,
    esquemaAfectado: null,
    consultaPura: false,
    devuelveFilas: false,
    noTransaccional: false,
    sesion: null
  }
}

export function lectura(clase: ClaseSentencia, verbo: string, extra: Partial<Clasificacion> = {}): Clasificacion {
  return { ...base(verbo), clase, escribe: false, ...extra }
}
