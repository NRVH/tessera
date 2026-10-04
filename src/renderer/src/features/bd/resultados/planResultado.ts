// =============================================================================
// El plan de ejecución de una sentencia (la pestaña «Plan» de la consola): el árbol
// rearmado desde la lista plana del main (un padre roto es raíz; un ciclo no cuelga), las
// filas visibles con lo plegado, el teclado de `treegrid` y el texto que se copia (lo que
// se ve; números sin formato). Dos vistas: árbol y texto del servidor. Neutral y puro.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-resultados.md
// =============================================================================

import type { DbNodoPlan, DbPlan } from '../../../../../shared/db-explorador-ipc.ts'
import { formatoEntero } from '../rejilla/celdasRejilla.ts'

/** Título base de la pestaña del plan (el sufijo ` (2)` lo pone el modelo de pestañas). */
export const TITULO_PLAN = 'Plan'

export interface NodoArbolPlan {
  readonly nodo: DbNodoPlan
  readonly hijos: readonly NodoArbolPlan[]
}

/** Una fila visible del árbol. */
export interface FilaPlan {
  readonly nodo: DbNodoPlan
  /** 0 = raíz. */
  readonly nivel: number
  readonly tieneHijos: boolean
  readonly abierto: boolean
  /** Id del padre en el árbol ARMADO (null en las raíces). */
  readonly padre: number | null
}

/** Anida la lista plana por `padre` (ver la cabecera). Hijos y raíces, por id. */
export function arbolPlan(nodos: readonly DbNodoPlan[]): NodoArbolPlan[] {
  const porId = new Map<number, DbNodoPlan>()
  for (const n of nodos) if (!porId.has(n.id)) porId.set(n.id, n)
  const hijosDe = new Map<number, DbNodoPlan[]>()
  const raices: DbNodoPlan[] = []
  for (const n of porId.values()) {
    const p = n.padre
    if (p === null || p === n.id || !porId.has(p)) {
      raices.push(n)
      continue
    }
    const l = hijosDe.get(p)
    if (l) l.push(n)
    else hijosDe.set(p, [n])
  }
  const porOrden = (a: DbNodoPlan, b: DbNodoPlan): number => a.id - b.id
  const visto = new Set<number>()
  const armar = (n: DbNodoPlan): NodoArbolPlan => {
    visto.add(n.id)
    const hijos = (hijosDe.get(n.id) ?? [])
      .slice()
      .sort(porOrden)
      .filter((h) => !visto.has(h.id))
      .map(armar)
    return { nodo: n, hijos }
  }
  const out = raices.sort(porOrden).map(armar)
  // Lo que quedó sin visitar está en un ciclo sin raíz: cada trozo sale como raíz.
  for (const n of Array.from(porId.values()).sort(porOrden)) if (!visto.has(n.id)) out.push(armar(n))
  return out
}

/** Las filas que se ven, en orden de lectura, con `plegados` cerrados. */
export function filasPlan(raices: readonly NodoArbolPlan[], plegados: ReadonlySet<number>): FilaPlan[] {
  const out: FilaPlan[] = []
  const recorrer = (a: NodoArbolPlan, nivel: number, padre: number | null): void => {
    const tieneHijos = a.hijos.length > 0
    const abierto = tieneHijos && !plegados.has(a.nodo.id)
    out.push({ nodo: a.nodo, nivel, tieneHijos, abierto, padre })
    if (abierto) for (const h of a.hijos) recorrer(h, nivel + 1, a.nodo.id)
  }
  for (const r of raices) recorrer(r, 0, null)
  return out
}

/** Ids de los nodos que tienen hijos («Plegar todo»). */
export function idsConHijos(raices: readonly NodoArbolPlan[]): number[] {
  const out: number[] = []
  const recorrer = (a: NodoArbolPlan): void => {
    if (a.hijos.length > 0) out.push(a.nodo.id)
    for (const h of a.hijos) recorrer(h)
  }
  for (const r of raices) recorrer(r)
  return out
}

/** `TABLE ACCESS FULL`, `Seq Scan`, `Hash Join (Inner)`. */
export function textoOperacion(n: DbNodoPlan): string {
  const op = (n.operacion || '').trim()
  const opc = (n.opciones || '').trim()
  return opc ? `${op} ${opc}` : op
}

/** Un número del plan para la vista: miles con espacio duro y coma decimal. '' si no hay. */
export function numeroPlan(v: number | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ''
  if (Number.isInteger(v)) return formatoEntero(v)
  const [ent, dec] = Math.abs(v).toFixed(2).split('.')
  return `${v < 0 ? '-' : ''}${formatoEntero(Number(ent))},${dec}`
}

/** Los predicados y demás detalle en una línea: `access("ID"=1) · filter(…)`. */
export function textoDetalle(n: DbNodoPlan): string {
  return (n.detalle ?? []).map((d) => d.trim()).filter((d) => d !== '').join(' · ')
}

