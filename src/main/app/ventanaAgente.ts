// =============================================================================
// La ventana de agente: una BrowserWindow aparte con solo el agente nativo en la carpeta del
// usuario. Comparte con la principal las opciones, los atajos, la recuperación y el bloqueo de
// navegación (`ventana.ts`); en Windows lleva su propio AppUserModelID e icono para no agruparse
// con Tessera en la barra de tareas. Su X cierra solo ella y sus sesiones; la última ventana cierra la app.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================
import { app, BrowserWindow, screen, type Rectangle } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { esLinux, esWindows } from '../../shared/plataforma'
import { ARGUMENTO_VENTANA_AGENTE, type DatosVentanaAgente } from '../../shared/ventana-agente-ipc'
import { cargarAjustesWorkspace } from '../workspace/almacenEstadoWorkspace'
import { aplicarZoomCapa, bloquearNavegacion, instalarAtajos, instalarRecuperacion, opcionesDeVentana } from './ventana'
import { trasCerrarVentanaAgente } from './ventanasAgentePuro'
import type { ReferenciasApp } from './referencias'
import { txApp } from './textos.ts'

/** Unas 100 columnas por 40 filas con la letra por defecto, más la cabecera y el pie del pane. */
const ANCHO = 900
const ALTO = 780
const MIN_ANCHO = 480
const MIN_ALTO = 360
/** Cuánto se desplaza cada ventana nueva respecto a la anterior, para que no nazcan apiladas. */
const ESCALON = 28
/** Cuánto se espera a `ready-to-show` antes de enseñarla igual. */
const GUARDIA_MOSTRAR_MS = 15_000

/** Lo que la ventana de agente necesita del resto de la app. */
export interface DepsVentanaAgente {
  /** Cierra las sesiones de esa ventana (su X o la muerte de su renderer). */
  cerrarSesiones: (ventana: number) => Promise<unknown>
  /** No queda ninguna ventana: se cierra la app. */
  cerrarApp: () => void
  /** Cambió el número de ventanas (Jump List y Dock). */
  alCambiar: () => void
}

/** El AppUserModelID de las ventanas de agente: el de Tessera con `.agente`, aparte en la barra de tareas. */
export function idModeloAgente(): string {
  return app.isPackaged ? 'com.noe.tessera.agente' : 'com.noe.tessera.dev.agente'
}

/** El icono de la ventana de agente en esta plataforma, o null (macOS: un solo icono en el Dock). */
export function rutaIconoAgente(): string | null {
  if (!esWindows() && !esLinux()) return null
  const nombre = esWindows() ? 'tessera-agente.ico' : 'tessera-agente.png'
  const ruta = app.isPackaged ? join(process.resourcesPath, nombre) : join(app.getAppPath(), 'build', nombre)
  return existsSync(ruta) ? ruta : null
}

/** Rectángulo centrado en el monitor principal, desplazado un escalón por cada ventana ya abierta. */
function rectanguloInicial(abiertas: number): Rectangle {
  const area = screen.getPrimaryDisplay().workArea
  const ancho = Math.min(ANCHO, area.width)
  const alto = Math.min(ALTO, area.height)
  const paso = (abiertas % 8) * ESCALON
  return {
    width: ancho,
    height: alto,
    x: area.x + Math.max(0, Math.round((area.width - ancho) / 2) + paso - 3 * ESCALON),
    y: area.y + Math.max(0, Math.round((area.height - alto) / 2) + paso - 3 * ESCALON)
  }
}

/**
 * Windows: su propio grupo en la barra de tareas, con su icono y, anclada, abre otra ventana de
 * agente. El relanzamiento solo en la app instalada: en desarrollo el ejecutable es el de Electron.
 */
function fijarDetallesWindows(ventana: BrowserWindow, icono: string | null): void {
  if (!esWindows()) return
  try {
    ventana.setAppDetails({
      appId: idModeloAgente(),
      ...(icono ? { appIconPath: icono, appIconIndex: 0 } : {}),
      ...(app.isPackaged
        ? { relaunchCommand: `"${process.execPath}" ${ARGUMENTO_VENTANA_AGENTE}`, relaunchDisplayName: txApp().ventanaAgente.nueva }
        : {})
    })
  } catch (err) {
    console.error('[ventana-agente] no se pudo fijar su grupo de la barra de tareas:', err)
  }
}

/** Se enseña una vez, por `ready-to-show` o por el guardián, con los botones alineados al zoom. */
function instalarMostrar(ventana: BrowserWindow): void {
  let mostrada = false
  const mostrar = (): void => {
    if (mostrada || ventana.isDestroyed()) return
    mostrada = true
    clearTimeout(guardia)
    ventana.show()
    try {
      aplicarZoomCapa(ventana, cargarAjustesWorkspace().zoomLevel)
    } catch (err) {
      console.error('[ventana-agente] no se pudo alinear el overlay con el zoom:', err)
    }
  }
  const guardia = setTimeout(mostrar, GUARDIA_MOSTRAR_MS)
  ventana.once('ready-to-show', mostrar)
  ventana.once('closed', () => clearTimeout(guardia))
}

function cargar(ventana: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) void ventana.loadURL(`${process.env.ELECTRON_RENDERER_URL}/agente.html`)
  else void ventana.loadFile(join(__dirname, '../renderer/agente.html'))
}

/** Crea una ventana de agente con `datos` y la apunta en `refs.ventanasAgente`. */
export function crearVentanaAgente(refs: ReferenciasApp, deps: DepsVentanaAgente, datos: DatosVentanaAgente): BrowserWindow {
  const icono = rutaIconoAgente()
  const ventana = new BrowserWindow({
    ...opcionesDeVentana(rectanguloInicial(refs.ventanasAgente.size), { ancho: MIN_ANCHO, alto: MIN_ALTO }),
    title: txApp().ventanaAgente.titulo,
    ...(icono ? { icon: icono } : {})
  })
  const id = ventana.webContents.id
  refs.ventanasAgente.set(id, { ventana, datos, agenteActivo: datos.agente ?? null })
  fijarDetallesWindows(ventana, icono)
  instalarAtajos(ventana)
  instalarMostrar(ventana)
  // Si su renderer muere, sus sesiones se sueltan y la ventana se recarga como la principal.
  instalarRecuperacion(ventana, { cerrando: () => refs.cerrando, soltarSesionesHuerfanas: () => void deps.cerrarSesiones(id) })
  bloquearNavegacion(ventana)
  cargar(ventana)
  // La X cierra solo esta ventana. Durante el cierre de la app sus sesiones las mata el cierre.
  ventana.once('closed', () => {
    refs.ventanasAgente.delete(id)
    deps.alCambiar()
    if (refs.cerrando) return
    void deps.cerrarSesiones(id)
    const hayPrincipal = refs.ventana !== null && !refs.ventana.isDestroyed()
    if (trasCerrarVentanaAgente({ quedanAgente: refs.ventanasAgente.size, hayPrincipal }) === 'cerrar-app') deps.cerrarApp()
  })
  deps.alCambiar()
  return ventana
}
