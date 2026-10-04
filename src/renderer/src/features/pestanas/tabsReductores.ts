// =============================================================================
// tabsReductores: un reductor puro por cada acción de `TabsAction` y los ayudantes
// que comparten (parchear un perfil, despertar, elegir vecino o repo activo).
// Devuelven el MISMO `state` cuando la acción no cambia nada, para que el store no
// avise a nadie. Los tipos vienen de tabsModel (solo `import type`); el despacho por
// `switch` vive en `tabsReducer` (tabsModel.ts).
// =============================================================================

import type { Profile } from '../../../../main/profiles/types.ts'
import type { DetectedRepo } from '../../../../shared/workspace-ipc.ts'
import type { EstadoProyecto, OpenProject, ProfileTabs, TabsAction, TabsState } from './tabsModel.ts'

/** La acción de `TabsAction` cuyo `type` es `T`. */
type Accion<T extends TabsAction['type']> = Extract<TabsAction, { type: T }>

/** ProfileTabs de un perfil recién creado o sin sesión restaurada. */
export function tabsVacios(): ProfileTabs {
  return { openProjects: [], activePath: null, repoState: {} }
}

/** Devuelve un nuevo TabsState con el ProfileTabs de `profileId` parcheado. */
function patchProfile(
  state: TabsState,
  profileId: string,
  patch: Partial<ProfileTabs>
): TabsState {
  const current = state.byProfile[profileId]
  return {
    ...state,
    byProfile: { ...state.byProfile, [profileId]: { ...current, ...patch } }
  }
}

/**
 * Devuelve `openProjects` con el `estado` del proyecto `path` fijado. Devuelve la
 * MISMA referencia si no hay cambio (proyecto ausente o ya en ese estado), para no
 * disparar re-renders ni escrituras de persistencia inútiles.
 */
function setProjectEstado(
  openProjects: OpenProject[],
  path: string,
  estado: EstadoProyecto
): OpenProject[] {
  let changed = false
  const next = openProjects.map((p) => {
    if (p.projectHostPath !== path || p.estado === estado) return p
    changed = true
    return { ...p, estado }
  })
  return changed ? next : openProjects
}

/** Despierta un proyecto (flip a 'active'). Misma referencia si ya estaba 'active'/ausente. */
function wakeProject(openProjects: OpenProject[], path: string): OpenProject[] {
  return setProjectEstado(openProjects, path, 'active')
}

/**
 * Elige el proyecto que hereda el "activo" tras cerrar el que estaba en `idx`.
 * Tras el filtro, el vecino que ocupa el hueco es el de índice `idx` (el que
 * estaba a la derecha), acotado al último; null si la lista quedó vacía.
 */
function neighborPath(openProjects: OpenProject[], idx: number): string | null {
  if (openProjects.length === 0) return null
  const nextIdx = Math.min(idx, openProjects.length - 1)
  return openProjects[nextIdx].projectHostPath
}

/**
 * Elige el repo activo tras un (re)escaneo, dado el recordado previo:
 *  1) si el recordado SIGUE existiendo en la nueva lista, se respeta;
 *  2) si no, por defecto la RAÍZ (isRoot) si existe; si no, el primero;
 *  3) lista vacía -> null (git mostrará "sin repositorios").
 */
function pickActiveRepo(repos: DetectedRepo[], remembered: string | null): string | null {
  if (remembered !== null && repos.some((r) => r.repoHostPath === remembered)) return remembered
  const root = repos.find((r) => r.isRoot)
  if (root) return root.repoHostPath
  return repos[0]?.repoHostPath ?? null
}

/**
 * ¿Dos escaneos detectaron EXACTAMENTE los mismos repos? Compara en orden por los
 * tres campos de `DetectedRepo`: es lo que hace idempotente al re-escaneo (mismo
 * resultado -> mismo estado -> cero re-renders).
 */
function sameRepoList(a: DetectedRepo[], b: DetectedRepo[]): boolean {
  if (a.length !== b.length) return false
  return a.every(
    (r, i) => r.repoHostPath === b[i].repoHostPath && r.name === b[i].name && r.isRoot === b[i].isRoot
  )
}

/** Devuelve un nuevo record sin `key` (o el mismo si no estaba). Nunca muta. */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

