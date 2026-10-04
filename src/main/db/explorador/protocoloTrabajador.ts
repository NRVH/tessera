// =============================================================================
// Protocolo entre el main y el proceso de sesión (`src/tdb/sesion.cjs`, uno por conexión):
// los tipos de los mensajes por el canal IPC de `fork` y los códigos de error de Tessera. El
// trabajador ejecuta lo que se le da; lo que exige conocer SQL lo decide el main y viaja en
// `OpcionesEjecucion`. El correlador vive en `sesiones/correlador.ts` y se reexporta aquí.
// Decisiones: docs/decisiones/bd/sesiones-protocolo-del-trabajador.md
// =============================================================================

import type { DbColumnaResultado, DbEstadoTx, DbLineaSalida, DbRolSesion } from '../../../shared/db-explorador-ipc'
import type { DbAutenticacion, DbMotor, DbTls, DriverRequerido } from '../../../shared/db-ipc'
import type {
  DbDocBase,
  DbDocCambio,
  DbDocColeccion,
  DbDocDetalleColeccion,
  DbDocPagina,
  DbDocResultado,
  DbDocResultadoEnvio
} from '../../../shared/db-documentos-ipc'
import type { DbKvBases, DbKvPaginaClaves, DbKvResultado, DbKvTipo, DbKvValor } from '../../../shared/db-claves-ipc'

/** Versión del protocolo; `iniciar` la comprueba y un desajuste mata el proceso. */
export const VERSION_PROTOCOLO = 1

// --- Datos que viajan en las peticiones -----------------------------------------------

/** La conexión tal como la necesita el driver. Sin secreto: ese va aparte. */
export interface ConexionTrabajador {
  id: string
  alias: string
  motor: DbMotor
  host: string
  port: number
  database?: string
  sid?: string
  user: string
  /**
   * La solo lectura que IMPONE el explorador (`soloLecturaImpuesta.ts`), NO la casilla de la
   * conexión: esa es de los agentes (`tdb` la lee del registro por su cuenta). En el producto,
   * false: el trabajador de SQLite abre el archivo en lectura-escritura.
   */
  readonly: boolean
  /** Pack de Instant Client preferido (Oracle thick). */
  driverId?: string | null
  /**
   * Motor de ARCHIVO (SQLite): la ruta CANÓNICA guardada en el registro
   * (`ConnectionStore`, `archivo`). La pone el main desde el registro, nunca el renderer
   * (que solo ve `archivoVisible`); el trabajador la abre con la guardia de `sqliteComun`.
   * `host`/`port`/`user` van vacíos ('' / 0 / '').
   */
  archivo?: string
  /**
   * SQL Server: Los campos de `DbConnection` del mismo nombre, tal como los
   * guardó el main (solo si el motor los declara en `conexion.opcionales`). El trabajador los
   * pasa a tedious con `opcionesConexion` de `src/tdb/sqlserverComun.cjs`.
   */
  instancia?: string
  autenticacion?: DbAutenticacion
  dominio?: string
  tls?: DbTls
  /** MongoDB: Ver `DbConnection.srv` y `opcionesUri`; los pasa `mongoComun.cjs`. */
  srv?: boolean
  opcionesUri?: string
}

/** Lo que hoy arma `tdb.cjs` para cargar drivers (catálogo publicado por el main). */
export interface CtxDrivers {
  packs: unknown[]
  externos: Record<string, string>
  driversDir: string
  /** Sale en v$session.client_identifier / application_name. */
  usuarioWindows: string
}

export interface OpcionesApertura {
  /** callTimeout (Oracle) / statement_timeout (PG). 0 = sin límite. */
  timeoutMs: number
  /** Modo de transacción inicial: `false` = Manual. Por defecto Auto. */
  autoCommit?: boolean
  /** Etiqueta de v$session.action y de application_name. Por defecto, el rol. */
  accion?: string
}

/**
 * Binds. PG: posicionales ($1…), y un `string[]` viaja como array de PG
 * (`= ANY($1::text[])`, lo usa el catálogo). Oracle: posicionales o por nombre.
 */
export type BindsTrabajador =
  | Array<string | number | null | string[] | BindEntradaLob | BindValorSqlite>
  | Record<string, string | number | null | BindSalidaTexto | BindEntradaLob>
  | BindsSqlite

