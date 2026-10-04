// =============================================================================
// Compila el filtro guiado (`shared/filtroGuiado.ts`) y el orden de la cabecera de la pestaña de colección de MongoDB a
// los textos en notación del shell que ya entiende el trabajador. Pura: sin `electron`, proceso ni driver.
// La usan `ControladorDocumentos` (valida en la entrada) y `GestorDocumentos` (compila).
// Decisiones: docs/decisiones/bd/documentos-filtro-guiado.md
// =============================================================================

import type { DbErrorSql } from '../../../../shared/db-explorador-ipc.ts'
import type { DbDocConsultar } from '../../../../shared/db-documentos-ipc.ts'
import {
  diaSiguiente,
  leerBooleano,
  leerFecha,
  leerNumero,
  validarFiltro,
  validarOrden,
  type DbCondicionFiltro,
  type DbFiltroGuiado,
  type DbOrdenColumna,
  type FechaFiltro
} from '../../../../shared/filtroGuiado.ts'
import { invalida } from './validacionPeticion.ts'

/** Dónde está una condición dentro del texto compilado (UTF-16, `hasta` exclusivo). */
export interface RangoCondicion {
  desde: number
  hasta: number
}

export interface FiltroDocsCompilado {
  /** El filtro en notación del shell; '' = sin filtro. */
  texto: string
  rangos: RangoCondicion[]
}

export type Compilacion<T> = { ok: true; valor: T } | { ok: false; error: DbErrorSql }

/** Lo que llega al trabajador: los textos de siempre, venga el filtro de donde venga. */
export interface ConsultaDocsCompilada {
  filtro: string
  orden: string
  /** Rangos de las condiciones si el filtro es GUIADO; null si es el texto de la barra. */
  rangos: RangoCondicion[] | null
  /** ¿El orden sale de la cabecera? */
  ordenGuiado: boolean
}

/** Cifras significativas de un Decimal128. */
export const MAX_CIFRAS_DECIMAL = 34

const ENTERO_SEGURO = String(Number.MAX_SAFE_INTEGER)
const HEX_24 = /^[0-9a-fA-F]{24}$/
const METACARACTERES_REGEX = /[\\^$.*+?()[\]{}|]/g

function errorFiltro(mensaje: string, indice: number): { ok: false; error: DbErrorSql } {
  const error: DbErrorSql = { motivo: 'servidor', campo: 'filtro', mensaje }
  if (indice >= 0) error.condicion = indice
  return { ok: false, error }
}

function errorOrden(mensaje: string): { ok: false; error: DbErrorSql } {
  return { ok: false, error: { motivo: 'servidor', campo: 'orden', mensaje } }
}

const q = (s: string): string => JSON.stringify(s)

/** Por qué un nombre de campo no vale como ruta de MongoDB, o null. */
export function problemaDeCampo(nombre: string): string | null {
  if (nombre.indexOf('\u0000') >= 0) return 'El nombre del campo lleva un carácter nulo.'
  const partes = nombre.split('.')
  if (partes.some((p) => p === '')) return `«${nombre}» no es una ruta de campo válida (un punto al principio, al final o dos seguidos).`
  if (partes.some((p) => p.charAt(0) === '$')) return `El campo «${nombre}» empieza por $: el servidor lo leería como un operador.`
  return null
}

/** El texto con los metacaracteres de una expresión regular escapados (literales). */
export function escaparRegex(s: string): string {
  return s.replace(METACARACTERES_REGEX, '\\$&')
}

/** Signo, cifras sin ceros a los lados y exponente decimal: la forma canónica de un número. */
function canonico(texto: string): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(texto)
  if (!m) return texto
  const ent = m[2]
  const frac = m[3] ?? ''
  let cifras = ent + frac
  let exp = Number(m[4] ?? '0') - frac.length
  const sinIzq = cifras.replace(/^0+/, '')
  if (sinIzq === '') return '0'
  cifras = sinIzq.replace(/0+$/, '')
  exp += sinIzq.length - cifras.length
  return `${m[1]}${cifras}e${exp}`
}

/**
 * El número del usuario como literal del shell (ver la cabecera), o null si pasa de
 * `MAX_CIFRAS_DECIMAL` cifras significativas. `texto` ya pasó `leerNumero`.
 */
