// =============================================================================
// Contrato IPC del explorador para motores de DOCUMENTOS (MongoDB): canales, forma de los
// documentos y motivos de rechazo. Aparte del SQL; reutiliza de él la conexión y `DbRespuesta`.
// Hoja del grafo: solo `import type`; neutral y ES2020 (lo importan main, preload y renderer).
// Decisiones: docs/decisiones/bd/contratos-documentos.md
// =============================================================================

import type { DbRespuesta } from './db-explorador-ipc.ts'
import type { DbFiltroGuiado, DbOrdenColumna } from './filtroGuiado.ts'

export const DOCS_CHANNELS = {
  /**
   * invoke: DbDocPedirBases -> DbRespuesta<DbDocBase[]>. Las bases AUTORIZADAS
   * (`listDatabases({ nameOnly, authorizedDatabases: true })`, que funciona con rol `read`).
   * Solo con una conexión sin base fija (`tieneNivelBases`).
   */
  BASES: 'docs:bases',
  /** invoke: DbDocPedirColecciones -> DbRespuesta<DbDocColeccion[]> (sin `system.*`). */
  COLECCIONES: 'docs:colecciones',
  /** invoke: DbDocPedirDetalle -> DbRespuesta<DbDocDetalleColeccion> (índices, esquema muestreado). */
  DETALLE: 'docs:detalle',
  /** invoke: DbDocConsultar -> DbRespuesta<DbDocPagina>. La pestaña de colección (filtro, proyección, orden). */
  CONSULTAR: 'docs:consultar',
  /** invoke: DbDocPedirMas -> DbRespuesta<DbDocPagina>. Siguiente página del cursor vivo (`getMore`). */
  LECTOR_MAS: 'docs:lector:mas',
  /** invoke: (lector: string) -> void. Cierra el cursor del servidor. */
  LECTOR_CERRAR: 'docs:lector:cerrar',
  /** invoke: DbDocEjecutar -> DbRespuesta<DbDocResultado>. Una sentencia de la consola (D2). */
  CONSOLA_EJECUTAR: 'docs:consola:ejecutar',
  /**
   * invoke: DbDocEnviar -> DbRespuesta<DbDocResultadoEnvio> («Enviar» de la tabla, D3/D11).
   * Con transacciones (replica set, mongos): todo o nada. Sin ellas (servidor suelto):
   * `bulkWrite` ORDENADO que para en el primer fallo y dice qué entró; con más de un
   * documento exige `confirmadoSinTransaccion`. En producción exige `confirmado`.
   */
  ENVIAR: 'docs:enviar'
} as const

/** Tipos BSON que la tabla distingue al pintar una celda (y el panel JSON al colorear). */
export type DbDocTipo =
  | 'string'
  | 'int'
  | 'long'
  | 'double'
  | 'decimal'
  | 'bool'
  | 'null'
  | 'objectId'
  | 'date'
  | 'binary'
  | 'regex'
  | 'timestamp'
  | 'objeto'
  | 'array'
  | 'otro'

export interface DbDocBase {
  nombre: string
  /** Bytes en disco si el servidor los da (`sizeOnDisk`); ausente con `nameOnly`. */
  tamano?: number
}

export interface DbDocColeccion {
  nombre: string
  /** `listCollections` → `type`: 'collection', 'view' o 'timeseries'. */
  tipo: 'coleccion' | 'vista' | 'serieTemporal'
  /** `estimatedDocumentCount` (barato: metadatos); ausente en una vista. */
  documentosEstimados?: number
}

export interface DbDocIndice {
  nombre: string
  /** La clave del índice en notación del shell (`{ a: 1, b: -1 }`). */
  clave: string
  unico: boolean
}

export interface DbDocCampoMuestra {
  /** Nombre del campo de PRIMER nivel. */
  nombre: string
  /** Los tipos vistos en la muestra, del más frecuente al menos (una columna puede traer varios). */
  tipos: DbDocTipo[]
  /** En cuántos documentos de la muestra aparece (para ordenar las columnas). */
  presencia: number
}

export interface DbDocDetalleColeccion {
  indices: DbDocIndice[]
  /** La unión de los campos de primer nivel de la muestra (`$sample`), `_id` primero. */
  campos: DbDocCampoMuestra[]
  /** Tamaño de la muestra sobre la que se calculó `campos`. */
  muestra: number
}

/** Una celda de la tabla: un campo de primer nivel de un documento. */
export interface DbDocCelda {
  tipo: DbDocTipo
  /** Lo que pinta la celda (corto; un subdocumento se resume: `{ 3 campos }`, `[ 5 ]`). */
  vista: string
}

export interface DbDocDocumento {
  /** El `_id` en EJSON CANÓNICO: la identidad para «Enviar». */
  idEjson: string
  /** El documento entero en notación del shell (el panel JSON y la edición). */
  texto: string
  /** Las celdas por nombre de campo de primer nivel; un campo ausente no está. */
  celdas: Record<string, DbDocCelda>
}

