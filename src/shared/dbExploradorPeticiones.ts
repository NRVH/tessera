// =============================================================================
// Tipos de las PETICIONES del explorador: ejecutar en consola, binds, sintaxis, plan,
// historial, claves ajenas y abrir una tabla; y los de la EDICIÓN de la rejilla (identidad de
// fila, cambios, envío), del valor completo de una celda y de «Copiar como» / exportar. Van
// juntos porque se citan entre sí (abrir una tabla da su `DbIdentidadFila`, y exportar una
// consulta lleva sus `DbBinds`).
// Es una sección del contrato `db-explorador-ipc.ts`, que la reexporta entera: los importadores
// siguen importando de allí. Solo tipos y constantes neutrales (lo compilan node y web).
// Decisiones: docs/decisiones/bd/contratos-explorador-sql.md
// =============================================================================

import type { DbMotor } from './db-ipc.ts'
import type { DbRefObjeto } from './dbExploradorArbol.ts'
import type { DbCelda, DbColumnaResultado, DbErrorSql, DbResultadoError, DbResultadoFilas, DbTiempos, DbTipoLogico } from './dbExploradorResultados.ts'
import type { DbTxModo } from './dbExploradorSesiones.ts'
import type { DbFiltroGuiado, DbOrdenColumna } from './filtroGuiado.ts'
import type { GramaticaLocal } from './sql/dialectosSql.ts'
import type { VeredictoSintaxis } from './sql/sintaxisSql.ts'

// --- Peticiones ---------------------------------------------------------------

export interface DbEjecutarConsola {
  perfilId: string
  consolaId: string
  /** Lo genera el renderer: con él se cancela y se descartan respuestas viejas. */
  ejecucionId: string
  /** El texto del modelo `[desde, hastaContenido)` TAL CUAL: el main parte y traduce. */
  sql: string
  maxFilas: number
  /**
   * Valores de los parámetros de la sentencia. El main vuelve a sacar del SQL
   * los que hay (con `shared/sql`, que sabe que `:=`, `:new` de un disparador o un `$1`
   * dentro de una cadena NO lo son) y rechaza con `parametros` si falta alguno.
   */
  binds?: DbBinds
  /**
   * El usuario confirmó esta escritura en una conexión de PRODUCCIÓN. El main
   * la exige a lo que `requiereConfirmacionProduccion` marca y responde 'produccion'
   * sin enviar nada si falta.
   */
  confirmado?: boolean
  /**
   * La preferencia «Transacción al abrir» de Configuración, por si esta
   * petición CREA la sesión de la consola. Es la MISMA con la que el renderer pinta la
   * barra mientras no hay sesión, así que la sesión no puede nacer en otro modo que el
   * que se ve, aunque el guardado de ajustes no haya llegado aún al main. Producción y
   * solo lectura siguen mandando (`modoTxInicial`). Si la sesión ya existe, no cambia
   * nada: su modo lo decide ella. Ausente: la preferencia que tenga el main.
   */
  txInicial?: DbTxModo
}

/**
 * Valor de un parámetro. SIEMPRE texto (o null = NULL): el servidor lo convierte al
 * tipo de su sitio, y las fechas entran con el formato que Tessera fija en la sesión
 * ('YYYY-MM-DD HH24:MI:SS'). No hay selector de tipo.
 */
export type DbValorBind = string | null

/**
 * Parámetros por NOMBRE sin el prefijo: `{ ID: '5' }` para `:id` o `:ID` (Oracle no
 * distingue caja en los binds sin comillas: la clave va en MAYÚSCULAS) y
 * `{ '1': '5' }` para `$1` en PG.
 */
export type DbBinds = Record<string, DbValorBind>

/** `CONSOLA_SINTAXIS`: las sentencias que se validan, cada una tal cual se enviaría. */
export interface DbValidarSintaxis {
  gramatica: GramaticaLocal
  textos: string[]
}

export type { VeredictoSintaxis }

export interface DbExplicar {
  perfilId: string
  consolaId: string
  /** Como en ejecutar: con él se cancela. */
  ejecucionId: string
  /** UNA sentencia de clase consulta o dml, tal cual del modelo. */
  sql: string
  binds?: DbBinds
  /** Como en ejecutar: la preferencia de Tx por si esta petición CREA la sesión. */
  txInicial?: DbTxModo
}

/** Un paso del plan, en árbol por `padre`. */
export interface DbNodoPlan {
  id: number
  padre: number | null
  /** TABLE ACCESS / Seq Scan… */
  operacion: string
  /** FULL / BY INDEX ROWID… (Oracle); el tipo de join (PG). */
  opciones?: string
  /** ESQUEMA.OBJETO o índice. */
  objeto?: string
  coste?: number
  filas?: number
  bytes?: number
  /** Predicados de acceso y filtro, condición del join… */
  detalle?: string[]
}

