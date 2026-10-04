// =============================================================================
// Carga de datos del panel de Log: commits y ramas de un repo con su pareja lista/repo,
// los cargadores con descarte de respuestas viejas y el ajuste al cambiar de repo.
// Lo compone `useEstadoLog`; los efectos de sincronización están en `useSincronizacionLog`.
// Decisiones: docs/decisiones/git/log-identidad-y-anclaje.md
// =============================================================================

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { SIN_HASHES } from './constantesLog'
import { useSincronizacionLog } from './useSincronizacionLog'
import {
  branchesCache,
  cachePut,
  commitsCache,
  ponerCommits,
  DEFAULT_FETCH_LIMIT
} from './modelo/cacheGit'
import { FILTROS_VACIOS, claveCommits, type FiltrosLog } from './modelo/filtrosLog'
import { repoDePeticion } from './modelo/repoDePeticion'
import type { SeleccionLog } from './useSeleccionLog'
import type { Branch, Commit } from '../../../../shared/git-ipc'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'
import type { OpenProject } from '../pestanas'

/** Repo que viaja en cada petición y si el backend ya está anclado a él. */
export interface IdentidadLog {
  projectHostPath: string | null
  repoSeleccionado: string | null
  repoHostPath: string | null
  /** Espejo en ref de `anclado` para los cargadores (ver el ADR). */
  ancladoRef: { current: boolean }
}

/** Identidad de las peticiones del panel: nunca `undefined` habiendo proyecto. */
export function useIdentidadLog(
  activeProject: OpenProject | null,
  activeRepo: DetectedRepo | null,
  anclado: boolean
): IdentidadLog {
  const projectHostPath = activeProject?.projectHostPath ?? null
  const repoSeleccionado = activeRepo?.repoHostPath ?? null
  const repoHostPath = repoDePeticion(repoSeleccionado, projectHostPath)
  const ancladoRef = useRef(anclado)
  ancladoRef.current = anclado
  return { projectHostPath, repoSeleccionado, repoHostPath, ancladoRef }
}

export interface DatosLog {
  /** Commits que se pueden pintar: solo los del repo actual, o null. */
  commits: Commit[] | null
  repoDeCommits: string | null
  repoDeCommitsRef: { current: string | null }
  /** Único punto que toca la lista de commits, para que su repo no se olvide. */
  aplicarCommits: (lista: Commit[] | null, repo: string | null) => void
  branches: Branch[] | null
  repoDeBranches: string | null
  repoDeBranchesRef: { current: string | null }
  setBranches: (lista: Branch[] | null, repo: string | null) => void
  error: string | null
  setError: Dispatch<SetStateAction<string | null>>
  cargando: boolean
  setCargando: Dispatch<SetStateAction<boolean>>
  /** ¿La carga alcanzó el tope y podría haber más? */
  hayMas: boolean
  setHayMas: Dispatch<SetStateAction<boolean>>
  /** Recuerda «traer todo» para que los refetch no vuelvan a acotar. */
  historialCompletoRef: { current: boolean }
  enRamaActual: ReadonlySet<string>
  setEnRamaActual: Dispatch<SetStateAction<ReadonlySet<string>>>
}