/** Coste de la raíz (el de todo el plan) y número de pasos. */
export function resumenPlan(plan: Pick<DbPlan, 'nodos'>): { pasos: number; coste: number | null } {
  const raices = arbolPlan(plan.nodos)
  const c = raices.length > 0 ? raices[0].nodo.coste : undefined
  return { pasos: plan.nodos.length, coste: typeof c === 'number' && Number.isFinite(c) ? c : null }
}

const COLUMNAS_TSV = ['Operación', 'Objeto', 'Coste', 'Filas', 'Bytes', 'Detalle']

function crudo(v: number | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
}

function limpioTsv(t: string): string {
  return t.replace(/[\t\r\n]+/g, ' ')
}

/** Las filas VISIBLES como TSV con cabecera, la sangría del árbol en la operación. */
export function planComoTsv(filas: readonly FilaPlan[]): string {
  const lineas = [COLUMNAS_TSV.join('\t')]
  for (const f of filas) {
    const n = f.nodo
    lineas.push(
      [
        '  '.repeat(f.nivel) + limpioTsv(textoOperacion(n)),
        limpioTsv(n.objeto ?? ''),
        crudo(n.coste),
        crudo(n.filas),
        crudo(n.bytes),
        limpioTsv(textoDetalle(n))
      ].join('\t')
    )
  }
  return lineas.join('\n')
}

/**
 * El plan en texto generado desde el árbol (cuando el servidor no da el suyo): una
 * línea por paso con su sangría y, detrás, coste, filas y bytes; los predicados en
 * líneas propias, sangradas bajo su paso.
 */
export function textoPlanGenerado(nodos: readonly DbNodoPlan[]): string {
  const filas = filasPlan(arbolPlan(nodos), new Set())
  const out: string[] = []
  for (const f of filas) {
    const n = f.nodo
    const sangria = '  '.repeat(f.nivel)
    const cifras: string[] = []
    if (typeof n.coste === 'number') cifras.push(`coste=${crudo(n.coste)}`)
    if (typeof n.filas === 'number') cifras.push(`filas=${crudo(n.filas)}`)
    if (typeof n.bytes === 'number') cifras.push(`bytes=${crudo(n.bytes)}`)
    const objeto = n.objeto ? ` ${n.objeto}` : ''
    out.push(`${sangria}${textoOperacion(n)}${objeto}${cifras.length > 0 ? `  (${cifras.join(' ')})` : ''}`)
    for (const d of n.detalle ?? []) if (d.trim() !== '') out.push(`${sangria}    ${d.trim()}`)
  }
  return out.join('\n')
}

/** El texto de la vista «Texto»: el del servidor, o el generado si no lo dio. */
export function textoDelPlan(plan: Pick<DbPlan, 'nodos' | 'texto'>): string {
  const t = (plan.texto || '').replace(/\s+$/, '')
  return t !== '' ? t : textoPlanGenerado(plan.nodos)
}

/**
 * La tecla sobre el árbol: a qué fila va el cursor y qué se pliega o despliega. Null
 * si la tecla no es del árbol. `activo` es el id del nodo con el cursor (null = ninguno:
 * cualquier flecha va a la primera fila).
 */
export function teclaPlan(
  filas: readonly FilaPlan[],
  activo: number | null,
  tecla: string
): { activo: number | null; plegar?: number; desplegar?: number } | null {
  if (filas.length === 0) return null
  const i = activo === null ? -1 : filas.findIndex((f) => f.nodo.id === activo)
  const ir = (k: number): { activo: number } => ({ activo: filas[Math.max(0, Math.min(filas.length - 1, k))].nodo.id })
  switch (tecla) {
    case 'ArrowDown':
      return ir(i < 0 ? 0 : i + 1)
    case 'ArrowUp':
      return ir(i < 0 ? 0 : i - 1)
    case 'Home':
      return ir(0)
    case 'End':
      return ir(filas.length - 1)
    case 'ArrowRight':
      return i < 0 ? ir(0) : teclaDerecha(filas[i], () => ir(i + 1))
    case 'ArrowLeft':
      return i < 0 ? ir(0) : teclaIzquierda(filas[i])
    default:
      return null
  }
}

/** →: despliega el nodo cerrado, o baja al primer hijo si ya está abierto. */
function teclaDerecha(f: FilaPlan, bajar: () => { activo: number }): { activo: number; desplegar?: number } {
  if (!f.tieneHijos) return { activo: f.nodo.id }
  if (!f.abierto) return { activo: f.nodo.id, desplegar: f.nodo.id }
  return bajar()
}

/** ←: pliega el nodo abierto, o sube al padre. */
function teclaIzquierda(f: FilaPlan): { activo: number | null; plegar?: number } {
  if (f.tieneHijos && f.abierto) return { activo: f.nodo.id, plegar: f.nodo.id }
  return { activo: f.padre ?? f.nodo.id }
}