export interface DbPlan {
  nodos: DbNodoPlan[]
  /** El plan en texto, como lo da el servidor (DBMS_XPLAN.DISPLAY, EXPLAIN en texto). */
  texto: string
  tiempos: DbTiempos
  avisos?: string[]
}

/** Una sentencia ejecutada en una consola. Las contraseñas (IDENTIFIED BY, PASSWORD '…') se tapan antes de guardar. */
export interface DbEntradaHistorial {
  id: string
  /** Epoch ms del final. */
  en: number
  perfilId: string
  conexionId: string
  consolaId: string
  sql: string
  resultado: 'ok' | 'error' | 'cancelada'
  ms: number
  /** Filas devueltas (primera página) o afectadas. */
  filas?: number
  esquema?: string | null
}

export interface DbFiltroHistorial {
  perfilId: string
  /** Solo de esta conexión; ausente = todas las del perfil. */
  conexionId?: string
  /** Subcadena, sin distinguir caja ni tildes. */
  texto?: string
  /** Por defecto 200; el main no devuelve más de 1000. */
  limite?: number
}

/** Una clave ajena. */
export interface DbFk {
  nombre: string
  desde: { esquema: string; tabla: string; columnas: string[] }
  hacia: { esquema: string; tabla: string; columnas: string[] }
}

export interface DbRelacionesFk {
  /** Las de esta tabla hacia otras. */
  salientes: DbFk[]
  /** Las de otras tablas hacia esta. */
  entrantes: DbFk[]
}

export interface DbAbrirTabla {
  conexionId: string
  /** Una petición nueva de la misma pestaña descarta la anterior que siga en cola. */
  peticionId: string
  objeto: DbRefObjeto
  /**
   * El WHERE LIBRE (el modo «SQL», avanzado). EXCLUYENTE con `filtro`: con los dos, el main
   * contesta un error.
   */
  where?: string
  /**
   * ORDER BY libre. La interfaz ya NO lo manda (ordena la cabecera, con
   * `orden`); se acepta, validado igual, para los tests y quien lo use por IPC.
   * EXCLUYENTE con `orden`.
   */
  orderBy?: string
  /** El filtro GUIADO (`shared/filtroGuiado.ts`); el main lo compila con parámetros. */
  filtro?: DbFiltroGuiado
  /** El orden de la cabecera, por prioridad; el main cita las columnas. */
  orden?: DbOrdenColumna[]
  maxFilas: number
  /**
   * Solo SQL Server. «Leer sin esperar»: leer en READ UNCOMMITTED, sin esperar a
   * los bloqueos de otras transacciones y viendo lo que aún no se confirmó (la interfaz lo
   * MARCA). Se ofrece tras un error con `motivo: 'bloqueo'`. En SQL Server, con los bloqueos
   * de fábrica, los lectores esperan a los escritores (medido: un UPDATE sin confirmar de
   * una consola dejaba colgada la rejilla). Ausente/false = leer normal, con el tope de espera.
   * Los motores donde un lector no espera (Oracle, PG) lo ignoran.
   */
  sinEsperar?: boolean
}

export interface DbTablaAbierta {
  resultado: DbResultadoFilas | DbResultadoError
  /** Columnas de la PK, para la llave de la cabecera. */
  clavePrimaria: string[]
  /** El objeto real que se consultó (el destino si era un sinónimo). */
  objeto: DbRefObjeto
  /**
   * Con qué se identifica una fila para EDITARLA. Ausente = como 'ninguna'
   * sin motivo (versiones anteriores). Con 'rowid', el resultado trae una columna
   * OCULTA más (`columna`, la última) que la rejilla no pinta.
   */
  identidad?: DbIdentidadFila
  /**
   * Columnas del resultado que NO se pueden editar
   * aunque la tabla sí, con el motivo para el `title`: binarias, generadas, identidad
   * ALWAYS y, en Oracle, los tipos que la rejilla no sabe escribir como texto
   * (XMLTYPE, objetos, LONG…). Solo viene si `identidad` no es 'ninguna'. La columna
   * OCULTA del ROWID no está aquí: la dice `identidad.columna`. Una celda RECORTADA
   * tampoco (es de la celda, no de la columna: la dicen los `recortes` de la página).
   * El main vuelve a comprobarlo todo al «Enviar»; esto es para no dejar empezar.
   */
  noEditables?: DbColumnaNoEditable[]
  /**
   * Con la identidad 'rowid': las columnas cuyos valores leídos el main SABE
   * comparar en la concurrencia optimista (`originales`), por su catálogo. La rejilla no
   * manda originales de ninguna columna fuera de esta lista, así que la vista previa no
   * puede enseñar una comprobación que el main luego quite, ni con una caché del catálogo
   * de antes de un DDL hecho fuera. Ausente = ninguna (la rejilla no manda originales).
   */
  comparables?: string[]
}

