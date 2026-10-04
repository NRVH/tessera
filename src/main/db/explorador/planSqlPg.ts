// =============================================================================
// Plan de PostgreSQL: el `EXPLAIN (FORMAT JSON)` sin ANALYZE, el punto de guardado que protege la
// transacción del usuario y el parseo del JSON a `DbNodoPlan[]` más el texto, que se genera aquí
// como aproximación del formato TEXT de PG. Puro y sin electron; lo reexporta `planSql.ts`.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbNodoPlan } from '../../../shared/db-explorador-ipc.ts'
import { MAX_NODOS_PLAN, numero, texto } from './planSqlComun.ts'

export const PREFIJO_EXPLICAR_PG = 'EXPLAIN (FORMAT JSON)\n'

/** `EXPLAIN (FORMAT JSON)\n<sentencia>`. */
export function sqlExplicarPg(sentencia: string): string {
  return PREFIJO_EXPLICAR_PG + sentencia
}

/** Punto de guardado del EXPLAIN dentro de una transacción del usuario: ROLLBACK TO y RELEASE usan el más reciente. */
export const PUNTO_EXPLICAR_PG = 'tessera_explicar'
export const SQL_PUNTO_PG = `SAVEPOINT ${PUNTO_EXPLICAR_PG}`
export const SQL_VOLVER_AL_PUNTO_PG = `ROLLBACK TO SAVEPOINT ${PUNTO_EXPLICAR_PG}`
export const SQL_SOLTAR_PUNTO_PG = `RELEASE SAVEPOINT ${PUNTO_EXPLICAR_PG}`

type NodoJson = Record<string, unknown>

