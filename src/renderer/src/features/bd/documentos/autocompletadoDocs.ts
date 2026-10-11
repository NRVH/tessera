// =============================================================================
// El autocompletado de la consola de MongoDB, en lógica pura: qué se está escribiendo en el cursor
// (el principio de una orden, `db.`, `db.coleccion.`, la cadena de un `find`, la clave de un objeto
// de un argumento o un operador `$`) y qué se ofrece en cada caso. Ofrece SOLO lo que admite el
// intérprete de la consola (las listas de `src/tdb/sentenciaMongodb.cjs`, que comprueba el test).
// Sin Monaco ni DOM: lo prueba `test-autocompletado-docs.mts`; el proveedor es `proveedorDocsMonaco.ts`.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { dividirSentenciasShell } from './consolaDocs.ts'

/** Lo que admite `db.` además de las colecciones (`METODOS_DB` y `ESCRITURA_DB` del intérprete, más `getCollection`). */
export const METODOS_DB_DOCS: readonly string[] = ['getCollection', 'getCollectionNames', 'stats', 'getName', 'aggregate', 'createCollection']
/** Los métodos de una colección (`LECTURA_COLECCION` y `ESCRITURA_COLECCION` del intérprete). */
export const METODOS_COLECCION_DOCS: readonly string[] = [
  'find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'getIndexes', 'stats',
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'drop', 'renameCollection', 'createIndex', 'dropIndex'
]
/** Lo que se encadena tras `find(…)` (`CADENA_FIND` y `CADENA_CURSOR`) y tras `aggregate(…)` (`CADENA_CURSOR`). */
export const CADENA_FIND_DOCS: readonly string[] = ['sort', 'limit', 'skip', 'projection', 'count', 'explain', 'toArray', 'pretty', 'hint', 'maxTimeMS']
export const CADENA_AGGREGATE_DOCS: readonly string[] = ['explain', 'toArray', 'pretty', 'hint', 'maxTimeMS']
/** Las órdenes con que empieza una línea. */
export const ORDENES_DOCS: readonly string[] = ['db', 'use', 'show dbs', 'show collections']

/** Los operadores de consulta y de actualización, y los acumuladores de `$group`. */
export const OPERADORES_DOCS: readonly string[] = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$and', '$or', '$nor', '$not', '$exists', '$type',
  '$regex', '$options', '$elemMatch', '$size', '$all', '$expr', '$text', '$search', '$mod',
  '$set', '$unset', '$inc', '$push', '$pull', '$addToSet', '$pop', '$rename', '$min', '$max', '$mul',
  '$currentDate', '$setOnInsert', '$sum', '$avg', '$first', '$last', '$count'
]
/** Las etapas de un pipeline de `aggregate`. */
export const ETAPAS_DOCS: readonly string[] = [
  '$match', '$group', '$project', '$sort', '$limit', '$skip', '$unwind', '$lookup', '$addFields', '$set', '$unset',
  '$count', '$facet', '$replaceRoot', '$sample', '$bucket', '$sortByCount', '$out', '$merge'
]

/** Qué se está escribiendo en el cursor. */
export type ContextoDocs =
  /** El principio de una orden: `db`, `use`, `show …`. */
  | { tipo: 'orden' }
  /** Tras `db.`: las colecciones de la base y los métodos de `db`. */
  | { tipo: 'db' }
  /** Tras `db.coleccion.`: sus métodos. */
  | { tipo: 'coleccion'; coleccion: string }
  /** Tras `db.c.find(…).` o `….aggregate(…).`: lo que se encadena. */
  | { tipo: 'cadena'; metodo: 'find' | 'aggregate' }
  /**
   * Una clave de un objeto dentro de los argumentos de una llamada: los campos de la colección
   * (si se sabe) y, con `$`, los operadores; en una etapa de `aggregate`, las etapas.
   */
  | { tipo: 'clave'; coleccion: string | null; etapa: boolean }