/** Entrar a un perfil despierta su proyecto ACTIVO; no-op si nada cambia. */
export function reducirSetActiveProfile(state: TabsState, action: Accion<'setActiveProfile'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state // id desconocido: no-op
  const woken =
    tabs.activePath !== null ? wakeProject(tabs.openProjects, tabs.activePath) : tabs.openProjects
  const profileChanged = state.activeProfileId !== action.profileId
  if (!profileChanged && woken === tabs.openProjects) return state // nada cambia
  let next = state
  if (woken !== tabs.openProjects) next = patchProfile(next, action.profileId, { openProjects: woken })
  if (profileChanged) next = { ...next, activeProfileId: action.profileId }
  return next
}

/** `openProjects` sin la marca de agente diferido en `path`; la MISMA referencia si no la llevaba. */
function sinMarcaDiferido(openProjects: OpenProject[], path: string): OpenProject[] {
  if (!openProjects.some((p) => p.projectHostPath === path && p.agenteDiferido)) return openProjects
  return openProjects.map((p) => {
    if (p.projectHostPath !== path) return p
    const { agenteDiferido: _quitada, ...resto } = p
    return resto
  })
}

/** Abrir un proyecto ya abierto no duplica: lo activa y lo despierta. */
export function reducirOpenProject(state: TabsState, action: Accion<'openProject'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state // perfil desconocido: no-op
  const { projectHostPath, name } = action.project
  const already = tabs.openProjects.some((p) => p.projectHostPath === projectHostPath)
  const diferido = action.agenteDiferido === true
  const openProjects = already
    ? // Uno ya abierto no gana la marca. Y si se reabre como PROYECTO (sin la opción), la
      // pierde: quien lo abre así lo quiere con su agente.
      wakeProject(diferido ? tabs.openProjects : sinMarcaDiferido(tabs.openProjects, projectHostPath), projectHostPath)
    : [...tabs.openProjects, { projectHostPath, name, estado: 'active' as const, ...(diferido ? { agenteDiferido: true as const } : {}) }]
  // Reabrir uno ya abierto conserva su escaneo y su repo activo recordado.
  const repoState = already
    ? tabs.repoState
    : { ...tabs.repoState, [projectHostPath]: { repos: null, activeRepoHostPath: null } }
  return patchProfile(state, action.profileId, {
    openProjects,
    activePath: projectHostPath,
    repoState
  })
}

/** Quita la marca de agente diferido; el mismo `state` si el proyecto no existe o no la lleva. */
export function reducirQuitarAgenteDiferido(state: TabsState, action: Accion<'quitarAgenteDiferido'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  const openProjects = sinMarcaDiferido(tabs.openProjects, action.projectHostPath)
  return openProjects === tabs.openProjects ? state : patchProfile(state, action.profileId, { openProjects })
}

/** Activa un proyecto abierto y lo despierta, incluso si ya era el activo. */
export function reducirSetActiveProject(state: TabsState, action: Accion<'setActiveProject'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  const exists = tabs.openProjects.some((p) => p.projectHostPath === action.projectHostPath)
  if (!exists) return state
  const openProjects = wakeProject(tabs.openProjects, action.projectHostPath)
  // No-op solo si NADA cambia (ya activo Y ya 'active').
  if (openProjects === tabs.openProjects && tabs.activePath === action.projectHostPath) return state
  return patchProfile(state, action.profileId, {
    openProjects,
    activePath: action.projectHostPath
  })
}

/** Despierta un proyecto sin activarlo. */
export function reducirWakeProject(state: TabsState, action: Accion<'wakeProject'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  const openProjects = wakeProject(tabs.openProjects, action.projectHostPath)
  if (openProjects === tabs.openProjects) return state
  return patchProfile(state, action.profileId, { openProjects })
}

/** Marca 'hibernated' todos los proyectos del perfil que no lo estén ya. */
export function reducirHibernateProfile(state: TabsState, action: Accion<'hibernateProfile'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  let changed = false
  const openProjects = tabs.openProjects.map((p) => {
    if (p.estado === 'hibernated') return p
    changed = true
    return { ...p, estado: 'hibernated' as const }
  })
  if (!changed) return state
  return patchProfile(state, action.profileId, { openProjects })
}

/**
 * El agente de un proyecto se cerró por inactividad: 'active' pasa a 'agente-hibernado'. Un
 * 'hibernated' no se rebaja (su terminal también murió), y sin cambio vuelve el mismo `state`.
 */
export function reducirHibernarAgentes(state: TabsState, action: Accion<'hibernarAgentes'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  const proyecto = tabs.openProjects.find((p) => p.projectHostPath === action.projectHostPath)
  if (!proyecto || proyecto.estado !== 'active') return state
  const openProjects = setProjectEstado(tabs.openProjects, action.projectHostPath, 'agente-hibernado')
  return patchProfile(state, action.profileId, { openProjects })
}

