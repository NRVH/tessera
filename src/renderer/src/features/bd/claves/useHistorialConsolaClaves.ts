// =============================================================================
// El historial de la consola de Redis: el popover abierto o no, dónde cuelga y qué hace elegir un comando
// (lo INSERTA en el cursor, sin terminador). Es el de la consola de MongoDB (`useHistorialConsolaDocs`)
// con la composición de `historialClaves.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-historial.md
// =============================================================================

import type { editor } from 'monaco-editor'
import { useHistorialConsolaDocs, type EstadoParaHistorial, type HistorialConsolaDocs } from '../documentos/useHistorialConsolaDocs'
import { insercionHistorialClaves } from './historialClaves'

export type HistorialConsolaClaves = HistorialConsolaDocs

export function useHistorialConsolaClaves(
  e: EstadoParaHistorial,
  edRef: React.RefObject<editor.IStandaloneCodeEditor>,
  colReparto: (node: HTMLElement | null) => void
): HistorialConsolaClaves {
  return useHistorialConsolaDocs(e, edRef, colReparto, insercionHistorialClaves)
}
