// =============================================================================
// La ventana principal: tamaño por monitor, barra de título propia con los botones del
// sistema alineados al zoom, atajos de ventana, guardián de `ready-to-show`, recuperación
// del renderer y bloqueo de navegación. La crea `index.ts`; la X la delega en el cierre.
// Decisiones: docs/decisiones/app/ventana-barra-de-titulo.md, docs/decisiones/app/ventana-arranque-y-recuperacion.md, docs/decisiones/app/atajos-y-menu.md
// =============================================================================
import {
  app,
  BrowserWindow,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type Display,
  type Rectangle
} from 'electron'
import { join } from 'node:path'
import { esMac } from '../../shared/plataforma'
import { loadWorkspaceSettings } from '../workspace/workspaceStateStore'
import { logUpdate } from '../update/logUpdate'
import { atenderSegundaInstanciaPendiente, esArranqueTrasActualizar, traerAlFrente } from './instanciaUnica'
import { MODO_CAPTURA } from './modoCaptura'

/** Fracción del área útil del monitor que ocupa la ventana NO maximizada. */
const RESTORE_RATIO = 0.8
/** Suelo absoluto: por debajo el layout (explorador, editor y agente) va apretado. */
const MIN_WINDOW_WIDTH = 900
const MIN_WINDOW_HEIGHT = 620
/** Alto de la barra de título en CSS a zoom 100 %: gemelo de `--titlebar-h` del renderer. */
const TITLEBAR_HEIGHT = 30
/** Gemelos de `--bg-chrome` y `--fg` del tema del renderer. */
const CHROME_BG = '#22242b'
const CHROME_FG = '#cbced9'
/** Alto del semáforo de macOS (valor del sistema) y su margen izquierdo en nuestra barra. */
const SEMAFORO_ALTO = 14
const SEMAFORO_X = 13
/** Cuánto se espera a `ready-to-show` antes de mostrar la ventana igual. */
const GUARDIA_MOSTRAR_MS = 15_000

/** Lo que la ventana necesita del resto de la app. */
export interface DepsVentana {
  /** ¿Cierre en curso? La segunda pasada (`destroy`) debe dejar cerrar. */
  cerrando: () => boolean
  /** La X y Alt+F4 piden el cierre ordenado. */
  pedirCierre: () => void
  /** Suelta, sin parar contenedores, las sesiones que murieron con el renderer. */
  soltarSesionesHuerfanas: () => void
}

/** Rectángulo proporcional y CENTRADO en el área útil de `display`. */
function proportionalBounds(display: Display): Rectangle {
  const area = display.workArea
  const width = Math.min(area.width, Math.max(MIN_WINDOW_WIDTH, Math.round(area.width * RESTORE_RATIO)))
  const height = Math.min(area.height, Math.max(MIN_WINDOW_HEIGHT, Math.round(area.height * RESTORE_RATIO)))
  return {
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2)
  }
}

/**
 * Re-coloca los botones del sistema para la altura que da el zoom actual (factor 1,2^nivel):
 * el overlay entero en Windows, la posición del semáforo en macOS.
 */
export function applyOverlayZoom(window: BrowserWindow, zoomLevel: number): void {
  if (window.isDestroyed()) return
  const factor = Math.pow(1.2, zoomLevel)
  const alto = Math.round(TITLEBAR_HEIGHT * factor)

  if (esMac()) {
    // El semáforo no escala: se centra en la banda; con el zoom mínimo la banda es más baja que él.
    window.setWindowButtonPosition({
      x: SEMAFORO_X,
      y: Math.max(0, Math.round((alto - SEMAFORO_ALTO) / 2))
    })
    return
  }

  // Windows (y cualquier otro con Window Controls Overlay). Fuera de Windows esta API no existe.
  if (typeof window.setTitleBarOverlay !== 'function') return
  window.setTitleBarOverlay({
    color: CHROME_BG,
    symbolColor: CHROME_FG,
    height: alto
  })
}

/** Opciones de creación: sin marco nativo, botones del sistema y overlay en las dos plataformas. */
function opcionesDeVentana(inicio: Rectangle): BrowserWindowConstructorOptions {
  return {
    ...inicio,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    titleBarStyle: esMac() ? 'hiddenInset' : 'hidden',
    // En macOS solo `height`: el semáforo lo pinta el sistema y no admite color.
    ...(esMac()
      ? {
          trafficLightPosition: {
            x: SEMAFORO_X,
            y: Math.round((TITLEBAR_HEIGHT - SEMAFORO_ALTO) / 2)
          },
          titleBarOverlay: { height: TITLEBAR_HEIGHT }
        }
      : {
          titleBarOverlay: {
            color: CHROME_BG,
            symbolColor: CHROME_FG,
            height: TITLEBAR_HEIGHT
          }
        }),
    // Sin marco, el primer pintado sería blanco: con el gris del chrome no destella.
    backgroundColor: CHROME_BG,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}

/** F11, F12/Mod+Shift+I y F5 (solo en desarrollo), con la ventana enfocada. */
function instalarAtajos(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    // El modificador principal de la plataforma y SOLO él.
    const mod = esMac() ? input.meta && !input.control : input.control && !input.meta
    if (input.key === 'F11') {
      event.preventDefault()
      window.setFullScreen(!window.isFullScreen())
    } else if (input.key === 'F12' || (mod && input.shift && input.key.toLowerCase() === 'i')) {
      event.preventDefault()
      window.webContents.toggleDevTools()
    } else if (input.key === 'F5' && !app.isPackaged) {
      event.preventDefault()
      if (input.shift) window.webContents.reloadIgnoringCache()
      else window.webContents.reload()
    }
  })
}

