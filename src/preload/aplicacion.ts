// =============================================================================
// Preload: la aplicación y su ventana: workspace, zoom, cierre, actualización, «Acerca de»
// e integración con el sistema (menú contextual de Windows y acción rápida del Finder).
// El zoom se aplica aquí, sin IPC, con `webFrame` (rango -3..5).
// =============================================================================
import { ipcRenderer, webFrame } from 'electron'
import {
  WORKSPACE_CHANNELS,
  type OpenProjectResult,
  type ScanReposResult,
  type SetActiveProjectResult,
  type SetFilesRootResult
} from '../shared/workspace-ipc'
import {
  WORKSPACE_STATE_CHANNELS,
  type WorkspaceSettings,
  type WorkspaceState
} from '../shared/workspace-state-ipc'
import { SHUTDOWN_CHANNELS, type ShutdownProgress } from '../shared/shutdown-ipc'
import { UPDATE_CHANNELS, type AvisoDescartable, type UpdateState } from '../shared/update-ipc'
import { APP_INFO_CHANNELS, type AppInfo } from '../shared/app-info-ipc'
import {
  SHELL_WINDOWS_CHANNELS,
  type EstadoIntegracionShell,
  type ResultadoApertura,
  type ResultadoIntegracion,
  type TomarAperturasRequest
} from '../shared/shell-windows-ipc'
import type { EstadoIntegracion } from '../shared/integracionShell'
import {
  SERVICIO_FINDER_CHANNELS,
  type EstadoServicioFinder,
  type ResultadoServicioFinder
} from '../shared/servicio-finder-ipc'

/**
 * Zoom GLOBAL de la UI vía el mecanismo nativo de Electron (webFrame): escala de
 * forma uniforme todo el renderer (sidebar, textos y el canvas de xterm). Vive
 * en el preload porque `webFrame` no está disponible en el renderer aislado.
 */
export interface ZoomApi {
  /** Aumenta un paso el zoom. Devuelve el factor resultante (1 = 100%). */
  in: () => number
  /** Reduce un paso el zoom. Devuelve el factor resultante. */
  out: () => number
  /** Restablece el zoom a 100%. Devuelve 1. */
  reset: () => number
  /** Factor de zoom actual. */
  get: () => number
  /** Nivel de zoom DISCRETO actual (entero acotado); lo que se persiste. */
  getLevel: () => number
  /** Fija el nivel de zoom discreto (acotado al rango). Devuelve el factor resultante. Para restaurar el zoom persistido al arrancar. */
  setLevel: (level: number) => number
}

/**
 * API de workspace expuesta al renderer: solo el mecanismo para elegir una
 * carpeta de proyecto del disco (diálogo nativo). No monta ni usa la carpeta
 * elegida; eso llega con el futuro modelo de tabs de proyectos.
 */
export interface WorkspaceApi {
  /** Abre el diálogo nativo "elegir carpeta" y devuelve la carpeta elegida. */
  openProjectDialog: () => Promise<OpenProjectResult>
  /**
   * Cambia el REPO ACTIVO de git: re-apunta SOLO la vista de git al `repoHostPath`
   * indicado (o al contenedor si aún no hay repo). NO mueve el explorador, que se
   * ancla aparte con `setFilesRoot`. Devuelve el nombre neutro del repo activo.
   */
  setActiveProject: (projectHostPath: string) => Promise<SetActiveProjectResult>
  /**
   * Ancla el EXPLORADOR a la carpeta CONTENEDORA de la pestaña activa (la ruta
   * opaca de openProjectDialog o del bootstrap). Independiente del repo activo:
   * cambiar de repo NO lo llama. Devuelve el nombre neutro de la contenedora.
   */
  setFilesRoot: (projectHostPath: string) => Promise<SetFilesRootResult>
  /**
   * Escanea `projectHostPath` en busca de repos git (la raíz y los que cuelgan
   * de ella). No activa ninguno; `repos` puede ser una lista
   * vacía si la carpeta no contiene repos.
   */
  scanRepos: (projectHostPath: string) => Promise<ScanReposResult>
  /**
   * Lee el esqueleto de workspace persistido (B2): perfiles -> proyectos abiertos
   * + activo. `null` si aún no hay archivo (primer arranque). Lo consumirá la
   * restauración perezosa al arrancar.
   */
  loadState: () => Promise<WorkspaceState | null>
  /**
   * Persiste el esqueleto de workspace COMPLETO (escritura INCREMENTAL: en cada
   * open/close/cambio de activo, no solo al salir). Robusto a cierre sucio.
   */
  saveState: (state: WorkspaceState) => Promise<void>
  /** Lee el slice de ajustes globales de UI (zoom, etc.). Siempre resuelve con defaults si no hay archivo. */
  loadSettings: () => Promise<WorkspaceSettings>
  /** Persiste el slice de ajustes globales, preservando el esqueleto de tabs en disco. */
  saveSettings: (settings: WorkspaceSettings) => Promise<void>
}

