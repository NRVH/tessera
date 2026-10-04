// =============================================================================
// Clasificación del DDL: CREATE, DROP, ALTER, TRUNCATE y COMMENT, con el objeto creado, el
// esquema cuyo catálogo cambia, el peligro y si la sentencia admite transacción.
// Los usan `clasificarSqlDesde.ts` y `clasificarSqlPlsql.ts` (`esquemaTrasOn`).
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

import { deDialecto } from './dialectosSql.ts'
import {
  base,
  lectura,
  leerNombre,
  pal,
  PROPIO,
  refDe,
  esParteNombre,
  type NombreLeido,
  type Vista
} from './clasificarSqlBase.ts'
import type { Clasificacion } from './clasificarSqlTipos.ts'
import { conjunto } from './conjuntoSql.ts'

const MODIF_CREATE = conjunto(
  'EDITIONABLE NONEDITIONABLE EDITIONING FORCE NOFORCE UNIQUE BITMAP MULTIVALUE GLOBAL LOCAL PRIVATE ' +
    'TEMPORARY TEMP UNLOGGED PUBLIC SHARED DUPLICATED SHARDED BLOCKCHAIN IMMUTABLE CONSTRAINT ' +
    'RECURSIVE TRUSTED PROCEDURAL DEFAULT SECURE'
)
/** Tipos de objeto de dos palabras: primera -> segundas posibles. */
const SEGUNDA_PALABRA: Record<string, ReadonlySet<string>> = {
  MATERIALIZED: conjunto('VIEW'),
  PACKAGE: conjunto('BODY'),
  TYPE: conjunto('BODY'),
  DATABASE: conjunto('LINK'),
  FOREIGN: conjunto('TABLE DATA'),
  EVENT: conjunto('TRIGGER'),
  JAVA: conjunto('SOURCE CLASS RESOURCE'),
  TEXT: conjunto('SEARCH'),
  ACCESS: conjunto('METHOD'),
  USER: conjunto('MAPPING'),
  OPERATOR: conjunto('CLASS FAMILY'),
  DEFAULT: conjunto('PRIVILEGES')
}
/** Tipos cuyo objeto "de verdad" está tras ON (el esquema afectado es el de la tabla). */
const TIPOS_CON_ON = conjunto('INDEX TRIGGER POLICY RULE STATISTICS')
const DROP_PELIGROSO = conjunto('TABLE USER SCHEMA DATABASE TABLESPACE OWNED')

/** Lee el tipo de objeto (1-3 palabras) desde `j`. */
function leerTipo(v: Vista, j: number): { tipo: string; n: number } | null {
  const w1 = pal(v, j)
  if (!w1) return null
  const palabras = [w1]
  const w2 = pal(v, j + 1)
  const segundas = Object.prototype.hasOwnProperty.call(SEGUNDA_PALABRA, w1) ? SEGUNDA_PALABRA[w1] : null
  if (w2 && segundas && segundas.has(w2)) {
    palabras.push(w2)
    const w3 = pal(v, j + 2)
    if (w1 === 'MATERIALIZED' && w3 === 'LOG') palabras.push(w3)
    else if (w1 === 'FOREIGN' && w2 === 'DATA' && w3 === 'WRAPPER') palabras.push(w3)
    else if (w1 === 'TEXT' && w3) palabras.push(w3)
  }
  return { tipo: palabras.join(' '), n: palabras.length }
}

/** Salta `IF [NOT] EXISTS`, `ONLY` y `CONCURRENTLY`; dice si vio CONCURRENTLY. */
function saltarCalificadores(v: Vista, k: number): { k: number; concurrente: boolean } {
  let concurrente = false
  for (;;) {
    const w = pal(v, k)
    if (w === 'IF' && pal(v, k + 1) === 'NOT' && pal(v, k + 2) === 'EXISTS') k += 3
    else if (w === 'IF' && pal(v, k + 1) === 'EXISTS') k += 2
    else if (w === 'ONLY') k++
    else if (w === 'CONCURRENTLY') {
      concurrente = true
      k++
    } else return { k, concurrente }
  }
}

