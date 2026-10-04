// =============================================================================
// Tipos y topes comunes de la edición de la rejilla: la identidad, la petición «Enviar» ya
// validada, la sentencia lista para el trabajador y el candado por lotes. Sin lógica.
// Lo reexporta `edicionRejilla.ts`; nadie fuera de esa familia importa de aquí.
// Decisiones: docs/decisiones/bd/rejilla-envio-bloqueos.md
// =============================================================================

import type { DbCambioFila, DbIdentidadFila } from '../../../shared/db-explorador-ipc.ts'
import type { BindEntradaLob, BindValorSqlite } from './protocoloTrabajador.ts'

/**
 * Cambios por envío. Cada uno es un viaje al servidor dentro de la misma transacción: es un
 * tope de sensatez del payload, no un límite del producto que se espere tocar.
 */
export const MAX_CAMBIOS_ENVIO = 10_000
/** Columnas por fila (Oracle admite 1000; PG 1600). */
export const MAX_COLUMNAS_CAMBIO = 1600
/** Valores de clave por fila. */
export const MAX_CLAVE = 64
/** Tope de un identificador que llega del renderer (como el del controlador). */
export const MAX_IDENT = 1024

export interface EnvioValidado {
  conexionId: string
  peticionId: string
  /** Sin validar aquí: el controlador lo pasa por su `refObjeto`. */
  objeto: unknown
  identidad: DbIdentidadFila
  cambios: DbCambioFila[]
  confirmado: boolean
}

export type Validacion<T> = { ok: true; valor: T } | { ok: false; mensaje: string }

export interface FalloCambio {
  /** El cambio culpable (0-based). */
  indice: number
  mensaje: string
}

/**
 * Binds de una sentencia de «Enviar», ya adaptados a la columna que los recibe (SQLite: la
 * clase de almacenamiento que conserva el valor y la clave binaria como BLOB).
 */
export type BindsEnvio = Array<string | null | BindEntradaLob | BindValorSqlite>

/** Oracle, UPDATE y DELETE: la identidad de la fila de un cambio, para el candado por lotes. */
export interface ClaveBloqueo {
  /** La tabla, citada como en su DML: `"HR"."DOCS"`. */
  tabla: string
  /** Lo que la identifica, citado como en su DML: `ROWID`, o las columnas de la PK. */
  columnas: string[]
  /** Los valores, en ese orden y adaptados como los del DML (hex desnudo, NVARCHAR…). */
  binds: BindsEnvio
}

/** Una sentencia de «Enviar», lista para el trabajador. */
export interface SentenciaEnvio {
  tipo: DbCambioFila['tipo']
  sql: string
  binds: BindsEnvio
  /** Oracle, UPDATE y DELETE: la identidad de su fila para el candado por lotes. */
  bloqueo?: ClaveBloqueo
}

/** Un `SELECT … FOR UPDATE` de varias filas de «Enviar» y los cambios que cubre. */
export interface LoteBloqueo {
  sql: string
  binds: BindsEnvio
  /** Los índices de los cambios que cubre, en su orden en el envío. */
  indices: number[]
}