export interface DbDocPagina {
  /** Cursor vivo en el trabajador para pedir más, o null si no quedan. */
  lector: string | null
  documentos: DbDocDocumento[]
  /**
   * Las columnas en su orden: las de la muestra de la colección y, detrás, las que aparezcan
   * en esta página y no estuvieran (los documentos no tienen esquema).
   */
  columnas: string[]
  ms: number
}

export interface DbDocPedirBases {
  conexionId: string
  refrescar?: boolean
}

export interface DbDocPedirColecciones {
  conexionId: string
  base: string
  refrescar?: boolean
}

export interface DbDocPedirDetalle {
  conexionId: string
  base: string
  coleccion: string
  refrescar?: boolean
}

export interface DbDocConsultar {
  conexionId: string
  base: string
  coleccion: string
  /** Filtro en notación del shell (`{ edad: { $gt: 30 } }`); '' = todos. Se INTERPRETA, no se evalúa. */
  filtro: string
  /** Proyección en notación del shell; '' = sin proyección. */
  proyeccion: string
  /** Orden en notación del shell (`{ _id: -1 }`); '' = el natural. */
  orden: string
  /**
   * El filtro GUIADO (`shared/filtroGuiado.ts`), que el main compila a un
   * documento de filtro. EXCLUYENTE con un `filtro` de texto no vacío.
   */
  filtroGuiado?: DbFiltroGuiado
  /**
   * El orden de la CABECERA, por prioridad (el `sort` que arma el main). EXCLUYENTE
   * con un `orden` de texto no vacío: la interfaz vacía el texto al ordenar por la cabecera.
   */
  ordenColumnas?: DbOrdenColumna[]
  /** Documentos por página (el `batchSize`). */
  maxDocumentos: number
  /** Para cancelar con `DBX_CHANNELS.CANCELAR`. */
  peticionId?: string
}

export interface DbDocPedirMas {
  lector: string
  maxDocumentos: number
  peticionId?: string
}

export interface DbDocEjecutar {
  perfilId: string
  consolaId: string
  conexionId: string
  /** La base de la consola (el `use x` de mongosh la cambia; el main la devuelve en el resultado). */
  base: string | null
  /** UNA sentencia (`db.col.find({…}).limit(5)`, `show collections`…), del texto de la consola. */
  texto: string
  /** Desplazamiento de `texto` dentro de la consola, para ubicar los errores. */
  desplazamiento: number
  /** Confirmación de una escritura en una conexión de PRODUCCIÓN (el main es la segunda barrera). */
  confirmado?: boolean
  peticionId?: string
  /** Documentos de la primera página (las «filas por página» de la consola); sin él, 100. */
  maxDocumentos?: number
}

/** Lo que devuelve una sentencia de la consola. */
export type DbDocResultado =
  /** Documentos (find, aggregate): la primera página, con cursor para más. */
  | {
      tipo: 'documentos'
      pagina: DbDocPagina
      base: string | null
      /** La colección de la sentencia (`db.col.find`), o null (`db.aggregate`, `show`). */
      coleccion: string | null
      /** Avisos del clasificador (JavaScript de servidor: `$where`, `$function`…). */
      avisos?: string[]
    }
  /** Un valor suelto (count, distinct, show dbs, un findOne), en notación del shell. */
  | { tipo: 'valor'; texto: string; base: string | null; avisos?: string[] }
  /** Una escritura: cuántos documentos casaron, cambiaron, se insertaron o borraron. */
  | {
      tipo: 'escritura'
      casados: number
      modificados: number
      insertados: number
      borrados: number
      base: string | null
      avisos?: string[]
    }
  /** `use x`: solo cambia la base de la consola. */
  | { tipo: 'base'; base: string }

/** Un cambio de la tabla, identificado por `_id` (D3). Los textos van en notación del shell. */
export type DbDocCambio =
  | { tipo: 'insertar'; documento: string }
  /** Reemplaza el documento entero por `documento` (el panel JSON editado). */
  | { tipo: 'reemplazar'; idEjson: string; documento: string }
  /** `$set`/`$unset` de campos de primer nivel (la celda editada). */
  | { tipo: 'actualizar'; idEjson: string; poner: Record<string, string>; quitar: string[] }
  | { tipo: 'borrar'; idEjson: string }

export interface DbDocEnviar {
  conexionId: string
  base: string
  coleccion: string
  cambios: DbDocCambio[]
  /** Confirmación de PRODUCCIÓN (como `DbEnviarCambios.confirmado`). */
  confirmado?: boolean
  /** D11: confirmación de que, sin transacciones, un fallo deja aplicados los anteriores. */
  confirmadoSinTransaccion?: boolean
}

export interface DbDocResultadoEnvio {
  /** ¿Fue en una transacción (todo o nada)? false = servidor suelto (D11). */
  transaccion: boolean
  /** Cuántos cambios quedaron aplicados, en orden (todos, o los anteriores al que falló). */
  aplicados: number
  /** El que falló (índice en `cambios`) y por qué; ausente si entraron todos. */
  fallo?: { indice: number; mensaje: string; codigo?: string }
}

/** Para que el main y el preload tipen los handlers sin repetir la forma. */
export type DbDocRespuesta<T> = DbRespuesta<T>
