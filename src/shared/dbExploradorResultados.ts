// =============================================================================
// Tipos de las RESPUESTAS y los RESULTADOS del explorador: el sobre `DbRespuesta`, la sesión a
// la que se refiere una petición, celdas, columnas, páginas, errores con su motivo y lo que
// devuelve cada sentencia de una consola. Van juntos porque se citan entre sí (`DbRespuesta`
// lleva un `DbErrorSql`, y los resultados, un `DbRefSesion`).
// Es una sección del contrato `db-explorador-ipc.ts`, que la reexporta entera: los importadores
// siguen importando de allí. Solo tipos y constantes neutrales (lo compilan node y web).
// Decisiones: docs/decisiones/bd/contratos-explorador-sql.md
// =============================================================================

import type { DriverRequerido } from './db-ipc.ts'

// --- Respuestas ---------------------------------------------------------------

export type DbRespuesta<T> = { ok: true; valor: T } | { ok: false; error: DbErrorSql }

export type DbRolSesion = 'meta' | 'datos' | 'consola'
export type DbRefSesion =
  | { rol: 'meta' | 'datos'; conexionId: string }
  | { rol: 'consola'; perfilId: string; consolaId: string }

/** Cómo resolver una transacción pendiente antes de una operación que la cerraría. */
export type DbResolverTx = 'commit' | 'rollback'

/**
 * Lo que devuelve una resolución EN BLOQUE: hoy, DESCONECTAR con `resolver`, que
 * resuelve todas las sesiones de la conexión con una sola respuesta del usuario.
 *
 * En bloque, «Confirmar» confirma las pendientes y REVIERTE las `fallida`: es lo único
 * posible para ellas (PG convertiría el COMMIT en ROLLBACK igualmente) y rechazarlo
 * dejaba el bloque a medias. `revertidasFallidas` dice cuáles fueron, para que la UI
 * no deje creer que se confirmaron. Ausente = ninguna (también con `rollback`, donde
 * revertir es lo pedido y no hay nada que avisar).
 *
 * Todos los campos son OPCIONALES a propósito: antes esta respuesta era `void`, y así
 * quien la ignore sigue siendo correcto. UNA sola consola (su Commit, cerrarla o
 * borrarla con «Confirmar») NO es un bloque: ahí una fallida se sigue rechazando
 * (`txPendiente` con el mensaje de «solo se puede revertir»).
 */
export interface DbResolucionBloque {
  /** Sesiones cuya tx estaba `fallida` y se revirtieron aunque se pidió «Confirmar». */
  revertidasFallidas?: DbRefSesion[]
}

// --- Resultados ---------------------------------------------------------------

/**
 * Una celda. Los números viajan SIEMPRE como texto exacto (NUMBER(38) y numeric
 * no caben en un double). Las fechas, como texto en la hora de pared del servidor
 * (sin `Date` de JS, que las desplazaba a UTC). El binario, como '0x…' truncado.
 */
export type DbCelda = string | boolean | null

export type DbTipoLogico =
  | 'texto'
  | 'numero'
  | 'fecha'
  | 'fechaHora'
  | 'booleano'
  | 'binario'
  | 'lob'
  | 'json'
  | 'otro'

export interface DbColumnaResultado {
  nombre: string
  tipoLogico: DbTipoLogico
  /**
   * Nombre del tipo en el motor según el DRIVER (VARCHAR2, NVARCHAR2(20), int8…). De él
   * DECIDEN la rejilla y el exportado (qué original se compara, si es binaria, si un RAW va
   * como RAW). En Oracle no lleva el tamaño de un VARCHAR2/CHAR, que el driver no sabe dar
   * con su unidad (ver `tipoMotorOracle` en `tdb/celdas.cjs`).
   */
  tipoMotor: string
  /**
   * El tipo DECLARADO según el catálogo ('VARCHAR2(40 CHAR)',
   * 'NUMBER(*,0)'), solo en las pestañas de TABLA de Oracle y solo si el catálogo conoce la
   * columna. Es solo para ENSEÑARLO (cabecera y visor, `tipoVisible`): ninguna decisión lo lee,
   * porque puede venir de una caché de antes de un DDL hecho fuera de Tessera.
   */
  tipoDeclarado?: string
  nullable?: boolean
}

