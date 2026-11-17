// =============================================================================
// La ventana principal: posición y tamaño recordados, barra de título propia con los botones del
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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { esMac } from '../../shared/plataforma'
import { ARGUMENTO_ALPHA, esVersionAlpha } from '../../shared/salud'
import { ARGUMENTO_IDIOMA, idiomaActual } from '../../shared/i18n'
import { cargarAjustesWorkspace } from '../workspace/almacenEstadoWorkspace'
import { escribirArchivoAtomicoSync } from '../util/escrituraAtomica'
import { registrarActualizacion } from '../actualizacion/registroActualizacion'
import { atenderSegundaInstanciaPendiente, esArranqueTrasActualizar, traerAlFrente } from './instanciaUnica'
import { MODO_CAPTURA } from './modoCaptura'
import { navegacionPermitida } from './navegacionVentana'
import {
  ALTO_MINIMO_VENTANA as MIN_WINDOW_HEIGHT,
  ANCHO_MINIMO_VENTANA as MIN_WINDOW_WIDTH,
  encajarEnPantallas,
  normalizarEstadoVentana,
  type EstadoVentana
} from './estadoVentana'

/** Fracción del área útil del monitor que ocupa la ventana NO maximizada. */
const PROPORCION_RESTAURAR = 0.8
/** Archivo de `userData` con el último estado de la ventana principal: solo lo escribe el main. */
const ARCHIVO_ESTADO = 'ventana.json'
/** Espera tras el último movimiento o cambio de tamaño antes de escribir. */
const GUARDAR_ESTADO_MS = 500
/** Alto de la barra de título en CSS a zoom 100 %: gemelo de `--titlebar-h` del renderer. */
const ALTO_BARRA_TITULO = 30
/** Gemelos de `--bg-chrome` y `--fg` del tema del renderer. */
const FONDO_CHROME = '#22242b'
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
function limitesProporcionales(pantalla: Display): Rectangle {
  const area = pantalla.workArea
  const ancho = Math.min(area.width, Math.max(MIN_WINDOW_WIDTH, Math.round(area.width * PROPORCION_RESTAURAR)))
  const alto = Math.min(area.height, Math.max(MIN_WINDOW_HEIGHT, Math.round(area.height * PROPORCION_RESTAURAR)))
  return {
    width: ancho,
    height: alto,
    x: area.x + Math.round((area.width - ancho) / 2),
    y: area.y + Math.round((area.height - alto) / 2)
  }
}

function rutaEstado(): string {
  return join(app.getPath('userData'), ARCHIVO_ESTADO)
}

/** El estado guardado que sigue cayendo en algún monitor de ahora; null si no hay o ya no encaja. */
function estadoGuardadoVigente(): EstadoVentana | null {
  try {
    const guardado = normalizarEstadoVentana(JSON.parse(readFileSync(rutaEstado(), 'utf-8')))
    if (!guardado) return null
    return encajarEnPantallas(
      guardado,
      screen.getAllDisplays().map((d) => ({ workArea: d.workArea }))
    )
  } catch {
    return null
  }
}

/** Escritura pendiente de la ventana principal viva; null si no hay ventana que vigilar. */
let guardarEstadoPendiente: (() => void) | null = null

/** Escribe ya el estado de la ventana principal si hay un cambio sin guardar. Lo llama el cierre. */
export function guardarEstadoVentanaYa(): void {
  guardarEstadoPendiente?.()
}

/**
 * Guarda la posición, el tamaño sin maximizar y si está maximizada, con espera tras cada cambio. En
 * pantalla completa o minimizada no guarda: esos bounds no son los que el usuario eligió.
 */
function instalarGuardadoDeEstado(ventana: BrowserWindow): void {
  let temporizador: NodeJS.Timeout | null = null
  const escribir = (): void => {
    if (temporizador) clearTimeout(temporizador)
    temporizador = null
    if (ventana.isDestroyed() || ventana.isFullScreen() || ventana.isMinimized()) return
    // Sin maximizar, los límites de ahora: en Linux `getNormalBounds` conserva los de antes de la última
    // maximización aunque la ventana se haya movido o redimensionado después.
    const maximizada = ventana.isMaximized()
    const estado: EstadoVentana = { ...(maximizada ? ventana.getNormalBounds() : ventana.getBounds()), maximizada }
    try {
      escribirArchivoAtomicoSync(rutaEstado(), JSON.stringify(estado))
    } catch (err) {
      console.error('[ventana] no se pudo guardar el estado de la ventana:', err)
    }
  }
  const programar = (): void => {
    if (temporizador) clearTimeout(temporizador)
    temporizador = setTimeout(escribir, GUARDAR_ESTADO_MS)
    guardarEstadoPendiente = () => {
      if (temporizador) escribir()
    }
  }
  ventana.on('move', programar)
  ventana.on('resize', programar)
  ventana.on('maximize', programar)
  ventana.on('unmaximize', programar)
  ventana.once('closed', () => {
    if (temporizador) clearTimeout(temporizador)
    guardarEstadoPendiente = null
  })
}

