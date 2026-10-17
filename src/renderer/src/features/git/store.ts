// =============================================================================
// Store de git compartido por las superficies: el historial de un archivo abierto
// en la franja (por proyecto), las secciones de repo abiertas a mano en Cambios, la consulta del
// log por perfil, los ticks de invalidación, los
// repos que el usuario está viendo (los primeros que se piden) y el estado del
// árbol de trabajo por generaciones que mantiene useEstadoGit.
// =============================================================================
import { create } from 'zustand'
import type { RepoStatus } from '../../../../shared/git-ipc'
import { ESTADO_REPOS_VACIO, mismaListaEstados, type EstadoRepos } from './modelo/estadoRepos'
import type { ExpansionRepos } from './modelo/expansionRepos'
import { conHistorial, sinHistorial, type HistorialPorProyecto } from './modelo/historialPorProyecto'
import { conVistaLog, type VistaLogPorRepo, type VistaLogRepo } from './modelo/vistaLogPorRepo'

/** Lista vacía con identidad estable (dependencia del efecto que pide estados). */
export const SIN_VISIBLES: readonly string[] = []

/** Estado de git compartido. */
export interface EstadoGit {
  /** El archivo cuyo historial se ve, por proyecto (`modelo/historialPorProyecto.ts`). */
  historialPorProyecto: HistorialPorProyecto
  /** Filtros de autor y fecha y plegado de ramas del Git·Log, por repo (`modelo/vistaLogPorRepo.ts`). */
  vistaLogPorRepo: VistaLogPorRepo
  /** Secciones de repo de la vista Cambios abiertas o cerradas a mano (`modelo/expansionRepos.ts`). */
  expansionRepos: ExpansionRepos
  fileHistoryToken: number
  busquedaLogPorPerfil: Record<string, string>
  /** Tick del árbol de trabajo: lo sube cada ráfaga del watcher y cada acción del usuario. */
  worktreeTick: number
  /** Tick que invalida el estado de todos los repos: solo acciones del usuario. */
  statusTick: number
  /** Tick del grafo de commits. */
  commitTick: number
  reposVisibles: readonly string[]
  /** Estado por repo de la generación en curso; solo lo escribe useEstadoGit. */
  estadoRepos: EstadoRepos
  /** Tandas de estado en vuelo (el «refrescando»). */
  peticionesEstado: number
  /** Lista ordenada que consumen la vista de git y las decoraciones. */
  repoStatuses: RepoStatus[] | null
}

/** Estado de git compartido. */
export const useStoreGit = create<EstadoGit>()(() => ({
  historialPorProyecto: {},
  vistaLogPorRepo: {},
  expansionRepos: {},
  fileHistoryToken: 0,
  busquedaLogPorPerfil: {},
  worktreeTick: 0,
  statusTick: 0,
  commitTick: 0,
  reposVisibles: SIN_VISIBLES,
  estadoRepos: ESTADO_REPOS_VACIO,
  peticionesEstado: 0,
  repoStatuses: null
}))

/** Cambia el estado por repo; si devuelve el mismo objeto, no avisa a nadie. */
export function actualizarEstadoRepos(f: (prev: EstadoRepos) => EstadoRepos): void {
  useStoreGit.setState((s) => {
    const estadoRepos = f(s.estadoRepos)
    return estadoRepos === s.estadoRepos ? s : { estadoRepos }
  })
}

/** Suma `delta` a las tandas de estado en vuelo. */
export function contarPeticionEstado(delta: number): void {
  useStoreGit.setState((s) => ({ peticionesEstado: s.peticionesEstado + delta }))
}

/** Fija la lista ordenada del estado de los repos; una lista idéntica no avisa a nadie. */
export function fijarRepoStatuses(repoStatuses: RepoStatus[] | null): void {
  useStoreGit.setState((s) => (mismaListaEstados(s.repoStatuses, repoStatuses) ? s : { repoStatuses }))
}

/** Sube los dos ticks: una acción del usuario pudo cambiar cualquier cosa. */
export function bumpWorktree(): void {
  useStoreGit.setState((s) => ({ worktreeTick: s.worktreeTick + 1, statusTick: s.statusTick + 1 }))
}

/** Sube solo el tick del árbol (ráfaga del watcher con los repos ya resueltos). */
export function bumpSoloArbol(): void {
  useStoreGit.setState((s) => ({ worktreeTick: s.worktreeTick + 1 }))
}

/** Sube el tick del grafo de commits. */
export function bumpCommit(): void {
  useStoreGit.setState((s) => ({ commitTick: s.commitTick + 1 }))
}

/** Anota qué repos se ven; compara por contenido para no relanzar peticiones. */
export function anotarReposVisibles(lista: string[]): void {
  useStoreGit.setState((s) => {
    const prev = s.reposVisibles
    return prev.length === lista.length && prev.every((r, i) => r === lista[i]) ? {} : { reposVisibles: lista }
  })
}

/** Cambia lo recordado del Git·Log del repo `repo`; no repinta si no cambia nada. */
export function fijarVistaLog(repo: string, cambio: (actual: VistaLogRepo) => Partial<VistaLogRepo>): void {
  useStoreGit.setState((s) => {
    const siguiente = conVistaLog(s.vistaLogPorRepo, repo, cambio)
    return siguiente === s.vistaLogPorRepo ? s : { vistaLogPorRepo: siguiente }
  })
}

/** Cambia las secciones de repo tocadas a mano; no repinta si no cambia nada. */
export function fijarExpansionRepos(cambio: (actual: ExpansionRepos) => ExpansionRepos): void {
  useStoreGit.setState((s) => {
    const siguiente = cambio(s.expansionRepos)
    return siguiente === s.expansionRepos ? s : { expansionRepos: siguiente }
  })
}

/** Abre el historial de `path` en el proyecto `clave` (`claveHistorial`). */
export function abrirHistorial(clave: string, path: string): void {
  useStoreGit.setState((s) => ({
    historialPorProyecto: conHistorial(s.historialPorProyecto, clave, path),
    fileHistoryToken: s.fileHistoryToken + 1
  }))
}

/** Cierra el historial de archivo del proyecto `clave`. */
export function cerrarHistorial(clave: string): void {
  useStoreGit.setState((s) => {
    const siguiente = sinHistorial(s.historialPorProyecto, clave)
    return siguiente === s.historialPorProyecto ? s : { historialPorProyecto: siguiente }
  })
}