/** Una columna que la rejilla no deja editar, y por qué. */
export interface DbColumnaNoEditable {
  columna: string
  motivo: string
}

// --- Edición de la rejilla ------------------------------------------------

/**
 * Cómo se vuelve a encontrar una fila para actualizarla o borrarla:
 *   - 'pk': la clave primaria, o si no hay, una UNIQUE cuyas columnas son todas NOT NULL.
 *   - 'rowid': Oracle sin clave; el main añade `ROWID` al SELECT de la pestaña como
 *     columna oculta con este nombre. Solo tablas (una vista no tiene ROWID propio).
 *   - 'ninguna': no se puede editar; `motivo` lo dice (sin clave en PG, una vista, una
 *     conexión de solo lectura…).
 */
export type DbIdentidadFila =
  | { tipo: 'pk'; columnas: string[] }
  | { tipo: 'rowid'; columna: string }
  | { tipo: 'ninguna'; motivo: string }

/**
 * El valor que se escribe en una celda: TEXTO (el servidor convierte, con los formatos
 * que fija la sesión) o null = NULL. En un INSERT, la columna que no aparece va con su
 * DEFAULT.
 */
export type DbValorEdicion = string | null

/**
 * Un cambio pendiente de la rejilla. `clave` son los valores de la identidad en su orden
 * (las columnas de 'pk', o el ROWID), TAL COMO SE LEYERON: si la fila cambió entretanto,
 * el UPDATE o el DELETE no tocará exactamente una fila y todo se revierte.
 */
export type DbCambioFila =
  | { tipo: 'actualizar'; clave: DbCelda[]; valores: Record<string, DbValorEdicion>; originales?: DbOriginalesFila }
  | { tipo: 'insertar'; valores: Record<string, DbValorEdicion> }
  | { tipo: 'borrar'; clave: DbCelda[]; originales?: DbOriginalesFila }

/**
 * CONCURRENCIA OPTIMISTA: los valores que la rejilla LEYÓ de
 * algunas columnas de la fila, para que el main los añada al WHERE con una comparación
 * que trata NULL = NULL. Si otra sesión cambió la fila entre la lectura y el envío, el
 * DML no toca ninguna y el envío falla con «la fila cambió o ya no existe», en vez de
 * escribir encima. Hace falta con la identidad 'rowid': un ROWID es una DIRECCIÓN, y un
 * hueco de bloque reutilizado (una fila borrada y otra insertada en su sitio, un SHRINK,
 * un MOVE) lo pasa a otra fila distinta que casaría igual. Solo columnas que se leen
 * EXACTAS como texto (no LOB, no binarias, no recortadas, no coma flotante): lo decide
 * quien las manda y el main vuelve a filtrar las que no sabe comparar, los dos con la
 * MISMA regla (`shared/sql/originalesSql.ts`).
 */
export type DbOriginalesFila = Record<string, DbValorEdicion>

export interface DbEnviarCambios {
  conexionId: string
  /** Con él, Stop lo cancela (`cancelar` de rol 'datos'). */
  peticionId: string
  objeto: DbRefObjeto
  /** La identidad con la que se leyeron las filas (la de `DbTablaAbierta`). */
  identidad: DbIdentidadFila
  cambios: DbCambioFila[]
  /** Producción: el usuario confirmó en el diálogo. Sin él, 'produccion'. */
  confirmado?: boolean
}

export type DbResultadoEnvio =
  | { tipo: 'hecho'; cambios: number; tiempos: DbTiempos }
  /**
   * Nada se aplicó (se revirtió todo). `indice` es el cambio que falló; `filas`, cuántas
   * tocó un UPDATE/DELETE que no tocó exactamente una. `indice` -1 con `error.motivo`
   * 'servidor': falló el COMMIT (restricción diferida) y no hay un cambio al que culpar; con
   * otro motivo ('sesionPerdida'…) NO se sabe si se aplicó y la UI no puede afirmar «no se
   * aplicó nada». Un Stop vuelve con 'cancelada' en el índice del cambio que no llegó a
   * aplicarse; con el COMMIT ya en camino no se detiene. Semántica completa en
   * `docs/decisiones/bd/transacciones-enviar-todo-o-nada.md` y `rejilla-envio-bloqueos.md`.
   */
  | { tipo: 'error'; indice: number; error: DbErrorSql; filas?: number; tiempos: DbTiempos }

export type DbCancelar =
  | { rol: 'consola'; perfilId: string; consolaId: string; ejecucionId: string }
  | { rol: 'datos'; conexionId: string; peticionId: string }
  | { rol: 'exportacion'; peticionId: string }

