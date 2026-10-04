// =============================================================================
// Plan de SQL Server: `SET SHOWPLAN_XML ON`, la sentencia y `OFF` en tres lotes; cada lote trae
// un XML con un `StmtSimple` por sentencia y los `RelOp` anidados del árbol. Se lee con un
// recorrido de etiquetas (el formato es fijo y sin CDATA) y el texto se genera con la sangría de
// SHOWPLAN_TEXT. Puro y sin electron; lo reexporta `planSql.ts`.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbNodoPlan } from '../../../shared/db-explorador-ipc.ts'
import { MAX_NODOS_PLAN } from './planSqlComun.ts'

/** Entidades de un atributo de XML. */
function desescaparXml(s: string): string {
  return s.replace(/&(quot|apos|lt|gt|amp|#(\d+)|#x([0-9a-fA-F]+));/g, (m, nombre: string, dec?: string, hex?: string) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    switch (nombre) {
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'amp':
        return '&'
      default:
        return m
    }
  })
}

function atributos(cuerpo: string): Map<string, string> {
  const salida = new Map<string, string>()
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cuerpo)) !== null) salida.set(m[1], desescaparXml(m[2]))
  return salida
}

function numeroXml(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** `[pruebas].[dbo].[t].[PK_t]` → `pruebas.dbo.t (PK_t)`, sin los corchetes que pone el plan. */
function objetoDeXml(a: Map<string, string>): string | undefined {
  const quitar = (x: string | undefined): string | undefined =>
    x === undefined || x === '' ? undefined : x.replace(/^\[|\]$/g, '').replace(/\]\]/g, ']')
  const partes = [quitar(a.get('Schema')), quitar(a.get('Table'))].filter((x): x is string => x !== undefined)
  if (partes.length === 0) return undefined
  const indice = quitar(a.get('Index'))
  return partes.join('.') + (indice ? ` (${indice})` : '')
}

/** Lo que acumulan todos los XML del plan. */
interface AcumuladoXml {
  nodos: DbNodoPlan[]
  lineas: string[]
  recortado: boolean
  sentencias: number
}

/** El estado del recorrido de UN XML. */
interface RecorridoXml {
  /** Los `RelOp` abiertos (-1: uno que pasó del tope y no cuenta). */
  pila: number[]
  /** Dentro de un RelOp, el primer `Object` y el primer predicado son suyos (no de un hijo). */
  sinObjeto: Set<number>
  enPredicado: number
}

/** Un `StmtSimple`: la línea con su tipo y su texto. */
function sentenciaXml(cuerpo: string, acc: AcumuladoXml): void {
  const a = atributos(cuerpo)
  acc.sentencias++
  const texto = (a.get('StatementText') ?? '').replace(/\s+/g, ' ').trim()
  const tipo = a.get('StatementType') ?? ''
  acc.lineas.push(`${acc.lineas.length > 0 ? '\n' : ''}${tipo ? `[${tipo}] ` : ''}${texto}`.trimEnd())
}

/** El nodo de un `RelOp` que se abre, con sus atributos. */
function nodoRelOp(cuerpo: string, id: number, padre: number | null): DbNodoPlan {
  const a = atributos(cuerpo)
  const fisica = a.get('PhysicalOp') ?? 'RelOp'
  const logica = a.get('LogicalOp')
  const nodo: DbNodoPlan = { id, padre, operacion: fisica }
  if (logica && logica !== fisica) nodo.opciones = logica
  const coste = numeroXml(a.get('EstimatedTotalSubtreeCost'))
  if (coste !== undefined) nodo.coste = coste
  const filas = numeroXml(a.get('EstimateRows'))
  if (filas !== undefined) nodo.filas = filas
  const bytes = numeroXml(a.get('AvgRowSize'))
  if (bytes !== undefined && filas !== undefined) nodo.bytes = Math.round(bytes * filas)
  return nodo
}

/** Un `RelOp` (apertura o cierre): empuja o saca de la pila y añade el nodo. */
function relOpXml(cierre: boolean, autocierre: boolean, cuerpo: string, acc: AcumuladoXml, rec: RecorridoXml): void {
  if (cierre) {
    rec.pila.pop()
    return
  }
  if (acc.nodos.length >= MAX_NODOS_PLAN) {
    acc.recortado = true
    if (!autocierre) rec.pila.push(-1)
    return
  }
  const id = acc.nodos.length + 1
  const tope = rec.pila.length > 0 ? rec.pila[rec.pila.length - 1] : -1
  acc.nodos.push(nodoRelOp(cuerpo, id, tope > 0 ? tope : null))
  rec.sinObjeto.add(id)
  if (!autocierre) rec.pila.push(id)
}

