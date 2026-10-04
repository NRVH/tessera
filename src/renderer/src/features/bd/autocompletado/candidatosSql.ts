// =============================================================================
// Candidatos del autocompletado SQL: cómo se filtra (prefijo o subcadena), en qué
// nivel cae cada nombre, cómo se ordena y cómo un candidato se vuelve `Sugerencia`;
// y las altas de objetos, columnas, alias y palabras clave.
// Puro: depende de `fuenteCatalogo`, `referenciasSql` y `shared/`.
// Decisiones: docs/decisiones/bd/ui-autocompletado-filtro-y-orden.md
// =============================================================================

import type { DbTipoObjeto } from '../../../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../../../shared/motores/index.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { nombreCalificado } from '../../../../../shared/sql/identificadoresSql.ts'
import { PALABRAS_CLAVE } from '../../../../../shared/sql/palabrasSql.ts'
import { esquemasLocales, type FuenteCatalogo } from './fuenteCatalogo.ts'
import type { RefTabla } from './referenciasSql.ts'

export type TipoSugerencia =
  | DbTipoObjeto
  | 'columna'
  | 'palabraClave'
  | 'esquema'
  /** Tabla relacionada por FK con su ON (tras JOIN). */
  | 'join'
  /** Condición de FK (tras ON). */
  | 'condicion'
  /** «Expandir columnas» sobre un `*`. */
  | 'expandir'

export interface Sugerencia {
  /** Nombre tal cual en el catálogo (o la palabra clave en la caja tecleada). */
  etiqueta: string
  /** ` (ESQUEMA)` en objetos, ` (TABLA)` en columnas, '' en palabras clave. */
  detalle: string
  /** Alias de la conexión ('' en palabras clave): la columna de la derecha del widget. */
  descripcion: string
  tipo: TipoSugerencia
  /** Lo que se escribe: citado si hace falta y calificado si no es local. */
  insertar: string
  /** `sortText`: se ordena como texto. */
  orden: string
  /**
   * Lo que sustituye, en offsets del texto, si NO es la palabra del cursor (el `*` de
   * «Expandir columnas»). Con él va `filtro`: el texto de ese rango, que es lo que
   * Monaco compara con `filterText`.
   */
  rango?: { desde: number; hasta: number }
  filtro?: string
}

export interface OpcionesSugerencias {
  dialecto: DialectoSql
  /** Alias de la conexión, para `descripcion`. */
  alias: string
  /** Máximo de sugerencias (por defecto `LIMITE_SUGERENCIAS`). */
  limite?: number
  /** Caja de las palabras clave cuando no hay nada tecleado. */
  cajaClaves?: 'mayus' | 'minus'
}

export const LIMITE_SUGERENCIAS = 500

/** Niveles de `orden` (el primer carácter del texto). */
export const NIVEL_SUGERENCIA = {
  /** Lo que sale de una FK (tras JOIN o ON) y «Expandir columnas»: antes que todo. */
  relacion: -1,
  exacta: 0,
  prefijoLocal: 1,
  prefijoOtro: 2,
  subcadenaLocal: 3,
  subcadenaOtro: 4,
  publico: 5,
  palabraClave: 6
} as const

export const ORDEN_TIPO: Record<TipoSugerencia, number> = {
  columna: 0,
  tabla: 2,
  vista: 3,
  vistaMaterializada: 4,
  tablaForanea: 5,
  tablaVirtual: 5,
  sinonimo: 6,
  rutina: 7,
  paquete: 8,
  secuencia: 9,
  tipoObjeto: 10,
  tipoColeccion: 11,
  tipo: 12,
  disparador: 13,
  esquema: 20,
  palabraClave: 30,
  join: 0,
  condicion: 0,
  expandir: 0
}
/** Los alias y tablas de la sentencia van justo detrás de las columnas. */
const ORDEN_ALIAS = 1

export interface Candidato {
  nivel: number
  /** Subnivel dentro de PUBLIC (1 prefijo, 2 subcadena) y de las palabras clave (0 exacta, 1 prefijo). */
  sub: number
  tipoOrd: number
  /** Longitud del nombre (o posición de la columna en su tabla). */
  clave: number
  /** Nombre en minúsculas: con él se compara y se desempata. */
  minus: string
  /** Último desempate: esquema del objeto o tabla de la columna. */
  extra: string
  etiqueta: string
  /** Lo que va entre paréntesis en `detalle`; null = sin detalle. */
  parentesis: string | null
  tipo: TipoSugerencia
  /** Esquema con el que se califica al insertar (null = sin calificar). */
  calificarCon: string | null
  /** Se inserta tal cual, sin citar (palabras clave, joins y condiciones ya citados). */
  literal: boolean
}

/** 0 exacta, 1 prefijo, 2 subcadena, -1 no casa. `p` ya en minúsculas. */
export function coincidencia(minus: string, p: string): number {
  if (p === '') return 1
  const k = minus.indexOf(p)
  if (k < 0) return -1
  if (k === 0) return minus.length === p.length ? 0 : 1
  return 2
}

