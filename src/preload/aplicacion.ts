// =============================================================================
// Preload: la aplicación y su ventana: workspace, zoom, cierre, actualización, «Acerca de»
// e integración con el sistema (menú contextual de Windows, acción rápida del Finder y el
// `.desktop` de Linux).
// El zoom se aplica aquí, sin IPC, con `webFrame` (rango -3..5).
// =============================================================================
import { ipcRenderer, webFrame } from 'electron'
import type { SesionProyecto } from '../shared/sesionProyecto'
import {
  WORKSPACE_CHANNELS,
  type ResultadoAbrirProyecto,
  type PeticionEscanearRepos,
  type ResultadoEscanearRepos,
  type PeticionFijarProyectoActivo,
  type ResultadoFijarProyectoActivo,
  type PeticionFijarRaizArchivos,
  type ResultadoFijarRaizArchivos
} from '../shared/workspace-ipc'
import {
  WORKSPACE_STATE_CHANNELS,
  type AjustesWorkspace,
  type EstadoWorkspace
} from '../shared/workspace-state-ipc'
import { SHUTDOWN_CHANNELS, type AvanceCierre } from '../shared/shutdown-ipc'
import { UPDATE_CHANNELS, type AvisoDescartable, type EstadoActualizacion } from '../shared/update-ipc'
import { APP_INFO_CHANNELS, type AppInfo } from '../shared/app-info-ipc'
import {
  SHELL_WINDOWS_CHANNELS,
  type EstadoIntegracionShell,
  type ResultadoApertura,
  type ResultadoIntegracion,
  type PeticionTomarAperturas
} from '../shared/shell-windows-ipc'
import type { EstadoIntegracion } from '../shared/integracionShell'
import {
  SERVICIO_FINDER_CHANNELS,
  type EstadoServicioFinder,
  type PeticionAplicarServicioFinder,
  type ResultadoServicioFinder
} from '../shared/servicio-finder-ipc'
import {
  ESCRITORIO_LINUX_CHANNELS,
  type EstadoEscritorioLinux,
  type PeticionAplicarEscritorioLinux,
  type ResultadoEscritorioLinux
} from '../shared/escritorio-linux-ipc'

/**
 * Zoom GLOBAL de la UI vía el mecanismo nativo de Electron (webFrame): escala de
 * forma uniforme todo el renderer (sidebar, textos y el canvas de xterm). Vive
 * en el preload porque `webFrame` no está disponible en el renderer aislado.
 */
export interface ApiZoom {
  /** Aumenta un paso el zoom. Devuelve el factor resultante (1 = 100%). */
  acercar: () => number
  /** Reduce un paso el zoom. Devuelve el factor resultante. */
  alejar: () => number
  /** Restablece el zoom a 100%. Devuelve 1. */
  restablecer: () => number
  /** Factor de zoom actual. */
  obtener: () => number
  /** Nivel de zoom DISCRETO actual (entero acotado); lo que se persiste. */
  obtenerNivel: () => number
  /** Fija el nivel de zoom discreto (acotado al rango). Devuelve el factor resultante. Para restaurar el zoom persistido al arrancar. */
  fijarNivel: (nivel: number) => number
}

/**
 * API de workspace expuesta al renderer: solo el mecanismo para elegir una
 * carpeta de proyecto del disco (diálogo nativo). No monta ni usa la carpeta
 * elegida; eso llega con el futuro modelo de tabs de proyectos.
 */