export function literalNumero(texto: string): string | null {
  const n = leerNumero(texto)
  if (n === null) return null
  const neg = n.charAt(0) === '-'
  const s = neg ? n.slice(1) : n
  const punto = s.indexOf('.')
  const ent = (punto < 0 ? s : s.slice(0, punto)).replace(/^0+/, '')
  const frac = (punto < 0 ? '' : s.slice(punto + 1)).replace(/0+$/, '')
  const signo = neg ? '-' : ''
  return frac === '' ? literalEntero(ent, signo) : literalConDecimales(ent, frac, signo)
}

/** Un entero: a pelo si cabe en un double exacto, `NumberDecimal` si no, null si pasa de 34 cifras. */
function literalEntero(ent: string, signo: string): string | null {
  const cifras = ent === '' ? '0' : ent
  if (cifras.length < ENTERO_SEGURO.length || (cifras.length === ENTERO_SEGURO.length && cifras <= ENTERO_SEGURO)) {
    return cifras === '0' ? '0' : `${signo}${cifras}`
  }
  if (cifras.replace(/0+$/, '').length > MAX_CIFRAS_DECIMAL) return null
  return `NumberDecimal(${q(signo + cifras)})`
}

/** Un número con decimales: el double si el texto es su forma corta, `NumberDecimal` si no. */
function literalConDecimales(ent: string, frac: string, signo: string): string | null {
  const decimal = `${signo}${ent === '' ? '0' : ent}.${frac}`
  const doble = Number(decimal)
  if (Number.isFinite(doble) && doble !== 0 && canonico(decimal) === canonico(String(doble))) return String(doble)
  if ((ent + frac).replace(/^0+/, '').length > MAX_CIFRAS_DECIMAL) return null
  return `NumberDecimal(${q(decimal)})`
}

/** Un instante UTC como literal del shell. */
function isoDate(dia: string, hora: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  if (a > 9999) {
    const [h, mi, s] = hora.split(':').map(Number)
    return `ISODate(${Date.UTC(a, m - 1, d, h, mi, s)})`
  }
  return `ISODate(${q(`${dia}T${hora}Z`)})`
}

const inicio = (f: FechaFiltro): string => isoDate(f.dia, f.hora ?? '00:00:00')
const finDelDia = (f: FechaFiltro): string => isoDate(diaSiguiente(f.dia), '00:00:00')

/** La expresión de UNA condición sobre su campo (lo que va detrás de `"campo": `). */
function expresion(c: DbCondicionFiltro): Compilacion<string> {
  const op = c.operador
  if (op === 'vacio') return bien(c.categoria === 'texto' ? '{ "$in": [null, ""] }' : '{ "$eq": null }')
  if (op === 'noVacio') return bien(c.categoria === 'texto' ? '{ "$nin": [null, ""] }' : '{ "$ne": null }')
  const v = c.valor ?? ''
  const r = expresionDeCategoria(c, v)
  // `validarFiltro` ya descartó el operador que no es de su categoría y el valor ilegible.
  return r ?? { ok: false, error: { motivo: 'servidor', mensaje: 'Ese operador no vale para esta columna.' } }
}

function bien(valor: string): { ok: true; valor: string } {
  return { ok: true, valor }
}

/** La expresión según la categoría del campo, o null si el operador no es de ella. */
function expresionDeCategoria(c: DbCondicionFiltro, v: string): Compilacion<string> | null {
  switch (c.categoria) {
    case 'texto':
      return expresionTexto(c.operador, v)
    case 'numero':
      return expresionNumero(c, v)
    case 'fecha':
      return expresionFecha(c, v)
    case 'booleano':
      return expresionBooleano(c.operador, v)
    case 'id':
      return expresionId(c.operador, v)
    default:
      return null
  }
}

function expresionTexto(op: DbCondicionFiltro['operador'], v: string): Compilacion<string> | null {
  switch (op) {
    case 'contiene':
      return bien(`{ "$regex": ${q(escaparRegex(v))}, "$options": "i" }`)
    case 'empiezaPor':
      return bien(`{ "$regex": ${q('^' + escaparRegex(v))}, "$options": "i" }`)
    case 'igual':
      return bien(`{ "$eq": ${q(v)} }`)
    case 'distinto':
      return bien(`{ "$ne": ${q(v)} }`)
    default:
      return null
  }
}