function nivelDe(c: number, local: boolean): number {
  if (c === 0) return NIVEL_SUGERENCIA.exacta
  if (c === 1) return local ? NIVEL_SUGERENCIA.prefijoLocal : NIVEL_SUGERENCIA.prefijoOtro
  return local ? NIVEL_SUGERENCIA.subcadenaLocal : NIVEL_SUGERENCIA.subcadenaOtro
}

function cmpTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function comparar(a: Candidato, b: Candidato): number {
  return (
    a.nivel - b.nivel ||
    a.sub - b.sub ||
    a.tipoOrd - b.tipoOrd ||
    a.clave - b.clave ||
    cmpTexto(a.minus, b.minus) ||
    cmpTexto(a.extra.toLowerCase(), b.extra.toLowerCase())
  )
}

/**
 * El texto de `orden`: ordena igual que `comparar` (anchura fija, minúsculas). El
 * nivel -1 (`relacion`) se escribe `/`, el carácter anterior a `0`: Monaco compara
 * `sortText` con `<` tras pasarlo a minúsculas.
 */
function ordenDe(c: Candidato): string {
  return (
    (c.nivel < 0 ? '/' : String(c.nivel)) +
    String(c.sub) +
    String(c.tipoOrd).padStart(2, '0') +
    String(c.clave).padStart(5, '0') +
    c.minus +
    ' ' +
    c.extra.toLowerCase()
  )
}

/**
 * Los `k` mejores según `cmp`, ordenados. Con listas grandes no ordena todo:
 * mantiene un top acotado y descarta con una sola comparación lo que no entra.
 */
export function mejores<T>(lista: T[], k: number, cmp: (a: T, b: T) => number): T[] {
  if (k <= 0) return []
  if (lista.length <= k * 4) return lista.sort(cmp).slice(0, k)
  const top = lista.slice(0, k).sort(cmp)
  for (let i = k; i < lista.length; i++) {
    const x = lista[i]
    if (cmp(x, top[k - 1]) >= 0) continue
    let lo = 0
    let hi = k - 1
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (cmp(x, top[m]) < 0) hi = m
      else lo = m + 1
    }
    top.splice(lo, 0, x)
    top.pop()
  }
  return top
}

/** Un candidato ya elegido como `Sugerencia` de la lista. */
export function sugerencia(c: Candidato, op: OpcionesSugerencias): Sugerencia {
  return {
    etiqueta: c.etiqueta,
    detalle: c.parentesis !== null ? ' (' + c.parentesis + ')' : '',
    descripcion: c.tipo === 'palabraClave' || c.tipo === 'condicion' ? '' : op.alias,
    tipo: c.tipo,
    insertar: c.literal ? c.etiqueta : nombreCalificado(c.calificarCon, c.etiqueta, op.dialecto),
    orden: ordenDe(c)
  }
}

// --- Objetos -------------------------------------------------------------------

export interface OpcionesObjetos {
  /** Esquema escrito (`ESQ.`): todo es local y nada se califica. */
  esquema: string | null
  tipos?: readonly DbTipoObjeto[]
  /** Añadir también los esquemas (para seguir con `ESQ.`). */
  conEsquemas: boolean
  /** `BASE.ESQ.`: los objetos de ese esquema de OTRA base. */
  base?: string
}

function candidatoObjeto(
  nombre: string,
  minus: string,
  esquema: string,
  tipo: DbTipoObjeto,
  nivel: number,
  calificarCon: string | null
): Candidato {
  return {
    nivel,
    sub: 0,
    tipoOrd: ORDEN_TIPO[tipo],
    clave: nombre.length,
    minus,
    extra: esquema,
    etiqueta: nombre,
    parentesis: esquema,
    tipo,
    calificarCon,
    literal: false
  }
}

/** `PUBLIC.`: los sinónimos públicos, como objetos locales de ese esquema. */
function anadirPublicosDeEsquema(acc: Candidato[], p: string, fuente: FuenteCatalogo, pseudo: string): void {
  for (const nombre of fuente.publicos()) {
    const minus = nombre.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0) continue
    acc.push(candidatoObjeto(nombre, minus, pseudo, 'sinonimo', nivelDe(c, true), null))
  }
}

/** Los objetos del índice (de `ESQ.` o de todos los esquemas), calificados si no son locales. */
function anadirIndexados(acc: Candidato[], p: string, fuente: FuenteCatalogo, d: DialectoSql, op: OpcionesObjetos): void {
  const tipos = op.tipos
  const locales = op.esquema !== null ? [op.esquema] : esquemasLocales(fuente, d)
  for (const o of op.base !== undefined ? fuente.objetos(op.esquema, op.base) : fuente.objetos(op.esquema)) {
    if (tipos && tipos.indexOf(o.tipo) < 0) continue
    const minus = o.nombre.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0) continue
    const local = locales.indexOf(o.esquema) >= 0
    acc.push(candidatoObjeto(o.nombre, minus, o.esquema, o.tipo, nivelDe(c, local), local ? null : o.esquema))
  }
}