/**
 * SQLite, parámetros de una sentencia de CONSOLA (`?`, `?NNN`, `:x`, `@x`, `$x`;
 * `bindsConsola.ts`): `nombrados` por su nombre COMPLETO (`:x`, `@x`, `$x`), y
 * `anonimos` los valores de los índices de SQLite que no son un nombre con `:`/`@`/`$`
 * (los `?` y los `?NNN`), en orden de índice: node:sqlite enlaza los anónimos saltando
 * esos nombres (medido). Un ARRAY a secas en SQLite son los valores de `?1`, `?2`… (el SQL
 * de Tessera: catálogo, rejilla, «Enviar»).
 */
export interface BindsSqlite {
  nombrados: Record<string, string | null>
  anonimos: Array<string | null>
}

/**
 * SQLite, «Enviar» de la rejilla: un texto que se enlaza con la CLASE DE ALMACENAMIENTO que
 * conserva la del valor (una columna sin afinidad que guardaba 42 como entero seguiría
 * guardando 43 como entero, no como el texto '43'; medido). La decide el main
 * (`sesionSqlite.ts`, `bindTextoEdicion`) solo cuando el texto la representa sin pérdida;
 * el trabajador, si aun así no cupiera, lo enlaza como texto. 'blob': una CLAVE binaria,
 * con `valor` en hexadecimal sin `0x` (un texto hexadecimal no casa con un BLOB).
 */
export interface BindValorSqlite {
  sqlite: 'entero' | 'real' | 'blob'
  valor: string
}

/**
 * Oracle, bind de ENTRADA de un texto con su TIPO («Enviar» de la rejilla):
 *   - 'clob' / 'nclob': hacia un CLOB/NCLOB. Como VARCHAR2, un texto de más de 4000
 *     bytes no cabe en una sentencia SQL (ORA-01461 / ORA-12899); como CLOB, el driver
 *     crea un LOB temporal y cabe entero;
 *   - 'nvarchar': hacia una NCHAR/NVARCHAR2 (o un NCLOB corto), en el juego
 *     NACIONAL. Como VARCHAR pasaría por el juego de la base, y en una que no es Unicode
 *     lo que no cabe en él llegaría como «?».
 * El main lo pone SOLO en los binds cuyo destino es una columna de ese tipo. PG no lo usa
 * (un `text` no tiene ni ese tope ni juego nacional) y su trabajador lo reduce a su
 * `valor` por si acaso.
 */
export interface BindEntradaLob {
  /**
   * 'char': el texto de «=»/«≠» del filtro guiado, en Oracle como
   * `DB_TYPE_CHAR`, para que compare como un literal (con relleno contra una columna CHAR).
   */
  entrada: 'clob' | 'nclob' | 'nvarchar' | 'char'
  valor: string | null
}

/**
 * Oracle, bind con nombre de SALIDA de texto (un CLOB): el trabajador lo lee ENTERO
 * hasta `tope` (unidades UTF-16) y lo devuelve en `ResultadoHechoTrabajador.salidas`.
 * Lo usa el DDL de DBMS_METADATA, que llega por un bloque PL/SQL.
 */
export interface BindSalidaTexto {
  salida: 'texto'
  tope?: number
}

/** Un bind de salida de texto ya leído. */
export interface SalidaTextoTrabajador {
  texto: string
  /** Longitud real (unidades UTF-16), aunque se haya recortado. */
  longitud: number
  recortado: boolean
}

/**
 * Cómo ejecutar UNA sentencia. Todo lo que exige conocer SQL lo decide el main.
 */
