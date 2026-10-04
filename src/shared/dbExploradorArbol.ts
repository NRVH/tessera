// =============================================================================
// Tipos del ÁRBOL del explorador de bases de datos: objetos del catálogo, esquemas, bases de
// SQL Server, detalle de un objeto (columnas, índices, restricciones) y su fuente.
// Es una sección del contrato `db-explorador-ipc.ts`, que la reexporta entera: los importadores
// siguen importando de allí. Solo tipos y constantes neutrales (lo compilan node y web).
// Decisiones: docs/decisiones/bd/contratos-explorador-sql.md
// =============================================================================

import type { DbEsquemasVisibles } from './db-ipc.ts'

// --- Árbol --------------------------------------------------------------------

/**
 * Tipos de objeto del árbol. Cada uno es una CARPETA: no hay agrupaciones
 * intermedias. Qué carpetas tiene cada motor lo dice `catalogo.carpetas` de su
 * descriptor. `tablaVirtual` es la de SQLite (`CREATE VIRTUAL TABLE`: fts5, rtree…),
 * que se lee como una tabla pero no se edita.
 */
export type DbTipoObjeto =
  | 'tabla'
  | 'vista'
  | 'vistaMaterializada'
  | 'tablaForanea'
  | 'tablaVirtual'
  | 'rutina'
  | 'paquete'
  | 'secuencia'
  | 'sinonimo'
  | 'tipoObjeto'
  | 'tipoColeccion'
  | 'tipo'
  | 'disparador'

/** Tipos que se abren como pestaña de DATOS (rejilla). */
export const TIPOS_CON_DATOS: readonly DbTipoObjeto[] = [
  'tabla',
  'vista',
  'vistaMaterializada',
  'tablaForanea',
  'tablaVirtual',
  'sinonimo'
]

export interface DbEsquema {
  nombre: string
  /** Esquema del sistema (SYS, pg_catalog…): se pinta al final y atenuado. */
  sistema: boolean
  visible: boolean
  porDefecto: boolean
  /** PUBLIC de Oracle: pseudo-esquema que solo tiene sinónimos. */
  pseudo?: boolean
  /** La base a la que pertenece, en una conexión con nivel «Bases» (ver `DbBasesRespuesta`). */
  base?: string
}

export interface DbEsquemasRespuesta {
  esquemas: DbEsquema[]
  porDefecto: string
  config: DbEsquemasVisibles
  /** N de "N de M" (M = `esquemas.length`). */
  nVisibles: number
}

/**
 * Solo SQL Server. Una base del nivel «Bases» del árbol híbrido
 * (`NivelBases` 'sinBaseFija' en shared/motores/tipos.ts).
 */
export interface DbBase {
  nombre: string
  /** master, model, msdb, tempdb: se pintan al final y atenuadas, como los esquemas del sistema. */
  sistema: boolean
  visible: boolean
  /** La base por defecto del login (donde abre la sesión). */
  porDefecto: boolean
  /**
   * ¿Tiene el usuario acceso (`HAS_DBACCESS`)? `sys.databases` enseña TODAS las bases a
   * cualquiera, y leer el catálogo de una sin acceso da el 916 (medido): se pinta sin
   * desplegar, con el motivo.
   */
  accesible: boolean
}

/**
 * Lo que devuelve `DBX_CHANNELS.BASES`, con la misma forma que los esquemas.
 *
 * DIRECCIONAR UN OBJETO EN UNA CONEXIÓN CON NIVEL «BASES»: el `esquema` sigue siendo el
 * esquema (dbo…) y la base viaja APARTE, en `base` de `DbRefObjeto`/`DbObjeto`/`DbEsquema`
 * y como último argumento OPCIONAL de los canales que hoy toman un esquema (ESQUEMAS,
 * RESUMEN, OBJETOS, NOMBRES, REFRESCAR). Ausente = la base de la sesión (la de la conexión,
 * o la de por defecto del login), que es todo lo que hay en un motor sin nivel «Bases». El
 * catálogo del main la usa en el nombre de tres partes (`[base].sys.objects`).
 */
export interface DbBasesRespuesta {
  bases: DbBase[]
  porDefecto: string
  config: DbEsquemasVisibles
  /** N de "N de M" (M = `bases.length`). */
  nVisibles: number
}

export type DbConteos = Partial<Record<DbTipoObjeto, number>>

export interface DbObjeto {
  esquema: string
  nombre: string
  tipo: DbTipoObjeto
  /** 'PROCEDURE' | 'FUNCTION' en rutinas; relkind en PG… */
  subtipo?: string
  /** Firma de argumentos: distingue sobrecargas de PG. */
  firma?: string
  estado?: 'valido' | 'invalido'
  comentario?: string
  /** Disparadores: la tabla a la que pertenecen. */
  tabla?: string
  /** La base, en una conexión con nivel «Bases» (ver `DbBasesRespuesta`). */
  base?: string
}

export interface DbRefObjeto {
  esquema: string
  nombre: string
  tipo: DbTipoObjeto
  firma?: string
  /** La base, en una conexión con nivel «Bases» (ver `DbBasesRespuesta`). Ausente = la de la sesión. */
  base?: string
}

export interface DbColumnaInfo {
  nombre: string
  posicion: number
  /** Texto del tipo tal como lo escribiría el usuario: VARCHAR2(40 CHAR), numeric(10,2). */
  tipo: string
  nullable: boolean
  porDefecto?: string
  comentario?: string
  /** Posición dentro de la clave primaria (1..n) o null si no forma parte. */
  pk: number | null
}

export interface DbIndiceInfo {
  nombre: string
  unico: boolean
  columnas: string[]
  /**
   * Definición completa tal como la da el servidor (`pg_get_indexdef`). Solo PG: en
   * Oracle el DDL sale de DBMS_METADATA y las columnas bastan para el árbol.
   */
  definicion?: string
}

export interface DbRestriccionInfo {
  nombre: string
  tipo: 'pk' | 'unica' | 'fk' | 'check' | 'exclusion'
  columnas: string[]
  referencia?: { esquema: string; tabla: string; columnas: string[] }
  /** Cláusula tal como la da el servidor (`pg_get_constraintdef`). Solo PG, como arriba. */
  definicion?: string
}

export type DbParteDetalle = 'columnas' | 'indices' | 'restricciones'

export interface DbDetalle {
  columnas?: DbColumnaInfo[]
  indices?: DbIndiceInfo[]
  restricciones?: DbRestriccionInfo[]
  comentario?: string
}

export interface DbFuente {
  partes: { titulo: 'Especificación' | 'Cuerpo' | 'Definición' | 'DDL'; texto: string }[]
  /** De dónde salió (ALL_SOURCE, pg_get_functiondef…): va al tooltip. */
  origen: string
  /** Cuerpo vacío por privilegios, código ofuscado (`wrapped`)… */
  aviso?: string
}

/**
 * Índice de nombres para el autocompletado. Tuplas en vez de objetos: con miles de
 * sinónimos, los nombres de propiedad repetidos multiplicaban el tamaño del IPC.
 */
export interface DbIndiceNombres {
  esquemas: string[]
  objetos: Array<[nombre: string, iEsquema: number, tipo: DbTipoObjeto]>
  porDefecto: string
  /** Se llegó al tope y faltan nombres: la UI lo avisa. */
  truncado?: boolean
}
