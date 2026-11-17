// =============================================================================
// Estado del árbol de trabajo de TODOS los repos del proyecto que se mira: una sola
// fuente para el badge, las decoraciones del explorador y de las pestañas, la lista
// de PanelGit y la rama de la barra de estado. Pide por generaciones (lo de otro
// perfil se tira), con goteo y carga perezosa, y revalida con el watcher.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { EstadoRepo } from '../../../../shared/git-ipc'
import type { RepoDetectado } from '../../../../shared/workspace-ipc'
import { useCallbackColapsado } from '../../util/useCallbackColapsado'
import { construirDecoraciones } from './modelo/insigniaEstado'
import {
  UMBRAL_PEREZOSO,
  aplicarParcial,
  aplicarTanda,
  desmarcarPedidos,
  estadoAlDia,
  invalidarRepos,
  listaOrdenada,
  marcarPedidos,
  mismaListaEstados,
  nuevaGeneracion,
  pausaReintento,
  registrarFallo,
  reposAPedir,
  reposTocados,
  type EstadoRepos
} from './modelo/estadoRepos'
import { claveObjetivoEstado, recordarEstadoRepos, semillaEstadoRepos } from './modelo/cacheEstadoRepos'
import {
  actualizarEstadoRepos,
  avanzarCommit,
  avanzarSoloArbol,
  avanzarWorktree,
  contarPeticionEstado,
  fijarEstadosRepos,
  useStoreGit
} from './store'
import type { UsePestanas } from '../pestanas'
import type { EditorApp } from '../editor'

/** Ventana de coalescing (ms) de las reacciones al watcher: una ráfaga, una revalidación. */
const FS_COALESCE_MS = 250

/** Estado de git que consume la ventana. */
export interface EstadoGitApp {
  /** Lo que la vista de git está mirando: cambia en el mismo commit que el clic. */
  objetivoGit: UsePestanas['objetivoGit']
  estadosRepos: EstadoRepo[] | null
  cantidadWorktree: number | null
  decoraciones: ReturnType<typeof construirDecoraciones> | null
  estadoGitPorId: Map<string, string>
  ramaActiva: string | null
}

/** Revalida con el watcher: solo los repos tocados, o todo si la ráfaga viene truncada. */
function useVigilancia(pestanas: UsePestanas): void {
  const programarRefrescoWorktree = useCallbackColapsado(avanzarWorktree, FS_COALESCE_MS)
  const refrescarArbol = useCallbackColapsado(avanzarSoloArbol, FS_COALESCE_MS)
  // Por ref: el listener se registra una vez y necesita la lista al día.
  const reposRef = useRef<RepoDetectado[] | null>(null)
  reposRef.current = pestanas.reposProyectoActivo
  useEffect(
    () =>
      window.tessera.files.alCambiar((ev) => {
        const repos = reposRef.current
        const tocados = ev && repos !== null && repos.length > 0 ? reposTocados(ev.rutas, ev.parcial, repos) : null
        if (tocados === null) {
          programarRefrescoWorktree()
          return
        }
        // El árbol se refresca siempre: fuera de todo repo también pasan cosas.
        refrescarArbol()
        if (tocados.size === 0) return
        actualizarEstadoRepos((prev) => invalidarRepos(prev, tocados))
      }),
    [programarRefrescoWorktree, refrescarArbol]
  )
}

/** Cambios de git hechos fuera de la app (toque a `.git`): suben el grafo y la lista. */
function useVigilanciaGitExterno(): void {
  const programarRefrescoGit = useCallbackColapsado(() => {
    avanzarCommit()
    avanzarWorktree()
  }, FS_COALESCE_MS)
  useEffect(() => window.tessera.files.alCambiarGit(programarRefrescoGit), [programarRefrescoGit])
}

/** Repos cuyo estado se pide: los del objetivo SÍNCRONO, o su repo mientras llega el escaneo. */
function reposDelObjetivo(objetivoGit: UsePestanas['objetivoGit']): string[] | null {
  const escaneados = objetivoGit?.repos ?? null
  if (escaneados && escaneados.length > 0) return escaneados.map((r) => r.repoHostPath)
  const soloRepo = objetivoGit?.repo?.repoHostPath ?? null
  return soloRepo !== null ? [soloRepo] : null
}

type Decoraciones = ReturnType<typeof construirDecoraciones>

/**
 * Lista de estados del objetivo ACTUAL, sacada del mapa de estado y no de la lista del store: esa
 * se reescribe un commit más tarde y en el cambio de proyecto aún sería del otro. Es `null`
 * mientras el mapa no es de este objetivo (`alDia`) o no se sabe nada. Conserva la identidad
 * mientras el contenido no cambie: marcar pedidos o invalidar repos crea un estado nuevo con el
 * mismo mapa, y quien deriva de la lista no debe rehacerse por eso.
 */
