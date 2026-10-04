// =============================================================================
// Tipos del gestor de sesiones SQL: las dependencias que se le inyectan, las peticiones y
// resultados de su API y el estado interno (procesos, sesiones y lectores).
// Solo tipos: los usan la fachada `GestorSesiones.ts` y las operaciones de esta carpeta.
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type {
  DbColumnaResultado,
  DbEntradaHistorial,
  DbErrorSql,
  DbEstadoSesion,
  DbRefSesion,
  DbRolSesion,
  DbTxModo
} from '../../../../shared/db-explorador-ipc.ts'
import type { DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import type { SentenciaEnvio } from '../edicionRejilla.ts'
import type { SoloLecturaImpuesta } from '../soloLecturaImpuesta.ts'
import type { BindsSalientes } from '../bindsConsola.ts'
import type { ColaSesion } from '../colaSesion.ts'
import type { ConfirmacionEnVuelo, EstadoMaquinaSesion } from '../maquinaSesion.ts'
import type {
  CtxDrivers,
  ErrorTrabajador,
  EventoTrabajador,
  OpcionesEjecucion,
  OpTrabajador,
  PeticionSinIdDe,
  RespuestasPorOp,
  SalidaTextoTrabajador
} from '../protocoloTrabajador.ts'
import type { ClaveKeyset, ObjetoRejilla, ValorClave } from '../sqlRejilla.ts'
import type { DbFiltroGuiado, DbOrdenColumna } from '../../../../shared/filtroGuiado.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from '../motores/tipos.ts'

/**
 * Lo que el gestor necesita de un proceso de sesión. `ProcesoTrabajador` lo
 * cumple tal cual; el test inyecta uno falso.
 */
export interface TrabajadorGestor {
  arrancar(): Promise<unknown>
  enviar<O extends OpTrabajador>(peticion: PeticionSinIdDe<O>, plazoMs?: number | null): Promise<RespuestasPorOp[O]>
  onEvento(cb: (e: EventoTrabajador) => void): () => void
  onSalida(cb: (s: { codigo: number | null; senal: string | null }) => void): () => void
  salir(plazoMs?: number): Promise<void>
  /** `motivo`: con qué se rechaza lo que quede en vuelo (el Stop de SQLite: `cancelada`). */
  matar(motivo?: ErrorTrabajador): void
  readonly vivo: boolean
  readonly pendientes: number
}

export interface DependenciasGestor {
  /** Crea (sin arrancar) el proceso de sesión de una conexión. */
  lanzar: (conexion: DbConnection) => TrabajadorGestor
  /** La conexión tal como está AHORA en el registro (undefined si se borró). */
  conexion: (id: string) => DbConnection | undefined
  /** Contraseña en claro, o null si no hay o no se puede descifrar. */
  secreto: (id: string) => string | null
  /**
   * Motor de ARCHIVO (SQLite): la ruta canónica GUARDADA en el registro (el DTO solo lleva
   * su nombre, `archivoVisible`), o null si no la hay. Se pide justo antes de cada apertura,
   * como el secreto, y no se guarda aquí.
   */
  rutaArchivo?: (id: string) => string | null
  /**
   * Motor de ARCHIVO: los primeros bytes (32) del archivo de `ruta`, o null si no se leen.
   * Con ellos decide el motor si una transacción que solo leyó bloquea «Enviar»
   * (`EsperaPorArchivo.lectorBloquea`). Ausente: se leen del disco (`leerCabeceraArchivo`).
   */
  leerCabecera?: (ruta: string) => Uint8Array | null
  /** El nombre que el usuario dio a una consola (para decir cuál bloquea un archivo), o null. */
  nombreConsola?: (perfilId: string, consolaId: string) => Promise<string | null>

  /** Contexto de drivers para `abrir` (el mismo que arma `tdb.cjs`). */
  ctxDrivers: () => CtxDrivers
  /** `dbx:ev:sesion`: una sesión cambió de fase o de transacción. */
  emitirSesion: (estado: DbEstadoSesion) => void
  /** Una sesión se abrió contra el servidor (el main marca la conexión verificada). */
  alAbrir?: (conexionId: string, driverId: string | null) => void
  /**
   * Un DDL terminó bien en una consola: el catálogo de ese esquema cambió.
   * `global`: afecta a la lista de esquemas (CREATE/DROP USER|SCHEMA).
   */
  alDdl?: (conexionId: string, esquema: string | null, global: boolean) => void
  /**
   * Esquema elegido en una consola (`CONSOLA_ESQUEMA`, guardado en el índice de
   * consolas), o null = el de la conexión. Se consulta al (re)abrir su sesión.
   */
  esquemaDeConsola?: (perfilId: string, consolaId: string) => string | null
  /** Al reabrir, el esquema elegido ya no existía: el main lo olvida en el índice. */
  alPerderEsquema?: (perfilId: string, consolaId: string, esquema: string) => void
  /**
   * Una sentencia de consola LLEGÓ al servidor (bien, con error o detenida): el
   * historial. `sql` es el texto del usuario TAL CUAL (sin traducir el EXEC);
   * `esquema`, el de la sesión ANTES de ejecutarla. Lo que no llegó (ocupada, solo
   * lectura, parámetros que faltan, un Stop antes de enviar) no pasa por aquí.
   */
  alSentencia?: (e: Omit<DbEntradaHistorial, 'id'>, d: DialectoSql) => void
  /** Reloj de la máquina de estados y del barrido. Por defecto `Date.now`. */
  ahora?: () => number
  /** Registro. NUNCA recibe SQL ni secretos. */
  log?: (linea: string) => void
  /**
   * La solo lectura que impone el EXPLORADOR (`soloLecturaImpuesta.ts`). Ausente, ninguna:
   * la casilla `readonly` de la conexión es de los agentes y aquí no se lee. La pasan el
   * humo remoto (todas) y los tests que fijan la maquinaria de solo lectura.
   */
  soloLecturaImpuesta?: SoloLecturaImpuesta
}

/** Una consola, con la conexión a la que está atada. */
export interface RefConsola {
  perfilId: string
  consolaId: string
  conexionId: string
  /**
   * La preferencia «Transacción al abrir» con la que el renderer pinta la barra de esta
   * consola, por si la petición CREA la sesión. Viene del renderer: se valida con `txInicialDePeticion`, y
   * ausente o inválida manda la de `fijarAjustes`. Con la sesión ya creada no cuenta.
   */
  txInicial?: DbTxModo
}

/** Lo que recibe una función de catálogo (corre como UNA tarea de la cola de `meta`). */
export interface ContextoCatalogo {
  dialecto: DialectoCatalogo
  /** Esquema actual de la sesión `meta`. */
  esquema: string | null
  consultar: (c: ConsultaCatalogo) => Promise<FilaCatalogo[]>
  /**
   * Oracle: un bloque PL/SQL con UN bind de salida de texto (CLOB) llamado `salida`,
   * leído entero hasta `tope` (el DDL de DBMS_METADATA). null = el bloque dejó NULL.
   */
  bloqueTexto: (
    sql: string,
    binds: Record<string, string | number | null>,
    salida: string,
    tope: number
  ) => Promise<SalidaTextoTrabajador | null>
}

/** Topes de lectura del trabajador (ver `OpcionesEjecucion`): exportar y el valor completo. */
export type TopesLectura = Pick<OpcionesEjecucion, 'topeCelda' | 'topeBinario' | 'topeRespuesta'>

/** Una página que entrega una exportación (ver `exportacion.ts`). */
export interface PaginaExportada {
  columnas: DbColumnaResultado[]
  filasJson: string
  recortes?: Array<[number, number, number]>
}

export type ConsumidorPaginas = (p: PaginaExportada) => Promise<void>

export interface PeticionTabla {
  conexionId: string
  peticionId: string
  /** Ya resuelto (el destino si era un sinónimo). */
  objeto: ObjetoRejilla
  where?: string | null
  orderBy?: string | null
  /** El filtro guiado y el orden de la cabecera; excluyentes con `where` / `orderBy`. */
  filtro?: DbFiltroGuiado | null
  orden?: readonly DbOrdenColumna[] | null
  /** Columnas de la PK (PG ordena por ellas sin ORDER BY del usuario). */
  pk: readonly string[]
  maxFilas: number
  /** Topes de lectura propios (exportar lee los LOB enteros); también para las páginas siguientes. */
  topes?: TopesLectura
  /**
   * Oracle: añadir el ROWID como columna OCULTA y última (la identidad 'rowid'
   * de una tabla sin PK). Lo decide el controlador; también en las páginas siguientes.
   */
  rowid?: boolean
  /** SQLite: el alias del rowid que no tapa una columna (`TablaEdicion.aliasRowid`). */
  aliasRowid?: string | null
  /**
   * 'keyset' (SQLite): la clave con que se pagina sin ORDER BY del usuario (la PK o el
   * rowid); null o ausente = sin clave (LIMIT/OFFSET). La decide el controlador.
   */
  clave?: ClaveKeyset | null
  /**
   * SQL Server: «Leer sin esperar» (`DbAbrirTabla.sinEsperar`): la lectura
   * va en READ UNCOMMITTED; también las páginas siguientes. Los demás motores lo ignoran.
   */
  sinEsperar?: boolean
}

/** Leer el valor completo de una celda (`leerValor`). */
export interface PeticionValor {
  conexionId: string
  sql: string
  binds: string[]
  topes: TopesLectura
  /** La celda es de un resultado de esta consola: se lee en SU sesión. */
  consola?: RefConsola
}

/** Lo que el gestor recibe para «Enviar» (el controlador ya validó y construyó todo). */
export interface PeticionEnvio {
  conexionId: string
  /** La clave del Stop (`cancelar` de rol 'datos') y el id de la sesión efímera. */
  peticionId: string
  /** Producción: el usuario confirmó. Sin él, 'produccion' sin enviar nada. */
  confirmado?: boolean
  sentencias: SentenciaEnvio[]
  /**
   * La base del nivel «Bases» (SQL Server sin base fija) en la que está la
   * tabla: la sesión efímera del envío la fija ANTES de nada (`sqlFijarEsquema` del motor, que
   * en SQL Server es el `USE`), porque la DML va con el nombre de dos partes.
   */
  base?: string
}

/** Una sesión dentro de una resolución en bloque. */
export interface SesionResuelta {
  ref: DbRefSesion
  conexionId: string
}

export interface ErrorResolucion extends SesionResuelta {
  mensaje: string
}

/** Resultado de `resolverTodas` (el diálogo nativo de salida). */
export interface ResolucionTodas {
  /** Sin `errores`. Las fallidas revertidas NO cuentan como error: era lo único posible. */
  ok: boolean
  errores: ErrorResolucion[]
  /** Se pidió `commit` y estaban `fallida`: se revirtieron (`accionEnBloque`). */
  revertidas: SesionResuelta[]
}

/** Resultado de resolver UNA sesión dentro de un bloque. */
export interface ResolucionEnBloque {
  error: DbErrorSql | null
  /** Se pidió `commit`, la tx estaba `fallida` y el ROLLBACK que la sustituyó fue bien. */
  revertidaPorFallida: boolean
}

export interface Proceso {
  id: number
  conexionId: string
  /**
   * Su clave en `procesos`: el id de la conexión, o, en un motor con `procesoPorSesion`
   * (SQLite), `conexión|consola|perfil|consola` para el proceso PROPIO de una consola
   * (`claveProceso`). Meta, datos, exportar y «Enviar» van siempre en el de la conexión.
   */
  clave: string
  /** Proceso propio de una consola (`procesoPorSesion`): cuenta en `MAX_PROCESOS_CONSOLA`. */
  deConsola: boolean
  /**
   * Lo mató un Stop (`procesoPorSesion`: el motor no se interrumpe). Sus sesiones pasan a
   * `detenida`, no a `perdida`, y lo que estaba en vuelo vuelve como `cancelada`.
   */
  detenido?: true
  trabajador: TrabajadorGestor
  arranque: Promise<void>
  listo: boolean
  salido: boolean
  /** Ya no admite sesiones nuevas (editada, expulsada, desconectada…). */
  retirado: boolean
  /** Se mató por colgado: sus sesiones se avisan como caída. */
  colgado: boolean
  salida: Promise<void> | null
  ultimoUso: number
  sinSesionesDesde: number | null
  /** Pack de Instant Client cargado (Oracle thick). */
  driverId: string | null
  bajas: Array<() => void>
}

export interface Sesion {
  clave: string
  ref: DbRefSesion
  rol: DbRolSesion
  conexionId: string
  /** Id de la sesión dentro del trabajador. */
  idTrabajador: string
  cola: ColaSesion
  estado: EstadoMaquinaSesion
  driver?: DbEstadoSesion['driver']
  proceso: Proceso | null
  /** Ejecución, tx o cierre pedidos por el usuario en curso (solo consolas). */
  operacionUsuario: string | null
  /** Clave de la operación que está DENTRO del trabajador ahora mismo. */
  enTrabajador: string | null
  /** Stop pedido para una operación que aún no llegó al trabajador. */
  cancelada: string | null
  eliminada: boolean
  ultimoEmitido: string
  /**
   * Consolas: el esquema con el que se ABRIÓ la sesión (antes de aplicar el elegido).
   * Es al que vuelve «esquema de la conexión» en Oracle, donde no hay RESET.
   */
  esquemaConexion: string | null
  /** Avisos para la Salida que viajan en el resultado de la siguiente sentencia. */
  avisosPendientes: string[]
  /**
   * Sesión EFÍMERA de Tessera (exportar una tabla, o «Enviar» de la rejilla): el renderer no la conoce, así que ni se emite ni se lista, y se
   * cierra y se olvida al acabar.
   */
  interna?: true
  /** Etiqueta de `application_name` / MODULE si no es el rol ('exportar', 'enviar'). */
  accion?: string
  /**
   * «Enviar» corre VARIAS sentencias en una sola tarea de la cola: un Stop que llega
   * ENTRE dos no encuentra nada en el trabajador que interrumpir, así que se apunta
   * también en `cancelada` y el bucle lo mira antes de mandar la siguiente.
   */
  pararEntreSentencias?: true
  /**
   * Una consola que estaba OCUPADA (o abriendo) cuando su conexión PASÓ a
   * producción. No se le puede cambiar el modo en ese momento; se pone en Manual en
   * cuanto deja de estarlo —al terminar, al perderse o al cerrarse—, si la conexión
   * sigue siendo de producción (`aplicarManualPendiente`).
   * 'preferencia': lo mismo cuando la conexión DEJA de ser de
   * solo lectura (fuera de producción) y «Transacción al abrir» es Manual: su Auto era el
   * forzado por el solo lectura, no una elección, y ahora manda la preferencia.
   */
  manualPendiente?: 'produccion' | 'preferencia'
  /**
   * La operación que corre en el trabajador lleva una CONFIRMACIÓN en camino
   * (el COMMIT del botón o uno escrito: 'commit'; una escritura en Auto o un DDL de
   * Oracle: 'implicito'; un bloque o una rutina de Oracle en Manual, que pueden confirmar
   * por dentro: 'porDentro'). Si la sesión se pierde con ella en vuelo, no se sabe si se
   * aplicó: `perder` y `alSalirProceso` se lo dicen a la máquina, y el error lo dice.
   */
  commitEnCamino?: ConfirmacionEnVuelo
}

export type OrigenLector =
  /**
   * `esquema`: el de la sesión cuando nació el lector. Re-ejecutar su texto en otro
   * sería leer otra tabla.
   */
  | {
      tipo: 'consola'
      texto: string
      releible: boolean
      dialecto: DialectoSql
      esquema: string | null
      /** Los MISMOS binds con los que se ejecutó: «más» y Contar los repiten. */
      binds?: BindsSalientes
    }
  | {
      tipo: 'tabla'
      dialecto: DialectoSql
      objeto: ObjetoRejilla
      where: string | null
      orderBy: string | null
      /** El mismo filtro y orden: «más», Contar y exportar los repiten. */
      filtro?: DbFiltroGuiado | null
      orden?: readonly DbOrdenColumna[] | null
      pk: readonly string[]
      topes?: TopesLectura
      /** La columna oculta del ROWID: las páginas de respaldo la conservan. */
      rowid?: true
      /** SQLite: el alias de esa columna. */
      aliasRowid?: string | null
      /** 'keyset' (SQLite): la clave del paginado y la de la última fila entregada. */
      clave?: ClaveKeyset | null
      despues?: ValorClave[] | null
      /** SQL Server: la pestaña se abrió con «Leer sin esperar»; las páginas siguientes, igual. */
      sinEsperar?: true
    }

export interface Lector {
  id: string
  sesion: Sesion
  /** Cursor vivo en el trabajador (Oracle); null = se re-ejecuta. */
  cursor: string | null
  /** Filas ya entregadas: la siguiente página empieza aquí. */
  desde: number
  usadoEn: number
  origen: OrigenLector
}
