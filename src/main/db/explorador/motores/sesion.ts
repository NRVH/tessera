// =============================================================================
// La sesión por motor: la interfaz `SesionExplorador` que cumple cada motor con el SQL y los
// algoritmos que solo necesita el main: esquema y errores de compilación de la consola, columnas
// y binds de la edición de la rejilla, espera de bloqueos de «Enviar», valor completo de una
// celda y Explain. Los valores que también lee el renderer viven en `descriptor(m).sesion`.
// Decisiones: docs/decisiones/bd/sesiones-por-motor.md
// =============================================================================

import type { DbMotor } from '../../../../shared/db-ipc.ts'
import type { DbEstadoSesion, DbEstadoTx, DbMotivoError, DbPlan } from '../../../../shared/db-explorador-ipc.ts'
import type { Sentencia } from '../../../../shared/sql/divisorSql.ts'
import type { BindsSalientes } from '../bindsConsola.ts'
import type { ColumnaEdicion, TablaEdicion } from '../edicionRejilla.ts'
import type { BindEntradaLob, BindValorSqlite, OpcionesEjecucion, ResultadoTrabajador } from '../protocoloTrabajador.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/**
 * Las marcas DE LA TABLA que trae `sqlColumnasEdicion` en cada fila (ver `edicionRejilla.ts`).
 * `interna` y `aliasRowid` son opcionales: un motor que no las
 * tiene no las pone.
 */
export type MarcasTablaEdicion = Pick<TablaEdicion, 'temporal' | 'externa' | 'mantenidaPorOracle' | 'interna' | 'aliasRowid' | 'claveAdmiteNulos'>

/**
 * Cómo espera «Enviar» de la rejilla a que otra transacción suelte una fila sin quedarse
 * colgado, con lo que lo pone en marcha y con lo que dice el servidor al vencer:
 * - 'porFila' (Oracle): todas las filas se bloquean ANTES de ningún DML y con plazo, por
 *   lotes, con `sqlCandado` (`SELECT … FOR UPDATE WAIT`); si un lote vence, la fila se busca
 *   con la misma sentencia SIN espera, cuyo «ocupada» es `codigoOcupada`.
 * - 'porTransaccion' (PG): un tope para toda la transacción con su primera sentencia
 *   (`SET LOCAL lock_timeout`).
 * - 'porArchivo' (SQLite): el bloqueo es del archivo y la espera, de la conexión
 *   (`PRAGMA busy_timeout`).
 * Las formas son una unión de literales CON NOMBRE: la guardia de `test-motores-sueltos` la lee y
 * caza un `forma === 'porFila'` suelto. Una forma nueva entra en `FormaEsperaBloqueo`.
 */
export type FormaEsperaBloqueo = 'porFila' | 'porTransaccion' | 'porArchivo'

/** Lo que tiene toda forma de esperar. */
interface EsperaBloqueoComun {
  readonly forma: FormaEsperaBloqueo
  /** Lo que devuelve el servidor cuando vence la espera (la del candado o la del tope). */
  readonly codigoVencida: string
}

/** 'porFila' (Oracle): el candado por lotes antes de ningún DML, y su sonda sin espera. */
export interface EsperaPorFila extends EsperaBloqueoComun {
  readonly forma: 'porFila'
  /**
   * El candado de `filas` filas de `tabla` por las columnas de su identidad (las dos ya
   * citadas, o la pseudo-columna de la dirección): con `'wait'` espera como mucho
   * `segundos`; con `'nowait'` falla al instante si alguna está bloqueada. Sus binds van
   * fila a fila, en el orden de `columnas`.
   */
  sqlCandado(tabla: string, columnas: readonly string[], filas: number, espera: 'wait' | 'nowait', segundos: number): string
  /** El «ocupada» del candado sin espera (la sonda que busca la fila). */
  readonly codigoOcupada: string
}

/** 'porTransaccion' (PG): un tope para toda la transacción, con su primera sentencia. */
export interface EsperaPorTransaccion extends EsperaBloqueoComun {
  readonly forma: 'porTransaccion'
  /** La sentencia que pone el tope de `segundos` a la transacción. */
  sqlTope(segundos: number): string
}

/**
 * 'porArchivo' (SQLite): el motor bloquea el ARCHIVO entero y la espera es el `busy_timeout`
 * de la CONEXIÓN: lo que vence es un SQLITE_BUSY. Sin candado por filas.
 */
export interface EsperaPorArchivo extends EsperaBloqueoComun {
  readonly forma: 'porArchivo'
  /** La sentencia que fija la espera de la conexión en `segundos`, antes del envío. */
  sqlTope(segundos: number): string
  /**
   * ¿Una transacción que solo LEYÓ (tx 'abierta') de otra consola impide escribir en el
   * archivo? Se decide por su CABECERA (null si no se pudo leer: entonces sí, por prudencia):
   * en modo rollback un lector retiene SHARED y el COMMIT del otro falla; en WAL no bloquea.
   */
  lectorBloquea(cabecera: Uint8Array | null): boolean
}