export interface OpcionesEjecucion {
  /**
   * `usuario`: celdas como texto exacto, LOB parciales, cursor vivo en Oracle,
   * cancelable con Stop. `catalogo`: SQL de Tessera, valores JSON nativos
   * (números como Number, arrays de PG parseados), sin recorte ni lector.
   */
  proposito: 'usuario' | 'catalogo'
  /** Tamaño de página. Internamente se piden `maxFilas + 1` para saber `hayMas`. */
  maxFilas: number
  /**
   * Oracle: id con el que registrar el cursor si quedan filas (lo genera el main).
   * Si falta, el trabajador genera uno. PG nunca deja cursores vivos.
   */
  lector?: string
  /** Re-ejecución para "más": descartar antes estas filas (en bloques de 5000). */
  saltarFilas?: number
  /** Respaldo ROWNUM de Oracle: quitar la última columna (`"__TESSERA_RN"`, `COLUMNA_RN` de sqlRejilla.ts). */
  quitarUltimaColumna?: boolean
  /**
   * Conexión de solo lectura. Oracle: `ROLLBACK` + `SET TRANSACTION READ ONLY` en un
   * viaje antes de la sentencia, y autoCommit apagado. PG: `BEGIN READ ONLY` …
   * `ROLLBACK` alrededor, salvo `fueraDeEnvoltorio`.
   */
  candadoRO?: boolean
  /** PG + candadoRO: la lista blanca de `SET` va FUERA del envoltorio (el ROLLBACK la desharía). */
  fueraDeEnvoltorio?: boolean
  /** Modo Manual. Oracle: autoCommit false. PG: BEGIN perezoso si el estado es 'I'. Si falta, el de la sesión. */
  txManual?: boolean
  /** PG: no abrir el BEGIN perezoso (clase `tx`, VACUUM…, contar, releer, sondas). */
  sinBegin?: boolean
  /**
   * Oracle: la sentencia es DML (INSERT/UPDATE/DELETE/MERGE). Thin devuelve
   * `rowsAffected` 0 también para un DDL, así que sin esta pista solo se informa
   * `afectadas` si hubo filas. PG no la necesita: manda el tag del servidor.
   */
  esDml?: boolean
  /** Leer el estado EXACTO de la tx tras la sentencia (puede costar un viaje). Por defecto true. */
  comprobarTx?: boolean
  /** Volver a fijar los formatos de sesión tras la sentencia (PL/SQL con EXECUTE IMMEDIATE…). */
  refijarFormatos?: boolean
  /** Devolver el esquema actual tras la sentencia (un viaje más). */
  leerEsquema?: boolean
  /** Tope por celda de texto (unidades UTF-16). Por defecto 64 Ki (0 en catálogo = sin tope). */
  topeCelda?: number
  /** Tope de `filasJson` por respuesta (unidades UTF-16). Por defecto 4 Mi. */
  topeRespuesta?: number
  /** Tope de bytes de una celda binaria. Por defecto la mitad del de celda. */
  topeBinario?: number
  /**
   * Recoger la SALIDA DEL SERVIDOR de la sentencia (`salida` del resultado o del
   * error). Oracle: DBMS_OUTPUT.GET_LINES tras la sentencia (un viaje más, por eso lo
   * decide el main por clase). PG: los NOTICE que llegan mientras corre (gratis).
   */
  salidaServidor?: boolean
  /**
   * PG, SOLO exportar: el cursor sigue abierto entre lecturas (`leer`) hasta que se
   * agota o se cierra con `cerrarLector`. Sin esto PG nunca deja cursores vivos.
   * Oracle no lo necesita: con `lector` su resultSet ya persiste.
   */
  mantenerCursor?: boolean
  /**
   * SQLite: la sentencia es un EXPLAIN [QUERY PLAN] que no ejecuta nada. Se prepara y se
   * lee con el perfil 'explain' del autorizador, también en una conexión de solo lectura
   * (medido: EQP de un INSERT, un CREATE o un VACUUM INTO no escribe nada). Los demás
   * motores no la miran.
   */
  soloExplicar?: boolean
  /**
   * SQLite, paginado por clave ('keyset', `sqlRejilla.ts`): las ÚLTIMAS N columnas del
   * resultado son la clave. El trabajador las QUITA de la página y devuelve las de la última
   * fila entregada en `ultimaClave`, con su clase de almacenamiento.
   */
  claveAlFinal?: number
  /**
   * SQL Server: La sentencia es una CONSULTA PURA (`Sentencia.consultaPura`
   * del main: un SELECT sin efectos). SQL Server la usa para dos cosas: no marcar la
   * transacción como 'pendiente' por una lectura (sin permiso para la DMV, el estado se
   * deduce), y poder cortar con attention al llenar la página (`cortarAlLlenar`). Los demás
   * motores no la miran.
   */
  consultaPura?: boolean
  /**
   * SQL Server: Al llegar la fila `maxFilas + 1`, cortar la petición (attention) en
   * vez de leer y descartar el resto. Solo con una consulta pura y sin transacción abierta
   * (el trabajador lo vuelve a mirar): un attention corta el LOTE entero y, con XACT_ABORT
   * ON, revierte la transacción (medido). Los demás motores ya cortan con su cursor.
   */
  cortarAlLlenar?: boolean
  /**
   * SQL Server: «Leer sin esperar» (`DbAbrirTabla.sinEsperar`): la sentencia va en
   * READ UNCOMMITTED y la sesión vuelve a su aislamiento después. Los motores donde un
   * lector no espera a un escritor (Oracle, PG, SQLite en WAL) no lo miran.
   */
  sinEsperar?: boolean
}

