// =============================================================================
// El FILTRO GUIADO de la pestaña de tabla (SQL) y de colección (MongoDB): el contrato que arma el
// renderer y que el main valida con `validarFiltro` y compila (a SQL con parámetros o a un documento
// de filtro). Neutral: sin DOM, sin `process`, sin electron; imports con extensión.
// Decisiones: docs/decisiones/bd/contratos-filtro-guiado.md
// =============================================================================

import type { DbTipoLogico } from './db-explorador-ipc.ts'
import type { DbDocTipo } from './db-documentos-ipc.ts'

/** Qué operadores admite una columna. `id` es el `_id`/ObjectId de Mongo (sin «contiene»). */
export type DbCategoriaFiltro = 'texto' | 'numero' | 'fecha' | 'booleano' | 'id' | 'otro'

export type DbOperadorFiltro =
  | 'contiene'
  | 'empiezaPor'
  | 'igual'
  | 'distinto'
  | 'mayor'
  | 'menor'
  | 'entre'
  | 'vacio'
  | 'noVacio'

export interface DbCondicionFiltro {
  /** Nombre EXACTO de la columna (el del resultado) o del campo de primer nivel (Mongo). */
  columna: string
  categoria: DbCategoriaFiltro
  operador: DbOperadorFiltro
  /** El valor tal cual lo escribió el usuario. Ausente con `vacio`/`noVacio`. */
  valor?: string
  /** El segundo extremo de «entre». */
  valor2?: string
}

export interface DbFiltroGuiado {
  /** «todas» = Y (AND / `$and`), «cualquiera» = O (OR / `$or`). */
  union: 'todas' | 'cualquiera'
  /** Vacío = sin filtro. */
  condiciones: DbCondicionFiltro[]
}

/** Una columna del orden de la cabecera; el orden del array es la prioridad. */
export interface DbOrdenColumna {
  columna: string
  dir: 'asc' | 'desc'
}

/** Topes: un filtro de la interfaz no tiene 50 condiciones; más es un renderer que miente. */
export const MAX_CONDICIONES = 50
export const MAX_COLUMNAS_ORDEN = 16
export const MAX_VALOR_FILTRO = 4000

export const OPERADORES_POR_CATEGORIA: Readonly<Record<DbCategoriaFiltro, readonly DbOperadorFiltro[]>> = {
  texto: ['contiene', 'empiezaPor', 'igual', 'distinto', 'vacio', 'noVacio'],
  numero: ['igual', 'distinto', 'mayor', 'menor', 'entre', 'vacio', 'noVacio'],
  fecha: ['igual', 'distinto', 'mayor', 'menor', 'entre', 'vacio', 'noVacio'],
  booleano: ['igual', 'distinto', 'vacio', 'noVacio'],
  id: ['igual', 'distinto', 'vacio', 'noVacio'],
  otro: ['vacio', 'noVacio']
}

/** Lo que pinta el desplegable de operadores. */
export const ETIQUETA_OPERADOR: Readonly<Record<DbOperadorFiltro, string>> = {
  contiene: 'contiene',
  empiezaPor: 'empieza por',
  igual: '=',
  distinto: '≠',
  mayor: '>',
  menor: '<',
  entre: 'entre',
  vacio: 'está vacío',
  noVacio: 'no está vacío'
}

/** Cuántos valores lleva el operador. */
export function aridad(op: DbOperadorFiltro): 0 | 1 | 2 {
  if (op === 'vacio' || op === 'noVacio') return 0
  return op === 'entre' ? 2 : 1
}

/** Categoría de una columna SQL por su tipo lógico (`DbColumnaResultado.tipoLogico`). */
export function categoriaDeTipoLogico(t: DbTipoLogico): DbCategoriaFiltro {
  switch (t) {
    case 'texto':
      return 'texto'
    case 'numero':
      return 'numero'
    case 'fecha':
    case 'fechaHora':
      return 'fecha'
    case 'booleano':
      return 'booleano'
    // Un LOB, un binario o un JSON no se comparan igual en los cuatro motores (en Oracle,
    // `CLOB = :x` es un error): solo vacío / no vacío.
    case 'binario':
    case 'lob':
    case 'json':
    case 'otro':
      return 'otro'
    default: {
      const nunca: never = t
      throw new Error(`Tipo lógico desconocido: ${String(nunca)}`)
    }
  }
}