/** Cierre garantizado: el renderer solo ESCUCHA el progreso para pintar el overlay. */
export interface ShutdownApi {
  /** Suscribe al progreso del cierre. Devuelve una función para cancelar. */
  onProgress: (cb: (p: ShutdownProgress) => void) => () => void
}

/**
 * Auto-update. El renderer NO decide: refleja el estado y ofrece las acciones.
 * La descarga es automática, así que no hay `download()`.
 */
export interface UpdateApi {
  /** Estado actual (para re-sincronizar al montar, incluso a media descarga). */
  getState: () => Promise<UpdateState>
  /** Fuerza una comprobación del feed ("Buscar actualizaciones" / "Reintentar"). */
  check: () => Promise<UpdateState>
  /** Reinicia e instala AHORA. Solo tiene efecto si el estado es 'ready'. */
  install: () => Promise<void>
  /** Revela el instalador descargado, o abre el registro de actualizaciones. */
  openLog: () => Promise<void>
  /**
   * Cierra un aviso. Los dos terminales (`aplicada` / `fallo`) son PEGAJOSOS y no
   * se van solos: sólo los retira este método, que es lo que garantiza que el
   * usuario llegue a leer cómo acabó la actualización.
   */
  dismiss: (que: AvisoDescartable) => Promise<void>
  /** Suscribe a los cambios de estado. Devuelve una función para cancelar. */
  onState: (cb: (s: UpdateState) => void) => () => void
}

/**
 * Identidad de la app (versión + motores) para el "Acerca de". Un solo `invoke`:
 * no cambia mientras el proceso vive, así que no hay push ni caché que invalidar.
 */
export interface AppInfoApi {
  get: () => Promise<AppInfo>
}

/**
 * Lo que llega del Explorador de Windows ("Abrir con Tessera").
 *
 * `tomar` es la VERDAD y `onHay` solo un empujón: el main encola las rutas y las
 * resuelve al recogerlas, así que perderse un aviso —porque el renderer se estaba
 * recargando, o porque aún no existía— no pierde la apertura. Sondear una vez al
 * arrancar y suscribirse para lo demás es el uso previsto.
 */
export interface ShellWindowsApi {
  /**
   * Recoge y vacía la cola. Se le pasan los proyectos abiertos porque la CONTENEDORA
   * la elige el main: el renderer no puede hacer aritmética con rutas de Windows.
   */
  tomar: (req: TomarAperturasRequest) => Promise<ResultadoApertura[]>
  /** Avisa de que hay algo nuevo que recoger; devuelve la función para desuscribir. */
  onHay: (cb: () => void) => () => void
  /** Qué hay registrado ahora mismo en el menú contextual de Windows. */
  integracionEstado: () => Promise<EstadoIntegracionShell>
  /**
   * Escribe (o retira) las claves del registro. Devuelve los fallos en vez de
   * lanzarlos: un interruptor que dice que sí y no hizo nada es peor que no tenerlo.
   */
  integracionAplicar: (estado: EstadoIntegracion) => Promise<ResultadoIntegracion>
  /**
   * Abre el panel de Windows de aplicaciones predeterminadas. Es el único sitio desde
   * el que se puede elegir la app por defecto de una extensión: Windows firma esa
   * elección y ninguna aplicación puede hacerla por el usuario.
   */
  abrirAppsPredeterminadas: () => Promise<void>
}

/**
 * La acción rápida del Finder: el gemelo macOS de `integracionEstado`/`integracionAplicar`.
 *
 * NO se cuelga de `ShellWindowsApi` aunque haga "lo mismo" para el usuario: sus estados
 * no tienen la misma forma (allí tres casillas y una lista de extensiones; aquí un
 * sí/no) y sus modos de fallo tampoco. Ver la cabecera de `shared/servicio-finder-ipc.ts`.
 */
