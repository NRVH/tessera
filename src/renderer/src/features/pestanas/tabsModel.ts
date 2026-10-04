// =============================================================================
// tabsModel: estado PURO y transiciones de las pestañas de tres niveles (perfiles,
// proyectos abiertos por perfil, repo activo por proyecto). Sin React, DOM ni IPC.
// El activo global es un selector derivado (el `activePath` del perfil activo), no un
// campo; una ruta de proyecto es opaca (solo clave de igualdad). Cada acción tiene su
// reductor en tabsReductores.ts. Lo envuelve el hook useTabs (useTabs.ts).
// Decisiones: docs/decisiones/renderer/objetivo-de-git-derivado.md
// =============================================================================

// Extensión .ts explícita: es un import de VALOR y los test-*.mts cargan este módulo con `node`.
import { AGENTES_DISPONIBLES, type Agente, type Profile } from '../../../../main/profiles/types.ts'
import type { DetectedRepo } from '../../../../shared/workspace-ipc.ts'
import type { ProjectEstado } from '../../../../shared/workspace-state-ipc.ts'
import {
  despertarAgenteEnPantalla,
  reducirAddProfile,
  reducirCloseProject,
  reducirDeleteProfile,
  reducirHibernarAgentes,
  reducirHibernateProfile,
  reducirOpenProject,
  reducirQuitarAgenteDiferido,
  reducirRecolorProfile,
  reducirRenameProfile,
  reducirReordenarProyectos,
  reducirReorderProfiles,
  reducirReplaceProject,
  reducirSetActiveProfile,
  reducirSetActiveProject,
  reducirSetActiveRepo,
  reducirSetProfileRedHost,
  reducirSetScannedRepos,
  reducirWakeProject,
  tabsVacios
} from './tabsReductores.ts'

/**
 * Estado de un proyecto EN MEMORIA: los persistidos más 'agente-hibernado', que es solo su
 * AGENTE cerrado por inactividad (la terminal de abajo sigue viva). Se guarda como
 * 'hibernated': al reabrir la app, lo que no está activo amanece hibernado igualmente.
 */
export type EstadoProyecto = ProjectEstado | 'agente-hibernado'

/**
 * Un proyecto ABIERTO dentro de un perfil (nivel 2). `projectHostPath` es la
 * clave de identidad (opaca); `name` es solo para pintar el tab.
 */
export interface OpenProject {
  /** Ruta host opaca (de openProjectDialog / bootstrap). Clave de igualdad. */
  projectHostPath: string
  /** Nombre neutro para mostrar en el tab. */
  name: string
  /**
   * Estado de hibernación. 'active' por defecto; 'hibernated' cuando el usuario hiberna su
   * perfil y 'agente-hibernado' cuando su agente se cerró por inactividad. El flip a
   * 'active' ocurre al ENTRAR al proyecto (activarlo o despertarlo).
   */
  estado: EstadoProyecto
  /**
   * El proyecto se abrió desde el sistema para ver un ARCHIVO: su agente no arranca y su
   * columna va plegada hasta que el usuario lo pide. Solo existe como `true`; se persiste
   * con el proyecto y muere con él.
   */
  agenteDiferido?: true
}

/**
 * NIVEL 3 = el REPO ACTIVO dentro de un proyecto. Estado de SESIÓN derivado del
 * escaneo (workspace.scanRepos): se descubre al activar el proyecto y se pierde al
 * cerrarlo.
 *
 * - `repos === null` -> "aún no escaneado". Distinto de `repos === []`, que es
 *   "escaneado y la carpeta NO contiene ningún repo git".
 * - `activeRepoHostPath` es el repo activo de ESTE proyecto, o null si aún no hay.
 *   Se recuerda por proyecto: volver a un proyecto restaura su repo activo.
 */
export interface ProjectRepoState {
  /** Repos detectados en este proyecto; null = aún no escaneado. */
  repos: DetectedRepo[] | null
  /** repoHostPath del repo activo de este proyecto, o null si no hay. */
  activeRepoHostPath: string | null
}