function useListaEstable(estadoRepos: EstadoRepos, reposEstado: string[] | null, alDia: boolean): EstadoRepo[] | null {
  const previa = useRef<EstadoRepo[] | null>(null)
  const nueva = alDia && reposEstado !== null && estadoRepos.mapa.size > 0 ? listaOrdenada(estadoRepos, reposEstado) : null
  const lista = mismaListaEstados(previa.current, nueva) ? previa.current : nueva
  useEffect(() => {
    previa.current = lista
  }, [lista])
  return lista
}

/**
 * Decoraciones de las rutas cambiadas del proyecto `proyecto`, sacadas de la lista estable. Se
 * enseñan las últimas que se supieron de ESTE proyecto mientras la lista no es de este objetivo
 * (`alDia` falso) o su generación aún no ha recibido ninguna respuesta (`esperando`): un mapa
 * vacío recién reiniciado no es «sin cambios» y no pisa la memoria.
 */
function useDecoraciones(
  lista: EstadoRepo[] | null,
  alDia: boolean,
  esperando: boolean,
  proyecto: string | null
): Decoraciones | null {
  const porProyecto = useRef(new Map<string, Decoraciones>())
  return useMemo(() => {
    if (proyecto === null) return null
    if (!alDia || esperando) return porProyecto.current.get(proyecto) ?? null
    const d = lista !== null ? construirDecoraciones(lista.flatMap((s) => s.cambios)) : null
    if (d) porProyecto.current.set(proyecto, d)
    else porProyecto.current.delete(proyecto)
    return d
  }, [lista, alDia, esperando, proyecto])
}

/** Letra de estado de git de cada pestaña de archivo abierta, por id de pestaña. */
function useLetrasPorPestana(
  decoraciones: ReturnType<typeof construirDecoraciones> | null,
  pestanasEditor: EditorApp['pestanasEditor']['pestanas']
): Map<string, string> {
  return useMemo(() => {
    const mapa = new Map<string, string>()
    if (!decoraciones) return mapa
    for (const pestana of pestanasEditor) {
      if (pestana.pane.tipo !== 'file') continue
      const letra = decoraciones.porRuta.get(pestana.pane.archivo.ruta)
      if (letra) mapa.set(pestana.id, letra)
    }
    return mapa
  }, [decoraciones, pestanasEditor])
}

/** Rama del repo del objetivo, de la lista estable del objetivo. */
function useRamaActiva(repoGit: { repoHostPath: string } | null, estadosRepos: EstadoRepo[] | null): string | null {
  return useMemo(() => {
    const repo = repoGit?.repoHostPath ?? null
    if (repo === null || estadosRepos === null) return null
    return estadosRepos.find((s) => s.repo === repo)?.rama ?? null
  }, [repoGit, estadosRepos])
}

/** Claves que identifican el objetivo y la generación del estado de los repos. */
function useClavesEstado(objetivoGit: UsePestanas['objetivoGit'], tickEstado: number) {
  const proyectoGit = objetivoGit?.proyecto ?? null
  const reposEstado = useMemo(() => reposDelObjetivo(objetivoGit), [objetivoGit])
  const claveReposEstado = reposEstado?.join('\n') ?? ''
  // Separador `|`: no puede salir dentro de una ruta de Windows.
  const claveObjetivo = claveObjetivoEstado(proyectoGit?.rutaHostProyecto ?? null, claveReposEstado)
  return {
    reposEstado,
    claveReposEstado,
    claveObjetivo,
    claveEstadoRepos: `${claveObjetivo}|${tickEstado}`,
    // Solo se siembra por debajo del umbral perezoso: por encima se cementaría estado viejo.
    puedeSembrar: reposEstado !== null && reposEstado.length <= UMBRAL_PEREZOSO
  }
}

