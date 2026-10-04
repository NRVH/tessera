// =============================================================================
// dbTabsModel: las pestañas del área de BASES DE DATOS (tablas, fuentes, DDL,
// consolas, colecciones y claves). Reducer PURO (sin React, DOM ni IPC) con su test
// en `test-db-tabs.mts`: abrir, activar, cerrar (una, otras, a cada lado, todas),
// mover, los títulos de la tira y el indicador visible de cada pestaña.
// Decisiones: docs/decisiones/bd/ui-area-modelo-de-pestanas.md
// =============================================================================

import type { DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { NOMBRE_ENTORNO, esEntorno } from '../../../../shared/db-ipc.ts'
import type { DbEntorno } from '../../../../shared/db-ipc.ts'

export type DbPane =
  | {
      kind: 'datos'
      conexionId: string
      esquema: string
      objeto: string
      tipo: DbTipoObjeto
      /** La base, en una conexión con nivel «Bases» (SQL Server sin base fija). */
      base?: string
    }
  | {
      kind: 'fuente'
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
  | { kind: 'consola'; conexionId: string; consolaId: string }
  /**
   * Una colección de MongoDB (tabla de documentos + panel JSON). La base
   * va SIEMPRE: en Mongo una colección no existe fuera de su base, ni siquiera cuando la
   * conexión fija una (el nombre se repite de base en base).
   */
  | { kind: 'coleccion'; conexionId: string; base: string; coleccion: string }
  /**
   * El visor de una clave de Redis. `clave` es su base64 (la identidad);
   * `nombre`, lo pintado (`pintarBytes`), solo para el título.
   */
  | { kind: 'clave'; conexionId: string; base: number; clave: string; nombre: string }

/** Los panes de un OBJETO SQL (datos, fuente, DDL): los que tienen esquema, tipo y objeto. */
export type DbPaneObjeto = Extract<DbPane, { kind: 'datos' | 'fuente' }>

export interface DbTab {
  /** `idDbPane(pane)`: estable, único y clave de activa. */
  id: string
  pane: DbPane
}

export interface DbTabsState {
  /** Orden visual. */
  tabs: readonly DbTab[]
  /** Id de la activa, o null si y solo si no hay pestañas. */
  activeId: string | null
}

export const ESTADO_PESTANAS_INICIAL: DbTabsState = { tabs: [], activeId: null }

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

/** Etiqueta en español de cada tipo de objeto (tooltips, menús). */
export const ETIQUETA_TIPO_OBJETO: Record<DbTipoObjeto, string> = {
  tabla: 'Tabla',
  vista: 'Vista',
  vistaMaterializada: 'Vista materializada',
  tablaForanea: 'Tabla foránea',
  tablaVirtual: 'Tabla virtual',
  rutina: 'Rutina',
  paquete: 'Paquete',
  secuencia: 'Secuencia',
  sinonimo: 'Sinónimo',
  tipoObjeto: 'Tipo de objeto',
  tipoColeccion: 'Tipo colección',
  tipo: 'Tipo',
  disparador: 'Disparador'
}

// --- Identidad --------------------------------------------------------------------

export function idDbPane(p: DbPane): string {
  // La base, detrás y SOLO si la hay: sin ella el id es el de siempre (las pestañas de
  // Oracle, PG y SQLite siguen siendo las mismas), y `dbo.t` de dos bases son dos pestañas.
  if (p.kind === 'consola') return JSON.stringify(['consola', p.consolaId])
  // Prefijo propio: no puede chocar con el de un objeto SQL.
  if (p.kind === 'coleccion') return JSON.stringify(['coleccion', p.conexionId, p.base, p.coleccion])
  // Sin el nombre pintado: la identidad son los bytes (ver el ADR).
  if (p.kind === 'clave') return JSON.stringify(['clave', p.conexionId, p.base, p.clave])
  const conBase = (partes: unknown[]): string => JSON.stringify(p.base !== undefined ? [...partes, p.base] : partes)
  if (p.kind === 'fuente') {
    // El DDL de una vista y su definición son dos pestañas: el modo va en el id.
    if (p.modo === 'ddl') return conBase(['ddl', p.conexionId, p.esquema, p.tipo, p.objeto, p.firma ?? null])
    return conBase(['fuente', p.conexionId, p.esquema, p.tipo, p.objeto, p.firma ?? null])
  }
  return conBase(['datos', p.conexionId, p.esquema, p.objeto])
}

/** Clave del pane en el keep-alive: perfil + pestaña, separados por NUL. */
export function paneKeyDb(perfilId: string, tabId: string): string {
  return `${perfilId}\u0000${tabId}`
}

// --- Operaciones ------------------------------------------------------------------

/** Abre (o activa, si ya estaba) una pestaña. La nueva va al final. */
export function abrirPestana(s: DbTabsState, pane: DbPane): DbTabsState {
  const id = idDbPane(pane)
  if (s.tabs.some((t) => t.id === id)) return activarPestana(s, id)
  return { tabs: [...s.tabs, { id, pane }], activeId: id }
}

/** Activa `id`; no-op si ya es la activa o no existe. */
export function activarPestana(s: DbTabsState, id: string): DbTabsState {
  if (s.activeId === id) return s
  if (!s.tabs.some((t) => t.id === id)) return s
  return { tabs: s.tabs, activeId: id }
}

/** Cierra `id`. Si era la activa, pasa a la vecina de la derecha o, si no hay, a la de la izquierda. */
export function cerrarPestana(s: DbTabsState, id: string): DbTabsState {
  return cerrarVarias(s, [id])
}

/**
 * Cierra varias. Si la activa cae, la nueva activa es la primera superviviente a
 * su DERECHA en el orden previo o, si no queda ninguna, la última superviviente a
 * su izquierda.
 */
export function cerrarVarias(s: DbTabsState, ids: readonly string[]): DbTabsState {
  if (ids.length === 0) return s
  const quitar = new Set(ids)
  if (!s.tabs.some((t) => quitar.has(t.id))) return s
  const tabs = s.tabs.filter((t) => !quitar.has(t.id))
  if (s.activeId === null || !quitar.has(s.activeId)) return { tabs, activeId: s.activeId }
  const idx = s.tabs.findIndex((t) => t.id === s.activeId)
  let activeId: string | null = null
  for (let i = idx + 1; i < s.tabs.length && activeId === null; i++) {
    if (!quitar.has(s.tabs[i].id)) activeId = s.tabs[i].id
  }
  for (let i = idx - 1; i >= 0 && activeId === null; i--) {
    if (!quitar.has(s.tabs[i].id)) activeId = s.tabs[i].id
  }
  return { tabs, activeId }
}

/** Deja solo `id` (y la activa). No-op si no existe o ya es la única. */
export function cerrarOtras(s: DbTabsState, id: string): DbTabsState {
  const tab = s.tabs.find((t) => t.id === id)
  if (!tab) return s
  if (s.tabs.length === 1 && s.activeId === id) return s
  return { tabs: [tab], activeId: id }
}

export function cerrarTodas(s: DbTabsState): DbTabsState {
  if (s.tabs.length === 0 && s.activeId === null) return s
  return ESTADO_PESTANAS_INICIAL
}

/** Ids a la IZQUIERDA de `id`, en orden; [] si no existe o es la primera. */
export function idsIzquierda(s: DbTabsState, id: string): string[] {
  const i = s.tabs.findIndex((t) => t.id === id)
  return i <= 0 ? [] : s.tabs.slice(0, i).map((t) => t.id)
}

/** Ids a la DERECHA de `id`, en orden; [] si no existe o es la última. */
export function idsDerecha(s: DbTabsState, id: string): string[] {
  const i = s.tabs.findIndex((t) => t.id === id)
  return i < 0 ? [] : s.tabs.slice(i + 1).map((t) => t.id)
}

/**
 * «Cerrar a la izquierda». Si la activa estaba entre las cerradas, pasa a `id`
 * (la primera superviviente a su derecha, por la regla de `cerrarVarias`).
 */
export function cerrarIzquierda(s: DbTabsState, id: string): DbTabsState {
  return cerrarVarias(s, idsIzquierda(s, id))
}

/** «Cerrar a la derecha». Si la activa estaba entre las cerradas, pasa a `id`. */
export function cerrarDerecha(s: DbTabsState, id: string): DbTabsState {
  return cerrarVarias(s, idsDerecha(s, id))
}

/**
 * Reordena: `id` pasa a quedar justo ANTES de `antesDe` (null = al final). Es lo
 * que pinta el indicador de inserción del arrastre. No cambia la activa. No-op (el
 * MISMO objeto) si alguno no existe, si `antesDe` es la propia pestaña o si ya
 * estaba en ese sitio.
 */
export function moverPestana(s: DbTabsState, id: string, antesDe: string | null): DbTabsState {
  if (antesDe === id) return s
  const desde = s.tabs.findIndex((t) => t.id === id)
  if (desde < 0) return s
  if (antesDe !== null && !s.tabs.some((t) => t.id === antesDe)) return s
  const tab = s.tabs[desde]
  const resto = s.tabs.filter((t) => t.id !== id)
  const hueco = antesDe === null ? resto.length : resto.findIndex((t) => t.id === antesDe)
  if (hueco === desde) return s
  const tabs = [...resto.slice(0, hueco), tab, ...resto.slice(hueco)]
  return { tabs, activeId: s.activeId }
}

/**
 * Dónde caería la pestaña `arrastrada` si se suelta con el puntero sobre `sobre`
 * (null = el hueco vacío tras la última) en su `mitad` izquierda o derecha. Devuelve
 * el `antesDe` de `moverPestana` (null = al final), o `undefined` si soltar ahí no
 * movería nada: la tira no pinta raya donde no va a pasar nada.
 */
export function destinoArrastre(
  tabs: readonly DbTab[],
  arrastrada: string,
  sobre: string | null,
  mitad: 'izquierda' | 'derecha'
): string | null | undefined {
  const desde = tabs.findIndex((t) => t.id === arrastrada)
  if (desde < 0) return undefined
  let antesDe: string | null
  if (sobre === null) {
    antesDe = null
  } else {
    const i = tabs.findIndex((t) => t.id === sobre)
    if (i < 0) return undefined
    antesDe = mitad === 'izquierda' ? sobre : i + 1 < tabs.length ? tabs[i + 1].id : null
  }
  // Pegada a sí misma (antes de ella o antes de la que la sigue): no se mueve.
  const siguiente = desde + 1 < tabs.length ? tabs[desde + 1].id : null
  if (antesDe === arrastrada || antesDe === siguiente) return undefined
  return antesDe
}

/** Cierra las pestañas cuyo pane NO cumple `conservar` (poda por conexión o consola). */
export function filtrarPestanas(s: DbTabsState, conservar: (p: DbPane) => boolean): DbTabsState {
  const fuera: string[] = []
  for (const t of s.tabs) if (!conservar(t.pane)) fuera.push(t.id)
  return cerrarVarias(s, fuera)
}

export function pestanaActiva(s: DbTabsState): DbTab | null {
  if (s.activeId === null) return null
  return s.tabs.find((t) => t.id === s.activeId) ?? null
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

function ambiguedades(tabs: readonly DbTab[]): Ambiguedades {
  const a: Ambiguedades = {
    esquemasPorObjeto: new Map(),
    firmasPorObjeto: new Map(),
    basesPorColeccion: new Map(),
    basesPorClave: new Map()
  }
  for (const t of tabs) {
    const p = t.pane
    if (p.kind === 'consola') continue
    if (p.kind === 'coleccion') {
      anadirA(a.basesPorColeccion, JSON.stringify([p.conexionId, p.coleccion]), p.base)
    } else if (p.kind === 'clave') {
      anadirA(a.basesPorClave, JSON.stringify([p.conexionId, p.nombre]), String(p.base))
    } else {
      anadirA(a.esquemasPorObjeto, JSON.stringify([p.conexionId, p.objeto]), prefijoPane(p))
      if (p.kind === 'fuente' && p.firma !== undefined) {
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
  p: Extract<DbPane, { kind: 'coleccion' }>,
  alias: string,
  sufijoAlias: string,
  a: Ambiguedades
): TituloSinEntorno {
  const nombre = variasEn(a.basesPorColeccion, [p.conexionId, p.coleccion]) ? `${p.base}.${p.coleccion}` : p.coleccion
  return { nombre, conexion: alias, tooltip: `Colección ${p.base}.${p.coleccion}${sufijoAlias}` }
}

function tituloClave(
  p: Extract<DbPane, { kind: 'clave' }>,
  alias: string,
  sufijoAlias: string,
  a: Ambiguedades
): TituloSinEntorno {
  const conBaseClave = `db${p.base} › ${p.nombre}`
  const nombre = variasEn(a.basesPorClave, [p.conexionId, p.nombre]) ? conBaseClave : p.nombre
  return { nombre, conexion: alias, tooltip: `Clave ${conBaseClave}${sufijoAlias}` }
}

function tituloObjeto(p: DbPaneObjeto, alias: string, sufijoAlias: string, a: Ambiguedades): TituloSinEntorno {
  const firma = p.kind === 'fuente' ? p.firma : undefined
  const ambiguoEsquema = variasEn(a.esquemasPorObjeto, [p.conexionId, p.objeto])
  const ambiguoFirma =
    firma !== undefined && variasEn(a.firmasPorObjeto, [p.conexionId, p.esquema, p.tipo, p.objeto])
  const conFirma = ambiguoFirma ? `${p.objeto}(${firma})` : p.objeto
  // «Ver DDL» lleva el sufijo EN EL NOMBRE, no solo en el tooltip: la tabla y su
  // DDL abiertas a la vez tendrían el mismo título y el mismo icono de tipo.
  const esDdl = p.kind === 'fuente' && p.modo === 'ddl'
  const nombre = (ambiguoEsquema ? `${prefijoPane(p)}.${conFirma}` : conFirma) + (esDdl ? SUFIJO_DDL : '')
  const firmaCompleta = firma !== undefined ? `(${firma})` : ''
  const esDefinicion = p.kind === 'fuente' && !esDdl && (p.tipo === 'vista' || p.tipo === 'vistaMaterializada')
  const tooltip =
    `${ETIQUETA_TIPO_OBJETO[p.tipo]} ${prefijoPane(p)}.${p.objeto}${firmaCompleta}` +
    `${esDefinicion ? ' (definición)' : ''}${esDdl ? SUFIJO_DDL : ''}${sufijoAlias}`
  return { nombre, conexion: alias, tooltip }
}

function tituloSinEntorno(
  p: DbPane,
  alias: string,
  sufijoAlias: string,
  a: Ambiguedades,
  nombreConsolaDe: (consolaId: string) => string | undefined
): TituloSinEntorno {
  if (p.kind === 'consola') {
    const nombre = nombreConsolaDe(p.consolaId) ?? 'Consola'
    return { nombre, conexion: alias, tooltip: `Consola ${nombre}${sufijoAlias}` }
  }
  if (p.kind === 'coleccion') return tituloColeccion(p, alias, sufijoAlias, a)
  if (p.kind === 'clave') return tituloClave(p, alias, sufijoAlias, a)
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
  tabs: readonly DbTab[],
  aliasDe: (conexionId: string) => string | undefined,
  nombreConsolaDe: (consolaId: string) => string | undefined,
  entornoDe?: (conexionId: string) => DbEntorno | undefined
): Map<string, TituloPestana> {
  const a = ambiguedades(tabs)
  const out = new Map<string, TituloPestana>()
  for (const t of tabs) {
    const p = t.pane
    const alias = aliasDe(p.conexionId) ?? ''
    // Sin conexión (alias '') no hay entorno que afirmar.
    const e = alias === '' || !entornoDe ? undefined : entornoDe(p.conexionId)
    const entorno = esEntorno(e) ? e : undefined
    const sufijoAlias = (alias === '' ? '' : ` · ${alias}`) + (entorno ? ` · ${NOMBRE_ENTORNO[entorno]}` : '')
    const titulo = tituloSinEntorno(p, alias, sufijoAlias, a, nombreConsolaDe)
    out.set(t.id, entorno ? { ...titulo, entorno } : titulo)
  }
  return out
}
