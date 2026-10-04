// =============================================================================
// cacheMetaBdTipos — los contratos de la caché de catálogo del renderer: la API del main que
// se le inyecta (catálogo SQL y familias de documentos y claves), la instantánea que lee el
// aplanador del árbol y las entradas internas (dato, error recordado, petición en vuelo).
// Solo tipos; lo reexporta `cacheMetaBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-cache-meta.md
// =============================================================================

import type {
  DbBasesRespuesta,
  DbConteos,
  DbDetalle,
  DbErrorSql,
  DbEsquemasRespuesta,
  DbEventoCatalogo,
  DbIndiceNombres,
  DbObjeto,
  DbParteDetalle,
  DbRefObjeto,
  DbRelacionesFk,
  DbRespuesta,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbDocBase, DbDocColeccion, DbDocPedirBases, DbDocPedirColecciones } from '../../../../shared/db-documentos-ipc.ts'
import type { DbKvBases, DbKvEscanear, DbKvPaginaClaves, DbKvPedirBases } from '../../../../shared/db-claves-ipc.ts'
import type { RecorridoClaves } from './arbolClaves.ts'

/** Lo que la caché usa del explorador (lo cumple `window.tessera.dbExplorador`). */
export interface ApiCatalogoBd {
  // `base`: el último argumento, opcional; ausente, la petición de siempre.
  esquemas: (conexionId: string, refrescar?: boolean, base?: string) => Promise<DbRespuesta<DbEsquemasRespuesta>>
  /** Las bases del nivel «Bases». */
  bases: (conexionId: string, refrescar?: boolean) => Promise<DbRespuesta<DbBasesRespuesta>>
  resumen: (conexionId: string, esquema: string, refrescar?: boolean, base?: string) => Promise<DbRespuesta<DbConteos>>
  objetos: (
    conexionId: string,
    esquema: string,
    tipo: DbTipoObjeto,
    refrescar?: boolean,
    base?: string
  ) => Promise<DbRespuesta<DbObjeto[]>>
  detalle: (conexionId: string, objeto: DbRefObjeto, partes: DbParteDetalle[]) => Promise<DbRespuesta<DbDetalle>>
  resolver: (conexionId: string, esquema: string, nombre: string) => Promise<DbRespuesta<DbRefObjeto>>
  nombres: (
    conexionId: string,
    esquemaActual?: string | null,
    refrescar?: boolean,
    base?: string
  ) => Promise<DbRespuesta<DbIndiceNombres>>
  nombresPublicos: (conexionId: string) => Promise<DbRespuesta<string[]>>
  /** Claves ajenas que salen de la tabla y que entran en ella. */
  fks: (conexionId: string, objeto: DbRefObjeto, refrescar?: boolean) => Promise<DbRespuesta<DbRelacionesFk>>
  onCatalogo: (cb: (e: DbEventoCatalogo) => void) => () => void
}

/**
 * Lo que la caché usa de los exploradores de documentos y claves para el árbol (lo cumplen
 * `window.tessera.dbDocumentos` y `window.tessera.dbClaves`). Inyectable aparte: sin ella, las
 * cargas de esas familias fallan con su motivo en vez de romper.
 */
export interface ApiFamiliasBd {
  docBases: (p: DbDocPedirBases) => Promise<DbRespuesta<DbDocBase[]>>
  docColecciones: (p: DbDocPedirColecciones) => Promise<DbRespuesta<DbDocColeccion[]>>
  kvBases: (p: DbKvPedirBases) => Promise<DbRespuesta<DbKvBases>>
  kvEscanear: (p: DbKvEscanear) => Promise<DbRespuesta<DbKvPaginaClaves>>
}

/** Lo que `aplanarArbolBd` necesita de la caché (misma forma que `EntradaArbolBd`). */
export interface InstantaneaArbolBd {
  esquemas: ReadonlyMap<string, DbEsquemasRespuesta>
  /** Por `claveBd.bases`. */
  bases: ReadonlyMap<string, DbBasesRespuesta>
  conteos: ReadonlyMap<string, DbConteos>
  objetos: ReadonlyMap<string, readonly DbObjeto[]>
  detalles: ReadonlyMap<string, DbDetalle>
  errores: ReadonlyMap<string, DbErrorSql>
  /** Por `claveBd.docBases`. */
  docBases: ReadonlyMap<string, readonly DbDocBase[]>
  /** Por `claveBd.docBase`. */
  colecciones: ReadonlyMap<string, readonly DbDocColeccion[]>
  /** Por `claveBd.kvBases`. */
  kvBases: ReadonlyMap<string, DbKvBases>
  /** Por `claveBd.kvBase`: lo recorrido de esa base (todas sus páginas). */
  kvClaves: ReadonlyMap<string, RecorridoClaves>
  /** Por `claveBd.kvBase`: el patrón de las bases filtradas. */
  kvPatrones: ReadonlyMap<string, string>
  /** Por `claveBd.kvBase`: las bases con una «Cargar más» en vuelo. */
  kvCargandoMas: ReadonlySet<string>
}

/** Una entrada del índice de nombres, desplegada (la forma de `DbObjetoNombre`). */
export interface NombreIndexado {
  esquema: string
  nombre: string
  tipo: DbTipoObjeto
}

/** El índice de nombres desplegado: todos y agrupados por esquema. */
export interface IndiceDesplegado {
  todos: NombreIndexado[]
  porEsquema: Map<string, NombreIndexado[]>
}

/** Lo guardado en una clave. */
export interface Entrada {
  valor: unknown
  obsoleta: boolean
  /** Solo detalle: qué partes trae y de qué tipo es el objeto. */
  partes?: ReadonlySet<DbParteDetalle>
  tipo?: DbTipoObjeto
}

export interface ErrorGuardado {
  error: DbErrorSql
  en: number
}

export interface Vuelo {
  promesa: Promise<DbRespuesta<unknown>>
  /** Llegó una invalidación mientras volaba: su respuesta nace obsoleta. */
  obsoleta: boolean
}
