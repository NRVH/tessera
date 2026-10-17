// =============================================================================
// Plan de MySQL y MariaDB: el `EXPLAIN FORMAT=JSON` (sin ANALYZE: no ejecuta) y el parseo de su JSON
// a `DbNodoPlan[]`. Los dos servidores comparten la forma (`query_block` → `nested_loop` → `table`)
// con nombres de detalle distintos, que se leen los dos. El texto es el JSON tal cual. Puro y sin
// electron; lo reexporta `planSql.ts`.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbNodoPlan } from '../../../shared/db-explorador-ipc.ts'
import { MAX_NODOS_PLAN, numero, texto } from './planSqlComun.ts'
import { txPlanMysql } from './textosRejilla.ts'

export const PREFIJO_EXPLICAR_MYSQL = 'EXPLAIN FORMAT=JSON\n'

/** `EXPLAIN FORMAT=JSON\n<sentencia>`. */
export function sqlExplicarMysql(sentencia: string): string {
  return PREFIJO_EXPLICAR_MYSQL + sentencia
}

type ObjetoJson = Record<string, unknown>

function esObjeto(v: unknown): v is ObjetoJson {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Las operaciones que son un PASO del plan (con su nombre visible) y cómo lee la tabla cada
// `access_type` viven en `txPlanMysql()`: se leen al armar el plan, en el idioma activo.

/** El detalle de una tabla: su clave, sus condiciones y lo que usa. */
function detalleDeTabla(t: ObjetoJson): string[] {
  const detalle: string[] = []
  const clave = texto(t['key']).trim()
  const x = txPlanMysql()
  if (clave) detalle.push(x.clave(clave))
  const posibles = t['possible_keys']
  if (Array.isArray(posibles) && posibles.length > 0) detalle.push(x.posibles(posibles.map(texto).join(', ')))
  const ref = t['ref']
  if (Array.isArray(ref) && ref.length > 0) detalle.push(x.ref(ref.map(texto).join(', ')))
  const condicion = texto(t['attached_condition']).trim()
  if (condicion) detalle.push(x.condicion(condicion))
  if (t['using_index'] === true) detalle.push(x.soloIndice)
  if (t['using_temporary_table'] === true) detalle.push(x.tablaTemporal)
  if (t['using_filesort'] === true) detalle.push(x.ordenacionArchivo)
  return detalle
}

/** El coste de un nodo: `cost_info.query_cost` o `read_cost` (MySQL) o `cost` (MariaDB). */
function costeDe(o: ObjetoJson): number | undefined {
  const info = o['cost_info']
  if (esObjeto(info)) return numero(info['query_cost']) ?? numero(info['prefix_cost']) ?? numero(info['read_cost'])
  return numero(o['cost'])
}

interface Recorrido {
  nodos: DbNodoPlan[]
  recortado: boolean
}

function nodoDe(clave: string, o: ObjetoJson, id: number, padre: number | null): DbNodoPlan {
  const nodo: DbNodoPlan = { id, padre, operacion: txPlanMysql().operaciones[clave] ?? clave }
  if (clave === 'table') {
    const acceso = texto(o['access_type']).trim()
    if (acceso) nodo.opciones = txPlanMysql().acceso[acceso] ?? acceso
    const nombre = texto(o['table_name']).trim()
    if (nombre) nodo.objeto = nombre
    // MySQL: filas leídas por recorrido; MariaDB: `rows`.
    const filas = numero(o['rows_examined_per_scan']) ?? numero(o['rows'])
    if (filas !== undefined) nodo.filas = filas
    const detalle = detalleDeTabla(o)
    if (detalle.length) nodo.detalle = detalle
  } else if (clave === 'query_block') {
    const id0 = numero(o['select_id'])
    if (id0 !== undefined) nodo.opciones = `SELECT #${id0}`
  }
  const coste = costeDe(o)
  if (coste !== undefined) nodo.coste = coste
  return nodo
}

/** Recorre el JSON: cada clave de `txPlanMysql().operaciones` es un nodo hijo de `padre`; lo demás se atraviesa. */
function recorrer(v: unknown, padre: number | null, r: Recorrido): void {
  if (r.nodos.length >= MAX_NODOS_PLAN) {
    r.recortado = true
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) recorrer(x, padre, r)
    return
  }
  if (!esObjeto(v)) return
  for (const clave of Object.keys(v)) {
    const hijo = v[clave]
    if (Object.hasOwn(txPlanMysql().operaciones, clave) && esObjeto(hijo)) {
      const id = r.nodos.length
      r.nodos.push(nodoDe(clave, hijo, id, padre))
      recorrer(hijo, id, r)
    } else if (typeof hijo === 'object' && hijo !== null) {
      recorrer(hijo, padre, r)
    }
  }
}

/** El JSON de `EXPLAIN FORMAT=JSON` -> nodos y texto. Lanza si no es JSON. */
export function planDesdeJsonMysql(json: string): { nodos: DbNodoPlan[]; texto: string; recortado: boolean } {
  const raiz: unknown = JSON.parse(json)
  const r: Recorrido = { nodos: [], recortado: false }
  recorrer(raiz, null, r)
  return { nodos: r.nodos, texto: JSON.stringify(raiz, null, 2), recortado: r.recortado }
}
