// =============================================================================
// Qué terminal se ve y qué ofrece su botón de reinicio, en lógica pura: la pestaña SSH elegida del
// contexto si hay, si no la terminal local activa del proyecto, si no hay local la primera SSH del
// perfil, y si nada, ninguna. Sin React ni DOM: se fija bajo `node` (`test-pestanas-ssh.mts`).
// Depende de los modelos de las terminales locales y de las pestañas SSH y de `reloadButton`.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import { botonReinicio, TEXTOS_RECONEXION_SSH, type SalidaBotonReinicio } from './reloadButton.ts'
import { terminalPaneKey, type ShellTerminal, type ShellTerminalsState } from './shellTerminalsModel.ts'
import { esPestanaSftp, sshDePerfil, sshPaneKey, type SshTab, type SshTabsState } from './sshTabsModel.ts'
import type { TerminalPaneInfo, TerminalProjectTarget } from './terminalPaneTipos.ts'

/** El pane que se ve: uno de las terminales locales de un proyecto o uno de las pestañas SSH del perfil. */
export type PaneActivo =
  | { tipo: 'local'; paneKey: string; projectKey: string; terminalId: string }
  | { tipo: 'ssh'; paneKey: string; perfilId: string; tab: SshTab }

/** Lo que decide qué se ve. */
export interface EntradaPaneActivo {
  perfilId: string
  sshLista: readonly SshTab[]
  /** La pestaña SSH elegida en el contexto, si hay (puede apuntar a una que ya no existe). */
  sshElegidaId: string | null
  /** El proyecto que se mira, o `null` sin proyecto. */
  proyectoKey: string | null
  /** La terminal local activa de ese proyecto, o `null` si no tiene ninguna. */
  localActivaId: string | null
}

/**
 * El pane que se ve. La SSH elegida del contexto manda; sin ella, la local activa; sin local (un
 * proyecto sin terminales, o ningún proyecto), la primera SSH del perfil; y sin nada, `null`.
 */
export function derivarPaneActivo(e: EntradaPaneActivo): PaneActivo | null {
  const ssh = (tab: SshTab): PaneActivo => ({ tipo: 'ssh', paneKey: sshPaneKey(e.perfilId, tab.id), perfilId: e.perfilId, tab })
  const elegida = e.sshElegidaId === null ? undefined : e.sshLista.find((t) => t.id === e.sshElegidaId)
  if (elegida) return ssh(elegida)
  if (e.proyectoKey !== null && e.localActivaId !== null) {
    return { tipo: 'local', paneKey: terminalPaneKey(e.proyectoKey, e.localActivaId), projectKey: e.proyectoKey, terminalId: e.localActivaId }
  }
  const primera = e.sshLista[0]
  return primera ? ssh(primera) : null
}

/**
 * La conexión de la pestaña SSH que se ve, para marcar su fila en la lista de conexiones; `null` si lo
 * que se ve es una terminal local o nada.
 */
export function conexionDelPane(pane: PaneActivo | null): string | null {
  return pane?.tipo === 'ssh' && !esPestanaSftp(pane.tab) ? pane.tab.conexionId : null
}

/** Lo que se ve y lo que ofrece su botón de reinicio, derivado de los modelos y de lo que reportan los panes. */
export interface ActivoTerminales {
  activeProject: TerminalProjectTarget | null
  /** Las terminales locales del proyecto que se mira. */
  activeList: ShellTerminal[]
  activeHostMode: boolean
  /** Las pestañas SSH del perfil. */
  sshLista: readonly SshTab[]
  /** La terminal local que se VE (`null` si se ve una SSH o nada): la que la tira marca como activa. */
  localActivaId: string | null
  /** La pestaña SSH que se VE (`null` si se ve una local o nada). */
  sshActivaId: string | null
  pane: PaneActivo | null
  activePaneKey: string | null
  /** El botón de reinicio del pane que se ve; `null` si no se ve ninguno. */
  boton: SalidaBotonReinicio | null
}

