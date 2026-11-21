// =============================================================================
// Notificaciones (toasts): `notify()` se invoca desde cualquier sitio (también desde `.catch`
// fuera de React) y `useToasts()` las consume con useSyncExternalStore. Es un store de módulo
// con pub/sub, auto-descarte por tipo y tope de apilamiento. `<Toaster/>` las pinta.
// Un aviso admite una sola acción de texto («Mostrar en el gestor de archivos» tras exportar)
// y con acción vive más (`AUTO_MS_CON_ACCION`) para dar tiempo a leer y llegar al botón.
// Solo depende de React.
// =============================================================================

import { useSyncExternalStore } from 'react'
import { documentoEnfocado } from '../util/ventanaDe'

export type TipoToast = 'error' | 'warn' | 'success' | 'info'

/** Acción de un aviso: un botón de texto dentro de él. */
export interface AccionToast {
  etiqueta: string
  onClic: () => void
}

export interface Toast {
  id: number
  tipo: TipoToast
  titulo: string
  /** Detalle técnico opcional (p. ej. el mensaje de error crudo). */
  detalle?: string
  accion?: AccionToast
  /** Documento de la ventana enfocada al emitir el aviso, para mostrarlo en esa ventana. */
  documento?: Document
}

/** Cuánto vive cada tipo antes de auto-descartarse (ms). Los errores, más tiempo. */
const AUTO_MS: Record<TipoToast, number> = {
  error: 9000,
  warn: 7000,
  info: 5000,
  success: 3000
}

/** Mínimo de vida de un aviso con acción: leerlo y llegar al botón (ver la cabecera). */
const AUTO_MS_CON_ACCION = 10000

/** Tope de toasts simultáneos: una ráfaga descarta los más viejos, no inunda. */
const MAX_TOASTS = 4

let seq = 0
let toasts: Toast[] = []
const oyentes = new Set<() => void>()
const temporizadores = new Map<number, ReturnType<typeof setTimeout>>()

function emitir(): void {
  for (const l of oyentes) l()
}

function limpiarTemporizador(id: number): void {
  const t = temporizadores.get(id)
  if (t !== undefined) {
    clearTimeout(t)
    temporizadores.delete(id)
  }
}

/**
 * Publica un toast. Devuelve su id (para descartarlo manualmente si se quiere).
 * `opciones.accion` añade un botón de texto (ver la cabecera); `opciones.vidaMs` fija cuánto vive
 * (un aviso con plazo vive lo que dura el plazo).
 */
export function notify(
  tipo: TipoToast,
  titulo: string,
  detalle?: string,
  opciones?: { accion?: AccionToast; vidaMs?: number }
): number {
  const id = ++seq
  const accion = opciones?.accion
  const documento = typeof document !== 'undefined' ? documentoEnfocado() : undefined
  const toast: Toast = accion ? { id, tipo, titulo, detalle, accion, documento } : { id, tipo, titulo, detalle, documento }
  let siguiente = [...toasts, toast]
  // Poda por tope: descarta los más antiguos (y cancela sus timers) si hay exceso.
  if (siguiente.length > MAX_TOASTS) {
    for (const d of siguiente.slice(0, siguiente.length - MAX_TOASTS)) limpiarTemporizador(d.id)
    siguiente = siguiente.slice(-MAX_TOASTS)
  }
  toasts = siguiente
  const vida = opciones?.vidaMs ?? (accion ? Math.max(AUTO_MS[tipo], AUTO_MS_CON_ACCION) : AUTO_MS[tipo])
  temporizadores.set(id, setTimeout(() => descartar(id), vida))
  emitir()
  return id
}

/** Atajo para errores: normaliza el `unknown` de un catch a título + detalle. */
export function notifyError(titulo: string, err?: unknown): number {
  const detalle =
    err instanceof Error ? err.message : err != null && err !== '' ? String(err) : undefined
  return notify('error', titulo, detalle)
}

/** Descarta un toast por id (idempotente). */
export function descartar(id: number): void {
  limpiarTemporizador(id)
  const siguiente = toasts.filter((t) => t.id !== id)
  if (siguiente.length !== toasts.length) {
    toasts = siguiente
    emitir()
  }
}

/** Descarta todos (usado por el indicador persistente de la BarraEstadoPuro). */
export function descartarTodos(): void {
  for (const t of toasts) limpiarTemporizador(t.id)
  if (toasts.length > 0) {
    toasts = []
    emitir()
  }
}

function suscribir(cb: () => void): () => void {
  oyentes.add(cb)
  return () => {
    oyentes.delete(cb)
  }
}

function leerFoto(): Toast[] {
  return toasts
}

/** Hook de suscripción: re-renderiza al cambiar la lista de toasts. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(suscribir, leerFoto)
}
