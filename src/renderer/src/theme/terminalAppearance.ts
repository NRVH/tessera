// =============================================================================
// Apariencia configurable de las terminales: familia de fuente y tamaño, como contexto de React
// para que TerminalPane y AgentTerminalPane la lean sin pasarla por props; App la provee desde
// los ajustes persistidos. Hay dos contextos, uno para la terminal de shell y otro para la del
// agente, porque se usan distinto y sus ajustes son independientes. El tamaño de letra de la
// interfaz es otro ajuste y vive en `theme/densidad.ts`.
// =============================================================================

import { createContext } from 'react'

export interface TerminalAppearance {
  /** Familia de fuente CSS (con fallback). '' = la predeterminada de la app. */
  fontFamily: string
  /** Tamaño en px. 0 = el predeterminado. */
  fontSize: number
}

/** Fuente y tamaño por defecto de las terminales. */
export const DEFAULT_TERMINAL_FONT = '"Cascadia Code", "Fira Code", Consolas, "Courier New", monospace'
export const DEFAULT_TERMINAL_FONT_SIZE = 13

export const DEFAULT_TERMINAL_APPEARANCE: TerminalAppearance = {
  fontFamily: '',
  fontSize: 0
}

/** Apariencia de la terminal de SHELL (la de la franja inferior). */
export const TerminalAppearanceContext = createContext<TerminalAppearance>(DEFAULT_TERMINAL_APPEARANCE)
/** Apariencia de la terminal del AGENTE (CC/Codex), independiente de la anterior. */
export const AgentAppearanceContext = createContext<TerminalAppearance>(DEFAULT_TERMINAL_APPEARANCE)

/** Familia de fuente efectiva de xterm (aplica el default si está vacío). */
export function resolveFontFamily(a: TerminalAppearance): string {
  return a.fontFamily || DEFAULT_TERMINAL_FONT
}

/** Tamaño de fuente efectivo de xterm (aplica el default si es 0). */
export function resolveFontSize(a: TerminalAppearance): number {
  return a.fontSize || DEFAULT_TERMINAL_FONT_SIZE
}

/**
 * Catálogo de fuentes ofrecidas en Ajustes (etiqueta -> familia CSS con fallback a
 * monospace). Son fuentes MONOESPACIADAS habituales; si el equipo no tiene alguna,
 * el navegador cae al `monospace` genérico sin romper nada.
 */
export const TERMINAL_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Predeterminada', value: '' },
  { label: 'Cascadia Code', value: '"Cascadia Code", monospace' },
  { label: 'Cascadia Mono', value: '"Cascadia Mono", monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Lucida Console', value: '"Lucida Console", monospace' }
]
