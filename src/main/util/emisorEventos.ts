// =============================================================================
// Emisor de eventos del main al renderer: lo que recibe un servicio en vez de la ventana.
// El servicio no importa electron ni toca `webContents`: la raíz de composición le pasa
// `emisorDeVentana(() => ventana)` y una prueba, un falso que apunta lo emitido.
// Estándar: docs/ESTANDAR_CODIGO.md («Capas del main»).
// =============================================================================
import type { BrowserWindow } from 'electron'

/** Lo que un servicio usa para avisar al renderer por un canal de `src/shared/*-ipc.ts`. */
export interface EmisorEventos {
  /** Envía `canal` (con `payload` si no es `undefined`); sin destino vivo, no hace nada. */
  emitir(canal: string, payload?: unknown): void
  /** Si en este momento hay una ventana viva que recibiría lo emitido. */
  hayDestino(): boolean
}

/**
 * Emisor sobre la ventana que devuelva `ventana()` en cada envío.
 * `comprobarContenido: false` no mira `webContents.isDestroyed()` al emitir: es la guarda
 * que tenía `DbController`, y cambiarla alteraría qué pasa con la ventana a medio cerrar.
 */
export function emisorDeVentana(
  ventana: () => BrowserWindow | null,
  opciones: { comprobarContenido?: boolean } = {}
): EmisorEventos {
  const comprobarContenido = opciones.comprobarContenido ?? true
  return {
    emitir(canal, payload) {
      const win = ventana()
      if (!win || win.isDestroyed() || (comprobarContenido && win.webContents.isDestroyed())) return
      if (payload === undefined) win.webContents.send(canal)
      else win.webContents.send(canal, payload)
    },
    hayDestino() {
      const win = ventana()
      return !!win && !win.isDestroyed() && !win.webContents.isDestroyed()
    }
  }
}