export interface ApiWorkspace {
  /** Abre el diálogo nativo "elegir carpeta" y devuelve la carpeta elegida. */
  abrirDialogoProyecto: () => Promise<ResultadoAbrirProyecto>
  /**
   * Cambia el REPO ACTIVO de git: re-apunta SOLO la vista de git al `repoHostPath`
   * indicado (o al contenedor si aún no hay repo). NO mueve el explorador, que se
   * ancla aparte con `fijarRaizArchivos`. Devuelve el nombre neutro del repo activo.
   */
  setActiveProject: (rutaHostProyecto: string) => Promise<ResultadoFijarProyectoActivo>
  /**
   * Ancla el EXPLORADOR a la carpeta CONTENEDORA de la pestaña activa (la ruta
   * opaca de abrirDialogoProyecto o del bootstrap). Independiente del repo activo:
   * cambiar de repo NO lo llama. Devuelve el nombre neutro de la contenedora.
   */
  fijarRaizArchivos: (rutaHostProyecto: string) => Promise<ResultadoFijarRaizArchivos>
  /**
   * Escanea `projectHostPath` en busca de repos git (la raíz y los que cuelgan
   * de ella). No activa ninguno; `repos` puede ser una lista
   * vacía si la carpeta no contiene repos.
   */
  escanearRepos: (rutaHostProyecto: string) => Promise<ResultadoEscanearRepos>
  /**
   * Lee el esqueleto de workspace persistido (B2): perfiles -> proyectos abiertos
   * + activo. `null` si aún no hay archivo (primer arranque). Lo consumirá la
   * restauración perezosa al arrancar.
   */
  cargarEstado: () => Promise<EstadoWorkspace | null>
  /**
   * Persiste el esqueleto de workspace COMPLETO (escritura INCREMENTAL: en cada
   * open/close/cambio de activo, no solo al salir). Robusto a cierre sucio.
   */
  guardarEstado: (estado: EstadoWorkspace) => Promise<void>
  /** Lee el slice de ajustes globales de UI (zoom, etc.). Siempre resuelve con defaults si no hay archivo. */
  cargarAjustes: () => Promise<AjustesWorkspace>
  /** Persiste el slice de ajustes globales, preservando el esqueleto de tabs en disco. */
  guardarAjustes: (ajustes: AjustesWorkspace) => Promise<void>
  /** Lee la sesión de cada proyecto abierto (pestañas, carpetas y terminales). */
  cargarSesiones: () => Promise<Record<string, SesionProyecto>>
  /** Persiste la sesión de cada proyecto, preservando el esqueleto y los ajustes. */
  guardarSesiones: (sesiones: Record<string, SesionProyecto>) => Promise<void>
}

/** Cierre garantizado: el renderer solo ESCUCHA el progreso para pintar el overlay. */
export interface ApiCierre {
  /** Suscribe al progreso del cierre. Devuelve una función para cancelar. */
  alProgreso: (cb: (p: AvanceCierre) => void) => () => void
}

/**
 * Auto-update. El renderer NO decide: refleja el estado y ofrece las acciones.
 * La descarga es automática, así que no hay `download()`.
 */
export interface ApiActualizacion {
  /** Estado actual (para re-sincronizar al montar, incluso a media descarga). */
  estado: () => Promise<EstadoActualizacion>
  /** Fuerza una comprobación del feed ("Buscar actualizaciones" / "Reintentar"). */
  comprobar: () => Promise<EstadoActualizacion>
  /** Reinicia e instala AHORA. Solo tiene efecto si el estado es 'ready'. */
  instalar: () => Promise<void>
  /** Revela el instalador descargado, o abre el registro de actualizaciones. */
  abrirRegistro: () => Promise<void>
  /**
   * Cierra un aviso. Los dos terminales (`aplicada` / `fallo`) son PEGAJOSOS y no
   * se van solos: sólo los retira este método, que es lo que garantiza que el
   * usuario llegue a leer cómo acabó la actualización.
   */
  descartar: (que: AvisoDescartable) => Promise<void>
  /** Suscribe a los cambios de estado. Devuelve una función para cancelar. */
  alCambiarEstado: (cb: (s: EstadoActualizacion) => void) => () => void
}

/**
 * Identidad de la app (versión + motores) para el "Acerca de". Un solo `invoke`:
 * no cambia mientras el proceso vive, así que no hay push ni caché que invalidar.
 */