/** Lo que `derivarActivo` lee del panel. */
export interface EntradaActivo {
  projects: readonly TerminalProjectTarget[]
  activeProjectKey: string | null
  terminals: ShellTerminalsState
  /** El perfil de la terminal: el del proyecto confirmado o, sin proyecto, el activo. */
  perfilId: string
  /** El contexto de la terminal (`contextoSsh`). */
  contexto: string
  ssh: SshTabsState
  infoByPane: Readonly<Record<string, TerminalPaneInfo | undefined>>
  windowsModeKeys: ReadonlySet<string>
  hibernatedProjectKeys: ReadonlySet<string>
  dbReady?: boolean
  /** Las conexiones SSH que existen: de las demás no se puede reconectar. */
  conexionesVivas: ReadonlySet<string>
}

/** Por qué no se puede reconectar una pestaña cuya conexión se eliminó. */
export const MOTIVO_CONEXION_ELIMINADA = 'Reconectar no está disponible: la conexión se eliminó'

/** El botón de una terminal local, el de siempre: sin cuenta que pedir, solo espera a los ajustes en modo nativo. */
function botonLocal(info: TerminalPaneInfo | undefined, hibernated: boolean, puedeAbrir: boolean): SalidaBotonReinicio {
  return botonReinicio({
    status: info?.status ?? 'booting',
    sessionId: info?.sessionId ?? null,
    reloading: info?.reloading ?? false,
    hibernated,
    puedeAbrir,
    etiquetaNormal: 'Reiniciar',
    etiquetaProgreso: 'Reiniciando…'
  })
}

/** El botón de una pestaña SSH: «Reconectar», sin hibernación y bloqueado si su conexión ya no existe. */
function botonSsh(info: TerminalPaneInfo | undefined, existe: boolean): SalidaBotonReinicio {
  return botonReinicio({
    status: info?.status ?? 'booting',
    sessionId: info?.sessionId ?? null,
    reloading: info?.reloading ?? false,
    hibernated: false,
    puedeAbrir: true,
    etiquetaNormal: 'Reconectar',
    etiquetaProgreso: 'Reconectando…',
    textos: TEXTOS_RECONEXION_SSH,
    ...(existe ? {} : { bloqueo: MOTIVO_CONEXION_ELIMINADA })
  })
}

/** El botón de reinicio del pane que se ve, según sea una SSH o una local; `null` si no se ve ninguno. */
function botonDelPane(pane: PaneActivo | null, e: EntradaActivo, hostMode: boolean): SalidaBotonReinicio | null {
  if (pane === null) return null
  const info = e.infoByPane[pane.paneKey]
  // El explorador SFTP no tiene pty que reiniciar: él mismo ofrece «Reintentar» / «Reconectar» si algo falla.
  if (pane.tipo === 'ssh') return esPestanaSftp(pane.tab) ? null : botonSsh(info, e.conexionesVivas.has(pane.tab.conexionId))
  // En modo nativo la terminal local espera a que los ajustes de montaje estén hidratados.
  return botonLocal(info, e.hibernatedProjectKeys.has(pane.projectKey), hostMode ? (e.dbReady ?? true) : true)
}

/** Cuál de las dos clases de pestaña se ve y con qué id: la otra es `null`. */
function idsVistos(pane: PaneActivo | null): Pick<ActivoTerminales, 'localActivaId' | 'sshActivaId'> {
  return {
    localActivaId: pane?.tipo === 'local' ? pane.terminalId : null,
    sshActivaId: pane?.tipo === 'ssh' ? pane.tab.id : null
  }
}

/** Lo que se ve y el botón de reinicio de ese pane. */
export function derivarActivo(e: EntradaActivo): ActivoTerminales {
  const activeProject = e.projects.find((p) => p.key === e.activeProjectKey) ?? null
  const proyecto = e.activeProjectKey ? e.terminals[e.activeProjectKey] : undefined
  const sshLista = sshDePerfil(e.ssh, e.perfilId)
  const pane = derivarPaneActivo({
    perfilId: e.perfilId,
    sshLista,
    sshElegidaId: e.ssh.activaPorContexto[e.contexto] ?? null,
    proyectoKey: activeProject?.key ?? null,
    localActivaId: proyecto?.activeId ?? null
  })
  const activeHostMode = activeProject !== null && e.windowsModeKeys.has(activeProject.key)
  return {
    activeProject,
    activeList: proyecto?.list ?? [],
    activeHostMode,
    sshLista,
    ...idsVistos(pane),
    pane,
    activePaneKey: pane?.paneKey ?? null,
    boton: botonDelPane(pane, e, activeHostMode)
  }
}
