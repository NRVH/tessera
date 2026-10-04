// =============================================================================
// Con qué se identifica una fila de la rejilla y si la tabla se puede editar: `pk`, `rowid` o
// `ninguna` con su motivo, según el tipo de objeto, el esquema, las marcas del catálogo y lo
// que el descriptor del motor dice de una tabla sin PK. Puro; lo reexporta `edicionRejilla.ts`.
// Decisiones: docs/decisiones/bd/rejilla-edicion-identidad.md
// =============================================================================

import type { DbMotor } from '../../../shared/db-ipc.ts'
import type { DbIdentidadFila, DbTipoObjeto } from '../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../shared/motores/index.ts'
import { nunca } from '../../../shared/nunca.ts'
import type { ColumnaEdicion, TablaEdicion } from './edicionRejillaTablas.ts'
import { MAX_CLAVE, MAX_IDENT } from './edicionRejillaTipos.ts'
import { COLUMNA_ROWID } from './sqlRejilla.ts'

export interface EntradaIdentidad {
  motor: DbMotor
  soloLectura: boolean
  /** El objeto es de un esquema DEL SISTEMA (ver `esEsquemaDelSistema` y `conMarcasDeTabla`): no se edita. */
  sistema: boolean
  /** El tipo del objeto YA RESUELTO (el destino si era un sinónimo). */
  tipo: DbTipoObjeto
  /** Un sinónimo que apunta a otra base (@dblink). */
  remoto: boolean
  /** Tabla TEMPORAL (sus filas son de cada sesión); de `mapearTablaEdicion`. */
  temporal?: boolean
  /** Oracle, tabla EXTERNA; de `mapearTablaEdicion`. */
  externa?: boolean
  /** SQLite, tabla que mantiene el motor (sombra, `sqlite_*`); de `mapearTablaEdicion`. */
  interna?: boolean
  /** SQLite, el alias con que se lee el rowid (`TablaEdicion.aliasRowid`); ausente en un motor que no lo dice. */
  aliasRowid?: string | null
  /** Columnas de la PK en orden (vacío si no hay). */
  pk: readonly string[]
  /** PG sin PK: la UNIQUE con todas sus columnas NOT NULL; null si no hay o no se miró. */
  unica: readonly string[] | null
}

export const MOTIVO_SOLO_LECTURA = 'La conexión es de solo lectura: la rejilla no puede escribir en ella.'
/** SQLite: la sombra de una tabla virtual o una `sqlite_*`. */
export const MOTIVO_TABLA_INTERNA = 'Es una tabla interna del motor (la mantiene él, no el usuario): la rejilla no la edita.'
/** SQLite: sin PK, y una columna llamada `rowid` tapa la dirección de la fila (o no la tiene). */
export const MOTIVO_ROWID_TAPADO =
  'La tabla no tiene clave primaria y una columna suya se llama como su dirección de fila (rowid): no hay forma fiable de encontrar cada fila.'
export const MOTIVO_SIN_CLAVE_PG =
  'La tabla no tiene clave primaria ni una UNIQUE con todas sus columnas NOT NULL: no hay forma fiable de encontrar cada fila.'

function motivoDeTipo(tipo: DbTipoObjeto): string {
  switch (tipo) {
    case 'vista':
      return 'Es una vista: la rejilla solo edita tablas.'
    case 'vistaMaterializada':
      return 'Es una vista materializada: la rejilla solo edita tablas.'
    case 'tablaForanea':
      return 'Es una tabla foránea (de otro servidor): la rejilla solo edita tablas locales.'
    case 'tablaVirtual':
      return 'Es una tabla virtual (la sirve un módulo, no guarda filas propias): la rejilla solo edita tablas ordinarias.'
    default:
      return 'Este objeto no es una tabla: la rejilla solo edita tablas.'
  }
}

/** ¿Es un esquema DEL SISTEMA? Es la regla por NOMBRE del descriptor (`catalogo.esquemaDelSistema`). */
export function esEsquemaDelSistema(motor: DbMotor, esquema: string): boolean {
  return descriptorSql(motor).catalogo.esquemaDelSistema(esquema)
}