/** El esquema que nombra `ON` (`CREATE INDEX i ON esq.t`), o null. */
export function esquemaTrasOn(v: Vista, desde: number): string | null {
  const p0 = v.prof[desde] || 0
  for (let k = desde; k < v.t.length; k++) {
    if (v.prof[k] === p0 && pal(v, k) === 'ON') {
      const n = leerNombre(v, k + 1)
      return n ? refDe(n).esquema : null
    }
  }
  return null
}

/** OR REPLACE/ALTER, AND RESOLVE/COMPILE, NO FORCE y los modificadores que preceden al tipo. */
function saltarModificadoresCreate(v: Vista, desde: number): number {
  let j = desde
  for (;;) {
    const w = pal(v, j)
    if (w === 'OR' && (pal(v, j + 1) === 'REPLACE' || pal(v, j + 1) === 'ALTER')) j += 2
    else if (w === 'AND' && (pal(v, j + 1) === 'RESOLVE' || pal(v, j + 1) === 'COMPILE')) j += 2
    else if (w === 'NO' && pal(v, j + 1) === 'FORCE') j += 2
    else if (w && MODIF_CREATE.has(w)) j++
    else return j
  }
}

/** Un esquema o un usuario se afectan a sí mismos; el resto, el esquema del nombre. */
function esquemaDeNombre(tipo: string, n: NombreLeido): string | null {
  return tipo === 'USER' || tipo === 'SCHEMA' ? n.partes[n.partes.length - 1] : refDe(n).esquema
}

/** ¿La sentencia no admite ir dentro de una transacción? (PG y SQL Server: DATABASE, TABLESPACE, CONCURRENTLY…). */
function fueraDeTransaccion(v: Vista, tipo: string, concurrente: boolean): boolean {
  return v.r.sentenciasFueraDeTx && (concurrente || tipo === 'DATABASE' || tipo === 'TABLESPACE' || tipo === 'SUBSCRIPTION')
}

function esquemaAfectadoDeCreate(v: Vista, c: Clasificacion, tipo: string, k: number, n: NombreLeido | null): string | null {
  if (tipo === 'SCHEMA' || tipo === 'USER') return n ? n.partes[n.partes.length - 1] : null
  if (TIPOS_CON_ON.has(tipo) || tipo === 'MATERIALIZED VIEW LOG') {
    return esquemaTrasOn(v, k) || (c.objetoCreado ? c.objetoCreado.esquema : null)
  }
  return c.objetoCreado ? c.objetoCreado.esquema : null
}

export function analizarCreate(v: Vista, i: number): Clasificacion {
  const j = saltarModificadoresCreate(v, i + 1)
  const tipo = leerTipo(v, j)
  const c = base(tipo ? 'CREATE ' + tipo.tipo : 'CREATE')
  c.clase = 'ddl'
  if (!tipo) return c
  const s = saltarCalificadores(v, j + tipo.n)
  let k = s.k
  if (tipo.tipo === 'SCHEMA' && pal(v, k) === 'AUTHORIZATION') k++
  const n = pal(v, k) === 'ON' ? null : leerNombre(v, k)
  if (n) c.objetoCreado = { ...refDe(n), tipo: tipo.tipo, offsetTipo: v.t[j].desde }
  c.esquemaAfectado = esquemaAfectadoDeCreate(v, c, tipo.tipo, k, n)
  c.noTransaccional = fueraDeTransaccion(v, tipo.tipo, s.concurrente)
  return c
}