// --- Peticiones main -> trabajador ------------------------------------------------------

export type Peticion =
  | { id: number; op: 'iniciar'; v: number }
  | {
      id: number
      op: 'abrir'
      sesion: string
      rol: DbRolSesion
      conexion: ConexionTrabajador
      secreto: string
      ctx: CtxDrivers
      opciones: OpcionesApertura
    }
  | { id: number; op: 'ejecutar'; sesion: string; sql: string; binds?: BindsTrabajador; opciones: OpcionesEjecucion }
  | { id: number; op: 'leer'; sesion: string; lector: string; maxFilas: number }
  | { id: number; op: 'cerrarLector'; sesion: string; lector: string }
  | { id: number; op: 'cancelar'; sesion: string }
  | { id: number; op: 'tx'; sesion: string; accion: 'commit' | 'rollback' | 'estado' }
  /**
   * El main NO la envía hoy: el modo de transacción viaja en las opciones de
   * `abrir` (`autoCommit`) y de cada `ejecutar` (`txManual`). Se conserva porque el
   * trabajador la implementa y `test-sesion-postgres.mts` la ejercita.
   */
  | { id: number; op: 'autoCommit'; sesion: string; valor: boolean }
  | { id: number; op: 'cerrar'; sesion: string }
  | { id: number; op: 'salir' }
  /** Una operación de un motor de DOCUMENTOS (ver `PeticionDocs`). */
  | ({ id: number; op: 'docs'; sesion: string } & PeticionDocs)
  /** Una operación de un motor de CLAVES (ver `PeticionClaves`). */
  | ({ id: number; op: 'claves'; sesion: string } & PeticionClaves)

export type OpTrabajador = Peticion['op']
export type PeticionDe<O extends OpTrabajador> = Extract<Peticion, { op: O }>
/** Omit distributivo: una petición cualquiera sin su `id` (lo pone el correlador). */
export type SinId<T> = T extends unknown ? Omit<T, 'id'> : never
export type PeticionSinId = SinId<Peticion>
export type PeticionSinIdDe<O extends OpTrabajador> = SinId<PeticionDe<O>>

// --- Respuestas trabajador -> main -------------------------------------------------------

export type ClaseErrorTrabajador =
  | 'servidor'
  | 'cancelada'
  | 'perdida'
  | 'timeout'
  | 'driver'
  | 'soloLectura'
  | 'protocolo'
  | 'ocupada'

export interface ErrorTrabajador {
  mensaje: string
  /** 'ORA-00942', SQLSTATE de PG ('42P01'), 'NJS-…', 'DPI-…' o 'TESSERA-…'. */
  codigo?: string
  /**
   * Posición del error, 0-based, en PUNTOS DE CÓDIGO del SQL que se ENVIÓ al
   * trabajador (Oracle: `err.offset` en bytes UTF-8, convertido; PG: `position`-1).
   * El main la pasa a UTF-16 y le suma el inicio de la sentencia.
   */
  offsetCp?: number
  /** PG: `internalPosition`-1, dentro de la consulta interna (cuerpo PL/pgSQL). */
  offsetInternoCp?: number
  /** PG: `internalQuery`, la consulta interna de una función SQL (con `offsetInternoCp`). */
  consultaInterna?: string
  /** PG: `where`, el contexto («PL/pgSQL function inline_code_block line 3 at RAISE»). */
  donde?: string
  /** PG: DETAIL y HINT del servidor, por separado para que el main los componga. */
  detalle?: string
  pista?: string
  /**
   * SQL Server: La LÍNEA del error (`lineNumber`), base 1, relativa al SQL
   * que se ENVIÓ al trabajador; SQL Server no da columna. La convierte a posición
   * `offsetDeError` (`PosicionServidor.linea`). Con varios errores a la vez (AggregateError),
   * la del primero.
   */
  linea?: number
  /** SQL Server: el objeto donde ocurrió (`procName`); ver `PosicionServidor.objeto`. */
  objeto?: string
  /**
   * SQL Server: Los conjuntos que la sentencia (un lote de T-SQL) devolvió ANTES de
   * fallar, en orden (`DbResultadoError.anteriores`).
   */
  anteriores?: ConjuntoSiguienteTrabajador[]
  /** Como en `ComunResultado`: el servidor revirtió la transacción que había al fallar. */
  revertidaPorServidor?: { codigo?: string }
  clase: ClaseErrorTrabajador
  requiereDriver?: DriverRequerido
  /** Salida del servidor que la sentencia escribió antes de fallar (con `salidaServidor`). */
  salida?: DbLineaSalida[]
  /**
   * MongoDB: En `consultar`, el campo de la barra de la pestaña de
   * colección cuyo texto no se pudo interpretar (con `offsetCp` relativo a ESE texto).
   */
  campoDocs?: 'filtro' | 'proyeccion' | 'orden'
}