/**
 * Categoría de un campo de MongoDB por los tipos de la muestra (`DbDocCampoMuestra.tipos`,
 * del más frecuente al menos). Manda el más frecuente que no sea `null`: un campo que en la
 * muestra es texto y a veces null se filtra como texto.
 */
export function categoriaDeDocTipos(tipos: readonly DbDocTipo[]): DbCategoriaFiltro {
  const t = tipos.find((x) => x !== 'null')
  switch (t) {
    case 'string':
      return 'texto'
    case 'int':
    case 'long':
    case 'double':
    case 'decimal':
      return 'numero'
    case 'date':
    case 'timestamp':
      return 'fecha'
    case 'bool':
      return 'booleano'
    case 'objectId':
      return 'id'
    default:
      return 'otro'
  }
}

/** Un número decimal con punto, sin exponente ni separador de miles. */
const NUMERO = /^[-+]?(\d+(\.\d*)?|\.\d+)$/
const FECHA = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** Una fecha ISO ya partida y comprobada. `hora` null = sin hora (el DÍA entero). */
export interface FechaFiltro {
  /** `YYYY-MM-DD`. */
  dia: string
  /** `HH:MM:SS`, o null si el valor no traía hora. */
  hora: string | null
}

/** Parte y comprueba una fecha del filtro; null si no es una fecha válida del calendario. */
export function leerFecha(texto: string): FechaFiltro | null {
  const m = FECHA.exec(texto.trim())
  if (!m) return null
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const u = new Date(Date.UTC(a, mes - 1, d))
  if (u.getUTCFullYear() !== a || u.getUTCMonth() !== mes - 1 || u.getUTCDate() !== d) return null
  const dia = `${m[1]}-${m[2]}-${m[3]}`
  if (m[4] === undefined) return { dia, hora: null }
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? '0')]
  if (h > 23 || mi > 59 || s > 59) return null
  return { dia, hora: `${m[4]}:${m[5]}:${m[6] ?? '00'}` }
}

