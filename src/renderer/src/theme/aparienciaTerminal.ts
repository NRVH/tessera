// =============================================================================
// Apariencia configurable de las terminales: familia de fuente y tamaño, como contexto de React
// para que TerminalPane y PaneTerminalAgente la lean sin pasarla por props; App la provee desde
// los ajustes persistidos. Hay dos contextos, uno para la terminal de shell y otro para la del
// agente, porque se usan distinto y sus ajustes son independientes. El tamaño de letra de la
// interfaz es otro ajuste y vive en `theme/densidad.ts`.
// =============================================================================

import { createContext } from 'react'

export interface AparienciaTerminal {
  /** Familia de fuente CSS (con fallback). '' = la predeterminada de la app. */
  familiaLetra: string
  /** Tamaño en px. 0 = el predeterminado. */
  tamanoLetra: number
  /** Solo la de shell: ¿resalta logs y salidas (`resaltadoSalida.ts`)? Sin el campo, sí. */
  resaltar?: boolean
}

/**
 * Fuente y tamaño por defecto de las terminales. Menlo es la monoespaciada de macOS: sin ella, en Mac
 * (que no trae ninguna de las anteriores) se caía en Courier New. En Windows no existe y no cambia nada.
 */
export const LETRA_TERMINAL_POR_DEFECTO = '"Cascadia Code", "Fira Code", Consolas, Menlo, "Courier New", monospace'
export const TAMANO_LETRA_TERMINAL_POR_DEFECTO = 13

export const APARIENCIA_TERMINAL_POR_DEFECTO: AparienciaTerminal = {
  familiaLetra: '',
  tamanoLetra: 0
}

/** Apariencia de la terminal de SHELL (la de la franja inferior). */
export const ContextoAparienciaTerminal = createContext<AparienciaTerminal>(APARIENCIA_TERMINAL_POR_DEFECTO)
/** Apariencia de la terminal del AGENTE (CC/Codex), independiente de la anterior. */
export const ContextoAparienciaAgente = createContext<AparienciaTerminal>(APARIENCIA_TERMINAL_POR_DEFECTO)

/** Familia de fuente efectiva de xterm (aplica el default si está vacío). */
export function resolverFamiliaLetra(a: AparienciaTerminal): string {
  return a.familiaLetra || LETRA_TERMINAL_POR_DEFECTO
}

/** Tamaño de fuente efectivo de xterm (aplica el default si es 0). */
export function resolverTamanoLetra(a: AparienciaTerminal): number {
  return a.tamanoLetra || TAMANO_LETRA_TERMINAL_POR_DEFECTO
}

/**
 * Catálogo de fuentes ofrecidas en Ajustes (etiqueta -> familia CSS con fallback a
 * monospace). Son fuentes MONOESPACIADAS habituales; si el equipo no tiene alguna,
 * el navegador cae al `monospace` genérico sin romper nada.
 */
export const OPCIONES_LETRA_TERMINAL: { label: string; value: string }[] = [
  { label: 'Predeterminada', value: '' },
  { label: 'Cascadia Code', value: '"Cascadia Code", monospace' },
  { label: 'Cascadia Mono', value: '"Cascadia Mono", monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Lucida Console', value: '"Lucida Console", monospace' },
  { label: 'Menlo', value: 'Menlo, monospace' }
]