/**
 * Estado de nivel 2 de UN perfil: sus proyectos abiertos (en orden de tab) y
 * cuál está activo DENTRO de este perfil. `activePath` es null sii el perfil no
 * tiene proyectos abiertos (perfil vacío, estado válido).
 */
export interface ProfileTabs {
  /** Proyectos abiertos, en orden de aparición (orden de pestañas). */
  openProjects: OpenProject[]
  /** projectHostPath del proyecto activo de ESTE perfil, o null si está vacío. */
  activePath: string | null
  /**
   * Estado de repos (nivel 3) por proyecto, indexado por projectHostPath. Mapa
   * paralelo a `openProjects` para que OpenProject siga siendo pura identidad.
   * Solo hay entrada para proyectos abiertos; cerrar uno la borra.
   */
  repoState: Record<string, ProjectRepoState>
}

/**
 * Estado completo del árbol de tabs. `profiles` es la config estática; el estado
 * de sesión vive en `byProfile` (uno por cada perfil, creado en el init).
 */
export interface TabsState {
  /** Perfiles de config (nivel 1), tal cual los devolvió getProfiles. */
  profiles: Profile[]
  /** Perfil activo (nivel 1). null solo si NO hay perfiles en absoluto. */
  activeProfileId: string | null
  /** Estado de sesión de nivel 2, indexado por profileId. */
  byProfile: Record<string, ProfileTabs>
}

/**
 * Sesión de tabs RESTAURADA del disco, ya en forma de modelo (la produce
 * workspaceSnapshot). `byProfile` puede traer ids de perfiles que ya no existen:
 * `initialTabsState` solo lee las entradas de los perfiles ACTUALES, así que un id
 * obsoleto se descarta sin más.
 */
export interface RestoredSession {
  /** Perfil activo recordado (o null). Se valida contra los perfiles actuales. */
  activeProfileId: string | null
  /** Estado de sesión por perfil (posiblemente con ids obsoletos, ignorados). */
  byProfile: Record<string, ProfileTabs>
}

export type TabsAction =
  /**
   * Carga inicial: fija perfiles, RESTAURA la sesión persistida (si la hay) y
   * elige perfil activo. `restored` ausente/vacío = arranque limpio.
   */
  | { type: 'init'; profiles: Profile[]; preferredProfileId?: string; restored?: RestoredSession }
  /** Cambia el perfil activo (nivel 1). No-op si el id no existe. */
  | { type: 'setActiveProfile'; profileId: string }
  /**
   * Un proyecto ELEGIDO se abre en un perfil: se añade (sin duplicar) y se activa.
   * Su identidad (path + nombre); el `estado` lo fija el reducer ('active'). Con
   * `agenteDiferido`, y solo si el proyecto se CREA, nace con el agente sin arrancar.
   */
  | {
      type: 'openProject'
      profileId: string
      project: { projectHostPath: string; name: string }
      agenteDiferido?: boolean
    }
  /** Quita la marca de agente diferido de un proyecto: su agente puede arrancar ya. */
  | { type: 'quitarAgenteDiferido'; profileId: string; projectHostPath: string }
  /** Marca un proyecto ya abierto como activo dentro de su perfil. Al entrar, lo
   *  despierta (flip 'hibernated' -> 'active'). */
  | { type: 'setActiveProject'; profileId: string; projectHostPath: string }
  /** Cierra un proyecto de un perfil; si era el activo, elige un vecino. */
  | { type: 'closeProject'; profileId: string; projectHostPath: string }
  /**
   * REEMPLAZA un proyecto abierto (`oldPath`) por otro ELEGIDO, en el MISMO hueco
   * de la banda (conserva el orden) y lo activa. Si el nuevo ya está abierto en
   * otro tab NO duplica: cierra el viejo y activa el existente.
   */
  | { type: 'replaceProject'; profileId: string; oldPath: string; project: { projectHostPath: string; name: string } }
  /**
   * Reordena las pestañas de proyecto de un perfil (arrastre). `orderedPaths` tiene que
   * ser EXACTAMENTE sus rutas abiertas; no cambia el activo ni despierta nada.
   */
  | { type: 'reordenarProyectos'; profileId: string; orderedPaths: string[] }
  /**
   * DESPIERTA un proyecto sin activarlo: flip 'hibernated' -> 'active' y nada más.
   * Lo usa el mosaico, donde traer un proyecto dormido a una casilla no debe mover
   * la vista normal de ese perfil ni el objetivo de git.
   */
  | { type: 'wakeProject'; profileId: string; projectHostPath: string }
  /** Hiberna un PERFIL entero: marca 'hibernated' TODOS sus proyectos abiertos. */
  | { type: 'hibernateProfile'; profileId: string }
  /**
   * El main cerró por inactividad el AGENTE de un proyecto: pasa de 'active' a
   * 'agente-hibernado'. Con cualquier otro estado, o sin el proyecto, no hace nada.
   */
  | { type: 'hibernarAgentes'; profileId: string; projectHostPath: string }
  /**
   * Guarda el resultado del escaneo de un proyecto (nivel 3). Si el proyecto no
   * tenía repo activo válido, aplica la elección por defecto (raíz -> primero).
   * No-op si el perfil o el proyecto no existen (escaneo obsoleto tras cerrar).
   */
  | { type: 'setScannedRepos'; profileId: string; projectHostPath: string; repos: DetectedRepo[] }
  /**
   * Marca el repo activo de un proyecto. No-op si el repo no está en la lista
   * escaneada de ese proyecto (o si aún no se ha escaneado).
   */
  | { type: 'setActiveRepo'; profileId: string; projectHostPath: string; repoHostPath: string }
  /** Añade un perfil YA construido (id/agentes los arma useTabs) y lo activa. */
  | { type: 'addProfile'; profile: Profile }
  /** Renombra un perfil (solo `nombre`; el `id` NO cambia: contenedor/creds intactos). */
  | { type: 'renameProfile'; profileId: string; nombre: string }
  /** Cambia el color de un perfil. */
  | { type: 'recolorProfile'; profileId: string; color: string }
  | { type: 'setProfileRedHost'; profileId: string; redHost: boolean }
  /** Elimina un perfil (y su estado de sesión); si era el activo, hereda un vecino. */
  | { type: 'deleteProfile'; profileId: string }
  /** Reordena los perfiles a la secuencia de ids dada (drag & drop). */
  | { type: 'reorderProfiles'; orderedIds: string[] }

