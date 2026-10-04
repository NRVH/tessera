// =============================================================================
// useTabs: hook que envuelve el reducer puro de tabsModel (su estado vive en el store
// de pestañas) y le añade el mundo impuro. Compone: carga inicial y persistencia
// (usePersistenciaTabs), escaneo de repos (useEscaneoRepos), sincronización del
// backend (useSincronizacionBackend) y las acciones (useAccionesTabs), y re-expone los
// selectores aplicados al estado actual. Si el IPC falla se loguea y el estado NO se
// revierte. Decisiones: docs/decisiones/renderer/objetivo-de-git-derivado.md
// =============================================================================

import { useMemo } from 'react'
import {
  selectActiveProfile,
  selectActiveProfileProjects,
  selectGitTargetPath,
  selectGlobalActiveProject,
  selectGlobalActivePath,
  selectGlobalActiveRepo,
  selectGlobalActiveRepos,
  selectAllOpenTargets,
  selectAllOpenProjects,
  selectHibernatedTargetKeys,
  selectObjetivoGitMostrado,
  selectProfiles,
  type ObjetivoGit,
  type OpenAgentTarget,
  type OpenProjectRef,
  type OpenProject,
  type TabsState
} from './tabsModel'
import { useStorePestanas, type ConfirmedTarget } from './store'
import { useCargaInicialTabs, usePersistenciaTabs } from './usePersistenciaTabs'
import { useEscaneoRepos } from './useEscaneoRepos'
import { useSincronizacionBackend } from './useSincronizacionBackend'
import { useAccionesCrudPerfiles, useAccionesProyecto } from './useAccionesTabs'
import type { Profile } from '../../../../main/profiles/types'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'

export type { ConfirmedTarget }

/**
 * App decide y APLICA el modo (nativo/Docker) de un proyecto RECIÉN elegido antes de
 * abrirlo (según el ajuste por defecto, o preguntando). Devuelve false para CANCELAR.
 */
export type DecideProjectMode = (
  profileId: string,
  projectHostPath: string,
  name: string
) => Promise<boolean>

/** Superficie que el hook expone a la UI: estado leído por selectores + acciones. */
export interface UseTabs {
  // --- Selectores (derivados del estado actual) -----------------------------
  /** Perfiles (nivel 1). */
  profiles: Profile[]
  /** Perfil activo, o null mientras cargan / si no hay ninguno. */
  activeProfile: Profile | null
  /** Proyectos abiertos del perfil activo (nivel 2). */
  openProjects: OpenProject[]
  /** Proyecto activo global OPTIMISTA (el activo del perfil activo), o null.
   *  Cambia al instante con el clic; lo usa la banda de tabs para el resaltado. */
  activeProject: OpenProject | null
  /**
   * Repos escaneados del proyecto activo (nivel 3), o `null` si aún no se ha
   * escaneado / no hay proyecto activo. Lista vacía = carpeta sin repos.
   */
  activeProjectRepos: DetectedRepo[] | null
  /**
   * Objetivo CONFIRMADO por el backend tras setActiveProject: perfil + proyecto
   * + REPO ya re-apuntados. null = sin proyecto activo. Las tres zonas del shell
   * (explorador/git/terminal) lo consumen para no leer nunca contra el objetivo viejo.
   */
  confirmedTarget: ConfirmedTarget | null
  /**
   * Objetivo de GIT del perfil que se está MOSTRANDO. `confirmedTarget` dice a qué
   * apunta el BACKEND y éste qué está mirando el USUARIO: lo que se PINTA sale de
   * aquí, lo que se PIDE espera al confirmado (`backendAnclado`).
   */
  objetivoGit: ObjetivoGit | null
  /**
   * TODOS los targets de agente abiertos, de TODOS los perfiles (no solo el
   * activo): cada (perfil, proyecto, agente) abierto. Es lo que el multiplexado
   * keep-alive monta como N sesiones vivas en paralelo.
   */
  allOpenTargets: OpenAgentTarget[]
  /**
   * TODOS los proyectos abiertos de TODOS los perfiles, con su nombre. Lo consume el
   * MOSAICO para titular sus casillas y para su selector (incluidos perfiles no activos).
   */
  allOpenProjects: OpenProjectRef[]
  /**
   * Claves de los targets abiertos cuyo AGENTE está hibernado en el modelo (de todos los
   * perfiles): con su perfil o por inactividad. La columna de agente las usa para relanzar la
   * sesión de un pane al despertarlo. Set nuevo por render solo cuando cambia el conjunto (memo).
   */
  hibernatedTargetKeys: Set<string>