export interface DbPagina {
  /** `DbCelda[][]` serializado: el renderer lo parsea una sola vez. */
  filasJson: string
  /** Índice (0-based) de la primera fila de esta página dentro del resultado. */
  desde: number
  hayMas: boolean
  /**
   * Celdas recortadas, relativas a ESTA página. Longitud original en bytes para
   * binario y en unidades UTF-16 para texto.
   */
  recortes?: Array<[fila: number, columna: number, longitudOriginal: number]>
  /** La página se obtuvo re-ejecutando la consulta (PG, u Oracle con cursor expulsado). */
  reejecutada?: boolean
}

export interface DbTiempos {
  totalMs: number
  ejecucionMs: number
  lecturaMs: number
}

export type DbMotivoError =
  | 'servidor'
  | 'cancelada'
  | 'sesionPerdida'
  | 'soloLectura'
  | 'timeout'
  | 'driver'
  | 'limite'
  | 'txPendiente'
  | 'sinSecreto'
  | 'noReleible'
  | 'ocupada'
  /** Faltan o sobran parámetros (`:x`, `$1`) para la sentencia: no se envió. */
  | 'parametros'
  /**
   * Conexión de PRODUCCIÓN y una escritura sin `confirmado`: no se envió. El
   * renderer pide la confirmación antes; el main es la segunda barrera.
   */
  | 'produccion'
  /**
   * Solo SQL Server. Venció el TOPE de espera de un bloqueo (`SET LOCK_TIMEOUT`,
   * error 1222) al LEER: otra transacción (quizá una consola tuya) tiene la tabla o el
   * catálogo bloqueados. La interfaz ofrece «Reintentar» y «Leer sin esperar»
   * (`DbAbrirTabla.sinEsperar`). Tessera informa, no prohíbe.
   */
  | 'bloqueo'
  /**
   * Solo Redis. Un comando PELIGROSO (FLUSHALL, FLUSHDB, KEYS, CONFIG,
   * SHUTDOWN, DEBUG) sin `confirmadoPeligroso`: no se envió. La interfaz pregunta y lo
   * reenvía confirmado; el main es la segunda barrera, como con 'produccion'.
   */
  | 'peligroso'
  /**
   * Solo MongoDB. «Enviar» de más de un cambio en un servidor SIN
   * transacciones (suelto) sin `confirmadoSinTransaccion`: no se envió. La interfaz avisa de
   * que un fallo deja aplicados los anteriores y lo reenvía confirmado.
   */
  | 'sinTransaccion'
  | 'interno'

export interface DbErrorSql {
  mensaje: string
  /** 'ORA-00933', un SQLSTATE de PG, 'NJS-…'. */
  codigo?: string
  /** UTF-16, relativa al texto enviado por el renderer (o al campo `campo`). */
  posicion?: number
  /**
   * 'filtro' | 'proyeccion' | 'orden': la barra de la pestaña de colección de
   * MongoDB. 'filtro' es también el FILTRO GUIADO (de tabla y de colección):
   * `condicion` dice cuál, y `posicion` no se usa.
   */
  campo?: 'where' | 'orderBy' | 'filtro' | 'proyeccion' | 'orden'
  /** Con `campo: 'filtro'` del filtro guiado: índice de la condición culpable, si se sabe. */
  condicion?: number
  motivo: DbMotivoError
  requiereDriver?: DriverRequerido
  /** Con `motivo: 'txPendiente'`: qué sesiones tienen la transacción abierta. */
  txPendientes?: DbRefSesion[]
  /**
   * Con `motivo: 'parametros'`: las claves que faltan, como en `DbBinds`
   * (`ID`, `Id`, `1`). El mensaje ya las nombra como se escribieron.
   */
  parametros?: string[]
  /**
   * Solo SQL Server. El objeto donde ocurrió el error (`procName`, `dbo.p_err`)
   * cuando no es el texto enviado: un error DENTRO de un procedimiento llamado con EXEC, cuya
   * línea es la de su cuerpo y no tiene `posicion` en la consola. Para decirlo en el mensaje.
   */
  objeto?: string
}

