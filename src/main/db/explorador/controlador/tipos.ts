// =============================================================================
// Tipos del controlador del explorador: lo que usa del registro de conexiones y del registro de la app, sus opciones
// (todo lo de Electron llega inyectado) y `ContextoExplorador`, lo que los módulos de esta carpeta usan de la fachada.
// Solo tipos: no importa Electron como valor.
// =============================================================================

import type {
  BrowserWindow,
  MessageBoxOptions,
  MessageBoxReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
  WebContents
} from 'electron'

import type { DbErrorSql, DbRefObjeto, DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection, DbEsquemasVisibles, DbIntrospeccion } from '../../../../shared/db-ipc.ts'
import type { Plataforma } from '../../../../shared/plataforma.ts'

import type { CacheCatalogo } from '../CacheCatalogo.ts'
import type { DialectoCatalogo, FilaCatalogo } from '../catalogoSql.ts'
import type { GestorClaves } from '../claves/GestorClaves.ts'
import type { ConsolasStore } from '../ConsolasStore.ts'
import type { GestorDocumentos } from '../documentos/GestorDocumentos.ts'
import type { Exportador } from '../exportacion.ts'
import type { GestorSesiones, TrabajadorGestor } from '../GestorSesiones.ts'
import type { HistorialStore } from '../HistorialStore.ts'
import type { CtxDrivers } from '../protocoloTrabajador.ts'
import type { SoloLecturaImpuesta } from '../soloLecturaImpuesta.ts'

import type { EstadoExplorador } from './estado.ts'

/** Lo que el explorador usa del registro de conexiones (`ConnectionStore`). */
export interface ConexionesExplorador {
  get(id: string): DbConnection | undefined
  secretOf(id: string): string | null
  /**
   * Motor de archivo (SQLite): la ruta canónica GUARDADA de la conexión (el
   * DTO solo lleva `archivoVisible`), o null. La pide el gestor justo antes de abrir y la
   * compara «Enviar» (`sesionQueBloqueaElArchivo`). Opcional: sin ella, una SQLite no se abre (el
   * gestor lo dice) y las de red no la necesitan.
   */
  rutaArchivoDe?(id: string): string | null | undefined
  setEsquemasVisibles(id: string, v: DbEsquemasVisibles): DbConnection
  /**
   * Guarda las BASES visibles del nivel «Bases» (`DbConnection.bases`), con la
   * misma regla que los esquemas. `ConnectionStore` lo implementa; sigue opcional para los
   * dobles de los tests de Oracle, PG y SQLite, que no tienen nivel «Bases». Sin él,
   * `FIJAR_BASES` lo dice en vez de fingir que guardó.
   */
  setBasesVisibles?(id: string, v: DbEsquemasVisibles): DbConnection
  setIntrospeccion(id: string, v: DbIntrospeccion): void
  /** Devuelve si cambió algo (solo entonces se avisa con `db:changed`). */
  marcarVerificada(id: string, driverId: string | null): boolean
}

/** Lo que el explorador usa de `DbController`. */
export interface RegistroExplorador {
  ctxDrivers(): CtxDrivers
  /** Emite `db:changed`. */
  notificarCambio(): void
  /** `<userData>/conexiones/<perfil>`, validado como hija directa y SIN crearla. */
  espacioDeDatos(profileId: string): string
  /** Carpeta `src/tdb` de la app (ahí está `sesion.cjs`). */
  tdbScriptDir(): string
  /** Crea el espacio de datos y siembra el contexto del agente. */
  ensureWorkspace(profileId: string, nombrePerfil: string): unknown
}

/** Lo que el explorador delega en un gestor de familia (el núcleo de `gestorFamilia.ts`). */
export type MetodosDelegados =
  | 'cancelar'
  | 'forzar'
  | 'desconectar'
  | 'sesiones'
  | 'barrer'
  | 'cerrarTodo'
  | 'reanudarTrasCierreAbortado'
  | 'alCambiarConexion'
  | 'alBorrarConexion'
  | 'cerrarConsola'

