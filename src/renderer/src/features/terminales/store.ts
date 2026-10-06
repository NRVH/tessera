// =============================================================================
// Store de las terminales de la ventana: las de shell de cada proyecto abierto (lista y activa) y las
// pestañas SSH de cada perfil (lista y elegida por contexto). Vive por encima de los panes para que
// las terminales sobrevivan a dejar de mirar el proyecto. Las reglas son las de shellTerminalsModel
// y sshTabsModel (puros, con su prueba). Elegir o crear una terminal local suelta la SSH elegida
// del contexto: el contexto de un proyecto es su clave, así que no hace falta pasarlo aparte.
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
import {
  abrirSsh,
  actualizarAliasSsh,
  cerrarSsh,
  elegirSsh,
  initialSshTabsState,
  podarContextosSsh,
  podarSsh,
  renombrarSsh,
  soltarSsh,
  type SshTabsState
} from './sshTabsModel'

/** Estado de las terminales. */
export interface EstadoTerminales {
  shellTerminals: ShellTerminalsState
  ssh: SshTabsState
}

/** Estado de las terminales. */
export const useStoreTerminales = create<EstadoTerminales>()(() => ({
  shellTerminals: initialShellTerminalsState,
  ssh: initialSshTabsState
}))

function aplicar(f: (s: ShellTerminalsState) => ShellTerminalsState): void {
  useStoreTerminales.setState((s) => ({ shellTerminals: f(s.shellTerminals) }))
}

function aplicarSsh(f: (s: SshTabsState) => SshTabsState): void {
  useStoreTerminales.setState((s) => ({ ssh: f(s.ssh) }))
}

/** Acciones estables sobre las terminales de shell y las pestañas SSH. */
export const accionesTerminales = {
  asegurar: (key: string): void => aplicar((s) => ensureProject(s, key)),
  podar: (valid: string[]): void => aplicar((s) => pruneProjects(s, valid)),
  /** Nueva terminal local, activa y visible: suelta la SSH que se mirara en ese proyecto. */
  anadir: (key: string): void =>
    useStoreTerminales.setState((s) => ({ shellTerminals: addTerminal(s.shellTerminals, key), ssh: soltarSsh(s.ssh, key) })),
  cerrar: (key: string, id: string): void => aplicar((s) => closeTerminal(s, key, id)),
  /** Elegir una local la hace visible: suelta la SSH que se mirara en ese proyecto. */
  elegir: (key: string, id: string): void =>
    useStoreTerminales.setState((s) => ({ shellTerminals: selectTerminal(s.shellTerminals, key, id), ssh: soltarSsh(s.ssh, key) })),
  renombrar: (key: string, id: string, nombre: string): void => aplicar((s) => renameTerminal(s, key, id, nombre)),
  /** Abre una pestaña SSH del perfil (o, con `sftp`, su explorador de archivos), visible en este contexto. */
  abrirSsh: (contexto: string, perfilId: string, conexionId: string, alias: string, sftp = false): void =>
    aplicarSsh((s) => abrirSsh(s, contexto, perfilId, conexionId, alias, sftp)),
  cerrarSsh: (perfilId: string, id: string): void => aplicarSsh((s) => cerrarSsh(s, perfilId, id)),
  elegirSsh: (perfilId: string, contexto: string, id: string): void => aplicarSsh((s) => elegirSsh(s, perfilId, contexto, id)),
  renombrarSsh: (perfilId: string, id: string, nombre: string): void => aplicarSsh((s) => renombrarSsh(s, perfilId, id, nombre)),
  /**
   * Olvida las pestañas SSH de los perfiles que ya no existen y cuál se miraba en los contextos que ya
   * no existen (un proyecto cerrado). Solo con listas de fiar: una vacía quiere decir «ninguno».
   */
  podarSsh: (perfilesVivos: string[], contextosVivos: string[]): void =>
    aplicarSsh((s) => podarContextosSsh(podarSsh(s, perfilesVivos), contextosVivos)),
  /** Pone al día el alias de las pestañas cuya conexión cambió de nombre. */
  sincronizarAliasSsh: (aliasPorConexion: ReadonlyMap<string, string>): void =>
    aplicarSsh((s) => actualizarAliasSsh(s, aliasPorConexion))
}
