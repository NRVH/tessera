// =============================================================================
// Tipos del clasificador de sentencias SQL: clase, peligro, objeto, sesión y la `Clasificacion`.
// Sin dependencias; los reexporta `clasificarSql.ts`, que es la entrada del clasificador.
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

export type ClaseSentencia =
  | 'consulta'
  | 'bloqueo'
  | 'dml'
  | 'ddl'
  | 'plsql'
  | 'rutina'
  | 'tx'
  | 'sesion'
  | 'cliente'
  | 'otra'

/** Lo que merece un diálogo de confirmación antes de enviarse. */
export type PeligroSentencia = 'dmlSinWhere' | 'truncate' | 'dropObjeto'

export interface RefObjeto {
  /** Esquema PLEGADO, o null si no se escribió (= esquema actual de la sesión). */
  esquema: string | null
  /** Nombre PLEGADO como lo guarda el motor. */
  nombre: string
  /** El nombre se escribió entre comillas. */
  citado: boolean
  /** `@enlace` de Oracle. */
  dblink?: string
}

export interface ObjetoCreado extends RefObjeto {
  /** 'TABLE', 'PACKAGE BODY', 'MATERIALIZED VIEW'… */
  tipo: string
  /** Offset (UTF-16, en el texto tokenizado) de la palabra del tipo. */
  offsetTipo: number
}

/** Qué hace una sentencia de sesión con los parámetros. */
export interface SesionSentencia {
  /** `set`: fija `parametros`. `reset`: los restablece. `resetTodo`: RESET/DISCARD ALL. */
  accion: 'set' | 'reset' | 'resetTodo' | 'otra'
  /** En minúsculas: `current_schema`, `search_path`, `nls_date_format`… */
  parametros: string[]
}

export interface Clasificacion {
  clase: ClaseSentencia
  /** 'SELECT', 'UPDATE', 'CREATE PACKAGE BODY', 'ALTER SESSION'… */
  verbo: string
  /** Se envía como bloque PL/SQL: conserva `END;` y solo termina en `/`. */
  plsql: boolean
  /** Modifica (o puede modificar) datos o estructura. */
  escribe: boolean
  /** UPDATE/DELETE sin WHERE a su propio nivel de paréntesis. */
  sinWhere: boolean
  peligro: PeligroSentencia | null
  /** La única tabla que lee un SELECT simple (null con JOIN, coma, DUAL o WITH). */
  tablaUnica: RefObjeto | null
  objetoCreado: ObjetoCreado | null
  /** Esquema cuyo catálogo cambia (DDL). null = el esquema actual. */
  esquemaAfectado: string | null
  /** Se puede volver a ejecutar para leer más sin efectos (paginado por re-ejecución). */
  consultaPura: boolean
  /** Puede devolver un conjunto de filas. */
  devuelveFilas: boolean
  /** PG: no admite ir dentro de una transacción (VACUUM, …CONCURRENTLY). */
  noTransaccional: boolean
  /** Solo en la clase `sesion`. */
  sesion: SesionSentencia | null
  /**
   * T-SQL: detrás de la PRIMERA sentencia que devuelve filas, la unidad lleva más sentencias
   * que se ejecutan juntas (`SELECT …⏎SELECT 2`). Cortar ese conjunto con attention al llenar
   * la página abortaría las de detrás, así que el main no lo corta. Solo lo pone T-SQL.
   */
  masTrasLasFilas?: boolean
}

export type PermisoSoloLectura = { ok: true } | { ok: false; motivo: string }

/**
 * El «parámetro» de sesión con el que `USE base` entra en `SesionSentencia.parametros`: USE
 * cambia de BASE, no un parámetro, y se permite en solo lectura donde USE es un verbo del dialecto.
 */
export const PARAMETRO_USE = 'use'
