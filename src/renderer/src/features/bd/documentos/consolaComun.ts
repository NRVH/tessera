// =============================================================================
// Lo idéntico de las consolas: constantes de reparto y de guardado, tipos de diálogo,
// ejecución y ancla, y las funciones pequeñas que se copiaban. Sin React, Monaco ni la caché
// del catálogo: solo tipos y DOM en `altoRepartible` y `posicionSelector`. Lo usan
// `documentos/` y `claves/`, y la consola SQL lo que comparte con ellas.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import type { DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import { DB_RESULTADOS_ALTO_MIN } from '../../../../../shared/workspace-state-ipc.ts'

/**
 * Lo mínimo que se le deja al bloque de resultados. Es el MISMO suelo con el que el
 * main sanea el alto persistido: con uno propio más bajo, un arrastre a 95 px se
 * guardaba y volvía como 120 al reiniciar.
 */
export const MIN_RESULTADOS = DB_RESULTADOS_ALTO_MIN
/** Lo mínimo que se le deja al editor: dos líneas y la barra de desplazamiento. */
export const MIN_EDITOR = 64
/** Frames que se espera a que el host tenga caja antes de rendirse (~0,5 s). */
export const MAX_FRAMES_CREACION = 30
/** Pausa de tecleo antes de guardar el archivo (la de la consola SQL). */
export const DEBOUNCE_GUARDADO_MS = 300
/** Refresco del cronómetro de la barra. */
export const TICK_MS = 250
/** Margen del selector de base con el borde de la ventana. */
export const MARGEN = 8
/** Hueco entre el botón de la base y su selector. */
export const HUECO = 4
/** Filas que se ven a la vez en el selector de base. */
export const FILAS_MAX = 10

/** Pregunta pendiente de una consola: se resuelve con lo que elija el usuario. */
export interface Dialogo {
  titulo: string
  mensaje: string
  confirmar: string
  peligro: boolean
  resolver: (ok: boolean) => void
}

/** Lo que se pregunta antes de abrir un `Dialogo`. */
export type PeticionDialogo = Omit<Dialogo, 'resolver'>

/** Ejecución en marcha de una consola. */
export interface EnCurso {
  /** Id de la ejecución (el `loteId` de los enlaces de la salida). */
  id: number
  total: number
  indice: number
  inicio: number
  peticionId: string
}

/** Rectángulo del botón al que se ancla el selector de base. */
export interface AnclaSelector {
  left: number
  right: number
  top: number
  bottom: number
}

/** El mensaje de un error de IPC sin el prefijo de Electron. */
export function mensajeDe(err: unknown): string {
  const bruto = err instanceof Error ? err.message : String(err ?? '')
  return bruto.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '') || 'Error desconocido'
}

/** Un error lanzado por el IPC, con la forma de una respuesta fallida del main. */
export function respuestaDeError<T>(err: unknown): DbRespuesta<T> {
  return { ok: false, error: { motivo: 'interno', mensaje: mensajeDe(err) } }
}

/** Un identificador de petición (el que para Stop). */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** El texto con los saltos de línea unificados, para comparar lo del disco con lo del editor. */
export function norm(t: string): string {
  return t.replace(/\r\n?/g, '\n')
}

/** Alto que se reparten editor y resultados: la columna menos lo fijo (barra, divisor…). */
export function altoRepartible(col: HTMLElement): number {
  let fijo = 0
  for (const hijo of Array.from(col.children)) {
    if (hijo.classList.contains('db-consola-editor')) continue
    if (hijo.classList.contains('db-consola-resultados')) continue
    fijo += (hijo as HTMLElement).offsetHeight
  }
  return Math.max(0, col.clientHeight - fijo)
}

/** Dónde poner el selector de base: bajo su botón, o encima si abajo no cabe. */
export function posicionSelector(
  el: HTMLElement,
  ancla: Pick<AnclaSelector, 'right' | 'top' | 'bottom'>
): { left: number; top: number } {
  const { width, height } = el.getBoundingClientRect()
  const left = Math.max(MARGEN, Math.min(ancla.right - width, window.innerWidth - width - MARGEN))
  let top = ancla.bottom + HUECO
  if (top + height > window.innerHeight - MARGEN) top = ancla.top - height - HUECO
  top = Math.max(MARGEN, Math.min(top, window.innerHeight - height - MARGEN))
  return { left, top }
}