/**
 * Perfil preferido al arrancar sin sesión restaurada: el que siembra `config/profiles.json`.
 * Si no existe (el usuario lo borró o renombró su id), se activa el primero de la lista.
 */
export const BOOTSTRAP_PROFILE_ID = 'personal'

/** Estado vacío inicial (antes de cargar perfiles). El hook parte de aquí. */
export const EMPTY_TABS_STATE: TabsState = {
  profiles: [],
  activeProfileId: null,
  byProfile: {}
}

/**
 * Construye el estado inicial a partir de los perfiles cargados y, si se pasa,
 * la sesión RESTAURADA del disco. Sin `restored`, cada perfil arranca sin proyectos.
 *
 * Solo se restauran las entradas de perfiles que existen HOY (se itera `profiles`):
 * un id persistido de un perfil borrado se descarta solo, y un perfil sin entrada
 * persistida arranca vacío. El perfil activo inicial es, por prioridad: el
 * restaurado (si sigue existiendo) -> el preferido (bootstrap) -> el primero.
 *
 * No se pre-abre ningún proyecto bootstrap: el renderer no conoce su ruta y toda
 * ruta de proyecto debe venir opaca del diálogo nativo.
 *
 * Política de arranque: solo se "enciende" UN proyecto, el activo del perfil activo;
 * todos los demás amanecen 'hibernated' hasta que el usuario entra en ellos (los
 * despierta `wakeProject`). Un proyecto restaurado 'active' que nunca se visita
 * arrancaría su pane perezoso y su dot se quedaría cargando.
 */
export function initialTabsState(
  profiles: Profile[],
  preferredProfileId: string = BOOTSTRAP_PROFILE_ID,
  restored?: RestoredSession
): TabsState {
  const byProfile: Record<string, ProfileTabs> = {}
  for (const p of profiles) {
    const restoredTabs = restored?.byProfile[p.id]
    byProfile[p.id] = restoredTabs ?? tabsVacios()
  }
  const activeProfileId = pickInitialProfile(profiles, preferredProfileId, restored?.activeProfileId ?? null)
  return {
    profiles,
    activeProfileId,
    byProfile: hibernateAllButActive(byProfile, activeProfileId)
  }
}