/** La identidad de una tabla sin PK: la decide `sesion.identidadSinPk` del motor ('rowid' o 'unicaNoNula'). */
function identidadSinPk(e: EntradaIdentidad): DbIdentidadFila {
  const sinPk = descriptorSql(e.motor).sesion.identidadSinPk
  switch (sinPk) {
    case 'rowid':
      // SQLite dice con qué alias se lee (`aliasRowid`); el DML de «Enviar» escribe `ROWID`,
      // así que solo vale si `rowid` no lo tapa una columna. Oracle no lo dice: siempre está.
      if (e.aliasRowid !== undefined && e.aliasRowid !== 'rowid') return { tipo: 'ninguna', motivo: MOTIVO_ROWID_TAPADO }
      return { tipo: 'rowid', columna: COLUMNA_ROWID }
    case 'unicaNoNula':
      if (e.unica && e.unica.length > 0) return { tipo: 'pk', columnas: e.unica.slice() }
      return { tipo: 'ninguna', motivo: MOTIVO_SIN_CLAVE_PG }
    default:
      return nunca(sinPk, 'decidirIdentidad')
  }
}

/** Lo que decide la identidad (ver el ADR). Nunca lanza con un motor conocido. */
export function decidirIdentidad(e: EntradaIdentidad): DbIdentidadFila {
  if (e.soloLectura) return { tipo: 'ninguna', motivo: MOTIVO_SOLO_LECTURA }
  if (e.remoto) return { tipo: 'ninguna', motivo: 'Es un objeto remoto (@dblink): la rejilla no escribe a través de un enlace.' }
  if (e.tipo !== 'tabla') return { tipo: 'ninguna', motivo: motivoDeTipo(e.tipo) }
  if (e.sistema) return { tipo: 'ninguna', motivo: 'Es una tabla del sistema: la rejilla no la edita.' }
  if (e.temporal) {
    return { tipo: 'ninguna', motivo: 'Es una tabla temporal: sus filas son de cada sesión, y «Enviar» escribe desde otra.' }
  }
  if (e.externa) return { tipo: 'ninguna', motivo: 'Es una tabla externa (sus filas están en un archivo del servidor): no se edita.' }
  if (e.interna) return { tipo: 'ninguna', motivo: MOTIVO_TABLA_INTERNA }
  if (e.pk.length > 0) return { tipo: 'pk', columnas: e.pk.slice() }
  return identidadSinPk(e)
}

/**
 * ¿Puede ser editable, a falta de lo que diga el catálogo de la tabla? Escritura, tabla
 * local y de usuario. Si no, la identidad es 'ninguna' SIN preguntar nada al servidor.
 */
export function puedeSerEditable(e: Pick<EntradaIdentidad, 'soloLectura' | 'remoto' | 'sistema' | 'tipo'>): boolean {
  return !e.soloLectura && !e.remoto && !e.sistema && e.tipo === 'tabla'
}

/**
 * La entrada de la identidad con lo que dice el catálogo de la TABLA: temporal, externa y, en
 * Oracle 12c+, si su esquema lo mantiene Oracle (cuenta como «del sistema»). Aditivo: solo
 * puede quitar la edición, nunca darla. Una entrada de caché sin la marca cuenta como que no lo es.
 */
export function conMarcasDeTabla<T extends Pick<EntradaIdentidad, 'sistema'>>(
  base: T,
  tabla: Pick<TablaEdicion, 'temporal' | 'externa' | 'interna' | 'aliasRowid'> & { mantenidaPorOracle?: boolean }
): T & Pick<EntradaIdentidad, 'interna' | 'aliasRowid'> & { temporal: boolean; externa: boolean } {
  const salida: T & Pick<EntradaIdentidad, 'interna' | 'aliasRowid'> & { temporal: boolean; externa: boolean } = {
    ...base,
    sistema: base.sistema || tabla.mantenidaPorOracle === true,
    temporal: tabla.temporal,
    externa: tabla.externa
  }
  // SQLite: solo si el catálogo las dice; Oracle y PG salen como siempre.
  if (tabla.interna === true) salida.interna = true
  if (tabla.aliasRowid !== undefined) salida.aliasRowid = tabla.aliasRowid
  return salida
}

