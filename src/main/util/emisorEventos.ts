// =============================================================================
// Emisor de eventos del main al renderer: lo que recibe un servicio en vez de la ventana.
// El servicio no importa electron ni toca `webContents`: la raíz de composición le pasa
// `emisorDeVentana(() => ventana)` y una prueba, un falso que apunta lo emitido. Con ventanas de
// agente, la salida de cada sesión va solo a la ventana que la abrió (`emisorPorSesion`).
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

/** Lo que un emisor necesita de un `webContents`: enviar y saber si ya no existe. */
export interface DestinoEventos {
  send(canal: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

/** El `sessionId` de un payload, si lo trae. */
function sesionDe(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const id = (payload as { sessionId?: unknown }).sessionId
  return typeof id === 'string' ? id : null
}

/**
 * Emisor que enruta por la sesión del payload: si `dueno(sessionId)` dice de quién es, solo a esa
 * ventana; si no tiene dueño, a `defecto`. Una sesión cuya ventana ya no existe no se reenvía a otra:
 * su salida es de una ventana de agente y la principal no la pinta.
 */
export function emisorPorSesion(
  defecto: EmisorEventos,
  dueno: (sessionId: string) => DestinoEventos | null | 'sin-dueno'
): EmisorEventos {
  return {
    emitir(canal, payload) {
      const id = sesionDe(payload)
      const destino = id === null ? 'sin-dueno' : dueno(id)
      if (destino === 'sin-dueno') {
        defecto.emitir(canal, payload)
        return
      }
      if (!destino || destino.isDestroyed()) return
      if (payload === undefined) destino.send(canal)
      else destino.send(canal, payload)
    },
    hayDestino: () => defecto.hayDestino()
  }
}

/** Emisor que difunde a todas las ventanas vivas (lo que cambia para cualquiera que lo pinte). */
export function emisorATodas(ventanas: () => readonly BrowserWindow[]): EmisorEventos {
  const vivas = (): BrowserWindow[] => ventanas().filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed())
  return {
    emitir(canal, payload) {
      for (const w of vivas()) {
        if (payload === undefined) w.webContents.send(canal)
        else w.webContents.send(canal, payload)
      }
    },
    hayDestino: () => vivas().length > 0
  }
}