/**
 * Muestra la ventana una sola vez, por `ready-to-show` o por el guardián: maximiza, deja
 * su línea en el registro, la trae al frente tras actualizar y alinea los botones.
 */
function instalarMostrar(window: BrowserWindow): void {
  let mostrada = false
  const nacidaEn = Date.now()
  const mostrar = (motivo: 'ready-to-show' | 'guardián'): void => {
    if (mostrada || window.isDestroyed()) return
    mostrada = true
    clearTimeout(guardian)
    if (!MODO_CAPTURA) window.maximize() // el modo captura usa el tamaño fijo del shot
    window.show()
    logUpdate(
      `ventana mostrada (${motivo}, +${Date.now() - nacidaEn} ms desde que se creó); ` +
        `tras update=${esArranqueTrasActualizar()}`
    )
    // Lanzada por el instalador no tiene derecho a primer plano en Windows: se pinta detrás.
    if (esArranqueTrasActualizar()) traerAlFrente(window, 'arranque tras actualizar')
    atenderSegundaInstanciaPendiente(window)
    // Después de `show()`: antes, el contenido web se quedaba al tamaño de creación.
    try {
      applyOverlayZoom(window, loadWorkspaceSettings().zoomLevel)
    } catch (err) {
      console.error('[chrome] no se pudo alinear el overlay con el zoom inicial:', err)
    }
  }

  const guardian = setTimeout(() => mostrar('guardián'), GUARDIA_MOSTRAR_MS)
  window.once('ready-to-show', () => mostrar('ready-to-show'))
  window.once('closed', () => clearTimeout(guardian))
}

/**
 * Re-encaja la ventana si acaba en otro monitor; un tamaño elegido a mano se respeta
 * mientras siga en el monitor para el que se eligió.
 */
function instalarEncaje(window: BrowserWindow, monitorInicial: number): void {
  let sizedForDisplayId: number | null = monitorInicial
  const fitToCurrentDisplay = (): void => {
    if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return
    const display = screen.getDisplayMatching(window.getBounds())
    if (display.id === sizedForDisplayId) return // mismo monitor: respeta el tamaño actual
    window.setBounds(proportionalBounds(display))
    sizedForDisplayId = display.id
  }
  // En Windows, arrastrar una ventana maximizada la desmaximiza y la lleva al otro monitor.
  window.on('moved', fitToCurrentDisplay)
  window.on('unmaximize', () => setTimeout(fitToCurrentDisplay, 0))
  window.on('resized', () => {
    if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return
    sizedForDisplayId = screen.getDisplayMatching(window.getBounds()).id
  })
}

/** Si el renderer muere, suelta las sesiones huérfanas y recarga la interfaz. */
function instalarRecuperacion(window: BrowserWindow, deps: DepsVentana): void {
  window.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[tessera] el renderer murió (${details.reason}, exit=${details.exitCode}).`)
    if (deps.cerrando() || window.isDestroyed()) return
    if (details.reason === 'clean-exit' || details.reason === 'killed') return
    // En segundo plano: no retrasa la recarga, que es lo urgente.
    deps.soltarSesionesHuerfanas()
    console.error('[tessera] recargando la interfaz para recuperarla…')
    window.reload()
  })
  window.webContents.on('unresponsive', () => {
    console.error('[tessera] el renderer dejó de responder (sigue vivo; puede recuperarse).')
  })
}

/** El renderer nunca sale de su propio origen; los enlaces http(s) van al navegador. */
function bloquearNavegacion(window: BrowserWindow): void {
  const appOrigin = (): string => {
    try {
      return new URL(window.webContents.getURL()).origin
    } catch {
      return ''
    }
  }
  window.webContents.on('will-navigate', (e, url) => {
    let sameOrigin = false
    try {
      sameOrigin = new URL(url).origin === appOrigin()
    } catch {
      sameOrigin = false
    }
    if (sameOrigin) return // recargas/HMR del propio origen: permitidas
    e.preventDefault()
    console.error(`[tessera] navegación BLOQUEADA (secuestro evitado): ${url}`)
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

/** Crea la ventana principal en el monitor PRINCIPAL y carga el renderer. */
export function crearVentana(deps: DepsVentana): BrowserWindow {
  const startDisplay = screen.getPrimaryDisplay()
  const window = new BrowserWindow(opcionesDeVentana(proportionalBounds(startDisplay)))
  instalarAtajos(window)
  instalarMostrar(window)
  instalarEncaje(window, startDisplay.id)
  instalarRecuperacion(window, deps)
  bloquearNavegacion(window)

  // En modo captura, la consola del renderer va al log del main (evidencia de los workers de Monaco).
  if (MODO_CAPTURA) {
    window.webContents.on('console-message', (e) => {
      console.log(`[renderer:console ${e.level}] ${e.message}`)
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // La X no cierra: pide el cierre ordenado, que destruye la ventana al terminar.
  window.on('close', (e) => {
    if (deps.cerrando()) return // segunda pasada (win.destroy) -> dejar cerrar
    e.preventDefault()
    deps.pedirCierre()
  })

  return window
}