/**
 * Aplica la política de arranque: deja 'active' SOLO al proyecto activo del
 * perfil activo y marca 'hibernated' todos los demás (de cualquier perfil). Puro
 * y referencialmente estable: devuelve el mismo ProfileTabs/OpenProject cuando su
 * estado no cambia, y un perfil sin proyectos se pasa tal cual.
 */
function hibernateAllButActive(
  byProfile: Record<string, ProfileTabs>,
  activeProfileId: string | null
): Record<string, ProfileTabs> {
  const activePath =
    activeProfileId !== null ? byProfile[activeProfileId]?.activePath ?? null : null
  const out: Record<string, ProfileTabs> = {}
  for (const [profileId, tabs] of Object.entries(byProfile)) {
    if (tabs.openProjects.length === 0) {
      out[profileId] = tabs
      continue
    }
    let changed = false
    const openProjects = tabs.openProjects.map((p) => {
      const keepActive = profileId === activeProfileId && p.projectHostPath === activePath
      const estado: ProjectEstado = keepActive ? 'active' : 'hibernated'
      if (p.estado === estado) return p
      changed = true
      return { ...p, estado }
    })
    out[profileId] = changed ? { ...tabs, openProjects } : tabs
  }
  return out
}

/**
 * Perfil activo inicial, por prioridad: el RESTAURADO si sigue existiendo -> el
 * preferido (bootstrap) -> el primero -> null si no hay perfiles.
 */
function pickInitialProfile(
  profiles: Profile[],
  preferredProfileId: string,
  restoredActiveId: string | null
): string | null {
  if (restoredActiveId !== null && profiles.some((p) => p.id === restoredActiveId)) {
    return restoredActiveId
  }
  if (profiles.some((p) => p.id === preferredProfileId)) return preferredProfileId
  return profiles[0]?.id ?? null
}

/**
 * Reducer PURO. Nunca muta la entrada; una acción sobre un id o path inexistente
 * es un no-op y devuelve el mismo estado (React compara por referencia).
 *
 * Tras cada acción, el proyecto que queda EN PANTALLA no puede seguir con su agente
 * hibernado por inactividad: cerrar la pestaña activa o borrar el perfil activo dejan de
 * heredero a uno dormido sin pasar por ningún despertar. La única excepción es la propia
 * `hibernarAgentes`: el orquestador marca a propósito un proyecto en pantalla (el usuario
 * entró mientras viajaba la ronda) y lo despierta en otra tarea.
 */
export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  const siguiente = reducirAccion(state, action)
  return action.type === 'hibernarAgentes' ? siguiente : despertarAgenteEnPantalla(siguiente)
}

function reducirAccion(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'init':
      return initialTabsState(action.profiles, action.preferredProfileId, action.restored)
    case 'setActiveProfile':
      return reducirSetActiveProfile(state, action)
    case 'openProject':
      return reducirOpenProject(state, action)
    case 'setActiveProject':
      return reducirSetActiveProject(state, action)
    case 'wakeProject':
      return reducirWakeProject(state, action)
    case 'hibernateProfile':
      return reducirHibernateProfile(state, action)
    case 'hibernarAgentes':
      return reducirHibernarAgentes(state, action)
    case 'closeProject':
      return reducirCloseProject(state, action)
    case 'replaceProject':
      return reducirReplaceProject(state, action)
    case 'reordenarProyectos':
      return reducirReordenarProyectos(state, action)
    case 'quitarAgenteDiferido':
      return reducirQuitarAgenteDiferido(state, action)
    default:
      return reducirReposYPerfiles(state, action)
  }
}