export interface ServicioFinderApi {
  /** Qué hay instalado ahora mismo. Mira el DISCO, no un ajuste persistido. */
  estado: () => Promise<EstadoServicioFinder>
  /**
   * Instala o borra el `.workflow` de `~/Library/Services`. Devuelve los fallos en vez
   * de lanzarlos, por el mismo motivo que su gemelo de Windows.
   */
  aplicar: (activo: boolean) => Promise<ResultadoServicioFinder>
}

export const workspace: WorkspaceApi = {
  openProjectDialog: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.OPEN_PROJECT_DIALOG),
  setActiveProject: (projectHostPath) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.SET_ACTIVE_PROJECT, { projectHostPath }),
  setFilesRoot: (projectHostPath) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.SET_FILES_ROOT, { projectHostPath }),
  scanRepos: (projectHostPath) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.SCAN_REPOS, { projectHostPath }),
  loadState: () => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.LOAD),
  saveState: (state) => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.SAVE, state),
  loadSettings: () => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.LOAD_SETTINGS),
  saveSettings: (settings) => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.SAVE_SETTINGS, settings)
}

/**
 * Zoom en pasos discretos con setZoomLevel (cada nivel ≈ 1.2×, la misma curva
 * que Ctrl +/− del navegador). Acotamos el rango para que la UI nunca quede
 * inservible. setZoomLevel afecta a TODO el webFrame de forma uniforme.
 */
const ZOOM_MIN_LEVEL = -3
const ZOOM_MAX_LEVEL = 5
const clampLevel = (level: number): number =>
  Math.max(ZOOM_MIN_LEVEL, Math.min(ZOOM_MAX_LEVEL, level))
const applyLevel = (level: number): number => {
  const next = clampLevel(level)
  webFrame.setZoomLevel(next)
  return webFrame.getZoomFactor()
}

export const zoom: ZoomApi = {
  in: () => applyLevel(webFrame.getZoomLevel() + 1),
  out: () => applyLevel(webFrame.getZoomLevel() - 1),
  reset: () => applyLevel(0),
  get: () => webFrame.getZoomFactor(),
  getLevel: () => webFrame.getZoomLevel(),
  setLevel: (level) => applyLevel(level)
}

export const shutdown: ShutdownApi = {
  onProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ShutdownProgress): void => cb(p)
    ipcRenderer.on(SHUTDOWN_CHANNELS.PROGRESS, listener)
    return () => ipcRenderer.removeListener(SHUTDOWN_CHANNELS.PROGRESS, listener)
  }
}

export const update: UpdateApi = {
  getState: () => ipcRenderer.invoke(UPDATE_CHANNELS.GET_STATE),
  check: () => ipcRenderer.invoke(UPDATE_CHANNELS.CHECK),
  install: () => ipcRenderer.invoke(UPDATE_CHANNELS.INSTALL),
  openLog: () => ipcRenderer.invoke(UPDATE_CHANNELS.OPEN_LOG),
  dismiss: (que) => ipcRenderer.invoke(UPDATE_CHANNELS.DISMISS, que),
  onState: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: UpdateState): void => cb(s)
    ipcRenderer.on(UPDATE_CHANNELS.STATE, listener)
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.STATE, listener)
  }
}

export const appInfo: AppInfoApi = {
  get: () => ipcRenderer.invoke(APP_INFO_CHANNELS.GET)
}

export const shellWindows: ShellWindowsApi = {
  tomar: (req) => ipcRenderer.invoke(SHELL_WINDOWS_CHANNELS.TOMAR_APERTURAS, req),
  onHay: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(SHELL_WINDOWS_CHANNELS.HAY_APERTURAS, listener)
    return () => ipcRenderer.removeListener(SHELL_WINDOWS_CHANNELS.HAY_APERTURAS, listener)
  },
  integracionEstado: () => ipcRenderer.invoke(SHELL_WINDOWS_CHANNELS.INTEGRACION_ESTADO),
  integracionAplicar: (estado) =>
    ipcRenderer.invoke(SHELL_WINDOWS_CHANNELS.INTEGRACION_APLICAR, estado),
  abrirAppsPredeterminadas: () =>
    ipcRenderer.invoke(SHELL_WINDOWS_CHANNELS.ABRIR_APPS_PREDETERMINADAS)
}

export const servicioFinder: ServicioFinderApi = {
  estado: () => ipcRenderer.invoke(SERVICIO_FINDER_CHANNELS.ESTADO),
  aplicar: (activo) => ipcRenderer.invoke(SERVICIO_FINDER_CHANNELS.APLICAR, { activo })
}
