// =============================================================================
// Plan de SQLite: `EXPLAIN QUERY PLAN <sentencia>` devuelve filas `[id, parent, notused, detail]`
// en árbol por `parent` (0 = raíz); aquí se convierten en `DbNodoPlan[]` y en el texto del shell
// de SQLite. No lleva coste ni filas: el EQP no los da. Puro; lo reexporta `planSql.ts`.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbNodoPlan } from '../../../shared/db-explorador-ipc.ts'
import { MAX_NODOS_PLAN, numero, texto } from './planSqlComun.ts'

export const PREFIJO_EXPLICAR_SQLITE = 'EXPLAIN QUERY PLAN\n'

/** `EXPLAIN QUERY PLAN\n<sentencia>`. */
export function sqlExplicarSqlite(sentencia: string): string {
  return PREFIJO_EXPLICAR_SQLITE + sentencia
}

/** `SCAN t` / `SEARCH t USING INDEX i (a=?)`: la operación, el objeto y lo demás. */
const PASO_SQLITE = /^(SCAN|SEARCH)\s+(\S+)(?:\s+(.+))?$/

/** Filas del EQP (`[id, parent, notused, detail]`) -> nodos, en el orden en que llegan. */
export function nodosSqlite(filas: readonly (readonly unknown[])[]): { nodos: DbNodoPlan[]; recortado: boolean } {
  const nodos: DbNodoPlan[] = []
  let recortado = false
  for (const f of filas) {
    const id = numero(f[0])
    if (id === undefined) continue
    if (nodos.length >= MAX_NODOS_PLAN) {
      recortado = true
      break
    }
    const padre = numero(f[1])
    const detalle = texto(f[3]).trim()
    const nodo: DbNodoPlan = { id, padre: padre === undefined || padre === 0 ? null : padre, operacion: detalle }
    const m = PASO_SQLITE.exec(detalle)
    if (m) {
      nodo.operacion = m[1]
      nodo.objeto = m[2]
      if (m[3]) nodo.opciones = m[3]
    }
    nodos.push(nodo)
  }
  return { nodos, recortado }
}

/** El texto del plan como lo pinta el shell de SQLite, a partir de las mismas filas. */
export function textoPlanSqlite(filas: readonly (readonly unknown[])[]): string {
  const hijos = new Map<number, Array<{ id: number; detalle: string }>>()
  for (const f of filas) {
    const id = numero(f[0])
    if (id === undefined) continue
    const padre = numero(f[1]) ?? 0
    const lista = hijos.get(padre) ?? []
    lista.push({ id, detalle: texto(f[3]).trim() })
    hijos.set(padre, lista)
  }
  const lineas = ['QUERY PLAN']
  const visitar = (padre: number, sangria: string, prof: number): void => {
    const lista = hijos.get(padre) ?? []
    lista.forEach((h, i) => {
      const ultimo = i === lista.length - 1
      lineas.push(`${sangria}${ultimo ? '`--' : '|--'}${h.detalle}`)
      // Un id no puede colgar de sí mismo; la profundidad acota cualquier ciclo raro.
      if (h.id !== padre && prof < 200) visitar(h.id, sangria + (ultimo ? '   ' : '|  '), prof + 1)
    })
  }
  visitar(0, '', 0)
  return lineas.join('\n')
}
