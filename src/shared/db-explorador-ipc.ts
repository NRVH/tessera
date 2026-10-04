// =============================================================================
// Contrato IPC del EXPLORADOR DE BASES DE DATOS (vista «Conexiones»): sesiones vivas,
// transacciones, catálogo, rejillas y consolas SQL. Aparte de `db-ipc.ts`, del que solo importa
// tipos, y sin cargar el registro de motores.
// Neutral: lo compilan los dos proyectos TS (node y web), así que nada de DOM ni de `process`.
// Los tipos van por secciones en `dbExplorador<Sección>.ts` y este archivo los reexporta todos,
// así que se sigue importando de aquí. Aquí quedan solo los canales.
// Decisiones: docs/decisiones/bd/contratos-explorador-sql.md
// =============================================================================

import type { DbConnection } from './db-ipc'

export const DBX_CHANNELS = {
  // --- Árbol y catálogo ------------------------------------------------------
  /** invoke: (conexionId, refrescar?) -> DbRespuesta<DbEsquemasRespuesta> */
  ESQUEMAS: 'dbx:esquemas',
  /** invoke: (conexionId, config) -> DbRespuesta<DbConnection>; emite db:changed */
  FIJAR_ESQUEMAS: 'dbx:esquemas:fijar',
  /**
   * Solo SQL Server. invoke: (conexionId, refrescar?) ->
   * DbRespuesta<DbBasesRespuesta>. Solo para una conexión con nivel «Bases»
   * (`tieneNivelBases` de shared/motores: SQL Server sin base fija); con cualquier otra,
   * error. Lo implementan los grupos SESIÓN (handler) e INTERFAZ (preload y árbol).
   */
  BASES: 'dbx:bases',
  /** invoke: (conexionId, config: DbEsquemasVisibles) -> DbRespuesta<DbConnection>; emite db:changed. Guarda `DbConnection.bases`. */
  FIJAR_BASES: 'dbx:bases:fijar',
  /** invoke: (conexionId, esquema, refrescar?) -> DbRespuesta<DbConteos> */
  RESUMEN: 'dbx:esquema:resumen',
  /** invoke: (conexionId, esquema, tipo, refrescar?) -> DbRespuesta<DbObjeto[]> */
  OBJETOS: 'dbx:objetos',
  /** invoke: (conexionId, objeto, partes) -> DbRespuesta<DbDetalle> */
  DETALLE: 'dbx:detalle',
  /** invoke: (conexionId, esquema, nombre) -> DbRespuesta<DbRefObjeto> (sinónimo -> destino) */
  RESOLVER: 'dbx:objeto:resolver',
  /** invoke: (conexionId, objeto, refrescar?) -> DbRespuesta<DbFuente>; `refrescar` como en DDL */
  FUENTE: 'dbx:fuente',
  /**
   * invoke: (conexionId, objeto, refrescar?) -> DbRespuesta<DbRelacionesFk>. Las claves
   * ajenas que SALEN de la tabla y las que ENTRAN en ella (autocompletado de
   * JOIN … ON). Cacheado como el detalle; `refrescar` salta lo guardado.
   */
  FKS: 'dbx:fks',
  /**
   * invoke: (conexionId, objeto, refrescar?) -> DbRespuesta<DbFuente> con UNA parte 'DDL'.
   * `refrescar`: el «Refrescar» de la pestaña, que salta la caché de ESE objeto.
   */
  DDL: 'dbx:ddl',
  /** invoke: (conexionId, esquemaActual?, refrescar?) -> DbRespuesta<DbIndiceNombres> */
  NOMBRES: 'dbx:autocompletado',
  /** invoke: (conexionId) -> DbRespuesta<string[]> (sinónimos PUBLIC, capa aparte) */
  NOMBRES_PUBLICOS: 'dbx:autocompletado:publicos',
  /** invoke: (conexionId, esquema?) -> void; invalida y emite EV_CATALOGO */
  REFRESCAR: 'dbx:refrescar',

  // --- Pestaña de tabla y lectores --------------------------------------------
  /** invoke: DbAbrirTabla -> DbRespuesta<DbTablaAbierta> */
  TABLA_ABRIR: 'dbx:tabla:abrir',
  /** invoke: (lector, maxFilas, peticionId?) -> DbRespuesta<DbPagina>; con id, Stop la cancela */
  LECTOR_MAS: 'dbx:lector:mas',
  /** invoke: (lector, peticionId) -> DbRespuesta<number> */
  LECTOR_CONTAR: 'dbx:lector:contar',
  /** invoke: (lector) -> void */
  LECTOR_CERRAR: 'dbx:lector:cerrar',
  /**
   * invoke: DbEnviarCambios -> DbRespuesta<DbResultadoEnvio> («Enviar» de la
   * rejilla). TODO O NADA: en una sesión propia, BEGIN, cada DML (el UPDATE y el DELETE
   * tienen que tocar EXACTAMENTE una fila), COMMIT; al primer fallo, ROLLBACK y el
   * índice del cambio que falló. En producción exige `confirmado`.
   */
  DATOS_ENVIAR: 'dbx:datos:enviar',
  /** invoke: DbPedirValor -> DbRespuesta<DbValor> (el valor ENTERO de una celda, por su PK) */
  VALOR: 'dbx:valor',
  /**
   * invoke: DbExportar -> DbRespuesta<DbExportado | null>. Abre el diálogo nativo de
   * guardar; `null` = el usuario lo canceló. Stop: `CANCELAR` con rol `exportacion`.
   */
  EXPORTAR: 'dbx:exportar',
  /** invoke: (token) -> void; muestra el archivo exportado en el gestor de archivos */
  EXPORTACION_REVELAR: 'dbx:exportacion:revelar',

  // --- Consola ----------------------------------------------------------------
  /** invoke: DbEjecutarConsola -> DbRespuesta<DbResultadoSentencia> */
  CONSOLA_EJECUTAR: 'dbx:consola:ejecutar',
  /**
   * invoke: (perfilId, consolaId, 'commit'|'rollback', confirmado?, txInicial?) -> DbRespuesta<DbEstadoSesion>.
   * En producción, un COMMIT sin `confirmado` se rechaza con motivo 'produccion'.
   * `txInicial` (y en MODO_TX y ESQUEMA): la «Transacción al abrir» con la que el
   * renderer pinta la barra, por si la petición CREA la sesión de la consola (ver
   * `DbEjecutarConsola.txInicial`).
   */
  CONSOLA_TX: 'dbx:consola:tx',
  /** invoke: (perfilId, consolaId, modo, resolver?, txInicial?) -> DbRespuesta<DbEstadoSesion> */
  CONSOLA_MODO_TX: 'dbx:consola:modoTx',
  /** invoke: (perfilId, consolaId) -> DbEstadoSesion | null */
  CONSOLA_ESTADO: 'dbx:consola:estado',
  /** invoke: (perfilId, consolaId, resolver?) -> DbRespuesta<void> */
  CONSOLA_CERRAR_SESION: 'dbx:consola:cerrarSesion',
  /**
   * invoke: (perfilId, consolaId, esquema | null, txInicial?) -> DbRespuesta<DbEstadoSesion>.
   * Fija el esquema actual de la consola (`null` = el de la conexión). Se guarda en
   * el índice de consolas y se vuelve a aplicar cada vez que la sesión se reabre.
   */
  CONSOLA_ESQUEMA: 'dbx:consola:esquema',
  /**
   * invoke: DbExplicar -> DbRespuesta<DbPlan>. Plan de UNA sentencia sin ejecutarla, en
   * la sesión de la consola (ve su esquema y su transacción). Oracle: EXPLAIN PLAN +
   * DBMS_XPLAN; en solo lectura se deja pasar EXACTAMENTE `EXPLAIN PLAN … FOR <sentencia>`
   * (escribe en PLAN_TABLE, temporal de la sesión, y se revierte: decidido con el
   * usuario). PG: `EXPLAIN (FORMAT JSON)`, sin ANALYZE (ANALYZE ejecuta).
   */
  CONSOLA_EXPLAIN: 'dbx:consola:explain',
  /**
   * invoke: DbValidarSintaxis -> DbRespuesta<VeredictoSintaxis[]> (uno por texto,
   * en el mismo orden). Valida la GRAMÁTICA de sentencias sueltas con el parser local del
   * dialecto (`reglasDe(d).gramaticaLocal`; hoy solo PG, libpg_query en WASM) SIN conexión
   * ni servidor: no ejecuta nada ni abre sesión. `ok:false` = el parser no cargó o la
   * petición pasa de los topes (`shared/sql/sintaxisSql.ts`); un texto de más de
   * `TOPE_TEXTO_SINTAXIS` da `null` en su puesto.
   */
  CONSOLA_SINTAXIS: 'dbx:consola:sintaxis',

  // --- Historial de consultas (privado de Tessera: NO va al espacio de datos) ---
  /** invoke: DbFiltroHistorial -> DbRespuesta<DbEntradaHistorial[]> (más reciente primero) */
  HISTORIAL_LISTAR: 'dbx:historial:listar',
  /** invoke: (perfilId, ids | null) -> DbRespuesta<void>; null = todo el del perfil */
  HISTORIAL_BORRAR: 'dbx:historial:borrar',

  // --- Conexión ---------------------------------------------------------------
  /** invoke: DbCancelar -> void (se ignora si no es la ejecución/petición activa) */
  CANCELAR: 'dbx:cancelar',
  /** invoke: (conexionId) -> void; MATA el proceso de la conexión */
  FORZAR: 'dbx:forzar',
  /** invoke: (conexionId, resolver?) -> DbRespuesta<DbResolucionBloque> (las fallidas revertidas) */
  DESCONECTAR: 'dbx:desconectar',
  /** invoke: () -> DbEstadoSesion[] */
  SESIONES: 'dbx:sesiones',

  // --- Archivos de consola (espacio de datos del perfil) ----------------------
  /** invoke: (perfilId) -> DbRespuesta<DbConsolaInfo[]> */
  CONSOLAS_LISTAR: 'dbx:consolas:listar',
  /** invoke: (perfilId, conexionId) -> DbRespuesta<DbConsolaInfo> */
  CONSOLAS_CREAR: 'dbx:consolas:crear',
  /** invoke: (perfilId, consolaId) -> DbRespuesta<DbConsolaTexto> */
  CONSOLAS_LEER: 'dbx:consolas:leer',
  /** invoke: (perfilId, consolaId, texto) -> DbRespuesta<DbEscrituraConsola> */
  CONSOLAS_ESCRIBIR: 'dbx:consolas:escribir',
  /** invoke: (perfilId, consolaId, nombre) -> DbRespuesta<DbConsolaInfo> */
  CONSOLAS_RENOMBRAR: 'dbx:consolas:renombrar',
  /** invoke: (perfilId, consolaId, resolver?) -> DbRespuesta<void> (a la papelera) */
  CONSOLAS_BORRAR: 'dbx:consolas:borrar',
  /** send renderer -> main: acuse de EV_VACIAR_CONSOLAS (texto pendiente ya enviado) */
  CONSOLAS_VACIADAS: 'dbx:consolas:vaciadas',
  /**
   * send renderer -> main: `DbSinEnviar`, la respuesta a EV_PEDIR_SIN_ENVIAR con el MISMO
   * `id`. Un `send` y no un `invoke` porque quien pregunta es el main: Electron
   * no tiene `invoke` en ese sentido.
   */
  SIN_ENVIAR: 'dbx:sinEnviar',

  // --- Eventos main -> renderer -----------------------------------------------
  /** DbEstadoSesion: cambió la fase o la transacción de una sesión */
  EV_SESION: 'dbx:ev:sesion',
  /** DbEventoCatalogo: el main invalidó su caché. Se emite ANTES de responder. */
  EV_CATALOGO: 'dbx:ev:catalogo',
  /** sin argumentos: el main va a cerrar; manda el texto de consola pendiente */
  EV_VACIAR_CONSOLAS: 'dbx:ev:vaciarConsolas',
  /**
   * `{ id: number }`: el main va a cerrar la app y, ANTES de su diálogo nativo de salida,
   * pregunta qué pestañas de tabla tienen cambios SIN ENVIAR. Se contesta por
   * SIN_ENVIAR con el mismo `id`; el main espera con plazo y, sin respuesta, sigue.
   */
  EV_PEDIR_SIN_ENVIAR: 'dbx:ev:pedirSinEnviar',
  /** DbProgresoExportacion: filas escritas hasta ahora (como mucho cada 250 ms) */
  EV_EXPORTACION: 'dbx:ev:exportacion'
} as const

export * from './dbExploradorArbol.ts'
export * from './dbExploradorResultados.ts'
export * from './dbExploradorPeticiones.ts'
export * from './dbExploradorSesiones.ts'

/** Reexport para quien solo importa este contrato. */
export type { DbConnection }
