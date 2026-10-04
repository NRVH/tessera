// =============================================================================
// Preload: el explorador de bases de datos (catálogo, rejillas, consolas y sesiones).
// Cada respuesta llega envuelta en `DbRespuesta`; los avisos, por suscripción.
// Canales y formas: src/shared/db-explorador-ipc.ts.
// =============================================================================
import { ipcRenderer } from 'electron'
import type { DbConnection, DbEsquemasVisibles } from '../shared/db-ipc'
import {
  DBX_CHANNELS,
  type DbAbrirTabla,
  type DbCancelar,
  type DbConsolaInfo,
  type DbConsolaTexto,
  type DbConteos,
  type DbDetalle,
  type DbEjecutarConsola,
  type DbEscrituraConsola,
  type DbEsquemasRespuesta,
  type DbBasesRespuesta,
  type DbEstadoSesion,
  type DbEventoCatalogo,
  type DbEntradaHistorial,
  type DbEnviarCambios,
  type DbResultadoEnvio,
  type DbExplicar,
  type DbValidarSintaxis,
  type VeredictoSintaxis,
  type DbExportado,
  type DbFiltroHistorial,
  type DbPlan,
  type DbRelacionesFk,
  type DbExportar,
  type DbFuente,
  type DbIndiceNombres,
  type DbObjeto,
  type DbPagina,
  type DbParteDetalle,
  type DbPedirValor,
  type DbProgresoExportacion,
  type DbRefObjeto,
  type DbResolucionBloque,
  type DbResolverTx,
  type DbRespuesta,
  type DbResultadoSentencia,
  type DbSinEnviar,
  type DbTablaAbierta,
  type DbTipoObjeto,
  type DbTxModo,
  type DbValor
} from '../shared/db-explorador-ipc'

/**
 * Explorador de bases de datos (vista "Conexiones"): catálogo, rejillas, consolas y
 * sesiones vivas. Contrato en `shared/db-explorador-ipc.ts`, cuya cabecera explica por
 * qué casi todo devuelve `DbRespuesta` en vez de lanzar. Cada llamada manda UN objeto
 * con nombre de campo: así el main valida la forma y un argumento de más o de menos
 * no se desplaza en silencio.
 */