export type EsperaBloqueoEnvio = EsperaPorFila | EsperaPorTransaccion | EsperaPorArchivo

/**
 * Lo que el EXPLAIN de un motor puede pedirle al gestor (ver la cabecera). Los valores que
 * pueden cambiar mientras el algoritmo espera al servidor son FUNCIONES: se leen en el
 * momento en que el algoritmo los necesita, igual que cuando el código estaba en el gestor.
 */
export interface ContextoExplicar {
  /** La sentencia del usuario TAL CUAL se envía (`Sentencia.texto`). */
  readonly texto: string
  /** Sus binds ya en la forma del motor (`bindsConsola.ts`), o undefined sin parámetros. */
  readonly binds: BindsSalientes | undefined
  /** ¿La sentencia tiene parámetros? (Aunque no viajen: Oracle avisa de que no los mira.) */
  readonly conParametros: boolean
  /** La conexión es de solo lectura. */
  readonly soloLectura: boolean
  /** `Date.now()` al empezar la operación (antes de abrir): `tiempos.totalMs`. */
  readonly t0: number
  /** El estado de la transacción según la última operación (puede ir por detrás del servidor). */
  estadoTx(): DbEstadoTx
  /** ¿La consola está en Manual (y no es de solo lectura)? */
  txManual(): boolean
  /** El modo del driver de la sesión (Oracle: thin o thick), si se sabe. */
  modoDriver(): NonNullable<DbEstadoSesion['driver']>['modo'] | undefined
  /** Manda UNA sentencia a la sesión de la consola. */
  ejecutar(sql: string, opciones: OpcionesEjecucion, binds?: BindsSalientes): Promise<ResultadoTrabajador>
  /** Una acción de transacción de la sesión, y el estado en que la deja. */
  accionTx(accion: 'rollback' | 'estado'): Promise<DbEstadoTx>
  /**
   * El texto enviado al que se refiere el offset de un error del servidor: el prefijo del
   * EXPLAIN mientras está en vuelo, y null para todo lo demás (lo que falle fuera de él
   * trae el offset de OTRO texto y el gestor lo devuelve sin posición).
   */
  prefijo(p: string | null): void
  /** El estado de la transacción que deja el EXPLAIN (el gestor lo pasa a la máquina al terminar). */
  fijarTx(tx: DbEstadoTx): void
  /** Un id de plan nuevo (Oracle: el STATEMENT_ID de PLAN_TABLE). */
  nuevoIdPlan(): string
  /** Un error con mensaje SEGURO para el usuario (el `ErrorGestor` del gestor), para lanzarlo. */
  error(motivo: DbMotivoError, mensaje: string): Error
}

export interface SesionExplorador {
  /** La clave de `MOTORES_EXPLORADOR` en la que va (lo fija el test). */
  readonly motor: DbMotor

  // --- Esquema de la consola (`consolaSql.ts`) ----------------------------------------

  /**
   * La sentencia que fija el esquema de una sesión de consola. `esquema` null = volver al
   * de la conexión (`esquemaConexion`, el que tenía la sesión al abrirse). null si no hay
   * a qué volver.
   */
  sqlFijarEsquema(esquema: string | null, esquemaConexion: string | null): ConsultaCatalogo | null
  /** La sentencia que solo LEE el esquema actual de la sesión. */
  sqlLeerEsquema(): ConsultaCatalogo
  /**
   * ¿El código de error con que falló `sqlFijarEsquema` dice que el esquema YA NO EXISTE?
   * Es la única señal que degrada al reabrir (`trasReaplicarEsquema`). Solo tiene sentido
   * con `fijarEsquemaValida` (Oracle: ORA-01435); en un motor que acepta cualquier nombre,
   * ningún error lo dice.
   */
  esquemaInexistente(codigo: string | null): boolean
  /**
   * El error del selector de esquema cuando el elegido NO cuajó (la relectura dice otro;
   * `GestorSesiones.fijarEsquemaConsola`). Es del motor porque la causa es del motor: donde
   * fijar valida, solo puede ser que no exista; en PG también que falte el permiso USAGE.
   */
  mensajeEsquemaNoAplicado(esquema: string): string

  // --- Errores de compilación de la consola (`consolaSql.ts`) -------------------------

  /**
   * La consulta de los errores (y avisos) de compilación que el servidor GUARDA de la unidad que
   * acaba de crear `st`, o null si no hay nada que leer (la sentencia no crea una unidad así, o el
   * motor no los guarda: PG falla en el acto). Filas `[línea, columna, texto, atributo]`
   * ('WARNING' es un aviso). Es la ÚNICA pregunta: si hay que leerlos, esto no devuelve null.
   */
  sqlErroresCompilacion(st: Sentencia): ConsultaCatalogo | null

