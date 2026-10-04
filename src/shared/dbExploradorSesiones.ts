// =============================================================================
// Tipos del estado de las SESIONES y sus transacciones, de las consolas en disco, de los
// cambios sin enviar al cerrar la app y los topes que comparten main y renderer.
// Es una sección del contrato `db-explorador-ipc.ts`, que la reexporta entera: los importadores
// siguen importando de allí. Solo tipos y constantes neutrales (lo compilan node y web).
// Decisiones: docs/decisiones/bd/contratos-explorador-sql.md
// =============================================================================

import type { DbRefSesion } from './dbExploradorResultados.ts'

// --- Sesiones -----------------------------------------------------------------

export type DbFaseSesion = 'cerrada' | 'abriendo' | 'lista' | 'ocupada' | 'perdida'
export type DbTxModo = 'auto' | 'manual'
/**
 * - `abierta`: solo PG. Hay un BEGIN sin xid (solo lecturas). Retiene
 *   AccessShareLock, por eso se informa.
 * - `pendiente`: hay cambios sin confirmar.
 * - `fallida`: PG en estado 'E'. Solo cabe Rollback.
 */
export type DbEstadoTx = 'ninguna' | 'abierta' | 'pendiente' | 'fallida'

export interface DbAvisoSesion {
  tipo: 'perdida' | 'inactividad' | 'caida' | 'editada' | 'expulsada'
  /** Había una transacción pendiente y el servidor la revirtió. */
  txPerdida: boolean
  mensaje: string
  en: number
}

export interface DbEstadoSesion {
  ref: DbRefSesion
  conexionId: string
  fase: DbFaseSesion
  ocupadaDesde?: number
  txModo: DbTxModo
  tx: DbEstadoTx
  /** Sentencias que escribieron desde que la transacción dejó de estar `ninguna`. */
  sentenciasEnTx: number
  /** Esquema actual de la sesión; se relee tras `ALTER SESSION`/`SET` y PL/SQL. */
  esquema: string | null
  soloLectura: boolean
  driver?: { modo: 'thin' | 'thick' | 'nativo'; driverId: string | null; version: string }
  aviso?: DbAvisoSesion
}

export interface DbEventoCatalogo {
  conexionId: string
  esquema?: string
  motivo: 'ddl' | 'refrescar' | 'edicion' | 'esquemas'
}

// --- Consolas en disco --------------------------------------------------------

export interface DbConsolaInfo {
  id: string
  perfilId: string
  conexionId: string
  /** Nombre visible y del archivo (sin `.sql`): consola_1, ventas_marzo… */
  nombre: string
  /** POSIX, relativa al espacio de datos del perfil. Nunca una ruta del host. */
  rutaRelativa: string
  modificadaEn: number
  bytes: number
  /** Esquema elegido en la consola (`CONSOLA_ESQUEMA`); ausente = el de la conexión. */
  esquema?: string
}

export interface DbConsolaTexto {
  texto: string
  version: string
}

export type DbEscrituraConsola =
  | { ok: true; version: string }
  | { ok: false; conflicto: true; texto: string; version: string }

// --- Cierre de la app: cambios de la rejilla sin enviar --------------------------

/**
 * Una pestaña de tabla con cambios SIN ENVIAR. Los cambios viven solo en el renderer
 * (no se persisten en ninguna parte), así que cerrar la app los tira: el main los lista
 * en su diálogo nativo de salida como lista las transacciones pendientes.
 */
export interface DbPestanaSinEnviar {
  /** `alias · ESQUEMA.TABLA`: lo que se lee en el diálogo. */
  etiqueta: string
  /** Lo mismo que cuenta «Enviar (N)» y «Descartar N cambios» de la pestaña. */
  cambios: number
}

/** Respuesta a `EV_PEDIR_SIN_ENVIAR`, por `SIN_ENVIAR`. */
export interface DbSinEnviar {
  /** El `id` de la pregunta: una respuesta tardía a una anterior no vale para esta. */
  id: number
  /** Solo las pestañas con algún cambio (vacía = no hay nada que perder). */
  pestanas: DbPestanaSinEnviar[]
}

// --- Topes compartidos --------------------------------------------------------

/** Filas por página por defecto. */
export const DB_PAGINA_POR_DEFECTO = 500
/** El main rechaza páginas más grandes. */
export const DB_PAGINA_MAX = 5000
/** Tamaño máximo del texto de una consola. */
export const DB_CONSOLA_MAX_BYTES = 5 * 1024 * 1024