export function analizarDrop(v: Vista, i: number): Clasificacion {
  let j = i + 1
  if (pal(v, j) === 'PUBLIC') j++
  const tipo = leerTipo(v, j)
  const c = base(tipo ? 'DROP ' + tipo.tipo : 'DROP')
  c.clase = 'ddl'
  if (!tipo) return c
  const s = saltarCalificadores(v, j + tipo.n)
  if (DROP_PELIGROSO.has(tipo.tipo)) c.peligro = 'dropObjeto'
  const n = tipo.tipo === 'OWNED' ? null : leerNombre(v, s.k)
  if (n) c.esquemaAfectado = esquemaDeNombre(tipo.tipo, n)
  c.noTransaccional = fueraDeTransaccion(v, tipo.tipo, s.concurrente)
  return c
}

/** Parámetros de `ALTER SESSION SET a = x b = y` (Oracle): palabras seguidas de `=`. */
function parametrosAlterSession(v: Vista, desde: number): string[] {
  const ps: string[] = []
  for (let k = desde; k < v.t.length - 1; k++) {
    const t = v.t[k]
    const sig = v.t[k + 1]
    if (esParteNombre(t) && sig.tipo === 'operador' && sig.valor === '=') {
      ps.push(t.valor.toLowerCase())
    }
  }
  return ps
}

function analizarAlterSession(v: Vista, i: number): Clasificacion {
  const c = lectura('sesion', 'ALTER SESSION')
  const ps = pal(v, i + 2) === 'SET' ? parametrosAlterSession(v, i + 3) : []
  c.sesion = ps.length > 0 ? { accion: 'set', parametros: ps } : { accion: 'otra', parametros: [] }
  return c
}

/** ALTER TABLE … DETACH PARTITION … CONCURRENTLY no admite transacción. */
function hayConcurrently(v: Vista, desde: number): boolean {
  for (let k = desde; k < v.t.length; k++) if (pal(v, k) === 'CONCURRENTLY') return true
  return false
}

export function analizarAlter(v: Vista, i: number): Clasificacion {
  const w = pal(v, i + 1)
  if (v.r.alterSession && w === 'SESSION') return analizarAlterSession(v, i)
  if (w === 'SYSTEM') {
    const c = base('ALTER SYSTEM')
    c.noTransaccional = v.r.sentenciasFueraDeTx
    return c
  }
  const tipo = leerTipo(v, i + 1)
  const c = base(tipo ? 'ALTER ' + tipo.tipo : 'ALTER')
  c.clase = 'ddl'
  if (!tipo) return c
  const s = saltarCalificadores(v, i + 1 + tipo.n)
  const n = leerNombre(v, s.k)
  if (n) c.esquemaAfectado = esquemaDeNombre(tipo.tipo, n)
  if (tipo.tipo === 'DATABASE' && deDialecto(PROPIO, v.d).alterDatabaseFueraDeTx) c.noTransaccional = true
  if (v.r.sentenciasFueraDeTx && hayConcurrently(v, s.k)) c.noTransaccional = true
  return c
}

export function analizarTruncate(v: Vista, i: number): Clasificacion {
  const c = base('TRUNCATE')
  c.clase = 'ddl'
  c.peligro = 'truncate'
  let k = i + 1
  if (pal(v, k) === 'TABLE') k++
  const s = saltarCalificadores(v, k)
  const n = leerNombre(v, s.k)
  c.esquemaAfectado = n ? refDe(n).esquema : null
  return c
}

export function analizarComment(v: Vista, i: number): Clasificacion {
  const c = base('COMMENT')
  c.clase = 'ddl'
  if (pal(v, i + 1) !== 'ON') return c
  const tipo = leerTipo(v, i + 2)
  if (!tipo) return c
  const n = leerNombre(v, i + 2 + tipo.n)
  if (!n) return c
  // COMMENT ON COLUMN [esquema.]tabla.columna: el esquema es la antepenúltima parte.
  if (tipo.tipo === 'COLUMN') c.esquemaAfectado = n.partes.length >= 3 ? n.partes[n.partes.length - 3] : null
  else c.esquemaAfectado = refDe(n).esquema
  return c
}