/**
 * Si el proyecto activo del perfil activo tiene el agente hibernado por inactividad, lo
 * despierta; si no, el MISMO `state`. Un 'hibernated' (perfil entero) no se toca aquí.
 */
export function despertarAgenteEnPantalla(state: TabsState): TabsState {
  const profileId = state.activeProfileId
  const tabs = profileId === null ? undefined : state.byProfile[profileId]
  if (profileId === null || !tabs || tabs.activePath === null) return state
  const activo = tabs.openProjects.find((p) => p.projectHostPath === tabs.activePath)
  if (activo?.estado !== 'agente-hibernado') return state
  return patchProfile(state, profileId, { openProjects: wakeProject(tabs.openProjects, tabs.activePath) })
}

/** Cierra un proyecto: el vecino hereda el activo y se olvida su escaneo. */
export function reducirCloseProject(state: TabsState, action: Accion<'closeProject'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  const idx = tabs.openProjects.findIndex((p) => p.projectHostPath === action.projectHostPath)
  if (idx === -1) return state // no estaba abierto: no-op
  const openProjects = tabs.openProjects.filter((_, i) => i !== idx)
  const wasActive = tabs.activePath === action.projectHostPath
  const activePath = wasActive ? neighborPath(openProjects, idx) : tabs.activePath
  const repoState = omitKey(tabs.repoState, action.projectHostPath)
  return patchProfile(state, action.profileId, { openProjects, activePath, repoState })
}

/** Reemplaza un proyecto por otro en el mismo hueco, sin duplicar uno ya abierto. */
export function reducirReplaceProject(state: TabsState, action: Accion<'replaceProject'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  const idx = tabs.openProjects.findIndex((p) => p.projectHostPath === action.oldPath)
  if (idx === -1) return state // el tab a reemplazar ya no existe: no-op
  const { projectHostPath, name } = action.project

  // Reemplazar por el MISMO proyecto: solo despertarlo y activarlo.
  if (projectHostPath === action.oldPath) {
    const openProjects = wakeProject(tabs.openProjects, projectHostPath)
    if (openProjects === tabs.openProjects && tabs.activePath === projectHostPath) return state
    return patchProfile(state, action.profileId, { openProjects, activePath: projectHostPath })
  }

  // El nuevo YA está abierto en otro tab: cierra el viejo y activa el existente.
  const existingIdx = tabs.openProjects.findIndex((p) => p.projectHostPath === projectHostPath)
  if (existingIdx !== -1) {
    const openProjects = wakeProject(tabs.openProjects, projectHostPath).filter(
      (p) => p.projectHostPath !== action.oldPath
    )
    return patchProfile(state, action.profileId, {
      openProjects,
      activePath: projectHostPath,
      repoState: omitKey(tabs.repoState, action.oldPath)
    })
  }

  // Caso normal: sustituir en el mismo índice; el nuevo arranca 'active' y sin escanear.
  const openProjects = tabs.openProjects.map((p, i) =>
    i === idx ? { projectHostPath, name, estado: 'active' as const } : p
  )
  const repoState = {
    ...omitKey(tabs.repoState, action.oldPath),
    [projectHostPath]: { repos: null, activeRepoHostPath: null }
  }
  return patchProfile(state, action.profileId, {
    openProjects,
    activePath: projectHostPath,
    repoState
  })
}

/**
 * Reordena las pestañas de proyecto de un perfil. Solo acepta EXACTAMENTE sus rutas
 * abiertas (ni repetidas, ni de más, ni de menos): con menos comprobación, un orden mal
 * formado duplicaría un proyecto y perdería otro, y así se guardaría. Reutiliza los mismos
 * `OpenProject` y solo cambia `openProjects`: ni activa ni despierta nada.
 */
export function reducirReordenarProyectos(state: TabsState, action: Accion<'reordenarProyectos'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  const { orderedPaths } = action
  if (orderedPaths.length !== tabs.openProjects.length) return state
  const porRuta = new Map(tabs.openProjects.map((p) => [p.projectHostPath, p]))
  const openProjects: OpenProject[] = []
  for (const ruta of orderedPaths) {
    const proyecto = porRuta.get(ruta)
    if (proyecto === undefined) return state // ajena al perfil, o repetida (ya se consumió)
    porRuta.delete(ruta)
    openProjects.push(proyecto)
  }
  if (openProjects.every((p, i) => p === tabs.openProjects[i])) return state
  return patchProfile(state, action.profileId, { openProjects })
}

