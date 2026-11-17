// =============================================================================
// Preload: registro de conexiones y drivers, y los motores de documentos y de claves.
// Canales y formas: src/shared/db-ipc.ts, db-documentos-ipc.ts y db-claves-ipc.ts.
// El explorador SQL (catálogo, rejillas, consolas) está en bdExplorador.ts.
// =============================================================================
import { ipcRenderer, webUtils } from 'electron'
import {
  DB_CHANNELS,
  type PeticionListarConexiones,
  type PeticionFijarAmbitoBd,
  type PeticionEditarConexion,
  type PeticionReordenarConexiones,
  type PeticionProbarConexion,
  type PeticionElegirArchivoBd,
  type PeticionArchivoSoltadoBd,
  type PeticionInstalarControlador,
  type PeticionUsarControlador,
  type PeticionAsegurarEspacioBd,
  type PeticionRutasEspaciosBd,
  type DbArchivoElegido,
  type DbBorrarConexion,
  type DbConexionBorrada,
  type DbConexionDeArchivo,
  type PeticionMontarArchivoBd,
  type DbMontarArchivoRespuesta,
  type DbMotor,
  type DbListaConexiones,
  type ConexionBd,
  type DatosEntradaConexionBd,
  type ResultadoProbarConexion,
  type DbWorkspaceRef,
  type ProgresoDriver,
  type EstadoDriver
} from '../shared/db-ipc'
import type { DbRespuesta } from '../shared/db-explorador-ipc'
import {
  DOCS_CHANNELS,
  type DbDocBase,
  type DbDocColeccion,
  type DbDocConsultar,
  type DbDocDetalleColeccion,
  type DbDocEjecutar,
  type DbDocEnviar,
  type DbDocPagina,
  type DbDocPedirBases,
  type DbDocPedirColecciones,
  type DbDocPedirDetalle,
  type DbDocPedirMas,
  type DbDocResultado,
  type DbDocResultadoEnvio
} from '../shared/db-documentos-ipc'
import {
  KV_CHANNELS,
  type DbKvBases,
  type DbKvEjecutar,
  type DbKvEscanear,
  type DbKvGuardado,
  type DbKvGuardarTexto,
  type DbKvPaginaClaves,
  type DbKvPedirBases,
  type DbKvPedirValor,
  type DbKvResultado,
  type DbKvValor
} from '../shared/db-claves-ipc'

/**
 * Conexiones a bases de datos, privadas por perfil y SOLO útiles en modo Windows
 * (las bases van por VPN corporativa; el contenedor no las alcanza). El renderer
 * nunca ve una contraseña: las manda al guardar y recibe solo `tieneSecreto`.
 */
