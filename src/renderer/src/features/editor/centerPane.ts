// =============================================================================
// Tipos de la columna central del editor (archivo, sin título o diff) y el motivo de que la
// columna del agente esté oculta. Sin React ni JSX: lo importan pruebas puras con `node`.
// Otras features lo importan por `features/editor/index.ts`.
// Decisiones: docs/decisiones/editor/columna-del-agente-oculta.md
// =============================================================================

import type { DiffTarget } from './diffEditorTipos'

/** Archivo abierto en el editor: ruta relativa (POSIX) + nombre para mostrar. */
export interface OpenFile {
  /** Ruta relativa al proyecto (POSIX). Nunca una ruta de Windows. */
  path: string
  name: string
}

/**
 * Archivo sin título (Ctrl+N): un buffer que vive solo en el editor hasta que se guarda.
 * Guardado dentro del proyecto pasa a ser una pestaña de archivo normal; fuera, sigue siendo
 * `untitled` pero con nombre real y destino recordado en el main.
 */
export interface UntitledFile {
  /** Id opaco y estable del buffer: identidad de la pestaña y clave del destino recordado. */
  id: string
  /** Nombre a mostrar: «Sin título-1» mientras no se guarde; el basename real después. */
  name: string
  /** true una vez guardado FUERA del proyecto (deja de estar «sin guardar nunca»). */
  saved?: boolean
}

/**
 * Columna central bajo demanda: un archivo, un archivo sin título o un diff.
 * Un solo estado para que abrir uno siempre reemplace al otro.
 */
export type CenterPane =
  | { kind: 'file'; file: OpenFile }
  | { kind: 'untitled'; untitled: UntitledFile }
  | { kind: 'diff'; target: DiffTarget }

/** Por qué está oculta la columna del agente: colapso temporal del diff o decisión manual. */
export type MotivoCcOculto = 'no' | 'manual' | 'diff'

/**
 * Estado siguiente de la columna del agente al abrir una pestaña.
 * `colapsar` lo pide el llamador; restaurar se deduce del `kind`; un colapso no pisa un `manual`.
 */
export function siguienteMotivoCcOculto(
  actual: MotivoCcOculto,
  pane: CenterPane,
  colapsar: boolean
): MotivoCcOculto {
  // 'manual' es tuyo y no se toca — tampoco desde aquí.
  if (actual === 'manual') return 'manual'
  if (colapsar) return 'diff'
  if (pane.kind === 'diff') return actual
  // Solo se deshace el colapso del diff.
  return actual === 'diff' ? 'no' : actual
}

/**
 * Qué pasa al pulsar el conmutador de la columna del agente. En un proyecto con el agente
 * DIFERIDO la columna está plegada por esa marca y no por un motivo: desplegar la quita (y
 * el agente arranca) y deja el motivo en 'no'. En los demás es el 'no' ⇄ 'manual' de siempre.
 */
export function alternarColumnaAgente(
  actual: MotivoCcOculto,
  agenteDiferido: boolean
): { ccOculto: MotivoCcOculto; quitarDiferido: boolean } {
  if (agenteDiferido) return { ccOculto: 'no', quitarDiferido: true }
  return { ccOculto: actual === 'no' ? 'manual' : 'no', quitarDiferido: false }
}