/** Segunda mitad del despacho de `tabsReducer`: repos (nivel 3) y CRUD de perfiles. */
function reducirReposYPerfiles(
  state: TabsState,
  action: Exclude<
    TabsAction,
    {
      type:
        | 'init'
        | 'setActiveProfile'
        | 'openProject'
        | 'setActiveProject'
        | 'wakeProject'
        | 'hibernateProfile'
        | 'hibernarAgentes'
        | 'closeProject'
        | 'replaceProject'
        | 'reordenarProyectos'
        | 'quitarAgenteDiferido'
    }
  >
): TabsState {
  switch (action.type) {
    case 'setScannedRepos':
      return reducirSetScannedRepos(state, action)
    case 'setActiveRepo':
      return reducirSetActiveRepo(state, action)
    case 'addProfile':
      return reducirAddProfile(state, action)
    case 'renameProfile':
      return reducirRenameProfile(state, action)
    case 'recolorProfile':
      return reducirRecolorProfile(state, action)
    case 'setProfileRedHost':
      return reducirSetProfileRedHost(state, action)
    case 'deleteProfile':
      return reducirDeleteProfile(state, action)
    case 'reorderProfiles':
      return reducirReorderProfiles(state, action)
    default:
      return assertNever(action)
  }
}

/**
 * Slug seguro (filesystem/contenedor) a partir del nombre: minúsculas, sin
 * acentos, solo [a-z0-9-]. Base del `id` de un perfil nuevo.
 */
export function slugifyProfileId(nombre: string): string {
  const slug = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // quita acentos (marcas combinantes)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return slug || 'perfil'
}

