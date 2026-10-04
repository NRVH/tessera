// =============================================================================
// Notificaciones (toasts): `notify()` se invoca desde cualquier sitio (también desde `.catch`
// fuera de React) y `useToasts()` las consume con useSyncExternalStore. Es un store de módulo
// con pub/sub, auto-descarte por tipo y tope de apilamiento. `<Toaster/>` las pinta.
// Un aviso admite una sola acción de texto («Mostrar en el gestor de archivos» tras exportar)
// y con acción vive más (`AUTO_MS_CON_ACCION`) para dar tiempo a leer y llegar al botón.
// Solo depende de React.
// =============================================================================

import { useSyncExternalStore } from 'react'

export type ToastKind = 'error' | 'warn' | 'success' | 'info'

/** Acción de un aviso: un botón de texto dentro de él. */
export interface AccionToast {
  etiqueta: string
  onClick: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  /** Detalle técnico opcional (p. ej. el mensaje de error crudo). */
  detail?: string
  accion?: AccionToast
}

/** Cuánto vive cada tipo antes de auto-descartarse (ms). Los errores, más tiempo. */
const AUTO_MS: Record<ToastKind, number> = {
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
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit(): void {
  for (const l of listeners) l()
}

function clearTimer(id: number): void {
  const t = timers.get(id)
  if (t !== undefined) {
    clearTimeout(t)
    timers.delete(id)
  }
}

/**
 * Publica un toast. Devuelve su id (para descartarlo manualmente si se quiere).
 * `opciones.accion` añade un botón de texto (ver la cabecera).
 */
export function notify(
  kind: ToastKind,
  title: string,
  detail?: string,
  opciones?: { accion?: AccionToast }
): number {
  const id = ++seq
  const accion = opciones?.accion
  const toast: Toast = accion ? { id, kind, title, detail, accion } : { id, kind, title, detail }
  let next = [...toasts, toast]
  // Poda por tope: descarta los más antiguos (y cancela sus timers) si hay exceso.
  if (next.length > MAX_TOASTS) {
    for (const d of next.slice(0, next.length - MAX_TOASTS)) clearTimer(d.id)
    next = next.slice(-MAX_TOASTS)
  }
  toasts = next
  const vida = accion ? Math.max(AUTO_MS[kind], AUTO_MS_CON_ACCION) : AUTO_MS[kind]
  timers.set(id, setTimeout(() => dismiss(id), vida))
  emit()
  return id
}

/** Atajo para errores: normaliza el `unknown` de un catch a título + detalle. */
export function notifyError(title: string, err?: unknown): number {
  const detail =
    err instanceof Error ? err.message : err != null && err !== '' ? String(err) : undefined
  return notify('error', title, detail)
}

/** Descarta un toast por id (idempotente). */
export function dismiss(id: number): void {
  clearTimer(id)
  const next = toasts.filter((t) => t.id !== id)
  if (next.length !== toasts.length) {
    toasts = next
    emit()
  }
}

/** Descarta todos (usado por el indicador persistente de la StatusBar). */
export function dismissAll(): void {
  for (const t of toasts) clearTimer(t.id)
  if (toasts.length > 0) {
    toasts = []
    emit()
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): Toast[] {
  return toasts
}

/** Hook de suscripción: re-renderiza al cambiar la lista de toasts. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot)
}
