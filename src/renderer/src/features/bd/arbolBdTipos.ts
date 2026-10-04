// =============================================================================
// arbolBdTipos — los tipos del árbol de BD aplanado: las filas que se pintan (`FilaBd`),
// las cargas que piden sus marcadores (`CargaBd`) y la entrada del aplanador.
// Solo tipos; lo reexporta `arbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import type { DbDocBase, DbDocColeccion } from '../../../../shared/db-documentos-ipc.ts'
import type { DbKvBases, DbKvClave } from '../../../../shared/db-claves-ipc.ts'
import type {
  DbBasesRespuesta,
  DbColumnaInfo,
  DbConsolaInfo,
  DbConteos,
  DbDetalle,
  DbErrorSql,
  DbEsquemasRespuesta,
  DbIndiceInfo,
  DbMotivoError,
  DbObjeto,
  DbParteDetalle,
  DbRefObjeto,
  DbRestriccionInfo,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection, DriverRequerido } from '../../../../shared/db-ipc.ts'
import type { RecorridoClaves, VistaCargarMas } from './arbolClaves.ts'

/** [inicio, fin) de la coincidencia de la búsqueda dentro de la etiqueta, en UTF-16. */
export type Coincidencia = readonly [number, number]

export interface InsigniaEsquemas {
  /** Esquemas visibles. */
  n: number
  /** Esquemas del servidor (todos, incluidos los de sistema). */
  m: number
}

/**
 * Lo que hay que pedir al main para rellenar un nodo. `clave` es donde se guarda. `base` solo
 * en una conexión con nivel «Bases»; el detalle la lleva dentro de su `DbRefObjeto`. Las de
 * documentos y claves van por sus contratos, no por el catálogo SQL.
 */
export type CargaBd =
  | { tipo: 'esquemas'; clave: string; conexionId: string; base?: string }
  | { tipo: 'bases'; clave: string; conexionId: string }
  | { tipo: 'resumen'; clave: string; conexionId: string; esquema: string; base?: string }
  | { tipo: 'objetos'; clave: string; conexionId: string; esquema: string; tipoObjeto: DbTipoObjeto; base?: string }
  | { tipo: 'detalle'; clave: string; conexionId: string; objeto: DbRefObjeto; partes: DbParteDetalle[] }
  | { tipo: 'docBases'; clave: string; conexionId: string }
  | { tipo: 'colecciones'; clave: string; conexionId: string; base: string }
  | { tipo: 'kvBases'; clave: string; conexionId: string }
  | { tipo: 'kvClaves'; clave: string; conexionId: string; base: number }

interface FilaBase {
  key: string
  depth: number
  /** Solo con búsqueda: dónde coincide la etiqueta. */
  coincidencia?: Coincidencia
}
interface FilaContenedor extends FilaBase {
  expandida: boolean
  /** Solo con búsqueda: se pinta abierta por la búsqueda, no por `expandidos`. */
  forzada?: true
}

export interface FilaConexion extends FilaContenedor {
  kind: 'conexion'
  conexionId: string
  conexion: DbConnection
  /** "N de M", o null mientras M no se conozca. Con nivel «Bases», el de las BASES. */
  insignia: InsigniaEsquemas | null
  /** La conexión empieza en un nivel «Bases» (`tieneNivelBases`): su insignia cuenta bases. */
  nivelBases?: true
}
/** Una base del nivel «Bases»: sus hijos son SUS esquemas visibles. */
export interface FilaBaseDatos extends FilaContenedor {
  kind: 'base'
  conexionId: string
  base: string
  porDefecto: boolean
  sistema: boolean
  /** Sin acceso (`HAS_DBACCESS` = 0): no se despliega; leer su catálogo daría el 916. */
  accesible: boolean
  /** "N de M" de sus esquemas, o null mientras no se conozcan. */
  insignia: InsigniaEsquemas | null
}
export interface FilaCarpetaConsolas extends FilaContenedor {
  kind: 'carpeta-consolas'
  conexionId: string
  cuenta: number
}
export interface FilaConsola extends FilaBase {
  kind: 'consola'
  conexionId: string
  consola: DbConsolaInfo
}
export interface FilaEsquema extends FilaContenedor {
  kind: 'esquema'
  conexionId: string
  esquema: string
  /** La base, en una conexión con nivel «Bases»; ausente en las demás. */
  base?: string
  porDefecto: boolean
  sistema: boolean
  /** PUBLIC de Oracle. */
  pseudo: boolean
}
export interface FilaCarpeta extends FilaContenedor {
  kind: 'carpeta'
  conexionId: string
  esquema: string
  base?: string
  tipo: DbTipoObjeto
  cuenta: number
}
export interface FilaObjeto extends FilaContenedor {
  kind: 'objeto'
  conexionId: string
  esquema: string
  base?: string
  objeto: DbObjeto
  /** Tiene detalle (columnas…). Si no, `expandida` es siempre false. */
  expandible: boolean
}
export interface FilaCarpetaDetalle extends FilaContenedor {
  kind: 'carpeta-detalle'
  conexionId: string
  esquema: string
  base?: string
  objeto: DbObjeto
  parte: DbParteDetalle
  cuenta: number
}
interface FilaHojaBase extends FilaBase {
  conexionId: string
  esquema: string
  base?: string
  /** El objeto (tabla, vista…) al que pertenece la hoja. */
  objeto: DbObjeto
}
export interface FilaColumna extends FilaHojaBase {
  kind: 'columna'
  columna: DbColumnaInfo
}
export interface FilaIndice extends FilaHojaBase {
  kind: 'indice'
  indice: DbIndiceInfo
}
export interface FilaRestriccion extends FilaHojaBase {
  kind: 'restriccion'
  restriccion: DbRestriccionInfo
}
export interface FilaPlaceholder extends FilaBase {
  kind: 'placeholder'
  variante: 'loading' | 'empty' | 'error'
  /** Clave del nodo al que pertenece. */
  padre: string
  mensaje?: string
  /** Con 'loading': lo que falta pedir. */
  carga?: CargaBd
  /** Con 'error': lo que «Reintentar» vuelve a pedir. */
  reintentar?: CargaBd
  /** Con 'error': por qué (p. ej. `sinSecreto` -> «Vuelve a escribir la contraseña»). */
  motivo?: DbMotivoError
  /** Con 'error': falta un cliente nativo -> «Instalar cliente…». */
  requiereDriver?: DriverRequerido
}