/** Estado de los datos cargados; lista y repo se aplican JUNTOS. */
export function useDatosLog(repoHostPath: string | null): DatosLog {
  const [commitsCargados, setCommitsState] = useState<Commit[] | null>(null)
  const [repoDeCommits, setRepoDeCommits] = useState<string | null>(null)
  const repoDeCommitsRef = useRef<string | null>(null)
  const aplicarCommits = useCallback((lista: Commit[] | null, repo: string | null): void => {
    setCommitsState(lista)
    setRepoDeCommits(repo)
    // Espejo síncrono: la reconciliación corre en el mismo commit y vería el estado viejo.
    repoDeCommitsRef.current = repo
  }, [])
  const commits = repoDeCommits === repoHostPath ? commitsCargados : null
  const [branchesCargadas, setBranchesState] = useState<Branch[] | null>(null)
  const [repoDeBranches, setRepoDeBranches] = useState<string | null>(null)
  const repoDeBranchesRef = useRef<string | null>(null)
  const setBranches = useCallback((lista: Branch[] | null, repo: string | null): void => {
    setBranchesState(lista)
    setRepoDeBranches(repo)
    repoDeBranchesRef.current = repo
  }, [])
  const branches = repoDeBranches === repoHostPath ? branchesCargadas : null
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [hayMas, setHayMas] = useState(false)
  const historialCompletoRef = useRef(false)
  const [enRamaActual, setEnRamaActual] = useState<ReadonlySet<string>>(SIN_HASHES)
  return {
    commits,
    repoDeCommits,
    repoDeCommitsRef,
    aplicarCommits,
    branches,
    repoDeBranches,
    repoDeBranchesRef,
    setBranches,
    error,
    setError,
    cargando,
    setCargando,
    hayMas,
    setHayMas,
    historialCompletoRef,
    enRamaActual,
    setEnRamaActual
  }
}

/** Carga de commits y de ramas; cada petición nueva invalida las viejas. */
export interface CargadoresLog {
  cargarCommits: (
    rama: string | null,
    sigueVivo?: () => boolean,
    opts?: { completo?: boolean }
  ) => Promise<void>
  cargarRamaActual: (deEstos: readonly string[], sigueVivo?: () => boolean) => Promise<void>
  cargarRamas: (sigueVivo?: () => boolean) => Promise<void>
  /** Repo de la petición de commits en vuelo (null = ninguna). */
  repoEnVueloRef: { current: string | null }
  /** Repo de la petición de ramas en vuelo (null = ninguna). */
  repoRamasEnVueloRef: { current: string | null }
  /** Último repo cuya carga falló: freno de la reconciliación. */
  repoFallidoRef: { current: string | null }
}

interface CargaCommits {
  cargarCommits: CargadoresLog['cargarCommits']
  repoEnVueloRef: { current: string | null }
  repoFallidoRef: { current: string | null }
}

function useCargarCommits(ident: IdentidadLog, datos: DatosLog): CargaCommits {
  const { repoHostPath, ancladoRef } = ident
  const { aplicarCommits, setError, setCargando, setHayMas, historialCompletoRef } = datos
  const peticionCommitsRef = useRef(0)
  const repoEnVueloRef = useRef<string | null>(null)
  const repoFallidoRef = useRef<string | null>(null)
  const cargarCommits = useCallback(
    (
      rama: string | null,
      sigueVivo?: () => boolean,
      opts?: { completo?: boolean }
    ): Promise<void> => {
      // Sin identidad o sin anclaje no se pregunta: el backend rechazaría el repo y su
      // lista vacía se pintaría y se cachearía como «aún no hay commits».
      if (repoHostPath === null) return Promise.resolve()
      if (!ancladoRef.current) return Promise.resolve()
      const vivoExterno = sigueVivo ?? ((): boolean => true)
      const id = ++peticionCommitsRef.current
      repoEnVueloRef.current = repoHostPath
      const vigente = (): boolean => vivoExterno() && peticionCommitsRef.current === id
      if (opts?.completo !== undefined) historialCompletoRef.current = opts.completo
      const completo = historialCompletoRef.current
      const limite = completo ? undefined : DEFAULT_FETCH_LIMIT
      setCargando(true)
      return window.tessera.git
        .listCommits(rama ?? undefined, limite, repoHostPath)
        .then((result) => {
          const mas = !completo && limite !== undefined && result.length >= limite
          // Se cachea aunque la petición ya no sea vigente, pero no si se perdió el
          // anclaje por el camino: ese vacío de rechazo quedaría como caché caliente.
          if (repoHostPath && ancladoRef.current) {
            ponerCommits(claveCommits(repoHostPath, rama), { commits: result, full: completo })
          }
          // Tampoco se aplica: emparejarlo cortaría la reconciliación. Sin aplicar, se
          // reintenta al anclar.
          if (!vigente() || !ancladoRef.current) return
          aplicarCommits(result, repoHostPath)
          setHayMas(mas)
          setError(null)
        })
        .catch((err: unknown) => {
          // Se anota aunque la petición esté vieja: sin esta marca la reconciliación
          // reintentaría en bucle un fallo persistente.
          repoFallidoRef.current = repoHostPath
          if (!vigente()) return
          setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          // Solo la ÚLTIMA petición emitida levanta la marca de «en vuelo» y apaga el
          // spinner, esté o no vigente: una vieja no puede apagarlo.
          if (peticionCommitsRef.current === id) repoEnVueloRef.current = null
          if (peticionCommitsRef.current === id) setCargando(false)
        })
    },
    [repoHostPath, ancladoRef, aplicarCommits, setCargando, setHayMas, setError, historialCompletoRef]
  )
  return { cargarCommits, repoEnVueloRef, repoFallidoRef }
}