export interface ApiBd {
  listar: (perfilId: string) => Promise<ConexionBd[]>
  /**
   * Las conexiones del perfil y las que esta versión no sabe abrir (de un motor que no
   * conoce, o de uno que conoce guardadas de una forma que no reconoce; ver
   * `DbConexionAjena`), de una misma lectura del registro; y si el archivo ENTERO tiene
   * un formato que no reconoce o no se pudo leer (`formatoAjeno`, con el `aviso` que se
   * enseña y que dice cuál de las dos). Con esa
   * marca las listas vienen vacías sin que el perfil lo esté: no se poda con ellas ni se
   * dice «Sin conexiones» (ver `DbListaConexiones`).
   */
  listarCompleta: (perfilId: string) => Promise<DbListaConexiones>
  crearConexion: (entrada: DatosEntradaConexionBd) => Promise<ConexionBd>
  editarConexion: (id: string, entrada: DatosEntradaConexionBd) => Promise<ConexionBd>
  /**
   * Borra UNA conexión. `ajena` dice cuál si una conocida y una ajena comparten id,
   * `alias`, cuál de las ajenas si hay más de una con ese id, y `profileId`, de qué perfil
   * es la fila (solo se borra entre las suyas; `DbBorrarConexion`). La respuesta dice si
   * quedó una conocida con ese id en su perfil, en cuyo caso lo que cuelga de él (montajes
   * incluidos) es suyo y no se toca, o en OTRO (`conocidaEnOtroPerfil`: lo del id en el otro
   * perfil, montajes y pestañas, es de aquélla y tampoco se toca).
   */
  borrarConexion: (id: string, ajena?: boolean, alias?: string, perfilId?: string) => Promise<DbConexionBorrada>
  /** Fija el orden de las conexiones de un perfil (arrastre en el panel). */
  reordenarConexiones: (perfilId: string, ids: string[]) => Promise<void>
  /** Abre de verdad contra el servidor (vía el subproceso `tdb`). */
  probar: (id: string) => Promise<ResultadoProbarConexion>
  /**
   * Fija las bases MONTADAS de un proyecto. Aplica EN CALIENTE: la siguiente
   * invocación de `tdb` —en el pane del agente y en las terminales de abajo de ese
   * proyecto— ya ve la lista nueva, sin reiniciar ni recargar nada.
   */
  fijarAmbito: (perfilId: string, rutaHostProyecto: string, ids: string[]) => Promise<void>
  estadoDrivers: () => Promise<EstadoDriver[]>
  instalarDriver: (paqueteId: string) => Promise<EstadoDriver>
  /** Escotilla: registrar un cliente que la máquina ya tiene. */
  usarClienteExistente: (paqueteId: string, ruta: string) => Promise<EstadoDriver>
  /** Diálogo nativo de carpeta para la escotilla; null si se canceló. */
  elegirCarpetaDriver: () => Promise<string | null>
  /** El registro de conexiones cambió (alta/edición/baja/prueba): toca recargar la lista. */
  alCambiar: (cb: () => void) => () => void
  alProgresoDriver: (cb: (p: ProgresoDriver) => void) => () => void
  /** Crea (si hace falta) el espacio de datos del perfil y devuelve su ruta opaca. */
  asegurarEspacio: (perfilId: string, nombrePerfil: string) => Promise<DbWorkspaceRef>
  /** Rutas de espacio de datos de varios perfiles, sin crearlas. */
  rutasEspacios: (perfilIds: string[]) => Promise<Record<string, string>>
  // --- Motores de ARCHIVO (SQLite). La ruta no cruza nunca: el main
  // devuelve una FICHA y el nombre, y la ficha es lo que viaja al guardar
  // (`DatosEntradaConexionBd.archivo`).
  /** Diálogo nativo de abrir, con los filtros del motor. null si se canceló. */
  elegirArchivo: (motor: DbMotor) => Promise<DbArchivoElegido | null>
  /** Diálogo nativo de guardar: CREA una base nueva y vacía. null si se canceló. */
  crearArchivo: (motor: DbMotor) => Promise<DbArchivoElegido | null>
  /**
   * Un archivo SOLTADO sobre el árbol de Conexiones. La ruta la saca AQUÍ
   * `webUtils.getPathForFile` (el renderer aislado no la ve) y va directa al main.
   */
  archivoSoltado: (motor: DbMotor, archivo: File) => Promise<DbArchivoElegido>
  /** «Montar como base de datos» desde el explorador de archivos. */
  montarArchivo: (req: PeticionMontarArchivoBd) => Promise<DbMontarArchivoRespuesta>
  /** La conexión del perfil que ya apunta a ese archivo del proyecto, o null. */
  conexionDeArchivo: (req: PeticionMontarArchivoBd) => Promise<DbConexionDeArchivo>
}

/**
 * Explorador de motores de DOCUMENTOS (MongoDB). Contrato en
 * `shared/db-documentos-ipc.ts`: un canal por función, con el objeto de petición tal cual.
 * Lo común (cancelar, desconectar, sesiones, archivos de consola) sigue en `bdExplorador`.
 */
