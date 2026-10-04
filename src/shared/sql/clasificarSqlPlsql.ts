// =============================================================================
// Bloques y unidades de PL/SQL de Oracle: `CREATE [OR REPLACE] PROCEDURE|FUNCTION|PACKAGE|…` es
// DDL con `plsql: true`; DECLARE, BEGIN y `<<etiqueta>>` son la clase `plsql`. Solo terminan en `/`.
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

import { reglasDe, type DialectoSql } from './dialectosSql.ts'
import { base, crearVista, leerNombre, pal, refDe, type Vista } from './clasificarSqlBase.ts'
import { esquemaTrasOn } from './clasificarSqlDdl.ts'
import type { Clasificacion } from './clasificarSqlTipos.ts'
import type { Token } from './lexicoSql.ts'

interface UnidadPlsql {
  tipo: string
  iTipo: number
  iNombre: number
}

/** Salta `OR REPLACE`, `EDITIONABLE|NONEDITIONABLE`, `AND COMPILE|RESOLVE` y `NOFORCE` tras el CREATE. */
function saltarModificadoresPlsql(v: Vista): number {
  let j = 1
  for (;;) {
    const w = pal(v, j)
    if (w === 'OR' && pal(v, j + 1) === 'REPLACE') j += 2
    else if (w === 'EDITIONABLE' || w === 'NONEDITIONABLE' || w === 'NOFORCE') j++
    else if (w === 'AND' && (pal(v, j + 1) === 'RESOLVE' || pal(v, j + 1) === 'COMPILE')) j += 2
    else return j
  }
}

function unidadJava(v: Vista, j: number): UnidadPlsql {
  let k = j + 1
  let tipo = 'JAVA'
  const w2 = pal(v, k)
  if (w2 === 'SOURCE' || w2 === 'CLASS' || w2 === 'RESOURCE') {
    tipo += ' ' + w2
    k++
  }
  if (pal(v, k) === 'NAMED') k++
  return { tipo, iTipo: j, iNombre: k }
}

/** `CREATE [OR REPLACE] [EDITIONABLE|NONEDITIONABLE] [AND COMPILE] PROCEDURE|…`. */
function unidadPlsql(v: Vista): UnidadPlsql | null {
  if (pal(v, 0) !== 'CREATE') return null
  const j = saltarModificadoresPlsql(v)
  const w = pal(v, j)
  if (w === 'PROCEDURE' || w === 'FUNCTION' || w === 'TRIGGER' || w === 'LIBRARY') return { tipo: w, iTipo: j, iNombre: j + 1 }
  if (w === 'PACKAGE' || w === 'TYPE') {
    return pal(v, j + 1) === 'BODY' ? { tipo: w + ' BODY', iTipo: j, iNombre: j + 2 } : { tipo: w, iTipo: j, iNombre: j + 1 }
  }
  return w === 'JAVA' ? unidadJava(v, j) : null
}

/**
 * ¿Estos tokens (significativos, desde el inicio de la sentencia) abren un
 * bloque PL/SQL de Oracle, que solo termina en `/` o en el fin del texto?
 */
export function esInicioBloquePlsql(tokens: readonly Token[], d: DialectoSql): boolean {
  if (!reglasDe(d).bloquesPlsql) return false
  const v = crearVista(tokens, d)
  const t0 = v.t[0]
  if (!t0) return false
  if (t0.tipo === 'operador' && t0.valor.indexOf('<<') === 0) return true
  const w = pal(v, 0)
  if (w === 'DECLARE' || w === 'BEGIN') return true
  return unidadPlsql(v) !== null
}

/** La clasificación de una unidad o un bloque PL/SQL de Oracle (`esInicioBloquePlsql` ya dijo que lo es). */
export function clasificarPlsql(v: Vista): Clasificacion {
  const u = unidadPlsql(v)
  if (u) {
    const c = base('CREATE ' + u.tipo)
    c.clase = 'ddl'
    c.plsql = true
    const n = leerNombre(v, u.iNombre)
    if (n) {
      const ref = refDe(n)
      c.objetoCreado = { ...ref, tipo: u.tipo, offsetTipo: v.t[u.iTipo].desde }
      c.esquemaAfectado = ref.esquema
      if (u.tipo === 'TRIGGER') c.esquemaAfectado = esquemaTrasOn(v, u.iNombre) || ref.esquema
    }
    return c
  }
  const c = base(pal(v, 0) === 'DECLARE' ? 'DECLARE' : 'BEGIN')
  c.clase = 'plsql'
  c.plsql = true
  return c
}
