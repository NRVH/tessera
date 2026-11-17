// =============================================================================
// Los eventos de `app` de toda la vida del proceso: Salir y Cmd+Q van al cierre ordenado,
// `window-all-closed` no sale mientras se cierra, los procesos hijo de Chromium caídos se
// registran, y en macOS `activate` recrea la ventana y `open-file` la trae al frente.
// Decisiones: docs/decisiones/app/cierre-ordenado.md
// Decisiones: docs/decisiones/app/arranque-relevo-e-instancia-unica.md
// =============================================================================
import { app, BrowserWindow, powerMonitor } from 'electron'
import { esMac } from '../../shared/plataforma'
import { traerAlFrente } from './instanciaUnica'
import type { ReferenciasApp } from './referencias'

/**
 * `before-quit`, `window-all-closed` y `child-process-gone`, en ese orden. En modo relevo
 * no hay nada que apagar.
 */
export function registrarEventosDeApp(refs: ReferenciasApp, esRelevo: boolean, pedirCierre: () => void): void {
  app.on('before-quit', (evento) => {
    if (esRelevo) return
    if (refs.cerrando) return
    evento.preventDefault()
    pedirCierre()
  })

  app.on('window-all-closed', () => {
    // `destroy()` la emite síncrona: salir aquí mataba el proceso antes del instalador.
    if (refs.cerrando) return
    if (!esMac()) {
      app.quit()
    }
  })

  // Chromium suele recrearlos solo: se registra para diagnóstico y no se sale.
  app.on('child-process-gone', (_e, detalles) => {
    console.error(`[tessera] proceso hijo de Chromium caído: ${detalles.type} (${detalles.reason}).`)
  })

  if (!esRelevo) registrarApagadoDelEquipo(refs)
}

/**
 * Un apagado o un cierre de sesión del sistema no pasa por `before-quit` en Windows: se avisa por `session-end` de cada
 * ventana y, en macOS y Linux, por `shutdown`. Las tareas delegadas tienen que saberlo antes de que sus procesos mueran.
 */
function registrarApagadoDelEquipo(refs: ReferenciasApp): void {
  const alApagar = (): void => refs.agentes?.alCerrarApp()
  app.on('browser-window-created', (_e, ventana) => ventana.on('session-end', alApagar))
  void app.whenReady().then(() => powerMonitor.on('shutdown', alApagar))
}

/**
 * macOS: pulsar el Dock sin ninguna ventana vuelve a crear la principal. Con ventanas de agente
 * abiertas no: la principal se pide desde el menú del Dock («Abrir Tessera»).
 */
export function registrarActivacion(refs: ReferenciasApp, crear: () => BrowserWindow): void {
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      refs.ventana = crear()
    }
  })
}

/**
 * macOS: abrir un archivo o una carpeta con Tessera desde el Finder (`open-file`) trae la
 * ventana al frente, o la crea si la app se quedó sin ventanas. La ruta la encola el oyente
 * de `proceso.ts`, que se registra al cargar y corre antes que este; este se registra al
 * final del arranque, para no crear una segunda ventana cuando el evento llega en frío.
 * En Windows el evento no existe: allí la segunda instancia ya trae la ventana al frente.
 */
export function registrarAperturaMac(refs: ReferenciasApp, crear: () => BrowserWindow): void {
  if (!esMac()) return
  app.on('open-file', () => {
    if (refs.cerrando) return
    // Sin principal (cerrada con ventanas de agente abiertas, o nunca creada) se crea: lo que se abre son proyectos.
    if (!refs.ventana || refs.ventana.isDestroyed()) {
      refs.ventana = crear()
      return
    }
    const ventana = refs.ventana
    // Una ventana que aún no se ha mostrado la enseña `ready-to-show`: traerla ya la pintaría en blanco.
    if (ventana && !ventana.isDestroyed() && (ventana.isVisible() || ventana.isMinimized())) {
      traerAlFrente(ventana, 'abrir desde el Finder')
    }
  })
}