/**
 * Una línea de la SALIDA DEL SERVIDOR: `DBMS_OUTPUT` en Oracle, NOTICE/INFO/WARNING
 * en PG. Va dentro del resultado de la sentencia que la produjo.
 */
export interface DbLineaSalida {
  texto: string
  /** WARNING de PG. Oracle no distingue: DBMS_OUTPUT es siempre informativo. */
  aviso?: boolean
}

/**
 * Un error (o aviso) de compilación de PL/SQL, leído de ALL_ERRORS tras un
 * `CREATE [OR REPLACE] PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE`.
 */
export interface DbErrorCompilacion {
  /**
   * UTF-16 y relativa al texto ENVIADO, como `DbErrorSql.posicion`: el main hace la
   * cuenta (ALL_ERRORS numera desde la palabra PROCEDURE/FUNCTION…, no desde CREATE).
   * Ausente si no se pudo situar.
   */
  posicion?: number
  /** Línea y columna tal como las da el servidor, para el texto de Salida. */
  linea: number
  columna: number
  mensaje: string
  esAviso: boolean
}

export interface DbResultadoFilas {
  tipo: 'filas'
  columnas: DbColumnaResultado[]
  pagina: DbPagina
  /** Id para pedir más o contar; no nulo SI Y SOLO SI `pagina.hayMas`. */
  lector: string | null
  /** No se puede volver a leer sin re-ejecutar algo que escribe (RETURNING). */
  noReleible?: boolean
  /** RETURNING: filas afectadas además de las devueltas. */
  afectadas?: number
  tiempos: DbTiempos
  avisos?: string[]
  salida?: DbLineaSalida[]
  /** Solo SQL Server. Los conjuntos EXTRA de esta sentencia (ver `DbConjuntoSiguiente`). */
  siguientes?: DbConjuntoSiguiente[]
}

export interface DbResultadoAfectadas {
  tipo: 'afectadas'
  filas: number
  /** Verbo del servidor: UPDATE, INSERT, DELETE, MERGE. */
  comando: string
  tiempos: DbTiempos
  avisos?: string[]
  salida?: DbLineaSalida[]
  /** Solo SQL Server. Los conjuntos EXTRA de esta sentencia (ver `DbConjuntoSiguiente`). */
  siguientes?: DbConjuntoSiguiente[]
}

export interface DbResultadoHecho {
  tipo: 'hecho'
  comando: string
  tiempos: DbTiempos
  avisos?: string[]
  salida?: DbLineaSalida[]
  /** Solo avisos (PLSQL_WARNINGS): la unidad compiló. */
  compilacion?: DbErrorCompilacion[]
  /** Solo SQL Server. Los conjuntos EXTRA de esta sentencia (un EXEC que devolvió filas). */
  siguientes?: DbConjuntoSiguiente[]
}

export interface DbResultadoError {
  tipo: 'error'
  error: DbErrorSql
  tiempos: DbTiempos
  salida?: DbLineaSalida[]
  /** El CREATE llegó al servidor pero la unidad quedó INVÁLIDA (ORA-24344). */
  compilacion?: DbErrorCompilacion[]
  /**
   * Solo SQL Server. Los conjuntos que la sentencia llegó a devolver ANTES de fallar (un
   * lote de T-SQL con alcance de lote: `DECLARE …; SELECT …; SELECT 1/0`), en orden.
   */
  anteriores?: DbConjuntoSiguiente[]
}

export type DbResultadoSentencia =
  | DbResultadoFilas
  | DbResultadoAfectadas
  | DbResultadoHecho
  | DbResultadoError

/**
 * Solo SQL Server. Un conjunto de resultados EXTRA de una misma sentencia (un
 * EXEC de procedimiento, un lote de T-SQL con varios SELECT): filas SIN lector (no se
 * paginan; si hay más de las pedidas, `pagina.hayMas` y un aviso) o filas afectadas. Van en
 * `siguientes` del resultado de la sentencia, en orden, y la interfaz los enseña como
 * subpestañas «N.2, N.3…». En Oracle, PG y SQLite no llegan nunca.
 */
export type DbConjuntoSiguiente =
  | (Omit<DbResultadoFilas, 'siguientes' | 'lector'> & { lector: null })
  | Omit<DbResultadoAfectadas, 'siguientes'>
