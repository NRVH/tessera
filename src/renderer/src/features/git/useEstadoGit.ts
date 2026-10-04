// =============================================================================
// Estado del árbol de trabajo de TODOS los repos del proyecto que se mira: una sola
// fuente para el badge, las decoraciones del explorador y de las pestañas, la lista
// de GitPanel y la rama de la barra de estado. Pide por generaciones (lo de otro
// perfil se tira), con goteo y carga perezosa, y revalida con el watcher.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RepoStatus } from '../../../../shared/git-ipc'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'
import { useCoalescedCallback } from '../../util/useCoalescedCallback'
import { buildDecorations } from './modelo/statusBadge'
import {
  UMBRAL_PEREZOSO,
  aplicarParcial,
  aplicarTanda,
  desmarcarPedidos,
  estadoAlDia,
  invalidarRepos,
  listaOrdenada,
  marcarPedidos,
  nuevaGeneracion,
  reposAPedir,
  reposTocados,
  type EstadoRepos
} from './modelo/estadoRepos'
import { claveObjetivoEstado, recordarEstadoRepos, semillaEstadoRepos } from './modelo/cacheEstadoRepos'
import {
  actualizarEstadoRepos,
  bumpCommit,
  bumpSoloArbol,
  bumpWorktree,
  contarPeticionEstado,
  fijarRepoStatuses,
  useStoreGit
} from './store'
import { backendAnclado, type UseTabs } from '../pestanas'
import type { EditorApp } from '../editor'

/** Ventana de coalescing (ms) de las reacciones al watcher: una ráfaga, una revalidación. */
const FS_COALESCE_MS = 250

/** Estado de git que consume la ventana. */
export interface EstadoGitApp {
  /** Lo que la vista de git está mirando: cambia en el mismo commit que el clic. */
  objetivoGit: UseTabs['objetivoGit']
  /** El backend ya apunta ahí: permiso para PEDIR. */
  ancladoGit: boolean
  repoStatuses: RepoStatus[] | null
  worktreeCount: number | null
  decorations: ReturnType<typeof buildDecorations> | null
  gitStatusById: Map<string, string>
  activeBranch: string | null
}

/** Revalida con el watcher: solo los repos tocados, o todo si la ráfaga viene truncada. */
function useVigilancia(tabs: UseTabs): void {
  const scheduleWorktreeRefresh = useCoalescedCallback(bumpWorktree, FS_COALESCE_MS)
  const refrescarArbol = useCoalescedCallback(bumpSoloArbol, FS_COALESCE_MS)
  // Por ref: el listener se registra una vez y necesita la lista al día.
  const reposRef = useRef<DetectedRepo[] | null>(null)
  reposRef.current = tabs.activeProjectRepos
  useEffect(
    () =>
      window.tessera.files.onChanged((ev) => {
        const repos = reposRef.current
        const tocados = ev && repos !== null && repos.length > 0 ? reposTocados(ev.paths, ev.parcial, repos) : null
        if (tocados === null) {
          scheduleWorktreeRefresh()
          return
        }
        // El árbol se refresca siempre: fuera de todo repo también pasan cosas.
        refrescarArbol()
        if (tocados.size === 0) return
        actualizarEstadoRepos((prev) => invalidarRepos(prev, tocados))
      }),
    [scheduleWorktreeRefresh, refrescarArbol]
  )
}

/** Cambios de git hechos fuera de la app (toque a `.git`): suben el grafo y la lista. */
function useVigilanciaGitExterno(): void {
  const scheduleGitRefresh = useCoalescedCallback(() => {
    bumpCommit()
    bumpWorktree()
  }, FS_COALESCE_MS)
  useEffect(() => window.tessera.files.onGitChanged(scheduleGitRefresh), [scheduleGitRefresh])
}

/** Repos cuyo estado se pide: los del objetivo SÍNCRONO, o su repo mientras llega el escaneo. */
function reposDelObjetivo(objetivoGit: UseTabs['objetivoGit']): string[] | null {
  const scanned = objetivoGit?.repos ?? null
  if (scanned && scanned.length > 0) return scanned.map((r) => r.repoHostPath)
  const soloRepo = objetivoGit?.repo?.repoHostPath ?? null
  return soloRepo !== null ? [soloRepo] : null
}