export interface ApiBdDocumentos {
  bases: (p: DbDocPedirBases) => Promise<DbRespuesta<DbDocBase[]>>
  colecciones: (p: DbDocPedirColecciones) => Promise<DbRespuesta<DbDocColeccion[]>>
  detalle: (p: DbDocPedirDetalle) => Promise<DbRespuesta<DbDocDetalleColeccion>>
  consultar: (p: DbDocConsultar) => Promise<DbRespuesta<DbDocPagina>>
  lectorMas: (p: DbDocPedirMas) => Promise<DbRespuesta<DbDocPagina>>
  lectorCerrar: (lector: string) => Promise<void>
  ejecutarConsola: (p: DbDocEjecutar) => Promise<DbRespuesta<DbDocResultado>>
  enviar: (p: DbDocEnviar) => Promise<DbRespuesta<DbDocResultadoEnvio>>
}

/**
 * Explorador de motores de CLAVES (Redis). Contrato en `shared/db-claves-ipc.ts`,
 * con la misma forma que `ApiBdDocumentos`.
 */
export interface ApiBdClaves {
  bases: (p: DbKvPedirBases) => Promise<DbRespuesta<DbKvBases>>
  escanear: (p: DbKvEscanear) => Promise<DbRespuesta<DbKvPaginaClaves>>
  valor: (p: DbKvPedirValor) => Promise<DbRespuesta<DbKvValor>>
  ejecutarConsola: (p: DbKvEjecutar) => Promise<DbRespuesta<DbKvResultado>>
  /** Guarda un texto en el archivo que el usuario elige; `null` si cancela el diálogo. */
  guardarTexto: (p: DbKvGuardarTexto) => Promise<DbRespuesta<DbKvGuardado | null>>
}

/**
 * Conexiones a bases de datos (solo modo Windows). Las contraseñas NUNCA vuelven
 * por aquí: se mandan al crear/editar y el main las cifra; `list` devuelve solo el
 * indicador `tieneSecreto`.
 */