export interface ApiInfoApp {
  obtener: () => Promise<AppInfo>
  /** Cierra Tessera por el cierre ordenado y la vuelve a abrir (cambiar de idioma lo pide). */
  reiniciar: () => Promise<void>
}

/**
 * Lo que llega del Explorador de Windows ("Abrir con Tessera").
 *
 * `tomar` es la VERDAD y `alHaberAperturas` solo un empujón: el main encola las rutas y las
 * resuelve al recogerlas, así que perderse un aviso —porque el renderer se estaba
 * recargando, o porque aún no existía— no pierde la apertura. Sondear una vez al
 * arrancar y suscribirse para lo demás es el uso previsto.
 */
export interface ApiIntegracionShell {
  /**
   * Recoge y vacía la cola. Se le pasan los proyectos abiertos porque la CONTENEDORA
   * la elige el main: el renderer no puede hacer aritmética con rutas de Windows.
   */
  tomar: (req: PeticionTomarAperturas) => Promise<ResultadoApertura[]>
  /** Avisa de que hay algo nuevo que recoger; devuelve la función para desuscribir. */
  alHaberAperturas: (cb: () => void) => () => void
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
 * NO se cuelga de `ApiIntegracionShell` aunque haga "lo mismo" para el usuario: sus estados
 * no tienen la misma forma (allí tres casillas y una lista de extensiones; aquí un
 * sí/no) y sus modos de fallo tampoco. Ver la cabecera de `shared/servicio-finder-ipc.ts`.
 */
export interface ApiServicioFinder {
  /** Qué hay instalado ahora mismo. Mira el DISCO, no un ajuste persistido. */
  estado: () => Promise<EstadoServicioFinder>
  /**
   * Instala o borra el `.workflow` de `~/Library/Services`. Devuelve los fallos en vez
   * de lanzarlos, por el mismo motivo que su gemelo de Windows.
   */
  aplicar: (activo: boolean) => Promise<ResultadoServicioFinder>
}

/** «Abrir con Tessera» en Linux: el `tessera.desktop` propio. Ver `shared/escritorio-linux-ipc.ts`. */
export interface ApiEscritorioLinux {
  /** Qué hay instalado ahora mismo. Mira el DISCO. */
  estado: () => Promise<EstadoEscritorioLinux>
  /** Instala o borra el `.desktop`; devuelve los fallos en vez de lanzarlos. */
  aplicar: (activo: boolean) => Promise<ResultadoEscritorioLinux>
}

export const workspace: ApiWorkspace = {
  abrirDialogoProyecto: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.OPEN_PROJECT_DIALOG),
  setActiveProject: (rutaHostProyecto) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.SET_ACTIVE_PROJECT, { projectHostPath: rutaHostProyecto } satisfies PeticionFijarProyectoActivo),
  fijarRaizArchivos: (rutaHostProyecto) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.SET_FILES_ROOT, { projectHostPath: rutaHostProyecto } satisfies PeticionFijarRaizArchivos),
  escanearRepos: (rutaHostProyecto) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.SCAN_REPOS, { projectHostPath: rutaHostProyecto } satisfies PeticionEscanearRepos),
  cargarEstado: () => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.LOAD),
  guardarEstado: (estado) => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.SAVE, estado),
  cargarAjustes: () => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.LOAD_SETTINGS),
  guardarAjustes: (ajustes) => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.SAVE_SETTINGS, ajustes),
  cargarSesiones: () => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.LOAD_SESIONES),
  guardarSesiones: (sesiones) => ipcRenderer.invoke(WORKSPACE_STATE_CHANNELS.SAVE_SESIONES, sesiones)
}

/**
 * Zoom en pasos discretos con setZoomLevel (cada nivel ≈ 1.2×, la misma curva
 * que Ctrl +/− del navegador). Acotamos el rango para que la UI nunca quede
 * inservible. setZoomLevel afecta a TODO el webFrame de forma uniforme.
 */