/** id ÚNICO para un perfil nuevo: slug del nombre + sufijo -N si colisiona. */
export function uniqueProfileId(nombre: string, profiles: Profile[]): string {
  const base = slugifyProfileId(nombre)
  const taken = new Set(profiles.map((p) => p.id))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Garantiza en compilación que el switch cubre todas las acciones. */
function assertNever(action: never): never {
  throw new Error(`Acción de tabs no manejada: ${JSON.stringify(action)}`)
}

// -----------------------------------------------------------------------------
// SELECTORES. La UI lee SOLO por aquí; todos puros y baratos.
// -----------------------------------------------------------------------------

/** Todos los perfiles (nivel 1). */
export function selectProfiles(state: TabsState): Profile[] {
  return state.profiles
}

/** Perfil activo completo, o null si no hay perfiles. */
export function selectActiveProfile(state: TabsState): Profile | null {
  if (state.activeProfileId === null) return null
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? null
}

/** Proyectos abiertos del perfil `profileId` (vacío si no existe). */
export function selectOpenProjects(state: TabsState, profileId: string): OpenProject[] {
  return state.byProfile[profileId]?.openProjects ?? []
}

/** Proyectos abiertos del perfil ACTIVO (lo que pinta la barra de subpestañas). */
export function selectActiveProfileProjects(state: TabsState): OpenProject[] {
  if (state.activeProfileId === null) return []
  return selectOpenProjects(state, state.activeProfileId)
}

/** path del proyecto activo de un perfil concreto (null si vacío/inexistente). */
export function selectActivePath(state: TabsState, profileId: string): string | null {
  return state.byProfile[profileId]?.activePath ?? null
}

/**
 * PROYECTO ACTIVO GLOBAL = el activo del perfil activo. `null` en un estado
 * válido: no hay perfiles, o el perfil activo no tiene proyectos abiertos.
 */
export function selectGlobalActivePath(state: TabsState): string | null {
  if (state.activeProfileId === null) return null
  return selectActivePath(state, state.activeProfileId)
}

/** Objeto del proyecto activo global (para pintar nombre/estado), o null. */
export function selectGlobalActiveProject(state: TabsState): OpenProject | null {
  const path = selectGlobalActivePath(state)
  if (path === null || state.activeProfileId === null) return null
  return (
    selectOpenProjects(state, state.activeProfileId).find((p) => p.projectHostPath === path) ?? null
  )
}

/** Estado de repos de un proyecto concreto (null si no existe la entrada). */
export function selectRepoState(
  state: TabsState,
  profileId: string,
  projectHostPath: string
): ProjectRepoState | null {
  return state.byProfile[profileId]?.repoState[projectHostPath] ?? null
}

/** Estado de repos del proyecto activo GLOBAL (null si no hay proyecto activo). */
export function selectGlobalActiveRepoState(state: TabsState): ProjectRepoState | null {
  if (state.activeProfileId === null) return null
  const path = selectActivePath(state, state.activeProfileId)
  if (path === null) return null
  return selectRepoState(state, state.activeProfileId, path)
}

/**
 * Repos escaneados del proyecto activo, o `null` si aún no se ha escaneado (o no
 * hay proyecto activo): con el `null` el hook sabe que debe disparar el escaneo.
 */
export function selectGlobalActiveRepos(state: TabsState): DetectedRepo[] | null {
  return selectGlobalActiveRepoState(state)?.repos ?? null
}

/**
 * Repo activo del proyecto activo (objeto `DetectedRepo`), o `null` si no hay
 * proyecto activo, aún no se escaneó, o la lista quedó vacía.
 */
export function selectGlobalActiveRepo(state: TabsState): DetectedRepo | null {
  const rs = selectGlobalActiveRepoState(state)
  if (!rs || rs.repos === null || rs.activeRepoHostPath === null) return null
  return rs.repos.find((r) => r.repoHostPath === rs.activeRepoHostPath) ?? null
}

/**
 * Ruta host que la vista de GIT debe re-apuntar con `workspace.setActiveProject`
 * (solo GitService; el explorador se ancla aparte a la contenedora):
 *  - hay repo activo -> su `repoHostPath`;
 *  - sin repo activo (sin escanear, o carpeta sin repos) -> el `projectHostPath`
 *    del contenedor, para que git caiga a "sin repositorios";
 *  - sin proyecto activo -> `null`.
 * Con un solo repo (repoHostPath === projectHostPath) manda el mismo path antes y
 * después del escaneo, así que no hay doble re-apuntado.
 */
export function selectGitTargetPath(state: TabsState): string | null {
  const proj = selectGlobalActiveProject(state)
  if (proj === null) return null
  const rs = selectGlobalActiveRepoState(state)
  return rs?.activeRepoHostPath ?? proj.projectHostPath
}

/**
 * Qué está mirando la vista de GIT de un perfil concreto.
 *
 * `repos` conserva la distinción de `ProjectRepoState`: `null` es "escaneo en
 * vuelo, NO SE SABE" y `[]` es "escaneado, y la carpeta no tiene repos". Colapsarlos
 * haría que la UI afirmara "esto no es un repositorio" mientras aún está mirando.
 */
export interface ObjetivoGit {
  profileId: string
  project: OpenProject
  /** Repo activo del proyecto. `null` = aún no escaneado, o sin repos. */
  repo: DetectedRepo | null
  /** Lista escaneada. `null` = NO SE SABE todavía; `[]` = se sabe, y no hay. */
  repos: DetectedRepo[] | null
}

/** El objetivo de git de un perfil CUALQUIERA (no solo el activo). */
export function selectObjetivoGit(state: TabsState, profileId: string): ObjetivoGit | null {
  const path = selectActivePath(state, profileId)
  if (path === null) return null
  const project = selectOpenProjects(state, profileId).find((p) => p.projectHostPath === path)
  if (project === undefined) return null
  const rs = selectRepoState(state, profileId, path)
  const repos = rs?.repos ?? null
  const repo =
    repos !== null && rs?.activeRepoHostPath != null
      ? repos.find((r) => r.repoHostPath === rs.activeRepoHostPath) ?? null
      : null
  return { profileId, project, repo, repos }
}

/**
 * El objetivo del perfil que se está MOSTRANDO. Gobierna lo que se pinta y cambia
 * en el mismo commit de React que el clic en la pestaña.
 */
export function selectObjetivoGitMostrado(state: TabsState): ObjetivoGit | null {
  if (state.activeProfileId === null) return null
  return selectObjetivoGit(state, state.activeProfileId)
}

/**
 * ¿El backend está anclado EXACTAMENTE a este objetivo? Es la ÚNICA puerta de
 * "pedir". `repos` NO entra en la comparación: es un detalle de pintado, no parte
 * de a qué apunta el backend.
 */
export function backendAnclado(
  objetivo: ObjetivoGit | null,
  confirmado: {
    profileId: string
    project: { projectHostPath: string }
    repo: { repoHostPath: string } | null
  } | null
): boolean {
  if (objetivo === null || confirmado === null) return false
  return (
    objetivo.profileId === confirmado.profileId &&
    objetivo.project.projectHostPath === confirmado.project.projectHostPath &&
    (objetivo.repo?.repoHostPath ?? null) === (confirmado.repo?.repoHostPath ?? null)
  )
}

/**
 * Unidad del multiplexado: un target de agente ABIERTO. `key` es estable y sirve
 * como React key (y para dedupe).
 */
export interface OpenAgentTarget {
  profileId: string
  projectHostPath: string
  agente: Agente
  /** `${profileId}|${projectHostPath}|${agente}` — estable e inequívoca. */
  key: string
}

/** Clave estable de un target (React key + dedupe). Fuente única de la forma. */
export function agentTargetKey(profileId: string, projectHostPath: string, agente: Agente): string {
  return `${profileId}|${projectHostPath}|${agente}`
}

/** Agentes que se materializan como sesión: el set FIJO del producto, igual en todos los perfiles. */
function agentsForProfile(_profile: Profile): Agente[] {
  return [...AGENTES_DISPONIBLES]
}

/**
 * Aplana TODOS los targets de agente abiertos de TODOS los perfiles: producto
 * (proyectos abiertos del perfil) × (agentes del perfil). Orden determinista:
 * perfiles en el orden de `profiles`, proyectos en el de sus pestañas (el de apertura
 * hasta que el usuario las reordena arrastrando), agentes en `agentsForProfile`. Quien
 * monte nodos vivos con esta lista no puede usar su orden (ver `util/ordenEstable`).
 */
export function selectAllOpenTargets(state: TabsState, profiles: Profile[]): OpenAgentTarget[] {
  const targets: OpenAgentTarget[] = []
  for (const profile of profiles) {
    const tabs = state.byProfile[profile.id]
    if (!tabs) continue
    const agentes = agentsForProfile(profile)
    for (const project of tabs.openProjects) {
      for (const agente of agentes) {
        targets.push({
          profileId: profile.id,
          projectHostPath: project.projectHostPath,
          agente,
          key: agentTargetKey(profile.id, project.projectHostPath, agente)
        })
      }
    }
  }
  return targets
}

/**
 * Un proyecto abierto de CUALQUIER perfil, con su nombre para mostrar: lo consume
 * el mosaico, que titula cada casilla con el nombre de su proyecto aunque su perfil
 * no sea el activo (`OpenAgentTarget` no lleva el `name`).
 */
export interface OpenProjectRef {
  profileId: string
  projectHostPath: string
  name: string
  estado: EstadoProyecto
}

/** Aplana los proyectos abiertos de TODOS los perfiles, en orden determinista. */
export function selectAllOpenProjects(state: TabsState, profiles: Profile[]): OpenProjectRef[] {
  const out: OpenProjectRef[] = []
  for (const profile of profiles) {
    const tabs = state.byProfile[profile.id]
    if (!tabs) continue
    for (const project of tabs.openProjects) {
      out.push({
        profileId: profile.id,
        projectHostPath: project.projectHostPath,
        name: project.name,
        estado: project.estado
      })
    }
  }
  return out
}

/**
 * Claves (agentTargetKey) de los targets cuyo AGENTE está hibernado, de TODOS los perfiles:
 * por la hibernación de su perfil ('hibernated') o por inactividad ('agente-hibernado'). La
 * columna de agente las usa para relanzar la sesión de un pane al despertar (el backend
 * cierra la sesión al hibernar y el pane no se entera solo).
 */
export function selectHibernatedTargetKeys(state: TabsState, profiles: Profile[]): Set<string> {
  const keys = new Set<string>()
  for (const profile of profiles) {
    const tabs = state.byProfile[profile.id]
    if (!tabs) continue
    const agentes = agentsForProfile(profile)
    for (const project of tabs.openProjects) {
      if (project.estado === 'active') continue
      for (const agente of agentes) {
        keys.add(agentTargetKey(profile.id, project.projectHostPath, agente))
      }
    }
  }
  return keys
}