/** Código de `ErrorTrabajador` cuando `leer`/`cerrarLector` no encuentra el cursor. */
export const CODIGO_LECTOR_DESCONOCIDO = 'TESSERA-LECTOR'
/** Código cuando se opera sobre una sesión que no existe en el trabajador. */
export const CODIGO_SESION_DESCONOCIDA = 'TESSERA-SESION'

interface ComunResultado {
  avisos?: string[]
  /** Estado de la transacción DESPUÉS de la sentencia. */
  tx: DbEstadoTx
  /** Solo con `leerEsquema`. `null` si no se pudo leer (tx fallida en PG). */
  esquema?: string | null
  /** Solo con `salidaServidor`, y solo si hubo alguna línea. */
  salida?: DbLineaSalida[]
  /**
   * SQL Server: Los conjuntos de resultados EXTRA de la MISMA sentencia (un
   * EXEC de procedimiento, un lote con varios SELECT; medido: sp_help devuelve 7), en orden;
   * el primero es el propio resultado. Cada uno sin `lector` (no se pagina dentro de un
   * conjunto extra: si pasa de `maxFilas`, `hayMas` y un aviso) y sin su propio `siguientes`.
   * Ausente = uno solo, que es lo de Oracle, PG y SQLite. La interfaz los enseña como
   * subpestañas «N.2, N.3…».
   */
  siguientes?: ConjuntoSiguienteTrabajador[]
  /**
   * El SERVIDOR revirtió la transacción sin que se lo pidieran (SQL Server: un 245
   * de conversión, un 1205 de interbloqueo, XACT_ABORT; medido, tedious emite
   * 'rollbackTransaction'): el aviso lo compone el main (`codigo` = el número del error).
   */
  revertidaPorServidor?: { codigo?: string }
}

/**
 * Un conjunto extra de `siguientes`: filas (sin lector) o afectadas. Sin lo que es
 * de la SENTENCIA y no de cada conjunto (el estado de la transacción, el esquema, la salida),
 * que va una vez, en el resultado principal.
 */
type SoloDeLaSentencia = 'siguientes' | 'revertidaPorServidor' | 'tx' | 'esquema' | 'salida'
export type ConjuntoSiguienteTrabajador =
  | (Omit<ResultadoFilasTrabajador, SoloDeLaSentencia | 'lector'> & { lector: null })
  | Omit<ResultadoAfectadasTrabajador, SoloDeLaSentencia>

export interface ResultadoFilasTrabajador extends ComunResultado {
  tipo: 'filas'
  columnas: DbColumnaResultado[]
  /** `DbCelda[][]` serializado. */
  filasJson: string
  nFilas: number
  hayMas: boolean
  /**
   * Cursor vivo para `leer`: Oracle (con `lector`) o PG con `mantenerCursor`. No nulo
   * solo si `hayMas` y quedó abierto.
   */
  lector: string | null
  recortes?: Array<[fila: number, columna: number, longitudOriginal: number]>
  /** PG: tag del servidor (SELECT, INSERT con RETURNING…). Oracle: null. */
  comando: string | null
  /** PG con RETURNING, si la sentencia terminó en esta página. */
  afectadas?: number
  msEjecucion: number
  msLectura: number
  /** Filas descartadas con `saltarFilas` (menos que las pedidas si el resultado se acabó). */
  saltadas?: number
  /** Lectores que esta ejecución expulsó por el tope LRU de 8. */
  lectoresExpulsados?: string[]
  /**
   * Con `claveAlFinal`: la clave de la ÚLTIMA fila entregada (la página siguiente va detrás
   * de ella). Un entero o un real con su clase (`BindValorSqlite`), el texto tal cual.
   * Ausente si la página no trajo filas.
   */
  ultimaClave?: Array<string | null | BindValorSqlite>
}