const NIVEL_MIN_ZOOM = -3
const NIVEL_MAX_ZOOM = 5
const acotarNivel = (nivel: number): number =>
  Math.max(NIVEL_MIN_ZOOM, Math.min(NIVEL_MAX_ZOOM, nivel))
const aplicarNivel = (nivel: number): number => {
  const siguiente = acotarNivel(nivel)
  webFrame.setZoomLevel(siguiente)
  return webFrame.getZoomFactor()
}

export const zoom: ApiZoom = {
  acercar: () => aplicarNivel(webFrame.getZoomLevel() + 1),
  alejar: () => aplicarNivel(webFrame.getZoomLevel() - 1),
  restablecer: () => aplicarNivel(0),
  obtener: () => webFrame.getZoomFactor(),
  obtenerNivel: () => webFrame.getZoomLevel(),
  fijarNivel: (nivel) => aplicarNivel(nivel)
}

export const cierre: ApiCierre = {
  alProgreso: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, p: AvanceCierre): void => cb(p)
    ipcRenderer.on(SHUTDOWN_CHANNELS.PROGRESS, oyente)
    return () => ipcRenderer.removeListener(SHUTDOWN_CHANNELS.PROGRESS, oyente)
  }
}

export const actualizacion: ApiActualizacion = {
  estado: () => ipcRenderer.invoke(UPDATE_CHANNELS.GET_STATE),
  comprobar: () => ipcRenderer.invoke(UPDATE_CHANNELS.CHECK),
  instalar: () => ipcRenderer.invoke(UPDATE_CHANNELS.INSTALL),
  abrirRegistro: () => ipcRenderer.invoke(UPDATE_CHANNELS.OPEN_LOG),
  descartar: (que) => ipcRenderer.invoke(UPDATE_CHANNELS.DISMISS, que),
  alCambiarEstado: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, s: EstadoActualizacion): void => cb(s)
    ipcRenderer.on(UPDATE_CHANNELS.STATE, oyente)
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.STATE, oyente)
  }
}

export const infoApp: ApiInfoApp = {
  obtener: () => ipcRenderer.invoke(APP_INFO_CHANNELS.GET),
  reiniciar: () => ipcRenderer.invoke(APP_INFO_CHANNELS.REINICIAR)
}

export const integracionShell: ApiIntegracionShell = {
  tomar: (req) => ipcRenderer.invoke(SHELL_WINDOWS_CHANNELS.TOMAR_APERTURAS, req),
  alHaberAperturas: (cb) => {
    const oyente = (): void => cb()
    ipcRenderer.on(SHELL_WINDOWS_CHANNELS.HAY_APERTURAS, oyente)
    return () => ipcRenderer.removeListener(SHELL_WINDOWS_CHANNELS.HAY_APERTURAS, oyente)
  },
  integracionEstado: () => ipcRenderer.invoke(SHELL_WINDOWS_CHANNELS.INTEGRACION_ESTADO),
  integracionAplicar: (estado) =>
    ipcRenderer.invoke(SHELL_WINDOWS_CHANNELS.INTEGRACION_APLICAR, estado),
  abrirAppsPredeterminadas: () =>
    ipcRenderer.invoke(SHELL_WINDOWS_CHANNELS.ABRIR_APPS_PREDETERMINADAS)
}

export const servicioFinder: ApiServicioFinder = {
  estado: () => ipcRenderer.invoke(SERVICIO_FINDER_CHANNELS.ESTADO),
  aplicar: (activo) => ipcRenderer.invoke(SERVICIO_FINDER_CHANNELS.APLICAR, { activo } satisfies PeticionAplicarServicioFinder)
}

export const escritorioLinux: ApiEscritorioLinux = {
  estado: () => ipcRenderer.invoke(ESCRITORIO_LINUX_CHANNELS.ESTADO),
  aplicar: (activo) => ipcRenderer.invoke(ESCRITORIO_LINUX_CHANNELS.APLICAR, { activo } satisfies PeticionAplicarEscritorioLinux)
}