/** Decoraciones de las rutas cambiadas; se congelan sin anclaje del backend. */
function useDecoraciones(
  allChanges: Parameters<typeof buildDecorations>[0] | null,
  ancladoGit: boolean
): ReturnType<typeof buildDecorations> | null {
  // Se congela sin anclaje: una ruta que exista en los dos proyectos casaría por igualdad.
  const decoracionesRef = useRef<ReturnType<typeof buildDecorations> | null>(null)
  return useMemo(() => {
    if (!ancladoGit) return decoracionesRef.current
    const d = allChanges ? buildDecorations(allChanges) : null
    decoracionesRef.current = d
    return d
  }, [allChanges, ancladoGit])
}

/** Letra de estado de git de cada pestaña de archivo abierta, por id de pestaña. */
function useLetrasPorPestana(
  decorations: ReturnType<typeof buildDecorations> | null,
  tabsEditor: EditorApp['editorTabs']['tabs']
): Map<string, string> {
  return useMemo(() => {
    const map = new Map<string, string>()
    if (!decorations) return map
    for (const tab of tabsEditor) {
      if (tab.pane.kind !== 'file') continue
      const letter = decorations.byPath.get(tab.pane.file.path)
      if (letter) map.set(tab.id, letter)
    }
    return map
  }, [decorations, tabsEditor])
}

/** Rama del repo del objetivo: `repoStatuses` se construye para sus repos. */
function useRamaActiva(repoGit: { repoHostPath: string } | null, repoStatuses: RepoStatus[] | null): string | null {
  return useMemo(() => {
    const repo = repoGit?.repoHostPath ?? null
    if (repo === null || repoStatuses === null) return null
    return repoStatuses.find((s) => s.repo === repo)?.branch ?? null
  }, [repoGit, repoStatuses])
}

/** Claves que identifican el objetivo y la generación del estado de los repos. */
function useClavesEstado(objetivoGit: UseTabs['objetivoGit'], statusTick: number) {
  const proyectoGit = objetivoGit?.project ?? null
  const statusRepos = useMemo(() => reposDelObjetivo(objetivoGit), [objetivoGit])
  const statusReposKey = statusRepos?.join('\n') ?? ''
  // Separador `|`: no puede salir dentro de una ruta de Windows.
  const claveObjetivo = claveObjetivoEstado(proyectoGit?.projectHostPath ?? null, statusReposKey)
  return {
    statusRepos,
    statusReposKey,
    claveObjetivo,
    claveEstadoRepos: `${claveObjetivo}|${statusTick}`,
    // Solo se siembra por debajo del umbral perezoso: por encima se cementaría estado viejo.
    puedeSembrar: statusRepos !== null && statusRepos.length <= UMBRAL_PEREZOSO
  }
}

/** Lanza una tanda de estado (con prioridad) y vuelca su resultado en la generación `gen`. */
function pedirEstado(pedir: string[], prioritarios: string[], gen: number): void {
  window.tessera.git
    .multiStatus(pedir, prioritarios, gen)
    .then((result) => actualizarEstadoRepos((prev) => aplicarTanda(prev, gen, result)))
    .catch((err: unknown) => {
      console.error('[app] estado del working-tree falló:', err)
      // Se desmarcan: si no, quedarían en blanco para siempre en esta generación.
      actualizarEstadoRepos((prev) => (prev.gen === gen ? desmarcarPedidos(prev, pedir) : prev))
    })
    .finally(() => contarPeticionEstado(-1))
}

/** Repos a pedir antes que el resto: los visibles y, delante, el activo si no lo está. */
function reposPrioritarios(repoActivoGit: string | null, reposVisibles: readonly string[]): string[] {
  return repoActivoGit !== null && !reposVisibles.includes(repoActivoGit)
    ? [repoActivoGit, ...reposVisibles]
    : [...reposVisibles]
}

interface EntradaCiclo {
  estadoRepos: EstadoRepos
  proyectoGit: unknown
  repoGit: { repoHostPath: string } | null
  statusRepos: string[] | null
  statusReposKey: string
  ancladoGit: boolean
  reposVisibles: readonly string[]
  claveEstadoRepos: string
  claveObjetivo: string
  puedeSembrar: boolean
}