/** Tope del valor completo de una celda (unidades UTF-16, o bytes en binario). */
export const DB_VALOR_MAX = 16 * 1024 * 1024

/**
 * El valor ENTERO de una celda que la rejilla recibió recortado (un CLOB de más de
 * 64 KiB). Solo se puede pedir por la CLAVE PRIMARIA: la fila se vuelve a buscar y
 * sin PK no hay forma fiable de encontrarla (ROWID/ctid llegan con la edición de
 * celdas, que los necesita igual). El main relee las columnas de la PK del catálogo
 * y comprueba que `columna` existe: del renderer solo se fían los VALORES, que van
 * como binds.
 */
export interface DbPedirValor {
  conexionId: string
  objeto: DbRefObjeto
  /** Valores de la PK en el orden de `DbTablaAbierta.clavePrimaria`, tal como llegaron. */
  clave: DbCelda[]
  columna: string
  /**
   * La celda es de un resultado de ESTA consola: la fila se relee en SU sesión, que ve
   * su transacción sin confirmar (como exportar una consulta). Sin ella se lee en
   * `datos`, que solo ve lo confirmado: una fila insertada en Manual «no existiría» y
   * una actualizada devolvería el valor VIEJO. El main comprueba que la consola es de
   * `conexionId` y responde `ocupada` si está ejecutando. `txInicial`: la «Transacción al
   * abrir» de la barra, por si la lectura CREA la sesión (ver `DbEjecutarConsola.txInicial`).
   */
  consola?: { perfilId: string; consolaId: string; txInicial?: DbTxModo }
}

export interface DbValor {
  /** Texto completo, o '0x…' en binario. */
  valor: string | null
  tipoLogico: DbTipoLogico
  /** Tamaño real (caracteres o bytes), aunque se haya recortado. */
  longitud: number
  /** Supera `DB_VALOR_MAX`: `valor` llega recortado a ese tope. */
  recortado: boolean
}

/** Formatos de «Copiar como» y de exportar. */
export type DbFormatoFilas = 'tsv' | 'csv' | 'json' | 'insert' | 'markdown'

export type DbOrigenExportacion =
  /** La tabla ENTERA con su filtro: el main genera el SQL como en `TABLA_ABRIR`. */
  | {
      tipo: 'tabla'
      conexionId: string
      objeto: DbRefObjeto
      where?: string
      orderBy?: string
      /** Los mismos de `DbAbrirTabla`, con las mismas exclusiones. */
      filtro?: DbFiltroGuiado
      orden?: DbOrdenColumna[]
    }
  /**
   * Vuelve a ejecutar UNA consulta de la consola en SU sesión (ve su transacción).
   * El main rechaza (`noReleible`) lo que no sea de clase `consulta`, y también si
   * `esquema` (el de la sesión cuando se ejecutó, si se sabe) ya no es el actual: sin
   * calificar, la consulta leería OTRA tabla.
   */
  | {
      tipo: 'consulta'
      perfilId: string
      consolaId: string
      sql: string
      esquema?: string | null
      /** Los parámetros con los que se ejecutó: re-ejecutar sin ellos fallaría. */
      binds?: DbBinds
      /** «Transacción al abrir» de la barra, por si exportar CREA la sesión (ver `DbEjecutarConsola.txInicial`). */
      txInicial?: DbTxModo
    }
  /** Lo ya cargado en la rejilla (un RETURNING no se puede repetir). */
  | { tipo: 'filas'; columnas: DbColumnaResultado[]; filasJson: string }

export interface DbExportar {
  peticionId: string
  origen: DbOrigenExportacion
  formato: DbFormatoFilas
  /** Lo que propone el diálogo, sin extensión ni ruta: `ESQUEMA.TABLA`, `Resultado 2`. */
  nombreSugerido: string
  /** Tabla de los INSERT, YA citada para el motor. Ausente: `tabla`. */
  tablaInsert?: string
  /** Motor de la conexión: cómo se escriben los literales del INSERT. */
  motor: DbMotor
}

export interface DbExportado {
  /** Solo el NOMBRE del archivo: nunca una ruta del host. */
  archivo: string
  filas: number
  bytes: number
  /** Para `EXPORTACION_REVELAR`. El main recuerda los últimos; caduca con la app. */
  token: string
  /**
   * Celdas que se escribieron RECORTADAS: pasaban de `DB_VALOR_MAX` (un LOB de más de
   * 16 Mi). Ausente = ninguna. En el origen `filas` no se sabe (lo decide la rejilla).
   */
  recortadas?: number
  /**
   * Algo que el usuario debe saber del archivo: hoy, que la tabla se leyó por páginas
   * SIN orden estable (PG sin PK ni ORDER BY), y alguna fila pudo repetirse o faltar.
   */
  aviso?: string
}

export interface DbProgresoExportacion {
  peticionId: string
  filas: number
}