/** Guarda el escaneo de un proyecto abierto; un re-escaneo idéntico no cambia el estado. */
export function reducirSetScannedRepos(state: TabsState, action: Accion<'setScannedRepos'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  // Escaneo de un proyecto ya cerrado durante el await: resultado obsoleto.
  if (!tabs.openProjects.some((p) => p.projectHostPath === action.projectHostPath)) return state
  const prev = tabs.repoState[action.projectHostPath] ?? { repos: null, activeRepoHostPath: null }
  if (prev.repos !== null && sameRepoList(prev.repos, action.repos)) return state
  const activeRepoHostPath = pickActiveRepo(action.repos, prev.activeRepoHostPath)
  const repoState = {
    ...tabs.repoState,
    [action.projectHostPath]: { repos: action.repos, activeRepoHostPath }
  }
  return patchProfile(state, action.profileId, { repoState })
}

/** Marca el repo activo de un proyecto; no-op si no está en la lista escaneada. */
export function reducirSetActiveRepo(state: TabsState, action: Accion<'setActiveRepo'>): TabsState {
  const tabs = state.byProfile[action.profileId]
  if (!tabs) return state
  const prev = tabs.repoState[action.projectHostPath]
  if (!prev || prev.repos === null) return state
  if (!prev.repos.some((r) => r.repoHostPath === action.repoHostPath)) return state
  if (prev.activeRepoHostPath === action.repoHostPath) return state
  const repoState = {
    ...tabs.repoState,
    [action.projectHostPath]: { ...prev, activeRepoHostPath: action.repoHostPath }
  }
  return patchProfile(state, action.profileId, { repoState })
}

/** Añade un perfil ya construido y lo activa; no-op si el id colisiona. */
export function reducirAddProfile(state: TabsState, action: Accion<'addProfile'>): TabsState {
  if (state.profiles.some((p) => p.id === action.profile.id)) return state // id colisiona: no-op
  return {
    ...state,
    profiles: [...state.profiles, action.profile],
    activeProfileId: action.profile.id, // el perfil recién creado pasa a activo
    byProfile: {
      ...state.byProfile,
      [action.profile.id]: tabsVacios()
    }
  }
}

/** Renombra un perfil (el id no cambia); un nombre vacío es no-op. */
export function reducirRenameProfile(state: TabsState, action: Accion<'renameProfile'>): TabsState {
  const nombre = action.nombre.trim()
  if (nombre === '' || !state.profiles.some((p) => p.id === action.profileId)) return state
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.id === action.profileId ? { ...p, nombre } : p))
  }
}

/** Cambia el color de un perfil; solo acepta `#rrggbb`. */
export function reducirRecolorProfile(state: TabsState, action: Accion<'recolorProfile'>): TabsState {
  if (!/^#[0-9a-fA-F]{6}$/.test(action.color)) return state
  if (!state.profiles.some((p) => p.id === action.profileId)) return state
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === action.profileId ? { ...p, color: action.color } : p
    )
  }
}

/** Fija `sandbox.redHost` de un perfil. */
export function reducirSetProfileRedHost(state: TabsState, action: Accion<'setProfileRedHost'>): TabsState {
  if (!state.profiles.some((p) => p.id === action.profileId)) return state
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === action.profileId
        ? { ...p, sandbox: { ...p.sandbox, redHost: action.redHost } }
        : p
    )
  }
}

/** Elimina un perfil y su sesión; si era el activo, hereda el vecino de su hueco. */
export function reducirDeleteProfile(state: TabsState, action: Accion<'deleteProfile'>): TabsState {
  const idx = state.profiles.findIndex((p) => p.id === action.profileId)
  if (idx === -1) return state
  const profiles = state.profiles.filter((p) => p.id !== action.profileId)
  const byProfile = { ...state.byProfile }
  delete byProfile[action.profileId]
  let activeProfileId = state.activeProfileId
  if (activeProfileId === action.profileId) {
    activeProfileId = profiles[Math.min(idx, profiles.length - 1)]?.id ?? null
  }
  return { ...state, profiles, byProfile, activeProfileId }
}

/** Reordena los perfiles; solo vale una permutación exacta de los actuales. */
export function reducirReorderProfiles(state: TabsState, action: Accion<'reorderProfiles'>): TabsState {
  const byId = new Map(state.profiles.map((p) => [p.id, p]))
  const ordered = action.orderedIds.map((id) => byId.get(id)).filter(Boolean) as Profile[]
  if (ordered.length !== state.profiles.length) return state
  return { ...state, profiles: ordered }
}