  // --- Acciones (transiciones) ----------------------------------------------
  /** Cambia el perfil activo; su proyecto-activo recordado pasa a ser el global. */
  setActiveProfile: (profileId: string) => void
  /** Abre el diálogo nativo y, si no se cancela, abre el proyecto en el perfil activo. */
  openProjectInActiveProfile: (decideMode?: DecideProjectMode) => Promise<void>
  /**
   * Abre el diálogo y añade el proyecto elegido a ESE perfil (no al activo), sin
   * cambiar el perfil activo. Devuelve el proyecto abierto, o null si se canceló.
   */
  openProjectInProfile: (
    profileId: string,
    decideMode?: DecideProjectMode,
    alAbrir?: (project: { projectHostPath: string; name: string }) => void
  ) => Promise<{ projectHostPath: string; name: string } | null>
  /**
   * Abre/activa un proyecto de ruta ya conocida (la acuña el main), sin diálogo. Con
   * `agenteDiferido`, si el proyecto se crea nace con el agente sin arrancar.
   */
  openKnownProject: (
    profileId: string,
    project: { projectHostPath: string; name: string },
    opciones?: { agenteDiferido?: boolean }
  ) => void
  /** Quita la marca de agente diferido de un proyecto (el usuario pidió su agente). */
  quitarAgenteDiferido: (profileId: string, projectHostPath: string) => void
  /**
   * Abre el diálogo nativo y, si no se cancela, REEMPLAZA `oldPath` por el proyecto
   * elegido en el mismo hueco de la banda (cerrar actual + abrir nuevo en un gesto).
   * Cancelar el diálogo no cierra nada.
   */
  replaceProjectInActiveProfile: (oldPath: string, decideMode?: DecideProjectMode) => Promise<void>
  /** Marca un proyecto ya abierto como activo dentro de su perfil. */
  setActiveProject: (profileId: string, projectHostPath: string) => void
  /**
   * DESPIERTA un proyecto hibernado sin activarlo (ver la acción `wakeProject`): lo
   * usa el mosaico, donde traer a una casilla un proyecto dormido no debe mover dónde
   * aterriza la vista normal de ese perfil.
   */
  wakeProject: (profileId: string, projectHostPath: string) => void
  /**
   * Marca el repo activo del proyecto (dentro del perfil activo). Re-dispara el
   * candado de orden: el backend re-apunta a ese repoHostPath y, al resolver, se
   * confirma. No-op si el repo no está en la lista escaneada del proyecto.
   */
  setActiveRepo: (projectHostPath: string, repoHostPath: string) => void
  /**
   * Fuerza un re-escaneo de repos del proyecto activo (botón "Recargar" de git).
   * Idempotente: si nada cambió, no re-renderiza.
   */
  rescanRepos: () => void
  /** Cierra un proyecto de un perfil (elige un vecino si era el activo). */
  closeProject: (profileId: string, projectHostPath: string) => void
  /**
   * Reordena las pestañas de proyecto de ese perfil. No hace nada si `orderedPaths` no
   * son exactamente sus rutas abiertas; no cambia el proyecto activo.
   */
  reordenarProyectos: (profileId: string, orderedPaths: string[]) => void
  /** Hiberna un PERFIL entero: marca todos sus proyectos y mata su contenedor (IPC). */
  hibernateProfile: (profileId: string) => void
  /**
   * Marca como 'agente-hibernado' un proyecto cuyo agente cerró el main por inactividad.
   * Solo toca el modelo, y solo si el proyecto estaba 'active'.
   */
  hibernarAgentes: (profileId: string, projectHostPath: string) => void
  /** Perfiles con la hibernación en vuelo (spinner en el dot hasta que Docker cierra). */
  hibernatingProfiles: Set<string>
  /** Perfiles hibernados según el modelo (todos sus proyectos 'hibernated'): dot gris. */
  hibernatedProfiles: Set<string>