/** Lo que el explorador delega en el gestor de documentos (el test lo sustituye por un falso). */
export type GestorDocumentosDelegado = Pick<GestorDocumentos, MetodosDelegados>

/** Lo mismo, en el gestor de claves. */
export type GestorClavesDelegado = Pick<GestorClaves, MetodosDelegados>

export interface OpcionesExplorador {
  conexiones: ConexionesExplorador
  registro: RegistroExplorador
  perfilVivo: (perfilId: string) => boolean
  nombrePerfil: (perfilId: string) => string | null
  /** `shell.trashItem` en la app. */
  papelera: (rutaAbs: string) => Promise<void>
  plataforma: Plataforma
  getWindow: () => BrowserWindow | null
  /** Diálogo NATIVO (`dialog.showMessageBox`). Sin él, la salida no pregunta. */
  mostrarMensaje?: (win: BrowserWindow | null, opciones: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  /**
   * Diálogo NATIVO de guardar (`dialog.showSaveDialog`, el ASÍNCRONO: el e2e lo
   * sustituye desde el main). Sin él, exportar responde que no hay diálogo.
   */
  guardarArchivo?: (win: BrowserWindow | null, opciones: SaveDialogOptions) => Promise<SaveDialogReturnValue>
  /** «Mostrar en la carpeta» (`shell.showItemInFolder`). */
  mostrarEnCarpeta?: (ruta: string) => void
  /** La ventana de quien envió una petición (`BrowserWindow.fromWebContents`). */
  ventanaDe?: (emisor: WebContents) => BrowserWindow | null
  /**
   * Carpeta del HISTORIAL de consultas: en la app `<userData>/db-historial`,
   * FUERA del espacio de datos (`espacioDeDatos`), que es lo que lee el agente. Sin
   * ella no hay historial: listar devuelve vacío y no se anota nada.
   */
  dirHistorial?: string
  /**
   * El gestor de los motores de DOCUMENTOS (MongoDB), al que se delegan
   * los canales comunes (ver la cabecera, «OTRAS FAMILIAS»). Sin él, solo SQL.
   */
  documentos?: GestorDocumentosDelegado
  /** El gestor de los motores de CLAVES (Redis), delegado igual. */
  claves?: GestorClavesDelegado
  log?: (linea: string) => void
  // --- Para los tests ---
  /** Sustituye al `ProcesoTrabajador` (binario, serialización o un falso). */
  lanzar?: (conexion: DbConnection) => TrabajadorGestor
  /** Sustituye a `webContents.send`. */
  emitir?: (canal: string, payload?: unknown) => void
  ahora?: () => number
  /**
   * La solo lectura que impone el explorador (`soloLecturaImpuesta.ts`), al gestor y a la
   * edición de la rejilla. Ausente, NINGUNA: la casilla `readonly` es de los agentes. La
   * pasan el humo remoto (todas, sin mirar la casilla) y los tests que la fijan.
   */
  soloLecturaImpuesta?: SoloLecturaImpuesta
}

export interface BaseEsquemas {
  filas: FilaCatalogo[]
  porDefecto: string
  dialecto: DialectoCatalogo
}

/** Lo que los módulos de esta carpeta usan de la fachada `ExploradorController`. */
export interface ContextoExplorador {
  readonly opciones: OpcionesExplorador
  readonly conexiones: ConexionesExplorador
  readonly registro: RegistroExplorador
  readonly gestor: GestorSesiones
  readonly cache: CacheCatalogo
  readonly consolas: ConsolasStore
  readonly historial: HistorialStore | null
  readonly exportador: Exportador
  readonly estado: EstadoExplorador
  log(linea: string): void
  emitir(canal: string, payload?: unknown): void
  aFallo(e: unknown): { ok: false; error: DbErrorSql }
  seguro<T>(fn: () => Promise<DbRespuesta<T>>): Promise<DbRespuesta<T>>
  conexionOError(id: string): DbConnection
  refObjeto(v: unknown, conexionId: string): DbRefObjeto
  baseDe(con: DbConnection, v: unknown): string | undefined
}