/**
 * Lo que la identidad sin PK del motor exige ANTES de decidirla: preguntar al catálogo por
 * una UNIQUE NOT NULL ('unicaNoNula') o leer la página con la columna oculta del ROWID
 * ('rowid'). Un `switch` que cierra con `nunca`: un tercer valor no compila sin decidirlo.
 */
function exigenciasSinPk(motor: DbMotor): { preguntaUnica: boolean; rowidEnLaPagina: boolean } {
  const sinPk = descriptorSql(motor).sesion.identidadSinPk
  switch (sinPk) {
    case 'rowid':
      return { preguntaUnica: false, rowidEnLaPagina: true }
    case 'unicaNoNula':
      return { preguntaUnica: true, rowidEnLaPagina: false }
    default:
      return nunca(sinPk, 'exigenciasSinPk')
  }
}

/**
 * ¿Hay que preguntar al catálogo por una UNIQUE NOT NULL? Solo si el motor identifica así
 * una fila sin PK (PG), tabla de usuario, escritura y sin PK.
 */
export function necesitaUnica(e: Omit<EntradaIdentidad, 'unica'>): boolean {
  return exigenciasSinPk(e.motor).preguntaUnica && puedeSerEditable(e) && !e.temporal && e.pk.length === 0
}

/**
 * ¿La PRIMERA página depende de la identidad? Solo cuando puede salir 'rowid' (Oracle sin PK,
 * tabla local y de usuario, en escritura): el SELECT lleva la columna oculta y la identidad
 * hay que tenerla antes de leer. Si no, el controlador la pide en paralelo con la página.
 */
export function identidadAntesDeLeer(e: Pick<EntradaIdentidad, 'motor' | 'soloLectura' | 'remoto' | 'sistema' | 'tipo' | 'pk'>): boolean {
  return exigenciasSinPk(e.motor).rowidEnLaPagina && e.pk.length === 0 && puedeSerEditable(e)
}

/**
 * Columnas que la PÁGINA trae y el catálogo de edición (cacheado) no conoce, sin la del ROWID:
 * esa caché es anterior a un DDL hecho fuera de Tessera y el controlador la relee al abrir.
 */
export function columnasFueraDelCatalogo(leidas: readonly string[], catalogo: readonly ColumnaEdicion[]): string[] {
  const conocidas = new Set(catalogo.map((c) => c.nombre))
  return leidas.filter((n) => n !== COLUMNA_ROWID && !conocidas.has(n))
}

/** ¿Es una `DbIdentidadFila` bien formada? (lo que llega del renderer). */
export function esIdentidad(v: unknown): v is DbIdentidadFila {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (o.tipo === 'pk') {
    return (
      Array.isArray(o.columnas) &&
      o.columnas.length > 0 &&
      o.columnas.length <= MAX_CLAVE &&
      o.columnas.every((c) => typeof c === 'string' && c.length > 0 && c.length <= MAX_IDENT)
    )
  }
  if (o.tipo === 'rowid') return typeof o.columna === 'string' && o.columna.length > 0 && o.columna.length <= MAX_IDENT
  if (o.tipo === 'ninguna') return typeof o.motivo === 'string'
  return false
}

/** ¿La identidad que manda el renderer es la que el main calcula para la tabla? */
export function mismaIdentidad(calculada: DbIdentidadFila, recibida: DbIdentidadFila): boolean {
  if (calculada.tipo !== recibida.tipo) return false
  if (calculada.tipo === 'pk' && recibida.tipo === 'pk') {
    return (
      calculada.columnas.length === recibida.columnas.length &&
      calculada.columnas.every((c, i) => c === recibida.columnas[i])
    )
  }
  if (calculada.tipo === 'rowid' && recibida.tipo === 'rowid') return calculada.columna === recibida.columna
  // 'ninguna' nunca "coincide": no hay con qué escribir.
  return false
}