/** El día siguiente de un `YYYY-MM-DD` (para el extremo abierto del «día entero»). */
export function diaSiguiente(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const u = new Date(Date.UTC(a, m - 1, d + 1))
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(u.getUTCFullYear(), 4)}-${p(u.getUTCMonth() + 1)}-${p(u.getUTCDate())}`
}

/** El número normalizado (sin `+`, sin espacios), o null si no es un número. */
export function leerNumero(texto: string): string | null {
  const t = texto.trim()
  if (!NUMERO.test(t)) return null
  return t.charAt(0) === '+' ? t.slice(1) : t
}

/** `'true'`/`'false'` (también «sí»/«no», 1/0), o null. */
export function leerBooleano(texto: string): boolean | null {
  const t = texto.trim().toLowerCase()
  if (t === 'true' || t === 'sí' || t === 'si' || t === '1') return true
  if (t === 'false' || t === 'no' || t === '0') return false
  return null
}

/** Por qué un valor no vale para su categoría, o null si vale. En español, para la interfaz. */
export function problemaDeValor(categoria: DbCategoriaFiltro, valor: string | undefined): string | null {
  if (valor === undefined || valor.trim() === '') {
    return 'Escribe un valor (para buscar vacíos, usa «está vacío»).'
  }
  if (valor.length > MAX_VALOR_FILTRO) return `El valor pasa de ${MAX_VALOR_FILTRO} caracteres.`
  switch (categoria) {
    case 'numero':
      return leerNumero(valor) === null ? 'No es un número (usa punto decimal: 12.5).' : null
    case 'fecha':
      return leerFecha(valor) === null ? 'No es una fecha (AAAA-MM-DD, con hora opcional HH:MM[:SS]).' : null
    case 'booleano':
      return leerBooleano(valor) === null ? 'Escribe true o false.' : null
    case 'id':
    case 'texto':
    case 'otro':
      return null
    default: {
      const nunca: never = categoria
      throw new Error(`Categoría desconocida: ${String(nunca)}`)
    }
  }
}

/** El primer problema del filtro, con el índice de su condición (-1 = del filtro entero). */
export interface ProblemaFiltro {
  indice: number
  mensaje: string
}

const CATEGORIAS = Object.keys(OPERADORES_POR_CATEGORIA) as DbCategoriaFiltro[]

/**
 * Valida la ESTRUCTURA y los valores. La corre el renderer al aplicar y el main al recibir
 * (segunda barrera: lo que llega por IPC no se cree). Devuelve el primer problema o null.
 */
export function validarFiltro(f: unknown): ProblemaFiltro | null {
  if (typeof f !== 'object' || f === null) return { indice: -1, mensaje: 'Filtro no válido.' }
  const { union, condiciones } = f as Partial<DbFiltroGuiado>
  if (union !== 'todas' && union !== 'cualquiera') return { indice: -1, mensaje: 'Unión del filtro no válida.' }
  if (!Array.isArray(condiciones)) return { indice: -1, mensaje: 'Filtro no válido.' }
  if (condiciones.length > MAX_CONDICIONES) {
    return { indice: -1, mensaje: `Un filtro admite hasta ${MAX_CONDICIONES} condiciones.` }
  }
  for (let i = 0; i < condiciones.length; i++) {
    const mensaje = problemaDeCondicion(condiciones[i] as Partial<DbCondicionFiltro> | null)
    if (mensaje !== null) return { indice: i, mensaje }
  }
  return null
}

/** El primer problema de una condición del filtro, o null si vale. */
function problemaDeCondicion(c: Partial<DbCondicionFiltro> | null): string | null {
  if (typeof c !== 'object' || c === null) return 'Condición no válida.'
  if (typeof c.columna !== 'string' || c.columna === '' || c.columna.length > 1000) return 'Elige una columna.'
  if (typeof c.categoria !== 'string' || CATEGORIAS.indexOf(c.categoria as DbCategoriaFiltro) < 0) {
    return 'Tipo de columna no válido.'
  }
  const ops = OPERADORES_POR_CATEGORIA[c.categoria as DbCategoriaFiltro]
  if (typeof c.operador !== 'string' || ops.indexOf(c.operador as DbOperadorFiltro) < 0) {
    return 'Ese operador no vale para esta columna.'
  }
  const n = aridad(c.operador as DbOperadorFiltro)
  const vals = [c.valor, c.valor2]
  for (let k = 0; k < 2; k++) {
    const v = vals[k]
    if (k >= n) {
      if (v !== undefined) return 'Sobra un valor en la condición.'
      continue
    }
    if (typeof v !== 'string') return 'Escribe un valor (para buscar vacíos, usa «está vacío»).'
    const p = problemaDeValor(c.categoria as DbCategoriaFiltro, v)
    if (p !== null) return p
  }
  return null
}

/** Valida el orden de la cabecera. Devuelve el mensaje del problema o null. */
export function validarOrden(o: unknown): string | null {
  if (!Array.isArray(o)) return 'Orden no válido.'
  if (o.length > MAX_COLUMNAS_ORDEN) return `Se ordena por hasta ${MAX_COLUMNAS_ORDEN} columnas.`
  const vistas = new Set<string>()
  for (const x of o as Array<Partial<DbOrdenColumna> | null>) {
    if (typeof x !== 'object' || x === null) return 'Orden no válido.'
    if (typeof x.columna !== 'string' || x.columna === '' || x.columna.length > 1000) return 'Orden no válido.'
    if (x.dir !== 'asc' && x.dir !== 'desc') return 'Orden no válido.'
    if (vistas.has(x.columna)) return `La columna ${x.columna} está dos veces en el orden.`
    vistas.add(x.columna)
  }
  return null
}

/** ¿El filtro no filtra nada? (sin condiciones). */
export function filtroVacio(f: DbFiltroGuiado | null | undefined): boolean {
  return f == null || f.condiciones.length === 0
}