export interface PeticionDocs {
  contexto: ContextoDocs
  /** Lo ya escrito de la palabra del cursor (con su `$`), que lo sugerido sustituye. */
  parcial: string
}

type TipoToken = 'id' | 'cadena' | 'num' | '.' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ':' | 'otro'
interface Token {
  t: TipoToken
  /** El identificador, o el contenido de la cadena sin comillas. */
  v: string
}

const PUNTUACION: Readonly<Record<string, TipoToken>> = { '.': '.', '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}', ',': ',', ':': ':' }

/** El fin de la cadena que abre `q` en `i`, o -1 si queda abierta. */
function finDeCadena(s: string, i: number): number {
  const q = s[i]
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++
    else if (s[j] === q) return j
    else if ((s[j] === '\n' || s[j] === '\r') && q !== '`') return -1
  }
  return -1
}

/** El fin del comentario que empieza en `i` (`//` o `/*`), o -1 si queda abierto. */
function finDeComentario(s: string, i: number): number {
  if (s[i + 1] === '/') {
    const k = s.indexOf('\n', i)
    return k < 0 ? -1 : k
  }
  const k = s.indexOf('*/', i + 2)
  return k < 0 ? -1 : k + 1
}

const IDENTIFICADOR = /[\w$]+/y
const NUMERO = /[\w.]+/y

/** Lo que casa `re` (pegajosa) justo en `i`, sin copiar el resto del texto. */
function trozo(re: RegExp, s: string, i: number): string {
  re.lastIndex = i
  return (re.exec(s) as RegExpExecArray)[0]
}

/** Los tokens de `s`; null si acaba dentro de una cadena o de un comentario (ahí no se sugiere nada). */
function tokens(s: string): Token[] | null {
  const out: Token[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) {
      const k = finDeComentario(s, i)
      if (k < 0) return null
      i = k + 1
    } else if (c === "'" || c === '"' || c === '`') {
      const k = finDeCadena(s, i)
      if (k < 0) return null
      out.push({ t: 'cadena', v: s.slice(i + 1, k).replace(/\\(.)/g, '$1') })
      i = k + 1
    } else if (/[A-Za-z_$]/.test(c)) {
      const v = trozo(IDENTIFICADOR, s, i)
      out.push({ t: 'id', v })
      i += v.length
    } else if (/[0-9]/.test(c)) {
      const v = trozo(NUMERO, s, i)
      out.push({ t: 'num', v })
      i += v.length
    } else {
      out.push({ t: PUNTUACION[c] ?? 'otro', v: c })
      i++
    }
  }
  return out
}

/** El índice del que abre el cierre de `fin` (`)` o `]`), o -1. */
function apertura(ts: readonly Token[], fin: number): number {
  const cierre = ts[fin].t
  const abre = cierre === ')' ? '(' : '['
  let n = 0
  for (let i = fin; i >= 0; i--) {
    if (ts[i].t === cierre) n++
    else if (ts[i].t === abre && --n === 0) return i
  }
  return -1
}

interface Eslabon {
  nombre: string
  /** Es una llamada: `nombre(…)`; `arg0` es su primer argumento si es una cadena. */
  llamada: boolean
  arg0: string | null
}

/**
 * El eslabón que acaba en `ts[i]`: `nombre(…)`, `['nombre']` o `nombre`. `antes` es donde sigue
 * la cadena hacia la izquierda y `pegado`, si lo de delante va sin punto (`db['x']`). null si no lo es.
 */
