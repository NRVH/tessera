// =============================================================================
// Preload de Tessera: compone la API de cada dominio y la expone como `window.tessera`.
// Corre con `contextIsolation` y `sandbox`: solo usa `electron` y módulos propios, que Vite
// empaqueta en un único `out/preload/index.js`. La forma de la API la declara `TesseraApi`
// (el renderer la ve por `index.d.ts`); cada dominio vive en su módulo de esta carpeta.
// =============================================================================
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS, type CrashReport } from '../shared/ipc'
import {
  capacidades as capacidadesDelSistema,
  plataformaActual,
  type CapacidadesPlataforma,
  type Plataforma
} from '../shared/plataforma'
import type { Profile } from '../main/profiles/types'
import { type TerminalApi, type AgentTerminalApi, terminal, agentTerminal } from './terminales'
import {
  type AgentAccountsApi,
  type HibernateApi,
  type ConversationsApi,
  type AgentsUpdateApi,
  type AgentesNativosApi,
  type RedContenedorApi,
  type UsageApi,
  type ContextApi,
  agentAccounts,
  hibernate,
  conversations,
  agentsUpdate,
  agentesNativos,
  redContenedor,
  usage,
  context
} from './agentes'
import {
  type DbApi,
  type DbDocumentosApi,
  type DbClavesApi,
  db,
  dbDocumentos,
  dbClaves
} from './bd'
import { type DbExploradorApi, dbExplorador } from './bdExplorador'
import { type SshApi, ssh } from './ssh'
import { type SftpApi, sftp } from './sftp'
import {
  type FilesApi,
  type ClipboardApi,
  type JavaApi,
  type ComprimidosApi,
  type SearchApi,
  files,
  clipboard,
  java,
  comprimidos,
  search
} from './archivos'
import { type GitApi, git } from './git'
import {
  type WorkspaceApi,
  type ShutdownApi,
  type UpdateApi,
  type AppInfoApi,
  type ShellWindowsApi,
  type ServicioFinderApi,
  type ZoomApi,
  workspace,
  shutdown,
  update,
  appInfo,
  shellWindows,
  servicioFinder,
  zoom
} from './aplicacion'

export interface TesseraApi {
  getProfiles: () => Promise<Profile[]>
  /** Persiste el arreglo COMPLETO de perfiles (CRUD/orden/color). */
  saveProfiles: (profiles: Profile[]) => Promise<void>
  /** Abre una URL http(s)/mailto en el navegador del sistema (enlaces de la terminal). */
  openExternal: (url: string) => Promise<void>
  /**
   * Ruta absoluta en disco de un `File` del DOM (copiado del explorador o arrastrado
   * a la terminal). Vía moderna de Electron (`File.path` está deprecado); vive en el
   * preload porque `webUtils` no existe en el renderer aislado. Devuelve '' si el
   * File no tiene respaldo en disco (p. ej. un screenshot en memoria).
   */
  getPathForFile: (file: File) => string
  /** Reporta un error GLOBAL del renderer al crash-log del main (best-effort, sin respuesta). */
  reportCrash: (report: CrashReport) => void
  /**
   * En qué sistema corre Tessera. SÍNCRONO y no un `invoke`, a diferencia de todo lo
   * demás de esta API, por una razón concreta: el hueco de los botones de la ventana
   * está a la DERECHA en Windows (Window Controls Overlay) y a la IZQUIERDA en macOS
   * (el semáforo), y esa decisión la toma el CSS en el primer pintado. Resuelta por
   * IPC, el primer fotograma se dibujaría con el hueco en el lado equivocado y se
   * vería saltar. `process.platform` está disponible en el preload aun con
   * `sandbox: true`, así que no hace falta cruzar al main para saberlo.
   */
  plataforma: Plataforma
  /**
   * Lo que Tessera SABE HACER en este sistema. La UI lo consulta para no ofrecer
   * controles que no puede cumplir (ver `shared/plataforma.ts`): en Mac no hay
   * categoría "Windows" en Configuración porque el registro no existe, y el botón
   * "Instalar ahora" del update no aparece si el .app no puede auto-instalarse.
   * Síncrono por el mismo motivo que `plataforma`: decide qué se MONTA, no qué se
   * rellena después.
   */
  capacidades: CapacidadesPlataforma
  terminal: TerminalApi
  agentTerminal: AgentTerminalApi
  agentAccounts: AgentAccountsApi
  db: DbApi
  dbExplorador: DbExploradorApi
  dbDocumentos: DbDocumentosApi
  dbClaves: DbClavesApi
  ssh: SshApi
  sftp: SftpApi
  files: FilesApi
  git: GitApi
  workspace: WorkspaceApi
  hibernate: HibernateApi
  shutdown: ShutdownApi
  update: UpdateApi
  appInfo: AppInfoApi
  shellWindows: ShellWindowsApi
  servicioFinder: ServicioFinderApi
  zoom: ZoomApi
  clipboard: ClipboardApi
  conversations: ConversationsApi
  agentsUpdate: AgentsUpdateApi
  agentesNativos: AgentesNativosApi
  redContenedor: RedContenedorApi
  usage: UsageApi
  context: ContextApi
  java: JavaApi
  comprimidos: ComprimidosApi
  search: SearchApi
}

const api: TesseraApi = {
  getProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PROFILES),
  saveProfiles: (profiles) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_PROFILES, profiles),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_URL, url),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  reportCrash: (report) => ipcRenderer.send(IPC_CHANNELS.REPORT_CRASH, report),
  // Se evalúan UNA vez, al construir la API: ni la plataforma ni sus capacidades
  // cambian durante la vida del proceso, y así lo que cruza el puente son dos valores
  // planos y congelados en vez de funciones que el renderer podría llamar en un bucle
  // de render.
  plataforma: plataformaActual(),
  capacidades: capacidadesDelSistema(),
  terminal,
  agentTerminal,
  agentAccounts,
  db,
  dbExplorador,
  dbDocumentos,
  dbClaves,
  ssh,
  sftp,
  files,
  git,
  workspace,
  hibernate,
  shutdown,
  update,
  appInfo,
  shellWindows,
  servicioFinder,
  zoom,
  clipboard,
  conversations,
  agentsUpdate,
  agentesNativos,
  redContenedor,
  usage,
  context,
  java,
  comprimidos,
  search
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation debe estar habilitado para exponer la API de Tessera.')
}

contextBridge.exposeInMainWorld('tessera', api)
