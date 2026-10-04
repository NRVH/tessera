// =============================================================================
// El catálogo por motor: la interfaz `CatalogoExplorador` que cumple cada motor con el SQL de su
// diccionario (esquemas, objetos, columnas, restricciones, índices, FKs, fuente, sinónimos,
// nombres) y cómo se leen SUS filas. `catalogoSql.ts` delega aquí; lo que un motor no tiene lo
// implementa lanzando. La forma de las filas de cada método está junto a su consulta.
// Decisiones: docs/decisiones/bd/motores-codigo-por-motor.md
// =============================================================================

import type { DbMotor } from '../../../../shared/db-ipc.ts'
import type {
  DbColumnaInfo,
  DbFuente,
  DbIndiceInfo,
  DbRefObjeto,
  DbRelacionesFk,
  DbRestriccionInfo,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { SalidaTextoTrabajador } from '../protocoloTrabajador.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './tipos.ts'

/** Cómo pregunta el catálogo: el `consultar` del turno de `meta` (o uno falso en los tests). */
export type ConsultarCatalogo = (c: ConsultaCatalogo) => Promise<readonly FilaCatalogo[]>

/**
 * Con qué lee un método de VARIAS consultas (`leerFks`). Lo arma el controlador sobre el
 * turno de `meta`; un test, con uno falso. Ver la cabecera.
 */
export interface LectorCatalogo {
  readonly dialecto: DialectoCatalogo
  consultar: ConsultarCatalogo
  /**
   * Construye lo que se va a mandar (una consulta, una lista de ellas o un bloque). Si
   * construirlo lanza, el error sale clasificado (motivo interno, con su mensaje).
   */
  construir<T>(fn: () => T): T
}

/** El de `leerDdl`: lo mismo, más lo que solo usa el «Ver DDL». */
export interface LectorDdl extends LectorCatalogo {
  /** Un error SEGURO (motivo interno) con este mensaje, para lanzarlo. */
  fallo(mensaje: string): Error
  /**
   * Un bloque con UN bind de salida de texto llamado `salida`, leído entero hasta `tope`
   * (Oracle: el DDL de DBMS_METADATA). null = el bloque dejó NULL o no devolvió salidas.
   */
  bloqueTexto(
    sql: string,
    binds: Record<string, string | number | null>,
    salida: string,
    tope: number
  ): Promise<SalidaTextoTrabajador | null>
}

/**
 * Lo que un motor hace para describir su base. Las filas que leen los mapeadores genéricos de
 * `catalogoSql.ts` salen con la misma forma en todos los motores: `sqlBases` [nombre, sistema,
 * accesible]; `sqlEsquemas` [nombre, sistema]; `sqlEsquemaPorDefecto` [esquema, usuario];
 * `sqlConteos` [tipo, n]; `sqlObjetos` [nombre, subtipo, estado, comentario, firma, tabla];
 * `sqlClavePrimaria` [columna] en orden de la PK; `sqlResolverSinonimo` [dueño, nombre, enlace];
 * `sqlNombresPublicos` [nombre].
 */
export interface CatalogoExplorador {
  /** La clave de `MOTORES_EXPLORADOR` en la que va (lo fija el test). */
  readonly motor: DbMotor

  // --- Valores que solo decide el main ------------------------------------------------

  /**
   * ¿`sqlColumnas` trae ya la posición de cada columna en la PK? Si no (Oracle), el
   * detalle de columnas la pide aparte con `sqlClavePrimaria` y la aplica.
   */
  readonly pkEnColumnas: boolean
  /**
   * ¿Se leen los tipos DECLARADOS de las columnas para la cabecera de la pestaña de datos
   * (`sqlTiposColumnas`)? Oracle sí: su driver no sabe la unidad de una VARCHAR2. PG no:
   * el tipo que da su trabajador ya es el declarado.
   */
  readonly leeTiposDeclarados: boolean

  // --- Bases ------------------------------------------------------------

  /**
   * Las BASES del nivel «Bases» del árbol híbrido (`nivelBases` del descriptor), filas
   * `[nombre, sistema, accesible]`. Un motor sin ese nivel LANZA (`noDisponible`): el
   * controlador no se lo pide nunca (lo decide antes con `tieneNivelBases`), y si se lo
   * pidiera, mejor un error clasificado que el SQL de otro servidor. No es opcional por lo que
   * dice la cabecera: un opcional que falta no lo señala el compilador.
   */
  sqlBases(d: DialectoCatalogo): ConsultaCatalogo

  // --- Esquemas -----------------------------------------------------------------------

  sqlEsquemas(d: DialectoCatalogo): ConsultaCatalogo
  /** ¿Es del sistema el esquema `nombre`, leído de su fila de `sqlEsquemas`? */
  esSistemaDeFila(d: DialectoCatalogo, nombre: string, fila: FilaCatalogo): boolean
  sqlEsquemaPorDefecto(d: DialectoCatalogo): ConsultaCatalogo

  // --- Árbol --------------------------------------------------------------------------

  sqlConteos(d: DialectoCatalogo, esquema: string): ConsultaCatalogo
  /** Solo con un `tipo` de sus carpetas (lo comprueba `catalogoSql.sqlObjetos` antes). */
  sqlObjetos(d: DialectoCatalogo, esquema: string, tipo: DbTipoObjeto): ConsultaCatalogo

  // --- Detalle de una tabla -----------------------------------------------------------

  sqlColumnas(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo
  mapearColumnas(filas: readonly FilaCatalogo[]): DbColumnaInfo[]
  sqlClavePrimaria(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo
  sqlRestricciones(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo
  mapearRestricciones(filas: readonly FilaCatalogo[]): DbRestriccionInfo[]
  sqlIndices(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo
  mapearIndices(filas: readonly FilaCatalogo[]): DbIndiceInfo[]
  /** Lanza si el motor no los lee (`leeTiposDeclarados` falso). */
  sqlTiposColumnas(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo
  /** Nombre de columna -> tipo declarado. Lanza si el motor no los lee. */
  mapearTiposColumnas(filas: readonly FilaCatalogo[]): Map<string, string>

  // --- Claves ajenas (autocompletado de JOIN … ON) -----------------------------------

  /** La PRIMERA consulta de las FKs (en PG, la única). */
  sqlFks(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo
  /** Filas -> relaciones. `columnas`: las de la segunda tanda de Oracle; PG no las usa. */
  mapearFks(esquema: string, objeto: string, filas: readonly FilaCatalogo[], columnas: readonly FilaCatalogo[]): DbRelacionesFk
  /**
   * Las FKs de un objeto, con todas las consultas que el motor necesite, en su orden, y
   * cada una construida por `lector.construir`.
   */
  leerFks(lector: LectorCatalogo, esquema: string, objeto: string): Promise<DbRelacionesFk>

  // --- Fuente y DDL -------------------------------------------------------------------

  sqlFuente(d: DialectoCatalogo, ref: DbRefObjeto): ConsultaCatalogo
  mapearFuente(d: DialectoCatalogo, ref: DbRefObjeto, filas: readonly FilaCatalogo[]): DbFuente
  /** ¿Tiene «Ver DDL» ese tipo en este motor? (`ddlCatalogo.ts`). */
  tieneDdl(tipo: DbTipoObjeto): boolean
  /**
   * «Ver DDL»: una sola parte titulada 'DDL' (o ninguna, con el `aviso` de por qué). Las
   * consultas y su orden son del motor, cada una por `lector.construir`. Con un tipo sin
   * `tieneDdl` LANZA sin preguntar nada (el controlador ya lo filtra antes).
   */
  leerDdl(lector: LectorDdl, ref: DbRefObjeto): Promise<DbFuente>

  // --- Sinónimos (lanzan en un motor sin ellos: `descriptor(m).catalogo.tieneSinonimos`) ---

  /** Un salto; el llamador encadena hasta 3. */
  sqlResolverSinonimo(d: DialectoCatalogo, esquema: string, nombre: string): ConsultaCatalogo
  /** Qué es el destino de un sinónimo. */
  sqlTipoDeObjeto(d: DialectoCatalogo, esquema: string, nombre: string): ConsultaCatalogo
  mapearTipoDeObjeto(filas: readonly FilaCatalogo[]): DbTipoObjeto | null

  // --- Índice de autocompletado -------------------------------------------------------

  /** Filas: `[esquema, nombre, código]`, troceado como el motor necesite. */
  sqlNombres(d: DialectoCatalogo, esquemas: readonly string[]): ConsultaCatalogo[]
  /** El tipo de un `código` de `sqlNombres`, o `undefined` si no es de los que se indexan. */
  tipoDeNombre(codigo: string): DbTipoObjeto | undefined
  /** Los sinónimos públicos (capa aparte, perezosa), o null si el motor no los tiene. */
  sqlNombresPublicos(d: DialectoCatalogo): ConsultaCatalogo | null
}