/** Lanza una tanda de estado del proyecto `raiz` (con prioridad) y vuelca su resultado en la generación `gen`. */
function pedirEstado(raiz: string, pedir: string[], prioritarios: string[], gen: number): void {
  window.tessera.git
    .leerEstadoRepos(raiz, pedir, prioritarios, gen)
    .then((resultado) => actualizarEstadoRepos((prev) => aplicarTanda(prev, gen, resultado)))
    .catch((err: unknown) => {
      console.error('[app] estado del working-tree falló:', err)
      // Se desmarcan para reintentar (si no, quedarían en blanco en esta generación), con una
      // pausa que crece con los fallos seguidos de la generación: un fallo que se repite no
      // puede convertirse en un bucle de peticiones.
      const actual = useStoreGit.getState().estadoRepos
      const pausa = pausaReintento(actual.gen === gen ? actual.fallos : 0)
      actualizarEstadoRepos((prev) => registrarFallo(prev, gen))
      setTimeout(
        () => actualizarEstadoRepos((prev) => (prev.gen === gen ? desmarcarPedidos(prev, pedir) : prev)),
        pausa
      )
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
  proyectoGit: { rutaHostProyecto: string } | null
  repoGit: { repoHostPath: string } | null
  reposEstado: string[] | null
  claveReposEstado: string
  reposVisibles: readonly string[]
  claveEstadoRepos: string
  claveObjetivo: string
  puedeSembrar: boolean
}

/** Ciclo del mapa de estado: nueva generación, goteo, peticiones, lista ordenada y memoria. */
function useCicloEstadoRepos(e: EntradaCiclo): void {
  const { estadoRepos, proyectoGit, repoGit } = e
  const { reposEstado, claveReposEstado, reposVisibles, claveEstadoRepos, claveObjetivo, puedeSembrar } = e
  useEffect(() => {
    actualizarEstadoRepos((prev) =>
      nuevaGeneracion(prev, claveEstadoRepos, puedeSembrar ? semillaEstadoRepos(claveObjetivo) : undefined)
    )
  }, [claveEstadoRepos, claveObjetivo, puedeSembrar])
  // Goteo: cada repo que responde se pinta en cuanto llega.
  useEffect(
    () =>
      window.tessera.git.alRecibirEstadoParcial((p) => actualizarEstadoRepos((prev) => aplicarParcial(prev, p.gen, p.estado))),
    []
  )
  useEffect(() => {
    if (proyectoGit === null || reposEstado === null) return
    const prioritarios = reposPrioritarios(repoGit?.repoHostPath ?? null, reposVisibles)
    // Se espera a la generación de ESTA clave: el reset corre en el mismo commit.
    if (!estadoAlDia(estadoRepos, claveEstadoRepos)) return
    const pedir = reposAPedir(reposEstado, prioritarios, estadoRepos.pedidos)
    if (pedir.length === 0) return
    const gen = estadoRepos.gen
    actualizarEstadoRepos((prev) => (prev.gen === gen ? marcarPedidos(prev, pedir) : prev))
    contarPeticionEstado(1)
    pedirEstado(proyectoGit.rutaHostProyecto, pedir, prioritarios, gen)
    // `reposEstado` se recrea cada render; la clave de su CONTENIDO es la dep real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveEstadoRepos, repoGit, reposVisibles, estadoRepos])
  useEffect(() => {
    if (proyectoGit === null || reposEstado === null) {
      fijarEstadosRepos(null)
      return
    }
    fijarEstadosRepos(estadoRepos.mapa.size === 0 ? null : listaOrdenada(estadoRepos, reposEstado))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoGit, claveReposEstado, estadoRepos])
  // Se recuerda lo sabido de este objetivo (también lo que llega por goteo) para sembrar al volver.
  useEffect(() => {
    if (!estadoAlDia(estadoRepos, claveEstadoRepos)) return
    if (!puedeSembrar) return
    recordarEstadoRepos(claveObjetivo, estadoRepos.mapa)
  }, [estadoRepos, claveEstadoRepos, claveObjetivo, puedeSembrar])
}

/** Estado del árbol de trabajo de todos los repos del objetivo, con sus derivados. */
export function useEstadoGit(pestanas: UsePestanas, editor: Pick<EditorApp, 'pestanasEditor'>): EstadoGitApp {
  const objetivoGit = pestanas.objetivoGit
  const proyectoGit = objetivoGit?.proyecto ?? null
  const repoGit = objetivoGit?.repo ?? null
  // El estado vive en un MAPA por repo: cada respuesta perezosa habla de un subconjunto.
  // En el store y no en `useState`: sus efectos lo cruzan con `reposVisibles`, que
  // anota PanelGit desde sus efectos, y los dos tienen que llegar en el mismo commit.
  // `peticionesEstado` (el «refrescando») NO se lee aquí: solo se pinta, y lo lee quien lo
  // pinta (PanelGit). Leerlo aquí repintaba la ventana entera al acabar cada tanda.
  const { estadoRepos, estadosRepos, reposVisibles, tickEstado } = useStoreGit(
    useShallow((s) => ({
      estadoRepos: s.estadoRepos,
      estadosRepos: s.estadosRepos,
      reposVisibles: s.reposVisibles,
      tickEstado: s.tickEstado
    }))
  )
  const claves = useClavesEstado(objetivoGit, tickEstado)
  const alDia = estadoAlDia(estadoRepos, claves.claveEstadoRepos)
  const lista = useListaEstable(estadoRepos, claves.reposEstado, alDia)
  const todosLosCambios = useMemo(() => (lista ? lista.flatMap((s) => s.cambios) : null), [lista])
  const esperando = claves.reposEstado !== null && !estadoRepos.respondido && estadoRepos.mapa.size === 0
  const decoraciones = useDecoraciones(lista, alDia, esperando, proyectoGit?.rutaHostProyecto ?? null)
  const estadoGitPorId = useLetrasPorPestana(decoraciones, editor.pestanasEditor.pestanas)
  useVigilancia(pestanas)
  useVigilanciaGitExterno()
  const ramaActiva = useRamaActiva(repoGit, lista)
  useCicloEstadoRepos({
    ...claves,
    estadoRepos,
    proyectoGit,
    repoGit,
    reposVisibles
  })
  return {
    objetivoGit,
    estadosRepos,
    cantidadWorktree: todosLosCambios?.length ?? null,
    decoraciones,
    estadoGitPorId,
    ramaActiva
  }
}