function useCargarRamaActual(
  ident: IdentidadLog,
  setEnRamaActual: DatosLog['setEnRamaActual']
): CargadoresLog['cargarRamaActual'] {
  const { repoHostPath, ancladoRef } = ident
  const peticionRamaRef = useRef(0)
  return useCallback(
    (deEstos: readonly string[], sigueVivo?: () => boolean): Promise<void> => {
      if (repoHostPath === null) return Promise.resolve()
      if (!ancladoRef.current) return Promise.resolve()
      const vivoExterno = sigueVivo ?? ((): boolean => true)
      const id = ++peticionRamaRef.current
      const vigente = (): boolean => vivoExterno() && peticionRamaRef.current === id
      // Se pregunta solo por los commits cargados: la respuesta es su subconjunto teñible.
      return window.tessera.git
        .commitsRamaActual(repoHostPath, deEstos)
        .then((r) => {
          if (vigente()) setEnRamaActual(r.hashes.length > 0 ? new Set(r.hashes) : SIN_HASHES)
        })
        .catch(() => {
          if (vigente()) setEnRamaActual(SIN_HASHES)
        })
    },
    [repoHostPath, ancladoRef, setEnRamaActual]
  )
}

function useCargarRamas(
  ident: IdentidadLog,
  datos: DatosLog
): Pick<CargadoresLog, 'cargarRamas' | 'repoRamasEnVueloRef'> {
  const { repoHostPath, ancladoRef } = ident
  const { setBranches } = datos
  const repoRamasEnVueloRef = useRef<string | null>(null)
  const cargarRamas = useCallback(
    (sigueVivo?: () => boolean): Promise<void> => {
      if (repoHostPath === null) return Promise.resolve()
      if (!ancladoRef.current) return Promise.resolve()
      const vivo = sigueVivo ?? ((): boolean => true)
      repoRamasEnVueloRef.current = repoHostPath
      return window.tessera.git
        .listBranches(repoHostPath)
        .then((result) => {
          // Solo se cachea si el anclaje sigue siendo de este repo al responder.
          if (ancladoRef.current) cachePut(branchesCache, repoHostPath, result)
          if (vivo()) setBranches(result, repoHostPath)
        })
        .catch(() => {
          // Sin ramas el árbol queda vacío, pero el grafo en modo «todas» sigue.
          if (vivo()) setBranches([], repoHostPath)
        })
        .finally(() => {
          if (repoRamasEnVueloRef.current === repoHostPath) repoRamasEnVueloRef.current = null
        })
    },
    [repoHostPath, ancladoRef, setBranches]
  )
  return { cargarRamas, repoRamasEnVueloRef }
}