function expresionNumero(c: DbCondicionFiltro, v: string): Compilacion<string> | null {
  const op = c.operador
  const a = literalNumero(v)
  const b = op === 'entre' ? literalNumero(c.valor2 ?? '') : ''
  if (a === null || b === null) {
    return { ok: false, error: { motivo: 'servidor', mensaje: `El número pasa de ${MAX_CIFRAS_DECIMAL} cifras significativas: el servidor no lo guarda exacto.` } }
  }
  switch (op) {
    case 'igual':
      return bien(`{ "$eq": ${a} }`)
    case 'distinto':
      return bien(`{ "$ne": ${a} }`)
    case 'mayor':
      return bien(`{ "$gt": ${a} }`)
    case 'menor':
      return bien(`{ "$lt": ${a} }`)
    case 'entre':
      return bien(`{ "$gte": ${a}, "$lte": ${b} }`)
    default:
      return null
  }
}

/** Fechas en UTC: sin hora, el DÍA entero; con hora, el instante. */
function expresionFecha(c: DbCondicionFiltro, v: string): Compilacion<string> | null {
  const op = c.operador
  const a = leerFecha(v)
  const b = op === 'entre' ? leerFecha(c.valor2 ?? '') : null
  if (a === null || (op === 'entre' && b === null)) return null
  const dia = a.hora === null
  switch (op) {
    case 'igual':
      return bien(dia ? `{ "$gte": ${inicio(a)}, "$lt": ${finDelDia(a)} }` : `{ "$eq": ${inicio(a)} }`)
    case 'distinto':
      return bien(dia ? `{ "$not": { "$gte": ${inicio(a)}, "$lt": ${finDelDia(a)} } }` : `{ "$ne": ${inicio(a)} }`)
    case 'mayor':
      return bien(dia ? `{ "$gte": ${finDelDia(a)} }` : `{ "$gt": ${inicio(a)} }`)
    case 'menor':
      return bien(`{ "$lt": ${inicio(a)} }`)
    case 'entre': {
      const fin = b as FechaFiltro
      return bien(`{ "$gte": ${inicio(a)}, ${fin.hora === null ? `"$lt": ${finDelDia(fin)}` : `"$lte": ${inicio(fin)}`} }`)
    }
    default:
      return null
  }
}

function expresionBooleano(op: DbCondicionFiltro['operador'], v: string): Compilacion<string> | null {
  const b = leerBooleano(v)
  if (b === null) return null
  if (op === 'igual') return bien(`{ "$eq": ${b} }`)
  if (op === 'distinto') return bien(`{ "$ne": ${b} }`)
  return null
}

/** `_id`: con 24 hexadecimales, las DOS formas (ObjectId y texto), porque existen `_id` guardados como texto. */
function expresionId(op: DbCondicionFiltro['operador'], v: string): Compilacion<string> | null {
  const t = v.trim()
  const min = t.toLowerCase()
  const valor = HEX_24.test(t) ? `[ObjectId(${q(min)}), ${q(min)}${t !== min ? `, ${q(t)}` : ''}]` : null
  if (op === 'igual') return bien(valor ? `{ "$in": ${valor} }` : `{ "$eq": ${q(v)} }`)
  if (op === 'distinto') return bien(valor ? `{ "$nin": ${valor} }` : `{ "$ne": ${q(v)} }`)
  return null
}

/** Compila el filtro guiado (lo valida antes: lo que llega por IPC no se cree). */
export function compilarFiltroDocs(f: unknown): Compilacion<FiltroDocsCompilado> {
  const p = validarFiltro(f)
  if (p) return errorFiltro(p.mensaje, p.indice)
  const filtro = f as DbFiltroGuiado
  const partes: string[] = []
  for (let i = 0; i < filtro.condiciones.length; i++) {
    const c = filtro.condiciones[i]
    const pc = problemaDeCampo(c.columna)
    if (pc) return errorFiltro(pc, i)
    const e = expresion(c)
    if (!e.ok) return errorFiltro(e.error.mensaje, i)
    partes.push(`{ ${q(c.columna)}: ${e.valor} }`)
  }
  if (partes.length === 0) return { ok: true, valor: { texto: '', rangos: [] } }
  if (partes.length === 1) return { ok: true, valor: { texto: partes[0], rangos: [{ desde: 0, hasta: partes[0].length }] } }
  let texto = `{ ${q(filtro.union === 'todas' ? '$and' : '$or')}: [`
  const rangos: RangoCondicion[] = []
  partes.forEach((parte, i) => {
    texto += i === 0 ? ' ' : ', '
    rangos.push({ desde: texto.length, hasta: texto.length + parte.length })
    texto += parte
  })
  texto += ' ] }'
  return { ok: true, valor: { texto, rangos } }
}