/**
 * Re-coloca los botones del sistema para la altura que da el zoom actual (factor 1,2^nivel):
 * el overlay entero en Windows, la posición del semáforo en macOS.
 */
export function aplicarZoomCapa(ventana: BrowserWindow, nivelZoom: number): void {
  if (ventana.isDestroyed()) return
  const factor = Math.pow(1.2, nivelZoom)
  const alto = Math.round(ALTO_BARRA_TITULO * factor)

  if (esMac()) {
    // El semáforo no escala: se centra en la banda; con el zoom mínimo la banda es más baja que él.
    ventana.setWindowButtonPosition({
      x: SEMAFORO_X,
      y: Math.max(0, Math.round((alto - SEMAFORO_ALTO) / 2))
    })
    return
  }

  // Windows (y cualquier otro con Window Controls Overlay). Fuera de Windows esta API no existe.
  if (typeof ventana.setTitleBarOverlay !== 'function') return
  ventana.setTitleBarOverlay({
    color: FONDO_CHROME,
    symbolColor: CHROME_FG,
    height: alto
  })
}

/**
 * Opciones de creación: sin marco nativo, botones del sistema y overlay en las dos plataformas.
 * La ventana de agente pasa sus propios mínimos.
 */
export function opcionesDeVentana(
  inicio: Rectangle,
  minimo: { ancho: number; alto: number } = { ancho: MIN_WINDOW_WIDTH, alto: MIN_WINDOW_HEIGHT }
): BrowserWindowConstructorOptions {
  return {
    ...inicio,
    minWidth: minimo.ancho,
    minHeight: minimo.alto,
    show: false,
    titleBarStyle: esMac() ? 'hiddenInset' : 'hidden',
    // En macOS solo `height`: el semáforo lo pinta el sistema y no admite color.
    ...(esMac()
      ? {
          trafficLightPosition: {
            x: SEMAFORO_X,
            y: Math.round((ALTO_BARRA_TITULO - SEMAFORO_ALTO) / 2)
          },
          titleBarOverlay: { height: ALTO_BARRA_TITULO }
        }
      : {
          titleBarOverlay: {
            color: FONDO_CHROME,
            symbolColor: CHROME_FG,
            height: ALTO_BARRA_TITULO
          }
        }),
    // Sin marco, el primer pintado sería blanco: con el gris del chrome no destella.
    backgroundColor: FONDO_CHROME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // El renderer no tiene `process`: la versión alpha y el idioma le llegan por el preload.
      additionalArguments: [
        `${ARGUMENTO_IDIOMA}${idiomaActual()}`,
        ...(esVersionAlpha(app.getVersion()) ? [ARGUMENTO_ALPHA] : [])
      ]
    }
  }
}

/** F11, F12/Mod+Shift+I y F5 (solo en desarrollo), con la ventana enfocada. */
export function instalarAtajos(ventana: BrowserWindow): void {
  ventana.webContents.on('before-input-event', (evento, entrada) => {
    if (entrada.type !== 'keyDown' || entrada.isAutoRepeat) return
    // El modificador principal de la plataforma y SOLO él.
    const mod = esMac() ? entrada.meta && !entrada.control : entrada.control && !entrada.meta
    if (entrada.key === 'F11') {
      evento.preventDefault()
      ventana.setFullScreen(!ventana.isFullScreen())
    } else if (entrada.key === 'F12' || (mod && entrada.shift && entrada.key.toLowerCase() === 'i')) {
      evento.preventDefault()
      ventana.webContents.toggleDevTools()
    } else if (entrada.key === 'F5' && !app.isPackaged) {
      evento.preventDefault()
      if (entrada.shift) ventana.webContents.reloadIgnoringCache()
      else ventana.webContents.reload()
    }
  })
}

/**
 * Muestra la ventana una sola vez, por `ready-to-show` o por el guardián: maximiza, deja
 * su línea en el registro, la trae al frente tras actualizar y alinea los botones.
 */
function instalarMostrar(ventana: BrowserWindow, maximizar: boolean): void {
  let mostrada = false
  const nacidaEn = Date.now()
  const mostrar = (motivo: 'ready-to-show' | 'guardián'): void => {
    if (mostrada || ventana.isDestroyed()) return
    mostrada = true
    clearTimeout(guardian)
    if (maximizar) ventana.maximize()
    ventana.show()
    registrarActualizacion(
      `ventana mostrada (${motivo}, +${Date.now() - nacidaEn} ms desde que se creó); ` +
        `tras update=${esArranqueTrasActualizar()}`
    )
    // Lanzada por el instalador no tiene derecho a primer plano en Windows: se pinta detrás.
    if (esArranqueTrasActualizar()) traerAlFrente(ventana, 'arranque tras actualizar')
    atenderSegundaInstanciaPendiente(ventana)
    // Después de `show()`: antes, el contenido web se quedaba al tamaño de creación.
    try {
      aplicarZoomCapa(ventana, cargarAjustesWorkspace().zoomLevel)
    } catch (err) {
      console.error('[chrome] no se pudo alinear el overlay con el zoom inicial:', err)
    }
  }

  const guardian = setTimeout(() => mostrar('guardián'), GUARDIA_MOSTRAR_MS)
  ventana.once('ready-to-show', () => mostrar('ready-to-show'))
  ventana.once('closed', () => clearTimeout(guardian))
}

