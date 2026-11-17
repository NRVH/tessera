// =============================================================================
// modeloPestanasBd: las pestañas del área de BASES DE DATOS (tablas, fuentes, DDL,
// consolas, colecciones y claves). Reducer PURO (sin React, DOM ni IPC) con su test
// en `test-pestanas-bd.mts`: abrir, activar, cerrar (una, otras, a cada lado, todas),
// mover, los títulos de la tira y el indicador visible de cada pestaña.
// Decisiones: docs/decisiones/bd/ui-area-modelo-de-pestanas.md
// =============================================================================

import type { DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { esEntorno } from '../../../../shared/db-ipc.ts'
import { nombreEntorno } from './textosEntorno.ts'
import type { DbEntorno } from '../../../../shared/db-ipc.ts'
import { txPestanasBd } from './textosPestanasBd.ts'

export type DbPane =
  | {
      tipoPane: 'datos'
      conexionId: string
      esquema: string
      objeto: string
      tipo: DbTipoObjeto
      /** La base, en una conexión con nivel «Bases» (SQL Server sin base fija). */
      base?: string
    }
  | {
      tipoPane: 'fuente'
      conexionId: string
      esquema: string
      objeto: string
      tipo: DbTipoObjeto
      firma?: string
      /** 'ddl' = «Ver DDL» (canal DDL), no la fuente/definición (canal FUENTE). */
      modo?: 'ddl'
      /** Ver el de `datos`. */
      base?: string
    }
  | { tipoPane: 'consola'; conexionId: string; consolaId: string }
  /**
   * Una colección de MongoDB (tabla de documentos + panel JSON). La base
   * va SIEMPRE: en Mongo una colección no existe fuera de su base, ni siquiera cuando la
   * conexión fija una (el nombre se repite de base en base).
   */
  | { tipoPane: 'coleccion'; conexionId: string; base: string; coleccion: string }
  /**
   * El visor de una clave de Redis. `clave` es su base64 (la identidad);
   * `nombre`, lo pintado (`pintarBytes`), solo para el título.
   */
  | { tipoPane: 'clave'; conexionId: string; base: number; clave: string; nombre: string }

/** Los panes de un OBJETO SQL (datos, fuente, DDL): los que tienen esquema, tipo y objeto. */
export type DbPaneObjeto = Extract<DbPane, { tipoPane: 'datos' | 'fuente' }>

export interface PestanaBd {
  /** `idDbPane(pane)`: estable, único y clave de activa. */
  id: string
  pane: DbPane
}

export interface EstadoPestanasBd {
  /** Orden visual. */
  pestanas: readonly PestanaBd[]
  /** Id de la activa, o null si y solo si no hay pestañas. */
  pestanaActivaId: string | null
}

export const ESTADO_PESTANAS_INICIAL: EstadoPestanasBd = { pestanas: [], pestanaActivaId: null }

/**
 * Lo que una pestaña puede estar haciendo o arrastrando. Los panes publican un
 * conjunto; la tira pinta uno solo (`indicadorVisible`).
 */
export type IndicadorPestana = 'ejecutando' | 'cargando' | 'txPendiente' | 'sinEnviar' | 'sesionPerdida' | 'error'

/** Prioridad de los indicadores, de más a menos importante. */
export const PRIORIDAD_INDICADORES: readonly IndicadorPestana[] = [
  'ejecutando',
  'cargando',
  'txPendiente',
  'sinEnviar',
  'sesionPerdida',
  'error'
]

/** Etiqueta de cada tipo de objeto en el idioma activo (tooltips, menús). */
export const etiquetasTipoObjeto = (): Record<DbTipoObjeto, string> => txPestanasBd().tipoObjeto

// --- Identidad --------------------------------------------------------------------

export function idDbPane(p: DbPane): string {
  // La base, detrás y SOLO si la hay: sin ella el id es el de siempre (las pestañas de
  // Oracle, PG y SQLite siguen siendo las mismas), y `dbo.t` de dos bases son dos pestañas.
  if (p.tipoPane === 'consola') return JSON.stringify(['consola', p.consolaId])
  // Prefijo propio: no puede chocar con el de un objeto SQL.
  if (p.tipoPane === 'coleccion') return JSON.stringify(['coleccion', p.conexionId, p.base, p.coleccion])
  // Sin el nombre pintado: la identidad son los bytes (ver el ADR).
  if (p.tipoPane === 'clave') return JSON.stringify(['clave', p.conexionId, p.base, p.clave])
  const conBase = (partes: unknown[]): string => JSON.stringify(p.base !== undefined ? [...partes, p.base] : partes)
  if (p.tipoPane === 'fuente') {
    // El DDL de una vista y su definición son dos pestañas: el modo va en el id.
    if (p.modo === 'ddl') return conBase(['ddl', p.conexionId, p.esquema, p.tipo, p.objeto, p.firma ?? null])
    return conBase(['fuente', p.conexionId, p.esquema, p.tipo, p.objeto, p.firma ?? null])
  }
  return conBase(['datos', p.conexionId, p.esquema, p.objeto])
}

/** Clave del pane en el keep-alive: perfil + pestaña, separados por NUL. */
export function clavePaneBd(perfilId: string, pestanaId: string): string {
  return `${perfilId}\u0000${pestanaId}`
}

// --- Operaciones ------------------------------------------------------------------

/** Abre (o activa, si ya estaba) una pestaña. La nueva va al final. */
export function abrirPestana(s: EstadoPestanasBd, pane: DbPane): EstadoPestanasBd {
  const id = idDbPane(pane)
  if (s.pestanas.some((t) => t.id === id)) return activarPestana(s, id)
  return { pestanas: [...s.pestanas, { id, pane }], pestanaActivaId: id }
}

/**
 * La pestaña `id` pasa a enseñar `pane` en el MISMO sitio (una clave renombrada). Si ya había una
 * pestaña de `pane`, se cierra `id` y se activa aquella: nunca quedan dos con la misma identidad.
 */
export function reemplazarPestana(s: EstadoPestanasBd, id: string, pane: DbPane): EstadoPestanasBd {
  const nuevoId = idDbPane(pane)
  if (!s.pestanas.some((t) => t.id === id)) return s
  if (nuevoId === id) return { pestanas: s.pestanas.map((t) => (t.id === id ? { id, pane } : t)), pestanaActivaId: s.pestanaActivaId }
  if (s.pestanas.some((t) => t.id === nuevoId)) return activarPestana(cerrarVarias(s, [id]), nuevoId)
  return { pestanas: s.pestanas.map((t) => (t.id === id ? { id: nuevoId, pane } : t)), pestanaActivaId: s.pestanaActivaId === id ? nuevoId : s.pestanaActivaId }
}

/** Activa `id`; no-op si ya es la activa o no existe. */
export function activarPestana(s: EstadoPestanasBd, id: string): EstadoPestanasBd {
  if (s.pestanaActivaId === id) return s
  if (!s.pestanas.some((t) => t.id === id)) return s
  return { pestanas: s.pestanas, pestanaActivaId: id }
}

/** Cierra `id`. Si era la activa, pasa a la vecina de la derecha o, si no hay, a la de la izquierda. */
export function cerrarPestana(s: EstadoPestanasBd, id: string): EstadoPestanasBd {
  return cerrarVarias(s, [id])
}

/**
 * Cierra varias. Si la activa cae, la nueva activa es la primera superviviente a
 * su DERECHA en el orden previo o, si no queda ninguna, la última superviviente a
 * su izquierda.
 */
export function cerrarVarias(s: EstadoPestanasBd, ids: readonly string[]): EstadoPestanasBd {
  if (ids.length === 0) return s
  const quitar = new Set(ids)
  if (!s.pestanas.some((t) => quitar.has(t.id))) return s
  const pestanas = s.pestanas.filter((t) => !quitar.has(t.id))
  if (s.pestanaActivaId === null || !quitar.has(s.pestanaActivaId)) return { pestanas, pestanaActivaId: s.pestanaActivaId }
  const idx = s.pestanas.findIndex((t) => t.id === s.pestanaActivaId)
  let pestanaActivaId: string | null = null
  for (let i = idx + 1; i < s.pestanas.length && pestanaActivaId === null; i++) {
    if (!quitar.has(s.pestanas[i].id)) pestanaActivaId = s.pestanas[i].id
  }
  for (let i = idx - 1; i >= 0 && pestanaActivaId === null; i--) {
    if (!quitar.has(s.pestanas[i].id)) pestanaActivaId = s.pestanas[i].id
  }
  return { pestanas, pestanaActivaId }
}

/** Deja solo `id` (y la activa). No-op si no existe o ya es la única. */
export function cerrarOtras(s: EstadoPestanasBd, id: string): EstadoPestanasBd {
  const pestana = s.pestanas.find((t) => t.id === id)
  if (!pestana) return s
  if (s.pestanas.length === 1 && s.pestanaActivaId === id) return s
  return { pestanas: [pestana], pestanaActivaId: id }
}

export function cerrarTodas(s: EstadoPestanasBd): EstadoPestanasBd {
  if (s.pestanas.length === 0 && s.pestanaActivaId === null) return s
  return ESTADO_PESTANAS_INICIAL
}

/** Ids a la IZQUIERDA de `id`, en orden; [] si no existe o es la primera. */
export function idsIzquierda(s: EstadoPestanasBd, id: string): string[] {
  const i = s.pestanas.findIndex((t) => t.id === id)
  return i <= 0 ? [] : s.pestanas.slice(0, i).map((t) => t.id)
}

/** Ids a la DERECHA de `id`, en orden; [] si no existe o es la última. */
export function idsDerecha(s: EstadoPestanasBd, id: string): string[] {
  const i = s.pestanas.findIndex((t) => t.id === id)
  return i < 0 ? [] : s.pestanas.slice(i + 1).map((t) => t.id)
}

/**
 * «Cerrar a la izquierda». Si la activa estaba entre las cerradas, pasa a `id`
 * (la primera superviviente a su derecha, por la regla de `cerrarVarias`).
 */
export function cerrarIzquierda(s: EstadoPestanasBd, id: string): EstadoPestanasBd {
  return cerrarVarias(s, idsIzquierda(s, id))
}

/** «Cerrar a la derecha». Si la activa estaba entre las cerradas, pasa a `id`. */
export function cerrarDerecha(s: EstadoPestanasBd, id: string): EstadoPestanasBd {
  return cerrarVarias(s, idsDerecha(s, id))
}

/**
 * Reordena: `id` pasa a quedar justo ANTES de `antesDe` (null = al final). Es lo
 * que pinta el indicador de inserción del arrastre. No cambia la activa. No-op (el
 * MISMO objeto) si alguno no existe, si `antesDe` es la propia pestaña o si ya
 * estaba en ese sitio.
 */
export function moverPestana(s: EstadoPestanasBd, id: string, antesDe: string | null): EstadoPestanasBd {
  if (antesDe === id) return s
  const desde = s.pestanas.findIndex((t) => t.id === id)
  if (desde < 0) return s
  if (antesDe !== null && !s.pestanas.some((t) => t.id === antesDe)) return s
  const pestana = s.pestanas[desde]
  const resto = s.pestanas.filter((t) => t.id !== id)
  const hueco = antesDe === null ? resto.length : resto.findIndex((t) => t.id === antesDe)
  if (hueco === desde) return s
  const pestanas = [...resto.slice(0, hueco), pestana, ...resto.slice(hueco)]
  return { pestanas, pestanaActivaId: s.pestanaActivaId }
}

/** Cierra las pestañas cuyo pane NO cumple `conservar` (poda por conexión o consola). */
export function filtrarPestanas(s: EstadoPestanasBd, conservar: (p: DbPane) => boolean): EstadoPestanasBd {
  const fuera: string[] = []
  for (const t of s.pestanas) if (!conservar(t.pane)) fuera.push(t.id)
  return cerrarVarias(s, fuera)
}

export function pestanaActiva(s: EstadoPestanasBd): PestanaBd | null {
  if (s.pestanaActivaId === null) return null
  return s.pestanas.find((t) => t.id === s.pestanaActivaId) ?? null
}

// --- Indicador --------------------------------------------------------------------

/** El indicador que se pinta de un conjunto, o null si está vacío. */
export function indicadorVisible(set: ReadonlySet<IndicadorPestana>): IndicadorPestana | null {
  for (const i of PRIORIDAD_INDICADORES) if (set.has(i)) return i
  return null
}

// --- Títulos ----------------------------------------------------------------------

/**
 * Recorta por el CENTRO («ES_CONFIG…S_APIS_TBL»): en nombres de tabla lo que
 * distingue suele estar al principio (prefijo del módulo) Y al final (sufijo), y un
 * recorte por la derecha se come justo lo segundo. `max` cuenta el «…» y cuenta
 * PUNTOS DE CÓDIGO, para no partir un par sustituto en dos.
 */
export function recortarCentro(texto: string, max: number): string {
  const cp = Array.from(texto)
  if (cp.length <= max) return texto
  if (max <= 0) return ''
  if (max === 1) return '…'
  const resto = max - 1
  const cabeza = Math.ceil(resto / 2)
  const cola = resto - cabeza
  return cp.slice(0, cabeza).join('') + '…' + (cola > 0 ? cp.slice(cp.length - cola).join('') : '')
}

function anadirA(mapa: Map<string, Set<string>>, clave: string, valor: string): void {
  const previo = mapa.get(clave)
  if (previo) previo.add(valor)
  else mapa.set(clave, new Set([valor]))
}

/** Lo que distingue la pestaña de «Ver DDL» de la de datos o de la definición. */
export const SUFIJO_DDL = ' (DDL)'

export interface TituloPestana {
  /** Texto principal: el objeto (con `ESQUEMA.` si hace falta desambiguar) o la consola. */
  nombre: string
  /** Alias de la conexión, para el `[ALIAS]`; '' si la conexión ya no existe. */
  conexion: string
  /** Texto completo para el `title`. */
  tooltip: string
  /**
   * Entorno de la conexión, para la marca de la pestaña. Ausente = sin
   * entorno, o la conexión ya no existe (una marca de una conexión que no está
   * afirmaría algo que ya no se sabe).
   */
  entorno?: DbEntorno
}

/**
 * Lo que va delante del objeto en un título desambiguado y en el tooltip: el esquema, o
 * `base.esquema` en una conexión con nivel «Bases» (dos `dbo.t` de dos bases son dos
 * pestañas y tienen que leerse distintas).
 */
function prefijoPane(p: DbPaneObjeto): string {
  return p.base !== undefined ? `${p.base}.${p.esquema}` : p.esquema
}

/** Lo que distingue a las pestañas abiertas del mismo objeto, por clave JSON. */
interface Ambiguedades {
  /** Esquemas por (conexión, objeto). */
  esquemasPorObjeto: Map<string, Set<string>>
  /** Firmas por (conexión, esquema, tipo, objeto). */
  firmasPorObjeto: Map<string, Set<string>>
  /** Bases por (conexión, colección): `pedidos` de dos bases se titula `base.pedidos`. */
  basesPorColeccion: Map<string, Set<string>>
  /** Bases por (conexión, nombre de clave): con `›` y no con un punto, que es parte de muchos nombres. */
  basesPorClave: Map<string, Set<string>>
}

type TituloSinEntorno = Omit<TituloPestana, 'entorno'>

function ambiguedades(pestanas: readonly PestanaBd[]): Ambiguedades {
  const a: Ambiguedades = {
    esquemasPorObjeto: new Map(),
    firmasPorObjeto: new Map(),
    basesPorColeccion: new Map(),
    basesPorClave: new Map()
  }
  for (const t of pestanas) {
    const p = t.pane
    if (p.tipoPane === 'consola') continue
    if (p.tipoPane === 'coleccion') {
      anadirA(a.basesPorColeccion, JSON.stringify([p.conexionId, p.coleccion]), p.base)
    } else if (p.tipoPane === 'clave') {
      anadirA(a.basesPorClave, JSON.stringify([p.conexionId, p.nombre]), String(p.base))
    } else {
      anadirA(a.esquemasPorObjeto, JSON.stringify([p.conexionId, p.objeto]), prefijoPane(p))
      if (p.tipoPane === 'fuente' && p.firma !== undefined) {
        anadirA(a.firmasPorObjeto, JSON.stringify([p.conexionId, p.esquema, p.tipo, p.objeto]), p.firma)
      }
    }
  }
  return a
}

/** ¿Hay más de un valor bajo esa clave? Entonces el título se desambigua. */
function variasEn(mapa: Map<string, Set<string>>, clave: readonly unknown[]): boolean {
  return (mapa.get(JSON.stringify(clave))?.size ?? 0) > 1
}

function tituloColeccion(
  p: Extract<DbPane, { tipoPane: 'coleccion' }>,
  alias: string,
  sufijoAlias: string,
  a: Ambiguedades
): TituloSinEntorno {
  const nombre = variasEn(a.basesPorColeccion, [p.conexionId, p.coleccion]) ? `${p.base}.${p.coleccion}` : p.coleccion
  return { nombre, conexion: alias, tooltip: `${txPestanasBd().coleccion} ${p.base}.${p.coleccion}${sufijoAlias}` }
}

function tituloClave(
  p: Extract<DbPane, { tipoPane: 'clave' }>,
  alias: string,
  sufijoAlias: string,
  a: Ambiguedades
): TituloSinEntorno {
  const conBaseClave = `db${p.base} › ${p.nombre}`
  const nombre = variasEn(a.basesPorClave, [p.conexionId, p.nombre]) ? conBaseClave : p.nombre
  return { nombre, conexion: alias, tooltip: `${txPestanasBd().clave} ${conBaseClave}${sufijoAlias}` }
}

function tituloObjeto(p: DbPaneObjeto, alias: string, sufijoAlias: string, a: Ambiguedades): TituloSinEntorno {
  const firma = p.tipoPane === 'fuente' ? p.firma : undefined
  const ambiguoEsquema = variasEn(a.esquemasPorObjeto, [p.conexionId, p.objeto])
  const ambiguoFirma =
    firma !== undefined && variasEn(a.firmasPorObjeto, [p.conexionId, p.esquema, p.tipo, p.objeto])
  const conFirma = ambiguoFirma ? `${p.objeto}(${firma})` : p.objeto
  // «Ver DDL» lleva el sufijo EN EL NOMBRE, no solo en el tooltip: la tabla y su
  // DDL abiertas a la vez tendrían el mismo título y el mismo icono de tipo.
  const esDdl = p.tipoPane === 'fuente' && p.modo === 'ddl'
  const nombre = (ambiguoEsquema ? `${prefijoPane(p)}.${conFirma}` : conFirma) + (esDdl ? SUFIJO_DDL : '')
  const firmaCompleta = firma !== undefined ? `(${firma})` : ''
  const esDefinicion = p.tipoPane === 'fuente' && !esDdl && (p.tipo === 'vista' || p.tipo === 'vistaMaterializada')
  const tooltip =
    `${etiquetasTipoObjeto()[p.tipo]} ${prefijoPane(p)}.${p.objeto}${firmaCompleta}` +
    `${esDefinicion ? txPestanasBd().definicion : ''}${esDdl ? SUFIJO_DDL : ''}${sufijoAlias}`
  return { nombre, conexion: alias, tooltip }
}

function tituloSinEntorno(
  p: DbPane,
  alias: string,
  sufijoAlias: string,
  a: Ambiguedades,
  nombreConsolaDe: (consolaId: string) => string | undefined
): TituloSinEntorno {
  if (p.tipoPane === 'consola') {
    const nombre = nombreConsolaDe(p.consolaId) ?? txPestanasBd().consola
    return { nombre, conexion: alias, tooltip: `${txPestanasBd().consola} ${nombre}${sufijoAlias}` }
  }
  if (p.tipoPane === 'coleccion') return tituloColeccion(p, alias, sufijoAlias, a)
  if (p.tipoPane === 'clave') return tituloClave(p, alias, sufijoAlias, a)
  return tituloObjeto(p, alias, sufijoAlias, a)
}

/**
 * Títulos de la tira. Una pestaña de objeto se titula con su nombre a secas y se prefija
 * con `ESQUEMA.` SOLO cuando otra abierta tiene el mismo objeto en la misma conexión y en
 * OTRO esquema; dos sobrecargas de una función de PG se distinguen por su firma.
 * `entornoDe` (opcional) da el entorno de cada conexión: va al título para la marca y al
 * FINAL del tooltip (`… · ALIAS · Producción`), porque el color solo no es accesible. Lo
 * que no pase `esEntorno` se ignora.
 */
export function titulosPestanas(
  pestanas: readonly PestanaBd[],
  aliasDe: (conexionId: string) => string | undefined,
  nombreConsolaDe: (consolaId: string) => string | undefined,
  entornoDe?: (conexionId: string) => DbEntorno | undefined
): Map<string, TituloPestana> {
  const a = ambiguedades(pestanas)
  const salida = new Map<string, TituloPestana>()
  for (const t of pestanas) {
    const p = t.pane
    const alias = aliasDe(p.conexionId) ?? ''
    // Sin conexión (alias '') no hay entorno que afirmar.
    const e = alias === '' || !entornoDe ? undefined : entornoDe(p.conexionId)
    const entorno = esEntorno(e) ? e : undefined
    const sufijoAlias = (alias === '' ? '' : ` · ${alias}`) + (entorno ? ` · ${nombreEntorno(entorno)}` : '')
    const titulo = tituloSinEntorno(p, alias, sufijoAlias, a, nombreConsolaDe)
    salida.set(t.id, entorno ? { ...titulo, entorno } : titulo)
  }
  return salida
}