export const db: ApiBd = {
  listar: (perfilId) => ipcRenderer.invoke(DB_CHANNELS.LIST, { profileId: perfilId } satisfies PeticionListarConexiones),
  listarCompleta: (perfilId) =>
    ipcRenderer.invoke(DB_CHANNELS.LIST_COMPLETA, { profileId: perfilId } satisfies PeticionListarConexiones),
  crearConexion: (entrada) => ipcRenderer.invoke(DB_CHANNELS.CREATE, entrada),
  editarConexion: (id, entrada) =>
    ipcRenderer.invoke(DB_CHANNELS.UPDATE, { id, input: entrada } satisfies PeticionEditarConexion),
  borrarConexion: (id, ajena, alias, perfilId) => {
    const req: DbBorrarConexion = ajena === undefined ? { id } : { id, ajena }
    if (ajena === true && alias !== undefined) req.alias = alias
    if (perfilId !== undefined) req.profileId = perfilId
    return ipcRenderer.invoke(DB_CHANNELS.DELETE, req)
  },
  reordenarConexiones: (perfilId, ids) =>
    ipcRenderer.invoke(DB_CHANNELS.REORDER, { profileId: perfilId, ids } satisfies PeticionReordenarConexiones),
  probar: (id) => ipcRenderer.invoke(DB_CHANNELS.TEST, { id } satisfies PeticionProbarConexion),
  fijarAmbito: (perfilId, rutaHostProyecto, ids) =>
    ipcRenderer.invoke(DB_CHANNELS.SET_SCOPE, { profileId: perfilId, projectHostPath: rutaHostProyecto, ids } satisfies PeticionFijarAmbitoBd),
  estadoDrivers: () => ipcRenderer.invoke(DB_CHANNELS.DRIVERS_LIST),
  instalarDriver: (paqueteId) =>
    ipcRenderer.invoke(DB_CHANNELS.DRIVERS_INSTALL, { packId: paqueteId } satisfies PeticionInstalarControlador),
  usarClienteExistente: (paqueteId, ruta) =>
    ipcRenderer.invoke(DB_CHANNELS.DRIVERS_USE_EXISTING, { packId: paqueteId, ruta } satisfies PeticionUsarControlador),
  elegirCarpetaDriver: () => ipcRenderer.invoke(DB_CHANNELS.DRIVERS_PICK_FOLDER),
  alCambiar: (cb) => {
    const oyente = (): void => cb()
    ipcRenderer.on(DB_CHANNELS.CHANGED, oyente)
    return () => ipcRenderer.removeListener(DB_CHANNELS.CHANGED, oyente)
  },
  alProgresoDriver: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, p: ProgresoDriver): void => cb(p)
    ipcRenderer.on(DB_CHANNELS.DRIVERS_PROGRESS, oyente)
    return () => ipcRenderer.removeListener(DB_CHANNELS.DRIVERS_PROGRESS, oyente)
  },
  asegurarEspacio: (perfilId, nombrePerfil) =>
    ipcRenderer.invoke(DB_CHANNELS.WORKSPACE_ENSURE, { profileId: perfilId, nombrePerfil } satisfies PeticionAsegurarEspacioBd),
  rutasEspacios: (perfilIds) =>
    ipcRenderer.invoke(DB_CHANNELS.WORKSPACE_PATHS, { perfilIds } satisfies PeticionRutasEspaciosBd),
  elegirArchivo: (motor) =>
    ipcRenderer.invoke(DB_CHANNELS.ARCHIVO_ELEGIR, { motor } satisfies PeticionElegirArchivoBd),
  crearArchivo: (motor) =>
    ipcRenderer.invoke(DB_CHANNELS.ARCHIVO_CREAR, { motor } satisfies PeticionElegirArchivoBd),
  archivoSoltado: (motor, archivo) => {
    // '' = no es un archivo del disco (un File construido en la página, un elemento que
    // no viene del sistema): el main lo rechaza con su mensaje.
    const ruta = webUtils.getPathForFile(archivo)
    return ipcRenderer.invoke(DB_CHANNELS.ARCHIVO_SOLTADO, { motor, ruta } satisfies PeticionArchivoSoltadoBd)
  },
  montarArchivo: (req) => ipcRenderer.invoke(DB_CHANNELS.ARCHIVO_MONTAR, req),
  conexionDeArchivo: (req) => ipcRenderer.invoke(DB_CHANNELS.ARCHIVO_CONEXION, req)
}

// Una función por canal, cada una con el objeto de petición del contrato tal cual
// (el main lo valida por nombre de campo, como en `bdExplorador`).
export const bdDocumentos: ApiBdDocumentos = {
  bases: (p) => ipcRenderer.invoke(DOCS_CHANNELS.BASES, p),
  colecciones: (p) => ipcRenderer.invoke(DOCS_CHANNELS.COLECCIONES, p),
  detalle: (p) => ipcRenderer.invoke(DOCS_CHANNELS.DETALLE, p),
  consultar: (p) => ipcRenderer.invoke(DOCS_CHANNELS.CONSULTAR, p),
  lectorMas: (p) => ipcRenderer.invoke(DOCS_CHANNELS.LECTOR_MAS, p),
  lectorCerrar: (lector) => ipcRenderer.invoke(DOCS_CHANNELS.LECTOR_CERRAR, lector),
  ejecutarConsola: (p) => ipcRenderer.invoke(DOCS_CHANNELS.CONSOLA_EJECUTAR, p),
  enviar: (p) => ipcRenderer.invoke(DOCS_CHANNELS.ENVIAR, p)
}

export const bdClaves: ApiBdClaves = {
  bases: (p) => ipcRenderer.invoke(KV_CHANNELS.BASES, p),
  escanear: (p) => ipcRenderer.invoke(KV_CHANNELS.ESCANEAR, p),
  valor: (p) => ipcRenderer.invoke(KV_CHANNELS.VALOR, p),
  ejecutarConsola: (p) => ipcRenderer.invoke(KV_CHANNELS.CONSOLA_EJECUTAR, p),
  guardarTexto: (p) => ipcRenderer.invoke(KV_CHANNELS.GUARDAR_TEXTO, p)
}