function esNodo(v: unknown): v is NodoJson {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Condiciones que se enseñan, en el orden de explain.c, con sus nombres de PG. */
const CONDICIONES_PG = [
  'Output',
  'Merge Cond',
  'Hash Cond',
  'Join Filter',
  'Index Cond',
  'Recheck Cond',
  'TID Cond',
  'Filter',
  'One-Time Filter',
  'Sort Key',
  'Presorted Key',
  'Group Key',
  'Cache Key',
  'Workers Planned'
]

function valorCondicion(v: unknown): string {
  if (Array.isArray(v)) return v.map(texto).join(', ')
  return texto(v)
}

/** El nombre de un agregado según su estrategia y su modo parcial. */
function nombreAgregadoPg(n: NodoJson): string {
  const e = texto(n['Strategy'])
  const nombre = e === 'Sorted' ? 'GroupAggregate' : e === 'Hashed' ? 'HashAggregate' : e === 'Mixed' ? 'MixedAggregate' : 'Aggregate'
  const parcial = texto(n['Partial Mode'])
  return parcial === 'Partial' || parcial === 'Finalize' ? `${parcial} ${nombre}` : nombre
}

/** El nombre del nodo antes de su tipo de join y de sus prefijos (`Parallel`, `Async`). */
function nombreBasePg(n: NodoJson, tipo: string): string {
  if (tipo === 'ModifyTable' && n['Operation']) return texto(n['Operation'])
  if (tipo === 'Aggregate') return nombreAgregadoPg(n)
  if (tipo === 'SetOp') return texto(n['Strategy']) === 'Hashed' ? 'HashSetOp' : 'SetOp'
  return tipo
}

/** El nombre del nodo como lo compone el formato TEXT de PG (`Hash Left Join`, `HashAggregate`…). */
export function nombreNodoPg(n: NodoJson): string {
  const tipo = texto(n['Node Type'])
  let nombre = nombreBasePg(n, tipo)
  const union = texto(n['Join Type'])
  if (union && union !== 'Inner' && (tipo === 'Nested Loop' || tipo === 'Merge Join' || tipo === 'Hash Join')) {
    nombre = `${nombre} ${union} Join`.replace(/ Join ([A-Za-z ]+) Join$/, ' $1 Join')
  }
  if (n['Parallel Aware'] === true) nombre = `Parallel ${nombre}`
  if (n['Async Capable'] === true) nombre = `Async ${nombre}`
  return nombre
}

function relacionPg(n: NodoJson): string {
  const rel = texto(n['Relation Name'])
  if (!rel) return ''
  const esquema = texto(n['Schema'])
  return esquema ? `${esquema}.${rel}` : rel
}

/** Lo que va tras el nombre en la línea del nodo (`using idx on t a`, `on "*VALUES*"`…). */
function sufijoNodoPg(n: NodoJson): string {
  let s = ''
  if (texto(n['Scan Direction']) === 'Backward') s += ' Backward'
  const indice = texto(n['Index Name'])
  const rel = relacionPg(n)
  const alias = texto(n['Alias'])
  if (indice && !rel) return `${s} on ${indice}`
  if (indice) s += ` using ${indice}`
  const objeto = rel || texto(n['CTE Name']) || texto(n['Function Name']) || texto(n['Tuplestore Name'])
  if (objeto) {
    s += ` on ${objeto}`
    const base = texto(n['Relation Name']) || objeto
    if (alias && alias !== base) s += ` ${alias}`
  } else if (alias) s += ` on ${alias}`
  return s
}

function costePg(n: NodoJson): string {
  const a = numero(n['Startup Cost'])
  const b = numero(n['Total Cost'])
  const filas = numero(n['Plan Rows'])
  const ancho = numero(n['Plan Width'])
  if (a === undefined || b === undefined) return ''
  return `  (cost=${a.toFixed(2)}..${b.toFixed(2)} rows=${Math.round(filas ?? 0)} width=${Math.round(ancho ?? 0)})`
}

/** Las opciones del nodo para la columna del árbol: el tipo de join, la estrategia… */
function opcionesPg(n: NodoJson): string {
  const partes: string[] = []
  const union = texto(n['Join Type'])
  if (union) partes.push(union)
  const estrategia = texto(n['Strategy'])
  if (estrategia) partes.push(estrategia)
  const op = texto(n['Operation'])
  if (op) partes.push(op)
  if (texto(n['Scan Direction']) === 'Backward') partes.push('Backward')
  if (n['Parallel Aware'] === true) partes.push('Parallel')
  return partes.join(' ')
}

function detallePg(n: NodoJson): string[] {
  const d: string[] = []
  const indice = texto(n['Index Name'])
  if (indice && relacionPg(n)) d.push(`using ${indice}`)
  for (const k of CONDICIONES_PG) {
    const v = n[k]
    if (v === undefined || v === null || v === '') continue
    d.push(`${k}: ${valorCondicion(v)}`)
  }
  return d
}

/** El `DbNodoPlan` de un nodo del JSON. */
function nodoPg(n: NodoJson, id: number, padre: number | null): DbNodoPlan {
  const nodo: DbNodoPlan = { id, padre, operacion: texto(n['Node Type']) }
  const op = opcionesPg(n)
  if (op) nodo.opciones = op
  const objeto = relacionPg(n) || texto(n['Index Name']) || texto(n['CTE Name']) || texto(n['Function Name'])
  if (objeto) nodo.objeto = objeto
  const coste = numero(n['Total Cost'])
  if (coste !== undefined) nodo.coste = coste
  const filas = numero(n['Plan Rows'])
  if (filas !== undefined) nodo.filas = filas
  const ancho = numero(n['Plan Width'])
  // PG da el ANCHO medio de la fila; los bytes totales (lo que da Oracle) son filas × ancho.
  if (filas !== undefined && ancho !== undefined) nodo.bytes = Math.round(filas * ancho)
  const detalle = detallePg(n)
  if (detalle.length) nodo.detalle = detalle
  return nodo
}

/**
 * Añade a `lineas` el texto del nodo con la sangría de explain.c (hijo a profundidad p: 6p-4
 * blancos y «->  »; sus condiciones, a 6p+2), más dos por cada InitPlan/SubPlan por encima.
 * Devuelve el `extra` que heredan sus hijos.
 */
function escribirLineasPg(n: NodoJson, prof: number, extraPadre: number, lineas: string[]): number {
  const subplan = texto(n['Subplan Name'])
  const extra = subplan && prof > 0 ? extraPadre + 2 : extraPadre
  if (subplan && prof > 0) lineas.push(' '.repeat(6 * (prof - 1) + 2 + extraPadre) + subplan)
  const cabeza = prof === 0 ? '' : ' '.repeat(6 * prof - 4 + extra) + '->  '
  lineas.push(cabeza + nombreNodoPg(n) + sufijoNodoPg(n) + costePg(n))
  const sangriaDetalle = (prof === 0 ? 2 : 6 * prof + 2) + extra
  for (const k of CONDICIONES_PG) {
    const v = n[k]
    if (v === undefined || v === null || v === '') continue
    lineas.push(' '.repeat(sangriaDetalle) + `${k}: ${valorCondicion(v)}`)
  }
  return extra
}

/** Lo que acumula el recorrido del plan. */
interface AcumuladoPg {
  nodos: DbNodoPlan[]
  lineas: string[]
  recortado: boolean
}

function visitarPg(n: NodoJson, padre: number | null, prof: number, extraPadre: number, acc: AcumuladoPg): void {
  if (acc.nodos.length >= MAX_NODOS_PLAN) {
    acc.recortado = true
    return
  }
  const id = acc.nodos.length
  acc.nodos.push(nodoPg(n, id, padre))
  const extra = escribirLineasPg(n, prof, extraPadre, acc.lineas)
  const hijos = Array.isArray(n['Plans']) ? n['Plans'] : []
  for (const h of hijos) if (esNodo(h)) visitarPg(h, id, prof + 1, extra, acc)
}

/**
 * El JSON de `EXPLAIN (FORMAT JSON)` -> nodos (preorden, el primero con id 0) y el
 * texto. Lanza si no es un plan (lo convierte en error el gestor).
 */
export function planDesdeJsonPg(json: string): { nodos: DbNodoPlan[]; texto: string; recortado: boolean } {
  const doc: unknown = JSON.parse(json)
  const primero = Array.isArray(doc) ? doc[0] : doc
  const raiz = esNodo(primero) ? primero['Plan'] : undefined
  if (!esNodo(raiz)) throw new Error('El servidor no devolvió un plan.')
  const acc: AcumuladoPg = { nodos: [], lineas: [], recortado: false }
  visitarPg(raiz, null, 0, 0, acc)
  return { nodos: acc.nodos, texto: acc.lineas.join('\n'), recortado: acc.recortado }
}

/** El texto del plan de PG a partir de su JSON (lo mismo que `planDesdeJsonPg(json).texto`). */
export function textoPlanPg(json: string): string {
  return planDesdeJsonPg(json).texto
}