  // --- CRUD de perfiles (nivel 1). Persisten a disco automáticamente. ----------
  /** Crea un perfil nuevo (id derivado del nombre) con 1 agente claude-code y lo activa. */
  addProfile: (nombre: string, color: string) => void
  /** Renombra un perfil (el id NO cambia). */
  renameProfile: (profileId: string, nombre: string) => void
  /** Cambia el color de un perfil. */
  recolorProfile: (profileId: string, color: string) => void
  /**
   * Activa/desactiva `redHost` del perfil: con true su contenedor se lanza con
   * `--network host`. Aplica al RE-CREAR el contenedor (hibernar+abrir o reiniciar).
   */
  setProfileRedHost: (profileId: string, redHost: boolean) => void
  /** Elimina un perfil (y cierra sus sesiones/contenedor). */
  deleteProfile: (profileId: string) => void
  /** Reordena los perfiles a la secuencia de ids dada (drag & drop). */
  reorderProfiles: (orderedIds: string[]) => void
}

/** Perfiles hibernados según el modelo: con proyectos abiertos y TODOS 'hibernated'. */
function perfilesHibernados(byProfile: TabsState['byProfile']): Set<string> {
  const s = new Set<string>()
  for (const [id, tabs] of Object.entries(byProfile)) {
    if (tabs.openProjects.length > 0 && tabs.openProjects.every((p) => p.estado === 'hibernated')) {
      s.add(id)
    }
  }
  return s
}

/** Estado de pestañas, selectores y acciones de la ventana (ver `UseTabs`). */
export function useTabs(): UseTabs {
  const state = useStorePestanas((s) => s.tabs)

  useCargaInicialTabs()

  const activeProfileId = state.activeProfileId
  const globalActivePath = selectGlobalActivePath(state)
  const globalActiveProject = selectGlobalActiveProject(state)
  const globalActiveRepo = selectGlobalActiveRepo(state)
  const activeProjectRepos = selectGlobalActiveRepos(state)
  // Memoizado sobre `state`: lo consumen efectos de la vista de git y un objeto nuevo
  // por render los re-dispararía en cada tecla.
  const objetivoGit = useMemo(() => selectObjetivoGitMostrado(state), [state])
  // Ruta de la vista de GIT: repoHostPath del repo activo, o la contenedora sin repo.
  const gitTargetPath = selectGitTargetPath(state)
  // Ruta del EXPLORADOR: SIEMPRE la contenedora, nunca un repo; solo cambia al activar otra pestaña.
  const filesRootPath = globalActiveProject?.projectHostPath ?? null

  const rescanActiveProject = useEscaneoRepos(activeProfileId, globalActivePath)
  const confirmedTarget = useSincronizacionBackend(
    activeProfileId,
    filesRootPath,
    gitTargetPath,
    globalActiveProject,
    globalActiveRepo
  )

  const acciones = useAccionesProyecto(rescanActiveProject)
  const accionesPerfil = useAccionesCrudPerfiles()

  const hibernatingProfiles = useStorePestanas((s) => s.hibernando)

  const hibernatedProfiles = useMemo(() => perfilesHibernados(state.byProfile), [state.byProfile])

  usePersistenciaTabs(state)

  // Los tres memos dan identidad estable a sus conjuntos: `allOpenTargets` alimenta una
  // cadena de memos y dos efectos de poda de `useEditorApp`, y sin memo se recalcularían
  // en cada render (uno por frame al arrastrar un splitter). Los selectores solo leen
  // `state.byProfile` (y los `profiles` que reciben): depender de `state` anularía el memo.
  const hibernatedTargetKeys = useMemo(
    () => selectHibernatedTargetKeys(state, state.profiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.byProfile, state.profiles]
  )

  const allOpenTargets = useMemo(
    () => selectAllOpenTargets(state, state.profiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.byProfile, state.profiles]
  )

  const allOpenProjects = useMemo(
    () => selectAllOpenProjects(state, state.profiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.byProfile, state.profiles]
  )

  return {
    profiles: selectProfiles(state),
    activeProfile: selectActiveProfile(state),
    openProjects: selectActiveProfileProjects(state),
    activeProject: globalActiveProject,
    activeProjectRepos,
    confirmedTarget,
    objetivoGit,
    allOpenTargets,
    allOpenProjects,
    hibernatedTargetKeys,
    ...acciones,
    hibernatingProfiles,
    hibernatedProfiles,
    ...accionesPerfil
  }
}
