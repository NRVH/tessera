// =============================================================================
// Store de las terminales de shell de cada proyecto abierto (lista y activa). Vive
// por encima de los panes para que las terminales sobrevivan a dejar de mirar el
// proyecto. Las reglas son las de shellTerminalsModel (puro, con su prueba).
// =============================================================================
import { create } from 'zustand'
import {
  addTerminal,
  closeTerminal,
  ensureProject,
  initialShellTerminalsState,
  pruneProjects,
  renameTerminal,
  selectTerminal,
  type ShellTerminalsState
} from './shellTerminalsModel'

/** Estado de las terminales de shell. */
export interface EstadoTerminales {
  shellTerminals: ShellTerminalsState
}

/** Estado de las terminales de shell. */
export const useStoreTerminales = create<EstadoTerminales>()(() => ({
  shellTerminals: initialShellTerminalsState
}))

function aplicar(f: (s: ShellTerminalsState) => ShellTerminalsState): void {
  useStoreTerminales.setState((s) => ({ shellTerminals: f(s.shellTerminals) }))
}

/** Acciones estables sobre las terminales de shell. */
export const accionesTerminales = {
  asegurar: (key: string): void => aplicar((s) => ensureProject(s, key)),
  podar: (valid: string[]): void => aplicar((s) => pruneProjects(s, valid)),
  anadir: (key: string): void => aplicar((s) => addTerminal(s, key)),
  cerrar: (key: string, id: string): void => aplicar((s) => closeTerminal(s, key, id)),
  elegir: (key: string, id: string): void => aplicar((s) => selectTerminal(s, key, id)),
  renombrar: (key: string, id: string, nombre: string): void => aplicar((s) => renameTerminal(s, key, id, nombre))
}