function eslabonEn(ts: readonly Token[], i: number): { e: Eslabon; antes: number; pegado: boolean } | null {
  const t = ts[i]
  if (t.t === 'id') return { e: { nombre: t.v, llamada: false, arg0: null }, antes: i - 1, pegado: false }
  const j = t.t === ')' || t.t === ']' ? apertura(ts, i) : -1
  if (j < 0) return null
  if (t.t === ']') {
    if (j + 2 !== i || ts[j + 1].t !== 'cadena') return null
    return { e: { nombre: ts[j + 1].v, llamada: false, arg0: null }, antes: j - 1, pegado: true }
  }
  if (j < 1 || ts[j - 1].t !== 'id') return null
  const arg = ts[j + 1]
  const sigue = ts[j + 2]?.t
  const arg0 = arg && arg.t === 'cadena' && (sigue === ')' || sigue === ',') ? arg.v : null
  return { e: { nombre: ts[j - 1].v, llamada: true, arg0 }, antes: j - 2, pegado: false }
}

/** La cadena de miembros que acaba en `ts[fin]` (`db.c.find({…}).sort`), de izquierda a derecha. */
function cadenaHasta(ts: readonly Token[], fin: number): Eslabon[] {
  const eslabones: Eslabon[] = []
  let i = fin
  while (i >= 0) {
    const r = eslabonEn(ts, i)
    if (!r) return ts[i].t === ')' || ts[i].t === ']' ? [] : eslabones
    eslabones.unshift(r.e)
    i = r.antes
    if (r.pegado) continue
    if (i < 0 || ts[i].t !== '.') break
    i--
  }
  return eslabones
}

/** La colección que nombra el segundo eslabón (`db.c`, `db['c']`, `db.getCollection('c')`), o null. */
function coleccionDe(e: Eslabon | undefined): string | null {
  if (!e) return null
  if (e.llamada) return e.nombre === 'getCollection' ? e.arg0 : null
  return METODOS_DB_DOCS.includes(e.nombre) ? null : e.nombre
}

/** Tras un punto: `db.`, `db.c.`, `db.c.find(…).`. */
function contextoTrasPunto(ts: readonly Token[]): ContextoDocs | null {
  const c = cadenaHasta(ts, ts.length - 2)
  if (c.length === 0 || c[0].nombre !== 'db' || c[0].llamada) return null
  if (c.length === 1) return { tipo: 'db' }
  if (c.length === 2 && c[1].llamada && c[1].nombre === 'aggregate') return { tipo: 'cadena', metodo: 'aggregate' }
  const coleccion = coleccionDe(c[1])
  if (coleccion === null) return null
  if (c.length === 2) return { tipo: 'coleccion', coleccion }
  const metodo = c[2]
  if (!metodo.llamada) return null
  if (metodo.nombre === 'find') return { tipo: 'cadena', metodo: 'find' }
  if (metodo.nombre === 'aggregate') return { tipo: 'cadena', metodo: 'aggregate' }
  return null
}

/** Los índices de los `(`, `[` y `{` que siguen abiertos al final de `ts`. */
function abiertos(ts: readonly Token[]): number[] {
  const pila: number[] = []
  ts.forEach((t, i) => {
    if (t.t === '(' || t.t === '[' || t.t === '{') pila.push(i)
    else if ((t.t === ')' || t.t === ']' || t.t === '}') && pila.length > 0) pila.pop()
  })
  return pila
}

/** Una clave de objeto: el `{` abierto más interno, tras `{` o `,`, dentro de una llamada de la orden. */
function contextoDeClave(ts: readonly Token[]): ContextoDocs | null {
  const ultimo = ts[ts.length - 1]
  if (!ultimo || (ultimo.t !== '{' && ultimo.t !== ',')) return null
  const pila = abiertos(ts)
  if (pila.length === 0 || ts[pila[pila.length - 1]].t !== '{') return null
  let k = pila.length - 1
  while (k >= 0 && ts[pila[k]].t !== '(') k--
  if (k < 0) return null
  const parentesis = pila[k]
  const c = cadenaHasta(ts, parentesis - 1)
  if (c.length < 2 || c[0].nombre !== 'db' || c[0].llamada) return null
  const coleccion = c.length >= 3 ? coleccionDe(c[1]) : null
  return { tipo: 'clave', coleccion, etapa: c[c.length - 1].nombre === 'aggregate' && esEtapa(ts, pila, k) }
}