export interface ResultadoAfectadasTrabajador extends ComunResultado {
  tipo: 'afectadas'
  filas: number
  /** PG: UPDATE, INSERT, DELETE, MERGE, SELECT (CTAS)… Oracle: null (lo pone el main). */
  comando: string | null
  ms: number
}

export interface ResultadoHechoTrabajador extends ComunResultado {
  tipo: 'hecho'
  comando: string | null
  ms: number
  /** Oracle: "creado con errores de compilación" (ORA-24344 / `result.warning`). */
  advertencia?: { codigo?: string; mensaje: string }
  /** Oracle: los binds de salida de texto (`BindSalidaTexto`), por nombre; null = NULL. */
  salidas?: Record<string, SalidaTextoTrabajador | null>
}

export type ResultadoTrabajador = ResultadoFilasTrabajador | ResultadoAfectadasTrabajador | ResultadoHechoTrabajador

/** Respuesta de `leer` (Oracle, cursor vivo). */
export interface PaginaTrabajador {
  filasJson: string
  nFilas: number
  hayMas: boolean
  /** El mismo id si sigue abierto; null si se agotó y se cerró. */
  lector: string | null
  recortes?: Array<[fila: number, columna: number, longitudOriginal: number]>
  ms: number
}

export interface RespuestaIniciar {
  v: number
  pid: number
  versiones: { node: string; electron?: string }
}

export interface RespuestaAbrir {
  modo: 'thin' | 'thick' | 'nativo'
  /** Pack de Instant Client en uso (Oracle thick), para que el main haga `setDriver`. */
  driverId: string | null
  /** Versión del servidor ('19.3.0.0.0', '16.4'). */
  version: string
  esquema: string | null
  usuario: string | null
  /** PG: pid del backend (pg_stat_activity), para diagnóstico. */
  pidServidor?: number
}

/** Lo que devuelve cada operación con éxito. */
export interface RespuestasPorOp {
  iniciar: RespuestaIniciar
  abrir: RespuestaAbrir
  ejecutar: ResultadoTrabajador
  leer: PaginaTrabajador
  cerrarLector: { cerrado: boolean }
  cancelar: { cancelada: boolean }
  tx: { tx: DbEstadoTx; avisos?: string[] }
  autoCommit: { autoCommit: boolean; tx: DbEstadoTx }
  cerrar: { cerrada: boolean }
  salir: { saliendo: true }
  /** El tipo exacto lo da `RespuestasDocs[operacion]`; `GestorDocumentos` lo estrecha. */
  docs: RespuestasDocs[OperacionDocs]
  /** El tipo exacto lo da `RespuestasClaves[operacion]`; `GestorClaves` lo estrecha. */
  claves: RespuestasClaves[OperacionClaves]
}

// --- Operaciones de un motor de DOCUMENTOS: la op 'docs' ------------------------------------
//
// Una sola op con suboperación: `sesion.cjs` la despacha a `motor.docs(estado, operacion, args)`
// y lo que es de MongoDB se queda en su adaptador. El trabajador APLICA la política que decide
// el main (`PoliticaDocs`) antes de tocar el servidor, con los códigos de abajo: interpretar el
// shell exige el parser de CJS compartido con `tdb`, y sus objetos BSON no cruzan el canal.

/** Una sentencia de escritura en PRODUCCIÓN sin `confirmado`: no se envió (→ motivo 'produccion'). */
export const CODIGO_DOCS_PRODUCCION = 'TESSERA-PRODUCCION'
/** Una escritura en una conexión de solo lectura (clase 'soloLectura'). */
export const CODIGO_DOCS_SOLO_LECTURA = 'TESSERA-SOLO-LECTURA'
/** D11: sin transacciones, más de un cambio y sin `confirmadoSinTransaccion` (→ 'sinTransaccion'). */
export const CODIGO_DOCS_SIN_TRANSACCION = 'TESSERA-SIN-TX'
/** El texto no es una sentencia del shell admitida o un literal no se pudo interpretar (con `offsetCp`). */
export const CODIGO_DOCS_SINTAXIS = 'TESSERA-SINTAXIS'

/** La política que el main decide y el trabajador aplica (ver arriba). */
export interface PoliticaDocs {
  soloLectura: boolean
  /** ¿La conexión es de PRODUCCIÓN? Una escritura exige entonces `confirmado`. */
  produccion: boolean
  confirmado: boolean
}

