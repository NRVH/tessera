// =============================================================================
// Plan de ejecución (Explain): el SQL que lo pide y el parseo de lo que devuelve cada motor a
// `DbNodoPlan[]` más texto. Nunca ejecuta la sentencia. Aquí, Oracle (`EXPLAIN PLAN` sobre
// PLAN_TABLE) y la posición del error; PostgreSQL, SQLite y SQL Server viven en `planSql*.ts`
// y se reexportan. Puro y sin electron; lo fija `test-plan-sql.mts`.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbNodoPlan } from '../../../shared/db-explorador-ipc.ts'
import { MAX_NODOS_PLAN, numero, texto } from './planSqlComun.ts'

export * from './planSqlPg.ts'
export * from './planSqlSqlite.ts'
export * from './planSqlSqlserver.ts'
export { MAX_NODOS_PLAN }

// --- Oracle ----------------------------------------------------------------------------

export const PREFIJO_ID_PLAN = 'TESSERA_'
/** STATEMENT_ID es VARCHAR2(30): `TESSERA_` (8) + como mucho 22. */
const ID_PLAN = /^TESSERA_[A-Z0-9_]{1,22}$/
const EXPLAIN_ORACLE = /^EXPLAIN PLAN SET STATEMENT_ID = '(TESSERA_[A-Z0-9_]{1,22})' INTO PLAN_TABLE FOR\n/

/** ¿Tiene la forma cerrada de un id de plan? Va como literal, así que no admite otra. */
export function idPlanValido(id: string): boolean {
  return ID_PLAN.test(id)
}

/** Id de plan a partir de un contador y un sufijo aleatorio (los genera el main). */
export function nuevoIdPlan(n: number, azar: string): string {
  const id = `${PREFIJO_ID_PLAN}${Math.max(0, Math.floor(n)).toString(36).toUpperCase()}_${azar.toUpperCase().replace(/[^A-Z0-9]/g, '')}`
  return id.slice(0, 30)
}

/** El prefijo que antecede a la sentencia (su longitud es la que se resta a la posición del error). */
export function prefijoExplicarOracle(id: string): string {
  if (!idPlanValido(id)) throw new Error('Id de plan no válido.')
  return `EXPLAIN PLAN SET STATEMENT_ID = '${id}' INTO PLAN_TABLE FOR\n`
}

/** `EXPLAIN PLAN … FOR\n<sentencia>`. La sentencia va en su propia línea. */
export function sqlExplicarOracle(id: string, sentencia: string): string {
  return prefijoExplicarOracle(id) + sentencia
}

/** La inversa EXACTA de `sqlExplicarOracle`, o null si `sql` no es eso (el centinela). */
export function extraerExplicarOracle(sql: string): { id: string; sentencia: string } | null {
  const m = EXPLAIN_ORACLE.exec(sql)
  if (!m) return null
  return { id: m[1], sentencia: sql.slice(m[0].length) }
}

/**
 * Los nodos del plan, por el id (bind `:id`). Orden de columnas = contrato con
 * `nodosOracle`. PLAN_TABLE existe desde la 10g con estas columnas (11.2 incluida).
 */
export const SQL_NODOS_ORACLE = [
  'SELECT id, parent_id, operation, options, object_owner, object_name, cost, cardinality, bytes,',
  '       access_predicates, filter_predicates',
  '  FROM plan_table',
  ' WHERE statement_id = :id',
  ' ORDER BY id'
].join('\n')

/** El texto del plan como lo da SQL*Plus. */
export const SQL_TEXTO_ORACLE = "SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', :id, 'TYPICAL'))"

export const AVISO_BINDS_ORACLE =
  'Oracle no mira el valor de los parámetros al explicar (EXPLAIN PLAN no hace «bind peeking»): el plan de la ejecución real puede ser otro.'
export const AVISO_PLAN_RECORTADO = `El plan tiene más de ${MAX_NODOS_PLAN} pasos: se enseñan los primeros.`

/** Filas de `SQL_NODOS_ORACLE` -> nodos. */
export function nodosOracle(filas: readonly (readonly unknown[])[]): DbNodoPlan[] {
  const nodos: DbNodoPlan[] = []
  for (const f of filas) {
    const id = numero(f[0])
    if (id === undefined) continue
    const padre = numero(f[1])
    const nodo: DbNodoPlan = { id, padre: padre === undefined ? null : padre, operacion: texto(f[2]) }
    const opciones = texto(f[3]).trim()
    if (opciones) nodo.opciones = opciones
    const dueno = texto(f[4]).trim()
    const nombre = texto(f[5]).trim()
    if (nombre) nodo.objeto = dueno ? `${dueno}.${nombre}` : nombre
    const coste = numero(f[6])
    if (coste !== undefined) nodo.coste = coste
    const card = numero(f[7])
    if (card !== undefined) nodo.filas = card
    const bytes = numero(f[8])
    if (bytes !== undefined) nodo.bytes = bytes
    const detalle: string[] = []
    const acceso = texto(f[9]).trim()
    const filtro = texto(f[10]).trim()
    // Con los nombres de DBMS_XPLAN («access», «filter»): los que el usuario ve en el texto de al lado.
    if (acceso) detalle.push(`access: ${acceso}`)
    if (filtro) detalle.push(`filter: ${filtro}`)
    if (detalle.length) nodo.detalle = detalle
    nodos.push(nodo)
  }
  return nodos
}

/** Filas de `SQL_TEXTO_ORACLE` -> texto. */
export function textoOracle(filas: readonly (readonly unknown[])[]): string {
  return filas.map((f) => texto(f[0]).replace(/\s+$/, '')).join('\n')
}

// --- Posición del error -------------------------------------------------------------------

/**
 * Offset (puntos de código) relativo a la SENTENCIA a partir del relativo al texto
 * enviado, o `undefined` si cae dentro del prefijo (el error no es de la sentencia).
 */
export function offsetEnSentencia(offsetCp: number | undefined, prefijo: string): number | undefined {
  if (offsetCp === undefined) return undefined
  const o = offsetCp - prefijo.length
  return o >= 0 ? o : undefined
}