/** Ciclo del mapa de estado: nueva generación, goteo, peticiones, lista ordenada y memoria. */
function useCicloEstadoRepos(e: EntradaCiclo): void {
  const { estadoRepos, proyectoGit, repoGit } = e
  const { statusRepos, statusReposKey, ancladoGit, reposVisibles, claveEstadoRepos, claveObjetivo, puedeSembrar } = e
  useEffect(() => {
    actualizarEstadoRepos((prev) =>
      nuevaGeneracion(prev, claveEstadoRepos, puedeSembrar ? semillaEstadoRepos(claveObjetivo) : undefined)
    )
  }, [claveEstadoRepos, claveObjetivo, puedeSembrar])
  // Goteo: cada repo que responde se pinta en cuanto llega.
  useEffect(
    () =>
      window.tessera.git.onStatusParcial((p) => actualizarEstadoRepos((prev) => aplicarParcial(prev, p.gen, p.status))),
    []
  )
  useEffect(() => {
    if (proyectoGit === null || statusRepos === null) return
    // Sin anclaje no se pide: el backend contestaría vacío y se tomaría por «sin cambios».
    if (!ancladoGit) return
    const prioritarios = reposPrioritarios(repoGit?.repoHostPath ?? null, reposVisibles)
    // Se espera a la generación de ESTA clave: el reset corre en el mismo commit.
    if (!estadoAlDia(estadoRepos, claveEstadoRepos)) return
    const pedir = reposAPedir(statusRepos, prioritarios, estadoRepos.pedidos)
    if (pedir.length === 0) return
    const gen = estadoRepos.gen
    actualizarEstadoRepos((prev) => (prev.gen === gen ? marcarPedidos(prev, pedir) : prev))
    contarPeticionEstado(1)
    pedirEstado(pedir, prioritarios, gen)
    // `statusRepos` se recrea cada render; la clave de su CONTENIDO es la dep real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveEstadoRepos, ancladoGit, repoGit, reposVisibles, estadoRepos])
  useEffect(() => {
    if (proyectoGit === null || statusRepos === null) {
      fijarRepoStatuses(null)
      return
    }
    fijarRepoStatuses(estadoRepos.mapa.size === 0 ? null : listaOrdenada(estadoRepos, statusRepos))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoGit, statusReposKey, estadoRepos])
  // Se recuerda lo sabido de este objetivo (también lo que llega por goteo) para sembrar al volver.
  useEffect(() => {
    if (!estadoAlDia(estadoRepos, claveEstadoRepos)) return
    if (!puedeSembrar) return
    recordarEstadoRepos(claveObjetivo, estadoRepos.mapa)
  }, [estadoRepos, claveEstadoRepos, claveObjetivo, puedeSembrar])
}

/** Estado del árbol de trabajo de todos los repos del objetivo, con sus derivados. */
export function useEstadoGit(tabs: UseTabs, editor: Pick<EditorApp, 'editorTabs'>): EstadoGitApp {
  const objetivoGit = tabs.objetivoGit
  const ancladoGit = backendAnclado(objetivoGit, tabs.confirmedTarget)
  const proyectoGit = objetivoGit?.project ?? null
  const repoGit = objetivoGit?.repo ?? null
  // El estado vive en un MAPA por repo: cada respuesta perezosa habla de un subconjunto.
  // En el store y no en `useState`: sus efectos lo cruzan con `reposVisibles`, que
  // anota GitPanel desde sus efectos, y los dos tienen que llegar en el mismo commit.
  // `peticionesEstado` (el «refrescando») NO se lee aquí: solo se pinta, y lo lee quien lo
  // pinta (PanelGit). Leerlo aquí repintaba la ventana entera al acabar cada tanda.
  const { estadoRepos, repoStatuses, reposVisibles, statusTick } = useStoreGit(
    useShallow((s) => ({
      estadoRepos: s.estadoRepos,
      repoStatuses: s.repoStatuses,
      reposVisibles: s.reposVisibles,
      statusTick: s.statusTick
    }))
  )
  const allChanges = useMemo(() => (repoStatuses ? repoStatuses.flatMap((s) => s.changes) : null), [repoStatuses])
  const decorations = useDecoraciones(allChanges, ancladoGit)
  const gitStatusById = useLetrasPorPestana(decorations, editor.editorTabs.tabs)
  useVigilancia(tabs)
  useVigilanciaGitExterno()
  const activeBranch = useRamaActiva(repoGit, repoStatuses)
  const claves = useClavesEstado(objetivoGit, statusTick)
  useCicloEstadoRepos({
    ...claves,
    estadoRepos,
    proyectoGit,
    repoGit,
    ancladoGit,
    reposVisibles
  })
  return {
    objetivoGit,
    ancladoGit,
    repoStatuses,
    worktreeCount: allChanges?.length ?? null,
    decorations,
    gitStatusById,
    activeBranch
  }
}