/**
 * Re-encaja la ventana si acaba en otro monitor (otra densidad de píxeles y otro tamaño de
 * área útil); un tamaño elegido a mano, o recordado del arranque, se respeta mientras siga en
 * el monitor para el que se eligió.
 */
function instalarEncaje(ventana: BrowserWindow, monitorInicial: number): void {
  let dimensionadaParaPantallaId: number | null = monitorInicial
  const ajustarAPantallaActual = (): void => {
    if (ventana.isDestroyed() || ventana.isMaximized() || ventana.isFullScreen()) return
    const pantalla = screen.getDisplayMatching(ventana.getBounds())
    if (pantalla.id === dimensionadaParaPantallaId) return // mismo monitor: respeta el tamaño actual
    ventana.setBounds(limitesProporcionales(pantalla))
    dimensionadaParaPantallaId = pantalla.id
  }
  // En Windows, arrastrar una ventana maximizada la desmaximiza y la lleva al otro monitor.
  ventana.on('moved', ajustarAPantallaActual)
  ventana.on('unmaximize', () => setTimeout(ajustarAPantallaActual, 0))
  ventana.on('resized', () => {
    if (ventana.isDestroyed() || ventana.isMaximized() || ventana.isFullScreen()) return
    dimensionadaParaPantallaId = screen.getDisplayMatching(ventana.getBounds()).id
  })
}

/** Si el renderer muere, suelta las sesiones huérfanas y recarga la interfaz. */
export function instalarRecuperacion(ventana: BrowserWindow, deps: Pick<DepsVentana, 'cerrando' | 'soltarSesionesHuerfanas'>): void {
  ventana.webContents.on('render-process-gone', (_e, detalles) => {
    console.error(`[tessera] el renderer murió (${detalles.reason}, exit=${detalles.exitCode}).`)
    if (deps.cerrando() || ventana.isDestroyed()) return
    if (detalles.reason === 'clean-exit' || detalles.reason === 'killed') return
    // En segundo plano: no retrasa la recarga, que es lo urgente.
    deps.soltarSesionesHuerfanas()
    console.error('[tessera] recargando la interfaz para recuperarla…')
    ventana.reload()
  })
  ventana.webContents.on('unresponsive', () => {
    console.error('[tessera] el renderer dejó de responder (sigue vivo; puede recuperarse).')
  })
}

/** El renderer nunca sale de su propio origen; los enlaces http(s) van al navegador. */
export function bloquearNavegacion(ventana: BrowserWindow): void {
  ventana.webContents.on('will-navigate', (e, url) => {
    // Recargas y HMR de la propia página: permitidas (`navegacionPermitida`).
    if (navegacionPermitida(ventana.webContents.getURL(), url)) return
    e.preventDefault()
    console.error(`[tessera] navegación BLOQUEADA (secuestro evitado): ${url}`)
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

/** Crea la ventana principal en el monitor PRINCIPAL y carga el renderer. */
export function crearVentana(deps: DepsVentana): BrowserWindow {
  // El modo captura usa el tamaño fijo del shot: ni lee ni guarda el estado.
  const recordado = MODO_CAPTURA ? null : estadoGuardadoVigente()
  const pantallaInicio = recordado ? screen.getDisplayMatching(recordado) : screen.getPrimaryDisplay()
  const inicio: Rectangle = recordado
    ? { x: recordado.x, y: recordado.y, width: recordado.width, height: recordado.height }
    : limitesProporcionales(pantallaInicio)
  const ventana = new BrowserWindow(opcionesDeVentana(inicio))
  // Con monitores de distinta escala, el tamaño de creación se aplica con la escala del principal; ya
  // creada en su monitor, se reponen los límites recordados para que queden en la escala de ese monitor.
  if (recordado) {
    const actual = ventana.getBounds()
    if (actual.width !== inicio.width || actual.height !== inicio.height || actual.x !== inicio.x || actual.y !== inicio.y) {
      ventana.setBounds(inicio)
    }
  }
  instalarAtajos(ventana)
  instalarMostrar(ventana, recordado ? recordado.maximizada : !MODO_CAPTURA)
  instalarEncaje(ventana, pantallaInicio.id)
  if (!MODO_CAPTURA) instalarGuardadoDeEstado(ventana)
  instalarRecuperacion(ventana, deps)
  bloquearNavegacion(ventana)

  // En modo captura, la consola del renderer va al log del main (evidencia de los workers de Monaco).
  if (MODO_CAPTURA) {
    ventana.webContents.on('console-message', (e) => {
      console.log(`[renderer:console ${e.level}] ${e.message}`)
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    ventana.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    ventana.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // La X no cierra: pide el cierre ordenado, que destruye la ventana al terminar.
  ventana.on('close', (e) => {
    if (deps.cerrando()) return // segunda pasada (win.destroy) -> dejar cerrar
    e.preventDefault()
    deps.pedirCierre()
  })

  return ventana
}