  // --- Edición de la rejilla (`edicionRejilla.ts`) -----------------------------------

  /**
   * Columnas de la tabla y sus marcas (ver `sqlColumnasEdicion` en `edicionRejilla.ts`).
   * `base`: la del nivel «Bases» (`DialectoCatalogo.base`); solo la lee un
   * motor que lo tiene (SQL Server, con el nombre de tres partes). Los demás la ignoran.
   */
  sqlColumnasEdicion(versionMayor: number, esquema: string, objeto: string, base?: string): ConsultaCatalogo
  /**
   * La restricción UNIQUE con todas sus columnas NOT NULL que identifica una fila sin PK, para el
   * motor con `identidadSinPk: 'unicaNoNula'` (PG). Filas `[restricción, columna]`, una por
   * columna, la restricción más corta primero. Un motor que no identifica así LANZA
   * (`noDisponible`): no se le pregunta nunca (`necesitaUnica`).
   */
  sqlUnicaNoNula(esquema: string, objeto: string, base?: string): ConsultaCatalogo
  /**
   * La expresión del SELECT de la pestaña que lee la dirección de la fila como TEXTO, para el
   * motor con `identidadSinPk: 'rowid'` (Oracle: `ROWIDTOCHAR(ROWID)`); va detrás de `fuente.*` con
   * el alias `COLUMNA_ROWID`. Un motor que no identifica por ROWID LANZA (`noDisponible`).
   */
  sqlColumnaRowid(alias?: string | null): string
  /** Las marcas de la tabla, de la PRIMERA fila de `sqlColumnasEdicion` (undefined = sin filas). */
  marcasTablaEdicion(primera: FilaCatalogo | undefined): MarcasTablaEdicion
  /** Una fila de `sqlColumnasEdicion` como columna, con lo que no se escribe y por qué. */
  columnaEdicion(fila: FilaCatalogo): ColumnaEdicion
  /**
   * El bind de una CLAVE binaria, desde su hexadecimal SIN el `0x` con que llega de la rejilla
   * (SQLite: un BLOB de verdad, `BindValorSqlite` 'blob'; un texto hexadecimal no casaría).
   */
  bindClaveBinaria(hex: string): string | BindValorSqlite
  /**
   * El bind especial de un texto (no nulo) hacia `col` —un LOB largo, el juego nacional, la
   * clase de almacenamiento que conserva SQLite—, o null si va como texto a secas.
   */
  bindTextoEdicion(col: ColumnaEdicion, valor: string): BindEntradaLob | BindValorSqlite | null
  /** Cómo espera «Enviar» un bloqueo de fila, con su SQL (ver `EsperaBloqueoEnvio`). */
  readonly esperaBloqueo: EsperaBloqueoEnvio

  // --- Valor completo de una celda (`valorCelda.ts`) ----------------------------------

  /** ¿Es binaria la columna por su tipo del catálogo? `tipo` llega recortado y en MAYÚSCULAS. */
  esTipoBinario(tipo: string): boolean
  /** Un booleano de la clave como texto de bind. */
  bindBooleano(v: boolean): string
  /** El lado derecho que compara una clave binaria enlazada en `marca` (su hex sin `0x`). */
  ladoClaveBinaria(marca: string): string

  // --- Explicar plan (`GestorSesiones.explicar`) --------------------------------------

  /**
   * El EXPLAIN de UNA sentencia de consola, SIN ejecutarla y sin estropear la transacción
   * del usuario (el porqué de cada motor, en su archivo y en `planSql.ts`). Devuelve el
   * plan; lo que falle LANZA, tras dejar con `ctx.prefijo` a qué texto se refiere el error
   * y con `ctx.fijarTx` el estado de la transacción si lo sabe.
   */
  explicar(ctx: ContextoExplicar): Promise<DbPlan>
  /**
   * Tras un EXPLAIN que FALLÓ (sin pérdida ni plazo, que los trata el gestor): ¿hay que
   * revertir lo que dejara (true) o basta con releer el estado de la transacción (false)?
   */
  revertirTrasFalloDeExplicar(soloLectura: boolean): boolean

  // --- Esperas de bloqueo al LEER ------------------------------------

  /**
   * ¿Dice este código de error que una LECTURA de la rejilla (o del catálogo) venció su tope
   * de espera de un bloqueo? Entonces el error sale con `motivo: 'bloqueo'` y la interfaz
   * ofrece «Reintentar» y «Leer sin esperar» (`DbAbrirTabla.sinEsperar`). Solo SQL Server
   * (1222 de `SET LOCK_TIMEOUT`): con sus bloqueos de fábrica un lector espera a un escritor
   * (medido). En Oracle y PG un lector no espera nunca, y en SQLite el «ocupado» de leer es
   * el de siempre: false, y su error sale como antes.
   */
  esBloqueoAlLeer(codigo: string | undefined): boolean
}