/** Una base de una conexión de documentos sin base fija: sus hijos son sus colecciones. */
export interface FilaDocBase extends FilaContenedor {
  kind: 'doc-base'
  conexionId: string
  base: string
}
/** Una colección (o vista, o serie temporal). Hoja: doble clic o Enter abre su pestaña. */
export interface FilaColeccion extends FilaBase {
  kind: 'coleccion'
  conexionId: string
  base: string
  coleccion: DbDocColeccion
  /** Lo que acompaña al nombre (`metaColeccion`): el tipo o los documentos estimados. */
  meta: string | null
}
/** Una base numerada de una conexión de claves: sus hijos son sus claves. */
export interface FilaKvBase extends FilaContenedor {
  kind: 'kv-base'
  conexionId: string
  indice: number
  /** Claves según el servidor (0 = vacía); null si no se sabe (lista fallida o `conteosDesconocidos`). */
  claves: number | null
  porDefecto: boolean
  /** El MATCH con el que se recorre la base ('' = sin filtro). */
  patron: string
}
/** Una carpeta de claves (el prefijo hasta un `:`). */
export interface FilaKvCarpeta extends FilaContenedor {
  kind: 'kv-carpeta'
  conexionId: string
  indice: number
  /** El prefijo entero con su separador (`usuario:1:`). */
  prefijo: string
  /** El trozo de ESTA carpeta, como se pinta (`etiquetaCarpetaClaves`). */
  nombre: string
  /** Claves CARGADAS dentro (en cualquier nivel). */
  cuenta: number
}
/** Una clave. Hoja: abre su pestaña de visor. */
export interface FilaKvClave extends FilaBase {
  kind: 'kv-clave'
  conexionId: string
  indice: number
  clave: DbKvClave
  /** Lo que se pinta (`nombreClave`): el texto, o los bytes con escapes. El nombre ENTERO. */
  nombre: string
  /** Cuántos caracteres del principio de `nombre` son el prefijo de su carpeta (se atenúan). */
  largoPrefijo: number
}
/** «Cargar más claves» de una base: mientras el cursor de su SCAN no sea '0'. */
export interface FilaKvMas extends FilaBase {
  kind: 'kv-mas'
  conexionId: string
  indice: number
  /** Hay una «Cargar más» en vuelo. */
  cargando: boolean
  /** Lo que pinta (`vistaCargarMas`). */
  vista: VistaCargarMas
}

export type FilaBd =
  | FilaConexion
  | FilaDocBase
  | FilaColeccion
  | FilaKvBase
  | FilaKvCarpeta
  | FilaKvClave
  | FilaKvMas
  | FilaCarpetaConsolas
  | FilaConsola
  | FilaBaseDatos
  | FilaEsquema
  | FilaCarpeta
  | FilaObjeto
  | FilaCarpetaDetalle
  | FilaColumna
  | FilaIndice
  | FilaRestriccion
  | FilaPlaceholder

export interface EntradaArbolBd {
  /** En el orden del usuario. */
  conexiones: readonly DbConnection[]
  /** Consolas del perfil (las de conexiones que no están en la lista se ignoran). */
  consolas: readonly DbConsolaInfo[]
  /** Por `claveBd.conexion` y, con nivel «Bases», los de cada base por `claveBd.base`. */
  esquemas: ReadonlyMap<string, DbEsquemasRespuesta>
  /** Por `claveBd.bases`: las bases de una conexión con nivel «Bases». Ausente = ninguna. */
  bases?: ReadonlyMap<string, DbBasesRespuesta>
  /** Por `claveBd.esquema`. */
  conteos: ReadonlyMap<string, DbConteos>
  /** Por `claveBd.carpeta`. */
  objetos: ReadonlyMap<string, readonly DbObjeto[]>
  /** Por `claveBd.objeto`. */
  detalles: ReadonlyMap<string, DbDetalle>
  /** Por la clave del nodo cuya carga falló (la misma `clave` de su `CargaBd`). */
  errores: ReadonlyMap<string, DbErrorSql>
  expandidos: ReadonlySet<string>
  /** Búsqueda al teclear; vacía = sin filtro. */
  filtro?: string
  /** Por `claveBd.docBases`. Lo de documentos y claves: ausente = nada todavía. */
  docBases?: ReadonlyMap<string, readonly DbDocBase[]>
  /** Por `claveBd.docBase`: las colecciones de esa base. */
  colecciones?: ReadonlyMap<string, readonly DbDocColeccion[]>
  /** Por `claveBd.kvBases`. */
  kvBases?: ReadonlyMap<string, DbKvBases>
  /** Por `claveBd.kvBase`: lo recorrido de esa base (todas sus páginas). */
  kvClaves?: ReadonlyMap<string, RecorridoClaves>
  /** Por `claveBd.kvBase`: el patrón de la base, si tiene. */
  kvPatrones?: ReadonlyMap<string, string>
  /** Por `claveBd.kvBase`: las bases con una «Cargar más» en vuelo. */
  kvCargandoMas?: ReadonlySet<string>
}