export interface DbExploradorApi {
  // --- Árbol y catálogo ---
  //
  // `base` (SQL Server sin base fija, el nivel «Bases» del árbol): último
  // argumento OPCIONAL de esquemas/resumen/objetos/nombres/refrescar. Ausente = la base de la
  // sesión, que es todo lo que hay en Oracle, PG y SQLite (y en SQL Server con base fija).
  // Viaja en el objeto de la petición como `base` y SOLO si viene: un motor sin nivel
  // «Bases» manda exactamente la misma petición que antes.
  esquemas: (conexionId: string, refrescar?: boolean, base?: string) => Promise<DbRespuesta<DbEsquemasRespuesta>>
  fijarEsquemas: (conexionId: string, config: DbEsquemasVisibles) => Promise<DbRespuesta<DbConnection>>
  /** Las bases del nivel «Bases»; error con una conexión que no lo tiene. */
  bases: (conexionId: string, refrescar?: boolean) => Promise<DbRespuesta<DbBasesRespuesta>>
  /** Guarda el «N de M» de las bases (`DbConnection.bases`); emite db:changed. */
  fijarBases: (conexionId: string, config: DbEsquemasVisibles) => Promise<DbRespuesta<DbConnection>>
  resumen: (conexionId: string, esquema: string, refrescar?: boolean, base?: string) => Promise<DbRespuesta<DbConteos>>
  objetos: (
    conexionId: string,
    esquema: string,
    tipo: DbTipoObjeto,
    refrescar?: boolean,
    base?: string
  ) => Promise<DbRespuesta<DbObjeto[]>>
  detalle: (
    conexionId: string,
    objeto: DbRefObjeto,
    partes: DbParteDetalle[]
  ) => Promise<DbRespuesta<DbDetalle>>
  resolver: (conexionId: string, esquema: string, nombre: string) => Promise<DbRespuesta<DbRefObjeto>>
  /** `refrescar` (el «Refrescar» de la pestaña): igual que en `ddl`, salta la caché del main. */
  fuente: (conexionId: string, objeto: DbRefObjeto, refrescar?: boolean) => Promise<DbRespuesta<DbFuente>>
  /**
   * DDL del objeto: una sola parte con título 'DDL'. `refrescar` (el «Refrescar» de la
   * pestaña) vuelve a pedirlo al servidor aunque el main lo tenga en caché.
   */
  ddl: (conexionId: string, objeto: DbRefObjeto, refrescar?: boolean) => Promise<DbRespuesta<DbFuente>>
  nombres: (
    conexionId: string,
    esquemaActual?: string | null,
    refrescar?: boolean,
    base?: string
  ) => Promise<DbRespuesta<DbIndiceNombres>>
  nombresPublicos: (conexionId: string) => Promise<DbRespuesta<string[]>>
  refrescar: (conexionId: string, esquema?: string, base?: string) => Promise<void>
  // --- Pestaña de tabla y lectores ---
  abrirTabla: (req: DbAbrirTabla) => Promise<DbRespuesta<DbTablaAbierta>>
  /**
   * `peticionId` es la clave con la que Stop la encuentra (`cancelar` de rol
   * `datos`): sin ella la página se lee igual, pero no se puede detener.
   */
  leerMas: (lector: string, maxFilas: number, peticionId?: string) => Promise<DbRespuesta<DbPagina>>
  contar: (lector: string, peticionId: string) => Promise<DbRespuesta<number>>
  cerrarLector: (lector: string) => Promise<void>
  /** Valor ENTERO de una celda recortada, buscando la fila por su PK. */
  valor: (req: DbPedirValor) => Promise<DbRespuesta<DbValor>>
  /** «Enviar» los cambios de la rejilla: todo o nada, con COMMIT. */
  enviarCambios: (req: DbEnviarCambios) => Promise<DbRespuesta<DbResultadoEnvio>>
  /** Abre el diálogo nativo y exporta; `null` = el usuario canceló el diálogo. */
  exportar: (req: DbExportar) => Promise<DbRespuesta<DbExportado | null>>
  /** Muestra en el gestor de archivos lo exportado con ese `token`. */
  revelarExportacion: (token: string) => Promise<void>
  // --- Consola ---
  ejecutar: (req: DbEjecutarConsola) => Promise<DbRespuesta<DbResultadoSentencia>>
  /**
   * `confirmado`: en producción, el usuario confirmó el COMMIT. `txInicial` (y
   * en `modoTx` y `esquemaConsola`): la «Transacción al abrir» de la barra, por si la
   * petición CREA la sesión.
   */
  tx: (
    perfilId: string,
    consolaId: string,
    accion: DbResolverTx,
    confirmado?: boolean,
    txInicial?: DbTxModo
  ) => Promise<DbRespuesta<DbEstadoSesion>>
  modoTx: (
    perfilId: string,
    consolaId: string,
    modo: DbTxModo,
    resolver?: DbResolverTx,
    txInicial?: DbTxModo
  ) => Promise<DbRespuesta<DbEstadoSesion>>
  estadoConsola: (perfilId: string, consolaId: string) => Promise<DbEstadoSesion | null>
  cerrarSesionConsola: (
    perfilId: string,
    consolaId: string,
    resolver?: DbResolverTx
  ) => Promise<DbRespuesta<void>>
  /** Fija el esquema actual de la consola; `null` vuelve al de la conexión. */
  esquemaConsola: (
    perfilId: string,
    consolaId: string,
    esquema: string | null,
    txInicial?: DbTxModo
  ) => Promise<DbRespuesta<DbEstadoSesion>>
  /** Plan de una sentencia SIN ejecutarla, en la sesión de la consola (Stop: `cancelar` de consola). */
  explicar: (req: DbExplicar) => Promise<DbRespuesta<DbPlan>>
  /** Gramática local de sentencias sueltas, sin conexión (hoy solo PG). */
  validarSintaxis: (req: DbValidarSintaxis) => Promise<DbRespuesta<VeredictoSintaxis[]>>
  /** Claves ajenas que salen de la tabla y que entran en ella (autocompletado de JOIN). */
  fks: (conexionId: string, objeto: DbRefObjeto, refrescar?: boolean) => Promise<DbRespuesta<DbRelacionesFk>>
  // --- Historial de consultas (privado: no va al espacio de datos) ---
  historial: (filtro: DbFiltroHistorial) => Promise<DbRespuesta<DbEntradaHistorial[]>>
  /** `ids` null = todo el historial del perfil. */
  borrarHistorial: (perfilId: string, ids: string[] | null) => Promise<DbRespuesta<void>>
  // --- Conexión ---
  cancelar: (req: DbCancelar) => Promise<void>
  /**
   * Con `consola` (motor con un proceso por consola, SQLite) mata solo el proceso de esa
   * consola; sin ella, el de la conexión entera, como siempre.
   */
  forzar: (conexionId: string, consola?: { perfilId: string; consolaId: string }) => Promise<void>
  /**
   * Con `resolver: 'commit'` confirma las pendientes y REVIERTE las fallidas (no se
   * pueden confirmar); `valor.revertidasFallidas` dice cuáles, para avisar.
   */
  desconectar: (conexionId: string, resolver?: DbResolverTx) => Promise<DbRespuesta<DbResolucionBloque>>
  sesiones: () => Promise<DbEstadoSesion[]>
  // --- Archivos de consola ---
  listarConsolas: (perfilId: string) => Promise<DbRespuesta<DbConsolaInfo[]>>
  crearConsola: (perfilId: string, conexionId: string) => Promise<DbRespuesta<DbConsolaInfo>>
  leerConsola: (perfilId: string, consolaId: string) => Promise<DbRespuesta<DbConsolaTexto>>
  escribirConsola: (
    perfilId: string,
    consolaId: string,
    texto: string
  ) => Promise<DbRespuesta<DbEscrituraConsola>>
  renombrarConsola: (
    perfilId: string,
    consolaId: string,
    nombre: string
  ) => Promise<DbRespuesta<DbConsolaInfo>>
  borrarConsola: (
    perfilId: string,
    consolaId: string,
    resolver?: DbResolverTx
  ) => Promise<DbRespuesta<void>>
  /** Acuse de `onVaciarConsolas`: el texto pendiente ya se mandó. */
  consolasVaciadas: () => void
  /** Respuesta a `onPedirSinEnviar`, con su mismo `id`. */
  responderSinEnviar: (r: DbSinEnviar) => void
  // --- Eventos ---
  onSesion: (cb: (e: DbEstadoSesion) => void) => () => void
  onCatalogo: (cb: (e: DbEventoCatalogo) => void) => () => void
  /** El main va a cerrar la app: manda YA el texto de consola pendiente y acusa. */
  onVaciarConsolas: (cb: () => void) => () => void
  /**
   * El main va a cerrar la app y pregunta qué pestañas de tabla tienen cambios SIN
   * ENVIAR, para decirlo en su diálogo de salida. Se contesta con
   * `responderSinEnviar` y el mismo `id`.
   */
  onPedirSinEnviar: (cb: (id: number) => void) => () => void
  onExportacion: (cb: (e: DbProgresoExportacion) => void) => () => void
}