/** Compila el orden de la cabecera a `{ campo: 1|-1, … }` ('' = sin orden). */
export function compilarOrdenDocs(o: unknown): Compilacion<string> {
  const p = validarOrden(o)
  if (p) return errorOrden(p)
  const orden = o as DbOrdenColumna[]
  if (orden.length === 0) return { ok: true, valor: '' }
  for (const x of orden) {
    const pc = problemaDeCampo(x.columna)
    if (pc) return errorOrden(pc)
  }
  // La trampa de las claves enteras (ver la cabecera): si el objeto no conserva el orden
  // pedido, el trabajador ordenaría por otra prioridad.
  const prueba: Record<string, number> = {}
  for (const x of orden) prueba[x.columna] = 1
  const reales = Object.keys(prueba)
  if (reales.some((k, i) => k !== orden[i].columna)) {
    const numericas = orden.filter((x) => /^(0|[1-9]\d*)$/.test(x.columna)).map((x) => `«${x.columna}»`)
    return errorOrden(
      `Un campo de nombre numérico (${numericas.join(', ')}) solo puede ordenar el primero (y, si hay varios, de menor a mayor): ` +
        'Tessera todavía no sabe ponerlo detrás de otro.'
    )
  }
  return { ok: true, valor: `{ ${orden.map((x) => `${q(x.columna)}: ${x.dir === 'asc' ? 1 : -1}`).join(', ')} }` }
}

/**
 * Los textos de filtro y orden que van al trabajador para una consulta de la pestaña de
 * colección: los de la barra, o los compilados del filtro guiado y de la cabecera. Aplica la
 * exclusión (ver la cabecera).
 */
export function compilarConsultaDocs(
  req: Pick<DbDocConsultar, 'filtro' | 'orden' | 'filtroGuiado' | 'ordenColumnas'>
): Compilacion<ConsultaDocsCompilada> {
  const r: ConsultaDocsCompilada = { filtro: req.filtro, orden: req.orden, rangos: null, ordenGuiado: false }
  if (req.filtroGuiado !== undefined) {
    const f = compilarFiltroDocs(req.filtroGuiado)
    if (!f.ok) return f
    if (f.valor.texto !== '') {
      if (req.filtro.trim() !== '') return invalida('filtro guiado y filtro de texto a la vez')
      r.filtro = f.valor.texto
      r.rangos = f.valor.rangos
    }
  }
  if (req.ordenColumnas !== undefined) {
    const o = compilarOrdenDocs(req.ordenColumnas)
    if (!o.ok) return o
    if (o.valor !== '') {
      if (req.orden.trim() !== '') return invalida('orden de la cabecera y orden de texto a la vez')
      r.orden = o.valor
      r.ordenGuiado = true
    }
  }
  return { ok: true, valor: r }
}

/** La condición cuyo rango contiene la posición (UTF-16 del texto compilado), o null. */
export function condicionEnPosicion(rangos: readonly RangoCondicion[], posicion: number): number | null {
  const i = rangos.findIndex((x) => posicion >= x.desde && posicion < x.hasta)
  return i < 0 ? null : i
}

/**
 * Un error del trabajador sobre un filtro u orden COMPILADOS: la posición en un texto que el
 * usuario no ve se cambia por la condición culpable (si se sabe) y desaparece.
 */
export function ubicarErrorGuiado(e: DbErrorSql, c: ConsultaDocsCompilada): DbErrorSql {
  if (e.campo === 'filtro' && c.rangos !== null) {
    const x: DbErrorSql = { ...e }
    const i = typeof e.posicion === 'number' ? condicionEnPosicion(c.rangos, e.posicion) : null
    delete x.posicion
    if (i !== null) x.condicion = i
    return x
  }
  if (e.campo === 'orden' && c.ordenGuiado) {
    const x: DbErrorSql = { ...e }
    delete x.posicion
    return x
  }
  return e
}