/** Cargadores de commits, tinte de rama actual y ramas. */
export function useCargadoresLog(id: IdentidadLog, datos: DatosLog): CargadoresLog {
  const { cargarCommits, repoEnVueloRef, repoFallidoRef } = useCargarCommits(id, datos)
  const cargarRamaActual = useCargarRamaActual(id, datos.setEnRamaActual)
  const { cargarRamas, repoRamasEnVueloRef } = useCargarRamas(id, datos)
  return {
    cargarCommits,
    cargarRamaActual,
    cargarRamas,
    repoEnVueloRef,
    repoRamasEnVueloRef,
    repoFallidoRef
  }
}

/** Trae de las cachés lo del repo nuevo; lista y repo desemparejados si está fría. */
function adoptarCachesDelRepo(repoHostPath: string | null, datos: DatosLog): void {
  const { aplicarCommits, setBranches, setHayMas, historialCompletoRef } = datos
  const enCache = repoHostPath === null ? undefined : commitsCache.get(claveCommits(repoHostPath, null))
  if (enCache) {
    aplicarCommits(enCache.commits, repoHostPath)
    historialCompletoRef.current = enCache.full
    setHayMas(!enCache.full && enCache.commits.length >= DEFAULT_FETCH_LIMIT)
  } else {
    // Desemparejado a propósito (null, no el repo): así la reconciliación va a buscarlo.
    aplicarCommits(null, null)
    historialCompletoRef.current = false
    setHayMas(false)
  }
  const ramasEnCache = repoHostPath === null ? undefined : branchesCache.get(repoHostPath)
  setBranches(ramasEnCache ?? null, ramasEnCache ? repoHostPath : null)
}

/**
 * Adopta el repo nuevo DURANTE EL RENDER (sin frame intermedio con «cargando») y cancela
 * la apertura pendiente en un efecto, que no puede ir en el render.
 */
function useAjusteRepoEnRender(
  id: IdentidadLog,
  datos: DatosLog,
  sel: SeleccionLog,
  setFiltros: Dispatch<SetStateAction<FiltrosLog>>,
  repoFallidoRef: { current: string | null }
): void {
  const { projectHostPath, repoHostPath } = id
  const { olvidarSeleccion, cancelarAuto } = sel
  const [repoAjustado, setRepoAjustado] = useState<string | null>(null)
  if (repoAjustado !== repoHostPath) {
    setRepoAjustado(repoHostPath)
    datos.setError(null)
    // Con otro repo delante vuelve a tener sentido reintentar lo que falló.
    repoFallidoRef.current = null
    // Una rama del repo A no significa nada en el B; el tinte tampoco.
    setFiltros(FILTROS_VACIOS)
    datos.setEnRamaActual(SIN_HASHES)
    adoptarCachesDelRepo(repoHostPath, datos)
    // La selección se olvida aquí, no en un efecto: en el commit intermedio la memoria
    // del cursor se escribiría bajo la clave del repo nuevo con el hash del viejo.
    olvidarSeleccion()
  }
  useEffect(() => {
    cancelarAuto()
  }, [projectHostPath, repoHostPath, cancelarAuto])
}

/** Carga completa del log: datos, cargadores, ajuste al cambiar de repo y sincronización. */
export function useCargaLog(p: {
  id: IdentidadLog
  anclado: boolean
  commitTick: number | undefined
  filtros: FiltrosLog
  setFiltros: Dispatch<SetStateAction<FiltrosLog>>
  sel: SeleccionLog
}): { datos: DatosLog; cargadores: CargadoresLog } {
  const { id, anclado, commitTick, filtros, setFiltros, sel } = p
  const datos = useDatosLog(id.repoHostPath)
  const cargadores = useCargadoresLog(id, datos)
  useAjusteRepoEnRender(id, datos, sel, setFiltros, cargadores.repoFallidoRef)
  useSincronizacionLog({ id, anclado, commitTick, filtros, datos, cargadores })
  return { datos, cargadores }
}