/**
 * Suscripción a un evento del explorador con su payload. Un solo molde para los tres
 * eventos: el `removeListener` tiene que recibir EXACTAMENTE la misma función que el
 * `on`, y escribirlo a mano tres veces es como se cuela una baja que no da de baja.
 */
function suscribirDbx<T>(canal: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(canal, listener)
  return () => ipcRenderer.removeListener(canal, listener)
}

/**
 * La `base` de una petición del catálogo, SOLO si viene: sin ella la
 * petición es la de siempre, al byte (Oracle, PG, SQLite y SQL Server con base fija).
 */
function conBase(base: string | undefined): { base?: string } {
  return typeof base === 'string' && base !== '' ? { base } : {}
}

export const dbExplorador: DbExploradorApi = {
  esquemas: (conexionId, refrescar, base) =>
    ipcRenderer.invoke(DBX_CHANNELS.ESQUEMAS, { conexionId, refrescar, ...conBase(base) }),
  fijarEsquemas: (conexionId, config) =>
    ipcRenderer.invoke(DBX_CHANNELS.FIJAR_ESQUEMAS, { conexionId, config }),
  bases: (conexionId, refrescar) => ipcRenderer.invoke(DBX_CHANNELS.BASES, { conexionId, refrescar }),
  fijarBases: (conexionId, config) => ipcRenderer.invoke(DBX_CHANNELS.FIJAR_BASES, { conexionId, config }),
  resumen: (conexionId, esquema, refrescar, base) =>
    ipcRenderer.invoke(DBX_CHANNELS.RESUMEN, { conexionId, esquema, refrescar, ...conBase(base) }),
  objetos: (conexionId, esquema, tipo, refrescar, base) =>
    ipcRenderer.invoke(DBX_CHANNELS.OBJETOS, { conexionId, esquema, tipo, refrescar, ...conBase(base) }),
  detalle: (conexionId, objeto, partes) =>
    ipcRenderer.invoke(DBX_CHANNELS.DETALLE, { conexionId, objeto, partes }),
  resolver: (conexionId, esquema, nombre) =>
    ipcRenderer.invoke(DBX_CHANNELS.RESOLVER, { conexionId, esquema, nombre }),
  fuente: (conexionId, objeto, refrescar) =>
    ipcRenderer.invoke(DBX_CHANNELS.FUENTE, { conexionId, objeto, refrescar }),
  ddl: (conexionId, objeto, refrescar) =>
    ipcRenderer.invoke(DBX_CHANNELS.DDL, { conexionId, objeto, refrescar }),
  nombres: (conexionId, esquemaActual, refrescar, base) =>
    ipcRenderer.invoke(DBX_CHANNELS.NOMBRES, { conexionId, esquemaActual, refrescar, ...conBase(base) }),
  nombresPublicos: (conexionId) =>
    ipcRenderer.invoke(DBX_CHANNELS.NOMBRES_PUBLICOS, { conexionId }),
  refrescar: (conexionId, esquema, base) =>
    ipcRenderer.invoke(DBX_CHANNELS.REFRESCAR, { conexionId, esquema, ...conBase(base) }),
  abrirTabla: (req) => ipcRenderer.invoke(DBX_CHANNELS.TABLA_ABRIR, req),
  leerMas: (lector, maxFilas, peticionId) =>
    ipcRenderer.invoke(DBX_CHANNELS.LECTOR_MAS, { lector, maxFilas, peticionId }),
  contar: (lector, peticionId) =>
    ipcRenderer.invoke(DBX_CHANNELS.LECTOR_CONTAR, { lector, peticionId }),
  cerrarLector: (lector) => ipcRenderer.invoke(DBX_CHANNELS.LECTOR_CERRAR, { lector }),
  valor: (req) => ipcRenderer.invoke(DBX_CHANNELS.VALOR, req),
  enviarCambios: (req) => ipcRenderer.invoke(DBX_CHANNELS.DATOS_ENVIAR, req),
  exportar: (req) => ipcRenderer.invoke(DBX_CHANNELS.EXPORTAR, req),
  revelarExportacion: (token) =>
    ipcRenderer.invoke(DBX_CHANNELS.EXPORTACION_REVELAR, { token }),
  ejecutar: (req) => ipcRenderer.invoke(DBX_CHANNELS.CONSOLA_EJECUTAR, req),
  tx: (perfilId, consolaId, accion, confirmado, txInicial) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLA_TX, { perfilId, consolaId, accion, confirmado, txInicial }),
  modoTx: (perfilId, consolaId, modo, resolver, txInicial) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLA_MODO_TX, { perfilId, consolaId, modo, resolver, txInicial }),
  estadoConsola: (perfilId, consolaId) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLA_ESTADO, { perfilId, consolaId }),
  cerrarSesionConsola: (perfilId, consolaId, resolver) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLA_CERRAR_SESION, { perfilId, consolaId, resolver }),
  esquemaConsola: (perfilId, consolaId, esquema, txInicial) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLA_ESQUEMA, { perfilId, consolaId, esquema, txInicial }),
  explicar: (req) => ipcRenderer.invoke(DBX_CHANNELS.CONSOLA_EXPLAIN, req),
  validarSintaxis: (req) => ipcRenderer.invoke(DBX_CHANNELS.CONSOLA_SINTAXIS, req),
  fks: (conexionId, objeto, refrescar) =>
    ipcRenderer.invoke(DBX_CHANNELS.FKS, { conexionId, objeto, refrescar }),
  historial: (filtro) => ipcRenderer.invoke(DBX_CHANNELS.HISTORIAL_LISTAR, filtro),
  borrarHistorial: (perfilId, ids) =>
    ipcRenderer.invoke(DBX_CHANNELS.HISTORIAL_BORRAR, { perfilId, ids }),
  cancelar: (req) => ipcRenderer.invoke(DBX_CHANNELS.CANCELAR, req),
  forzar: (conexionId, consola) => ipcRenderer.invoke(DBX_CHANNELS.FORZAR, consola ? { conexionId, consola } : { conexionId }),
  desconectar: (conexionId, resolver) =>
    ipcRenderer.invoke(DBX_CHANNELS.DESCONECTAR, { conexionId, resolver }),
  sesiones: () => ipcRenderer.invoke(DBX_CHANNELS.SESIONES),
  listarConsolas: (perfilId) => ipcRenderer.invoke(DBX_CHANNELS.CONSOLAS_LISTAR, { perfilId }),
  crearConsola: (perfilId, conexionId) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLAS_CREAR, { perfilId, conexionId }),
  leerConsola: (perfilId, consolaId) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLAS_LEER, { perfilId, consolaId }),
  escribirConsola: (perfilId, consolaId, texto) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLAS_ESCRIBIR, { perfilId, consolaId, texto }),
  renombrarConsola: (perfilId, consolaId, nombre) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLAS_RENOMBRAR, { perfilId, consolaId, nombre }),
  borrarConsola: (perfilId, consolaId, resolver) =>
    ipcRenderer.invoke(DBX_CHANNELS.CONSOLAS_BORRAR, { perfilId, consolaId, resolver }),
  consolasVaciadas: () => ipcRenderer.send(DBX_CHANNELS.CONSOLAS_VACIADAS),
  responderSinEnviar: (r) => ipcRenderer.send(DBX_CHANNELS.SIN_ENVIAR, r),
  onSesion: (cb) => suscribirDbx<DbEstadoSesion>(DBX_CHANNELS.EV_SESION, cb),
  onCatalogo: (cb) => suscribirDbx<DbEventoCatalogo>(DBX_CHANNELS.EV_CATALOGO, cb),
  onVaciarConsolas: (cb) => suscribirDbx<void>(DBX_CHANNELS.EV_VACIAR_CONSOLAS, () => cb()),
  onPedirSinEnviar: (cb) =>
    suscribirDbx<{ id?: unknown } | undefined>(DBX_CHANNELS.EV_PEDIR_SIN_ENVIAR, (p) => {
      // Sin un `id` numérico no hay a quién contestar: el main lo descartaría igual.
      if (typeof p?.id === 'number') cb(p.id)
    }),
  onExportacion: (cb) => suscribirDbx<DbProgresoExportacion>(DBX_CHANNELS.EV_EXPORTACION, cb)
}
