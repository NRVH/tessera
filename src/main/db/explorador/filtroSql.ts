// =============================================================================
// Filtro guiado -> SQL con PARÁMETROS por dialecto: el filtro (`DbFiltroGuiado`) y el orden de
// la cabecera (`DbOrdenColumna[]`) se convierten en el fragmento que `sqlRejilla.ts` pone en
// su WHERE y en su ORDER BY. Los valores nunca van en el texto: son parámetros. Una condición
// por línea, con su AND/OR delante desde la segunda; `rangos[i]` es la línea de la condición i.
// Puro (sin electron ni `process`); las piezas por dialecto viven en `filtroSqlValores.ts`.
// Decisiones: docs/decisiones/bd/rejilla-filtro-guiado-sql.md
// =============================================================================

import {
  leerBooleano,
  leerFecha,
  diaSiguiente,
  validarFiltro,
  validarOrden,
  type DbCondicionFiltro,
  type DbFiltroGuiado,
  type DbOrdenColumna,
  type FechaFiltro
} from '../../../shared/filtroGuiado.ts'
import { nunca } from '../../../shared/nunca.ts'
import type { DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import { citar } from '../../../shared/sql/identificadoresSql.ts'
import type { BindEntradaLob } from './protocoloTrabajador.ts'
import {
  Parametros,
  booleanoSql,
  comoTexto,
  escaparLike,
  fechaSql,
  likeSql,
  numero,
  partirNumero,
  vacioEsNull,
  type ValorFiltroSql
} from './filtroSqlValores.ts'

export { escaparLike, partirNumero, type ValorFiltroSql }

export interface FiltroCompilado {
  /** Las condiciones, una por línea (la unión delante desde la segunda). Sin `WHERE` ni paréntesis de fuera. */
  sql: string
  /** `[inicio, fin)` UTF-16 de cada condición dentro de `sql`, en el orden del filtro. */
  rangos: Array<[number, number]>
  /** Posicionales (PG, SQL Server, SQLite): el valor del marcador `i + 1`. Vacío en Oracle. */
  valores: ValorFiltroSql[]
  /** Oracle: por nombre, sin los dos puntos (`{ f1: … }`). null en los posicionales. */
  nombrados: Record<string, string | number | BindEntradaLob> | null
}

/** El problema de una condición (`indice` -1 = del filtro entero), en español. */
export interface ErrorFiltroSql {
  indice: number
  mensaje: string
}

/** ¿El resultado de `compilarFiltro` es un problema? */
export function esErrorFiltro(r: FiltroCompilado | ErrorFiltroSql): r is ErrorFiltroSql {
  return 'indice' in r
}

/** ¿Los parámetros de este dialecto van por nombre? Oracle sí; los demás, posicionales. */
export function filtroPorNombre(d: DialectoSql): boolean {
  switch (d) {
    case 'oracle':
      return true
    case 'postgres':
    case 'sqlite':
    case 'sqlserver':
      return false
    default:
      return nunca(d, 'filtroPorNombre')
  }
}

const OPERADOR_NO_VALE = 'Ese operador no vale para esta columna.'

/** Lo que sale de compilar una condición: su SQL o el problema. */
type CondicionCompilada = { sql: string } | { problema: string }

const sql = (s: string): CondicionCompilada => ({ sql: s })
const problema = (m: string): CondicionCompilada => ({ problema: m })

/** Un extremo de fecha ya partido, o el problema. */
function fecha(valor: string | undefined): FechaFiltro | string {
  const f = leerFecha(valor ?? '')
  return f === null ? 'No es una fecha (AAAA-MM-DD, con hora opcional HH:MM[:SS]).' : f
}

function condicionVacio(d: DialectoSql, col: string, vacio: boolean, esTexto: boolean): CondicionCompilada {
  if (!esTexto || vacioEsNull(d)) return sql(`${col} ${vacio ? 'IS NULL' : 'IS NOT NULL'}`)
  const t = comoTexto(d, col)
  return sql(vacio ? `(${col} IS NULL OR ${t} = '')` : `(${col} IS NOT NULL AND ${t} <> '')`)
}

function condicionTexto(d: DialectoSql, c: DbCondicionFiltro, col: string, p: Parametros): CondicionCompilada {
  const v = c.valor ?? ''
  switch (c.operador) {
    case 'contiene':
      return sql(likeSql(d, col, p.poner('%' + escaparLike(d, v) + '%')))
    case 'empiezaPor':
      return sql(likeSql(d, col, p.poner(escaparLike(d, v) + '%')))
    case 'igual':
      return sql(`${col} = ${p.ponerTexto(v)}`)
    case 'distinto':
      return sql(`(${col} IS NULL OR ${col} <> ${p.ponerTexto(v)})`)
    default:
      return problema(OPERADOR_NO_VALE)
  }
}

function condicionBooleano(d: DialectoSql, c: DbCondicionFiltro, col: string, p: Parametros): CondicionCompilada {
  const b = leerBooleano(c.valor ?? '')
  if (b === null) return problema('Escribe true o false.')
  if (c.operador === 'igual') return sql(`${col} = ${p.poner(booleanoSql(d, b))}`)
  if (c.operador === 'distinto') return sql(`(${col} IS NULL OR ${col} <> ${p.poner(booleanoSql(d, b))})`)
  return problema(OPERADOR_NO_VALE)
}

function condicionNumero(d: DialectoSql, c: DbCondicionFiltro, col: string, p: Parametros): CondicionCompilada {
  const a = numero(d, c.valor)
  if (typeof a === 'string') return problema(a)
  switch (c.operador) {
    case 'igual':
      return sql(`${col} = ${p.expr(a)}`)
    case 'distinto':
      return sql(`(${col} IS NULL OR ${col} <> ${p.expr(a)})`)
    case 'mayor':
      return sql(`${col} > ${p.expr(a)}`)
    case 'menor':
      return sql(`${col} < ${p.expr(a)}`)
    case 'entre': {
      const b = numero(d, c.valor2)
      if (typeof b === 'string') return problema(b)
      const desde = p.expr(a)
      return sql(`${col} BETWEEN ${desde} AND ${p.expr(b)}`)
    }
    default:
      return problema(OPERADOR_NO_VALE)
  }
}

/** El SQL de un instante del filtro (enlaza su parámetro). */
type EnFecha = (dia: string, hora: string | null) => string

/**
 * El día siguiente al 9999-12-31 no existe en ningún motor y es la fecha centinela típica de
 * «sin fecha de baja»: sin día siguiente, el día entero es «desde ese día».
 */
function siguiente(dia: string): string | null {
  return dia === '9999-12-31' ? null : diaSiguiente(dia)
}

function fechaIgual(col: string, a: FechaFiltro, en: EnFecha): CondicionCompilada {
  if (a.hora !== null) return sql(`${col} = ${en(a.dia, a.hora)}`)
  const s = siguiente(a.dia)
  if (s === null) return sql(`${col} >= ${en(a.dia, null)}`)
  return sql(`(${col} >= ${en(a.dia, null)} AND ${col} < ${en(s, null)})`)
}

function fechaDistinta(col: string, a: FechaFiltro, en: EnFecha): CondicionCompilada {
  if (a.hora !== null) return sql(`(${col} IS NULL OR ${col} <> ${en(a.dia, a.hora)})`)
  const s = siguiente(a.dia)
  if (s === null) return sql(`(${col} IS NULL OR ${col} < ${en(a.dia, null)})`)
  return sql(`(${col} IS NULL OR ${col} < ${en(a.dia, null)} OR ${col} >= ${en(s, null)})`)
}

function fechaMayor(col: string, a: FechaFiltro, en: EnFecha): CondicionCompilada {
  if (a.hora !== null) return sql(`${col} > ${en(a.dia, a.hora)}`)
  const s = siguiente(a.dia)
  // Nada va detrás del último día: ninguna fila, sin mandar una fecha imposible.
  return sql(s === null ? '1 = 0' : `${col} >= ${en(s, null)}`)
}

function fechaEntre(col: string, a: FechaFiltro, valor2: string | undefined, en: EnFecha): CondicionCompilada {
  const b = fecha(valor2)
  if (typeof b === 'string') return problema(b)
  const desde = `${col} >= ${en(a.dia, a.hora)}`
  if (b.hora !== null) return sql(`(${desde} AND ${col} <= ${en(b.dia, b.hora)})`)
  const s = siguiente(b.dia)
  return sql(s === null ? desde : `(${desde} AND ${col} < ${en(s, null)})`)
}

function condicionFecha(d: DialectoSql, c: DbCondicionFiltro, col: string, p: Parametros): CondicionCompilada {
  const a = fecha(c.valor)
  if (typeof a === 'string') return problema(a)
  const en: EnFecha = (dia, hora) => p.expr(fechaSql(d, dia, hora))
  switch (c.operador) {
    case 'igual':
      return fechaIgual(col, a, en)
    case 'distinto':
      return fechaDistinta(col, a, en)
    case 'mayor':
      return fechaMayor(col, a, en)
    case 'menor':
      return sql(`${col} < ${en(a.dia, a.hora)}`)
    case 'entre':
      return fechaEntre(col, a, c.valor2, en)
    default:
      return problema(OPERADOR_NO_VALE)
  }
}

/** El SQL de UNA condición (ya validada por `validarFiltro`), o el problema. */
function condicionSql(d: DialectoSql, c: DbCondicionFiltro, p: Parametros): CondicionCompilada {
  const col = citar(c.columna)
  const op = c.operador
  const esTexto = c.categoria === 'texto' || c.categoria === 'id'
  if (op === 'vacio' || op === 'noVacio') return condicionVacio(d, col, op === 'vacio', esTexto)

  switch (c.categoria) {
    case 'texto':
    case 'id':
      return condicionTexto(d, c, col, p)
    case 'booleano':
      return condicionBooleano(d, c, col, p)
    case 'numero':
      return condicionNumero(d, c, col, p)
    case 'fecha':
      return condicionFecha(d, c, col, p)
    case 'otro':
      return problema(OPERADOR_NO_VALE)
    default:
      return nunca(c.categoria, 'condicionSql')
  }
}

/**
 * Compila el filtro guiado. `null` si no tiene condiciones (no hay WHERE que poner); el
 * problema, con el índice de su condición, si no es válido.
 */
export function compilarFiltro(d: DialectoSql, f: unknown): FiltroCompilado | ErrorFiltroSql | null {
  const invalido = validarFiltro(f)
  if (invalido !== null) return { indice: invalido.indice, mensaje: invalido.mensaje }
  const filtro = f as DbFiltroGuiado
  if (filtro.condiciones.length === 0) return null
  const porNombre = filtroPorNombre(d)
  const p = new Parametros(d, porNombre)
  const union = filtro.union === 'todas' ? 'AND' : 'OR'
  let texto = ''
  const rangos: Array<[number, number]> = []
  for (let i = 0; i < filtro.condiciones.length; i++) {
    const r = condicionSql(d, filtro.condiciones[i], p)
    if ('problema' in r) return { indice: i, mensaje: r.problema }
    if (i > 0) texto += '\n'
    const ini = texto.length
    texto += (i > 0 ? union + ' ' : '') + r.sql
    rangos.push([ini, texto.length])
  }
  return { sql: texto, rangos, valores: porNombre ? [] : p.valores, nombrados: porNombre ? p.nombrados : null }
}

/** El ORDER BY de la cabecera (sin las palabras ORDER BY); null si está vacío; el problema si no vale. */
export function compilarOrden(o: unknown): string | null | { mensaje: string } {
  const invalido = validarOrden(o)
  if (invalido !== null) return { mensaje: invalido }
  const orden = o as DbOrdenColumna[]
  if (orden.length === 0) return null
  return orden.map((x) => `${citar(x.columna)} ${x.dir === 'desc' ? 'DESC' : 'ASC'}`).join(', ')
}