/** Lo que cuelga de un `RelOp` (`actual`): su `Object` y los predicados como detalle. */
function dentroDeRelOp(nombre: string, cierre: boolean, autocierre: boolean, cuerpo: string, actual: number, acc: AcumuladoXml, rec: RecorridoXml): void {
  if (nombre === 'Object' && !cierre && rec.sinObjeto.has(actual)) {
    const o = objetoDeXml(atributos(cuerpo))
    if (o !== undefined) {
      acc.nodos[actual - 1].objeto = o
      rec.sinObjeto.delete(actual)
    }
    return
  }
  if (nombre === 'Predicate' || nombre === 'SeekPredicates' || nombre === 'SeekPredicateNew') {
    if (cierre) rec.enPredicado = Math.max(0, rec.enPredicado - 1)
    else if (!autocierre) rec.enPredicado++
    return
  }
  if (nombre === 'ScalarOperator' && !cierre && rec.enPredicado > 0) {
    const s = atributos(cuerpo).get('ScalarString')
    if (s) {
      const n = acc.nodos[actual - 1]
      n.detalle = [...(n.detalle ?? []), s]
      // Solo el de fuera: los ScalarOperator anidados repiten trozos del mismo predicado.
      rec.enPredicado = 0
    }
  }
}

const ETIQUETA_XML = /<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g

/** Recorre un XML de plan acumulando sentencias y nodos. */
function recorrerXml(xml: string, acc: AcumuladoXml): void {
  const rec: RecorridoXml = { pila: [], sinObjeto: new Set<number>(), enPredicado: 0 }
  let m: RegExpExecArray | null
  ETIQUETA_XML.lastIndex = 0
  while ((m = ETIQUETA_XML.exec(xml)) !== null) {
    const cierre = m[1] === '/'
    const nombre = m[2]
    const autocierre = m[4] === '/'
    if (nombre === 'StmtSimple' && !cierre) {
      sentenciaXml(m[3], acc)
      continue
    }
    if (nombre === 'RelOp') {
      relOpXml(cierre, autocierre, m[3], acc, rec)
      continue
    }
    const actual = rec.pila.length > 0 ? rec.pila[rec.pila.length - 1] : -1
    if (actual <= 0) continue
    dentroDeRelOp(nombre, cierre, autocierre, m[3], actual, acc, rec)
  }
}

/**
 * Los planes XML de SHOWPLAN_XML (uno por lote) → nodos en árbol y texto. `recortado` si pasa de
 * `MAX_NODOS_PLAN`. Lanza si no hay ningún `RelOp` ni sentencia que enseñar (un XML que no es
 * un plan).
 */
export function planDesdeXmlSqlServer(xmls: readonly string[]): { nodos: DbNodoPlan[]; texto: string; recortado: boolean } {
  const acc: AcumuladoXml = { nodos: [], lineas: [], recortado: false, sentencias: 0 }
  for (const xml of xmls) recorrerXml(xml, acc)
  if (acc.nodos.length === 0 && acc.sentencias === 0) throw new Error('El servidor no devolvió un plan de SHOWPLAN_XML.')
  return { nodos: acc.nodos, texto: textoPlanSqlServer(acc.nodos, acc.lineas), recortado: acc.recortado }
}

/** El texto con la sangría de SHOWPLAN_TEXT: las sentencias y, debajo, su árbol. */
function textoPlanSqlServer(nodos: readonly DbNodoPlan[], sentencias: readonly string[]): string {
  const hijos = new Map<number | null, DbNodoPlan[]>()
  for (const n of nodos) {
    const lista = hijos.get(n.padre) ?? []
    lista.push(n)
    hijos.set(n.padre, lista)
  }
  const lineas: string[] = [...sentencias]
  const visitar = (padre: number | null, sangria: string, prof: number): void => {
    for (const n of hijos.get(padre) ?? []) {
      const extra: string[] = []
      if (n.filas !== undefined) extra.push(`filas=${n.filas}`)
      if (n.coste !== undefined) extra.push(`coste=${n.coste}`)
      const cabeza = `${n.operacion}${n.opciones ? ` [${n.opciones}]` : ''}${n.objeto ? `(${n.objeto})` : ''}`
      lineas.push(`${sangria}|--${cabeza}${extra.length ? `  ${extra.join(' ')}` : ''}`)
      for (const d of n.detalle ?? []) lineas.push(`${sangria}|     ${d}`)
      if (prof < 200) visitar(n.id, sangria + '   ', prof + 1)
    }
  }
  visitar(null, '', 0)
  return lineas.join('\n')
}