export type PeticionDocs =
  | { operacion: 'bases' }
  | { operacion: 'colecciones'; base: string }
  | { operacion: 'detalle'; base: string; coleccion: string }
  | {
      operacion: 'consultar'
      base: string
      coleccion: string
      filtro: string
      proyeccion: string
      orden: string
      maxDocumentos: number
      /** Las columnas conocidas (de `detalle`) para ordenar las de la página. */
      columnas: string[]
    }
  | { operacion: 'mas'; lector: string; maxDocumentos: number }
  | { operacion: 'cerrarLector'; lector: string }
  | { operacion: 'consola'; base: string | null; texto: string; maxDocumentos: number; politica: PoliticaDocs }
  | {
      operacion: 'enviar'
      base: string
      coleccion: string
      cambios: DbDocCambio[]
      politica: PoliticaDocs
      confirmadoSinTransaccion: boolean
    }

export type OperacionDocs = PeticionDocs['operacion']

export interface RespuestasDocs {
  bases: DbDocBase[]
  colecciones: DbDocColeccion[]
  detalle: DbDocDetalleColeccion
  /** `lector` es un id del trabajador; el main lo envuelve antes de dárselo al renderer. */
  consultar: DbDocPagina
  mas: DbDocPagina
  cerrarLector: { cerrado: boolean }
  consola: DbDocResultado
  enviar: DbDocResultadoEnvio
}

// --- Operaciones de un motor de CLAVES: la op 'claves' --------------------------------------
//
// La gemela de 'docs' para Redis, sin lectores (SCAN no guarda estado en el servidor). El
// trabajador aplica la política con las marcas de `COMMAND INFO`, en este orden de barreras:
// no admitido en la consola → solo lectura (también un peligroso) → peligroso sin confirmar →
// escritura en producción sin confirmar. Los códigos compartidos con documentos significan lo mismo.

/** D5: un comando peligroso sin `confirmadoPeligroso`: no se envió (→ motivo 'peligroso'). */
export const CODIGO_PELIGROSO = 'TESSERA-PELIGROSO'
/** Un comando que la consola no admite (SUBSCRIBE, MONITOR…): no se envió (→ motivo 'servidor'). */
export const CODIGO_NO_ADMITIDO = 'TESSERA-NO-ADMITIDO'

/** La política que el main decide y el trabajador aplica (ver arriba). */
export interface PoliticaClaves extends PoliticaDocs {
  /** D5: el usuario ya confirmó ESTE comando peligroso. */
  confirmadoPeligroso: boolean
}

export type PeticionClaves =
  | { operacion: 'bases' }
  | {
      operacion: 'escanear'
      base: number
      /** Patrón de MATCH; '' = `*`. */
      patron: string
      cursor: string
      cuenta: number
      tipo?: DbKvTipo
    }
  | {
      operacion: 'valor'
      base: number
      /** La clave en base64 (los bytes exactos). */
      clave: string
      desde?: string
      cuantos?: number
    }
  | {
      operacion: 'consola'
      base: number
      /** UN comando, con las comillas de redis-cli. La posición de un error de sintaxis va en `offsetCp`. */
      texto: string
      politica: PoliticaClaves
    }

export type OperacionClaves = PeticionClaves['operacion']

export interface RespuestasClaves {
  bases: DbKvBases
  escanear: DbKvPaginaClaves
  valor: DbKvValor
  consola: DbKvResultado
}

export type RespuestaTrabajador =
  | { id: number; ok: true; r: unknown }
  | { id: number; ok: false; error: ErrorTrabajador }

/** Mensajes sin `id`: pérdida de una sesión ociosa y fallo fatal (el proceso sale con 70). */
export type EventoTrabajador =
  | { ev: 'perdida'; sesion: string; error: ErrorTrabajador }
  | { ev: 'fatal'; mensaje: string }

export type MensajeTrabajador = RespuestaTrabajador | EventoTrabajador

export {
  clasificarMensaje,
  Correlador,
  esFalloTrabajador,
  FalloTrabajador,
  PLAZOS_TRABAJADOR_MS,
  plazoDePeticion,
  RELOJ_REAL
} from './sesiones/correlador.ts'
export type {
  MensajeClasificado,
  OpcionesCorrelador,
  PlazosTrabajador,
  RecepcionCorrelador,
  Reloj
} from './sesiones/correlador.ts'