/** `aggregate([{ |`: el objeto es una etapa del pipeline, directamente dentro del arreglo del argumento `k`. */
function esEtapa(ts: readonly Token[], pila: readonly number[], k: number): boolean {
  return pila.length - 1 === k + 2 && ts[pila[k + 1]].t === '[' && ts[pila[k + 1] - 1].t === '('
}

/** Qué se escribe en `cursor` de `texto` (el modelo entero), o null si ahí no se sugiere nada. */
export function contextoAutocompletadoDocs(texto: string, cursor: number): PeticionDocs | null {
  const antesTodo = texto.slice(0, cursor)
  const ss = dividirSentenciasShell(antesTodo)
  const ultima = ss.length > 0 ? ss[ss.length - 1] : null
  const abierta = ultima !== null && ultima.terminador === 'finDeTexto'
  const frag = abierta ? antesTodo.slice(ultima.desde) : ''
  const parcial = (/[\w$]*$/.exec(frag) as RegExpExecArray)[0]
  const antes = frag.slice(0, frag.length - parcial.length)
  if (antes.trim() === '') {
    // Entre órdenes: lo de detrás de la última puede ser un comentario a medio escribir.
    const resto = antesTodo.slice(abierta ? ultima.desde : ultima ? ultima.hasta : 0)
    return tokens(resto) === null ? null : { contexto: { tipo: 'orden' }, parcial }
  }
  const ts = tokens(antes)
  if (!ts || ts.length === 0) return null
  const contexto = ts[ts.length - 1].t === '.' ? contextoTrasPunto(ts) : contextoDeClave(ts)
  return contexto ? { contexto, parcial } : null
}

/** ¿Se escribe tal cual como clave o nombre de miembro? Si no, va entre comillas o con `getCollection`. */
export function esIdentificadorDocs(nombre: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(nombre)
}

export type TipoCandidatoDocs = 'orden' | 'coleccion' | 'metodo' | 'campo' | 'operador'

export interface CandidatoDocs {
  etiqueta: string
  /** Lo que sustituye a lo escrito: un nombre raro va con `getCollection('…')` o entre comillas. */
  insertar: string
  tipo: TipoCandidatoDocs
}

/** Lo que el proveedor sabe de la base: sus colecciones y los campos de la colección del contexto. */
export interface DatosDocs {
  colecciones?: readonly string[]
  campos?: readonly string[]
}

const comillas = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const de = (tipo: TipoCandidatoDocs, lista: readonly string[]): CandidatoDocs[] => lista.map((x) => ({ etiqueta: x, insertar: x, tipo }))

/** Lo que se ofrece en un contexto (Monaco filtra por lo escrito). */
export function candidatosDocs(p: PeticionDocs, datos: DatosDocs): CandidatoDocs[] {
  const c = p.contexto
  switch (c.tipo) {
    case 'orden':
      return de('orden', ORDENES_DOCS)
    case 'db':
      return (datos.colecciones ?? [])
        .map((x): CandidatoDocs => ({ etiqueta: x, insertar: esIdentificadorDocs(x) ? x : `getCollection(${comillas(x)})`, tipo: 'coleccion' }))
        .concat(de('metodo', METODOS_DB_DOCS))
    case 'coleccion':
      return de('metodo', METODOS_COLECCION_DOCS)
    case 'cadena':
      return de('metodo', c.metodo === 'find' ? CADENA_FIND_DOCS : CADENA_AGGREGATE_DOCS)
    case 'clave':
      if (c.etapa) return de('operador', ETAPAS_DOCS)
      if (p.parcial.startsWith('$')) return de('operador', OPERADORES_DOCS)
      return (datos.campos ?? []).map((x) => ({ etiqueta: x, insertar: esIdentificadorDocs(x) ? x : comillas(x), tipo: 'campo' }))
  }
}