/** Los sinónimos públicos sin calificar: su propio nivel, salvo los exactos. */
function anadirPublicos(acc: Candidato[], p: string, fuente: FuenteCatalogo, pseudo: string): void {
  for (const nombre of fuente.publicos()) {
    const minus = nombre.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0) continue
    const cand = candidatoObjeto(nombre, minus, pseudo, 'sinonimo', c === 0 ? NIVEL_SUGERENCIA.exacta : NIVEL_SUGERENCIA.publico, null)
    cand.sub = c
    acc.push(cand)
  }
}

function anadirEsquemas(acc: Candidato[], p: string, fuente: FuenteCatalogo): void {
  for (const e of fuente.esquemas()) {
    const minus = e.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0) continue
    acc.push({
      nivel: nivelDe(c, false),
      sub: 0,
      tipoOrd: ORDEN_TIPO.esquema,
      clave: e.length,
      minus,
      extra: '',
      etiqueta: e,
      parentesis: null,
      tipo: 'esquema',
      calificarCon: null,
      literal: false
    })
  }
}

/** Objetos del catálogo, sinónimos públicos y (si se pide) esquemas que casan con `p`. */
export function anadirObjetos(acc: Candidato[], p: string, fuente: FuenteCatalogo, d: DialectoSql, op: OpcionesObjetos): void {
  const admitePublicos = !op.tipos || op.tipos.indexOf('sinonimo') >= 0
  // El pseudo-esquema de los sinónimos públicos ('PUBLIC' en Oracle), o null (PG).
  const pseudo = descriptorSql(d).catalogo.pseudoEsquemaPublico
  if (op.esquema !== null && pseudo !== null && op.esquema === pseudo) {
    if (admitePublicos) anadirPublicosDeEsquema(acc, p, fuente, pseudo)
    return
  }
  anadirIndexados(acc, p, fuente, d, op)
  if (op.esquema !== null) return
  // Sin pseudo-esquema no hay sinónimos públicos (`publicos()` da [] por contrato).
  if (admitePublicos && pseudo !== null) anadirPublicos(acc, p, fuente, pseudo)
  if (op.conEsquemas) anadirEsquemas(acc, p, fuente)
}

// --- Columnas, alias y palabras clave ---------------------------------------------

export function anadirColumnas(acc: Candidato[], p: string, tabla: string, columnas: readonly string[]): void {
  for (let i = 0; i < columnas.length; i++) {
    const col = columnas[i]
    const minus = col.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0) continue
    acc.push({
      nivel: nivelDe(c, true),
      sub: 0,
      tipoOrd: ORDEN_TIPO.columna,
      // Sin nada tecleado, en el orden de la tabla; con prefijo, lo más corto antes.
      clave: p === '' ? i : col.length,
      minus,
      extra: tabla,
      etiqueta: col,
      parentesis: tabla,
      tipo: 'columna',
      calificarCon: null,
      literal: false
    })
  }
}

/** Alias (o nombre, si no lo tiene) de cada tabla de la sentencia. */
export function anadirAlias(acc: Candidato[], p: string, tablas: readonly RefTabla[]): void {
  const vistos = new Set<string>()
  for (const r of tablas) {
    const nombre = r.alias !== null ? r.alias : r.nombre
    if (vistos.has(nombre)) continue
    vistos.add(nombre)
    const minus = nombre.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0) continue
    acc.push({
      nivel: nivelDe(c, true),
      sub: 0,
      tipoOrd: ORDEN_ALIAS,
      clave: nombre.length,
      minus,
      extra: '',
      etiqueta: nombre,
      parentesis: r.alias !== null ? r.nombre : r.esquema,
      tipo: 'tabla',
      calificarCon: null,
      literal: false
    })
  }
}

/** Caja de las palabras clave: la de lo tecleado; sin letras, la de `porDefecto`. */
function cajaDe(prefijo: string, porDefecto: 'mayus' | 'minus'): 'mayus' | 'minus' {
  const hayMinus = /[a-z]/.test(prefijo)
  const hayMayus = /[A-Z]/.test(prefijo)
  if (hayMayus) return 'mayus'
  if (hayMinus) return 'minus'
  return porDefecto
}

/** Palabras clave del dialecto: solo por prefijo (la subcadena es para nombres). */
export function anadirClaves(acc: Candidato[], prefijo: string, d: DialectoSql, porDefecto: 'mayus' | 'minus'): void {
  const p = prefijo.toLowerCase()
  const caja = cajaDe(prefijo, porDefecto)
  for (const kw of PALABRAS_CLAVE[dialectoDeMotor(d)]) {
    const minus = kw.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0 || c === 2) continue
    const etiqueta = caja === 'minus' ? minus : kw
    acc.push({
      nivel: NIVEL_SUGERENCIA.palabraClave,
      sub: c,
      tipoOrd: ORDEN_TIPO.palabraClave,
      clave: kw.length,
      minus,
      extra: '',
      etiqueta,
      parentesis: null,
      tipo: 'palabraClave',
      calificarCon: null,
      literal: true
    })
  }
}
