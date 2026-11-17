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
  cacheRamas,
  guardarEnCache,
  commitsCache,
  ponerCommits,
  LIMITE_CARGA_POR_DEFECTO
} from './modelo/cacheGit'
import { claveCommits, type FiltrosLog } from './modelo/filtrosLog'
import { repoDePeticion } from './modelo/repoDePeticion'
import type { SeleccionLog } from './useSeleccionLog'
import type { Rama, Commit } from '../../../../shared/git-ipc'
import type { RepoDetectado } from '../../../../shared/workspace-ipc'
import type { ProyectoAbiertoDePerfil } from '../pestanas'

/** Proyecto (la `raiz` de cada petición) y repo que viajan en cada petición del panel. */
export interface IdentidadLog {
  rutaHostProyecto: string | null
  repoSeleccionado: string | null
  rutaHostRepo: string | null
}

/** Identidad de las peticiones del panel: nunca `undefined` habiendo proyecto. */
export function useIdentidadLog(proyectoActivo: ProyectoAbiertoDePerfil | null, repoActivo: RepoDetectado | null): IdentidadLog {
  const rutaHostProyecto = proyectoActivo?.rutaHostProyecto ?? null
  const repoSeleccionado = repoActivo?.repoHostPath ?? null
  const rutaHostRepo = repoDePeticion(repoSeleccionado, rutaHostProyecto)
  return { rutaHostProyecto, repoSeleccionado, rutaHostRepo }
}

export interface DatosLog {
  /** Commits que se pueden pintar: solo los del repo actual, o null. */
  commits: Commit[] | null
  repoDeCommits: string | null
  repoDeCommitsRef: { current: string | null }
  /** Único punto que toca la lista de commits, para que su repo no se olvide. */
  aplicarCommits: (lista: Commit[] | null, repo: string | null) => void
  ramas: Rama[] | null
  repoDeRamas: string | null
  repoDeRamasRef: { current: string | null }
  setRamas: (lista: Rama[] | null, repo: string | null) => void
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
export function useDatosLog(rutaHostRepo: string | null): DatosLog {
  const [commitsCargados, setEstadoCommits] = useState<Commit[] | null>(null)
  const [repoDeCommits, setRepoDeCommits] = useState<string | null>(null)
  const repoDeCommitsRef = useRef<string | null>(null)
  const aplicarCommits = useCallback((lista: Commit[] | null, repo: string | null): void => {
    setEstadoCommits(lista)
    setRepoDeCommits(repo)
    // Espejo síncrono: la reconciliación corre en el mismo commit y vería el estado viejo.
    repoDeCommitsRef.current = repo
  }, [])
  const commits = repoDeCommits === rutaHostRepo ? commitsCargados : null
  const [ramasCargadas, setEstadoRamas] = useState<Rama[] | null>(null)
  const [repoDeRamas, setRepoDeRamas] = useState<string | null>(null)
  const repoDeRamasRef = useRef<string | null>(null)
  const setRamas = useCallback((lista: Rama[] | null, repo: string | null): void => {
    setEstadoRamas(lista)
    setRepoDeRamas(repo)
    repoDeRamasRef.current = repo
  }, [])
  const ramas = repoDeRamas === rutaHostRepo ? ramasCargadas : null
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
    ramas,
    repoDeRamas,
    repoDeRamasRef,
    setRamas,
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
  const { rutaHostProyecto: raiz, rutaHostRepo } = ident
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
      if (raiz === null || rutaHostRepo === null) return Promise.resolve()
      const vivoExterno = sigueVivo ?? ((): boolean => true)
      const id = ++peticionCommitsRef.current
      repoEnVueloRef.current = rutaHostRepo
      const vigente = (): boolean => vivoExterno() && peticionCommitsRef.current === id
      if (opts?.completo !== undefined) historialCompletoRef.current = opts.completo
      const completo = historialCompletoRef.current
      const limite = completo ? undefined : LIMITE_CARGA_POR_DEFECTO
      setCargando(true)
      return window.tessera.git
        .listarCommits(raiz, rama ?? undefined, limite, rutaHostRepo)
        .then((resultado) => {
          const mas = !completo && limite !== undefined && resultado.length >= limite
          // Se cachea aunque la petición ya no sea vigente: la respuesta es de su repo, que
          // viajó con ella.
          ponerCommits(claveCommits(rutaHostRepo, rama), { commits: resultado, completo })
          if (!vigente()) return
          aplicarCommits(resultado, rutaHostRepo)
          setHayMas(mas)
          setError(null)
        })
        .catch((err: unknown) => {
          // Se anota aunque la petición esté vieja: sin esta marca la reconciliación
          // reintentaría en bucle un fallo persistente.
          repoFallidoRef.current = rutaHostRepo
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
    [raiz, rutaHostRepo, aplicarCommits, setCargando, setHayMas, setError, historialCompletoRef]
  )
  return { cargarCommits, repoEnVueloRef, repoFallidoRef }
}

function useCargarRamaActual(
  ident: IdentidadLog,
  setEnRamaActual: DatosLog['setEnRamaActual']
): CargadoresLog['cargarRamaActual'] {
  const { rutaHostProyecto: raiz, rutaHostRepo } = ident
  const peticionRamaRef = useRef(0)
  return useCallback(
    (deEstos: readonly string[], sigueVivo?: () => boolean): Promise<void> => {
      if (raiz === null || rutaHostRepo === null) return Promise.resolve()
      const vivoExterno = sigueVivo ?? ((): boolean => true)
      const id = ++peticionRamaRef.current
      const vigente = (): boolean => vivoExterno() && peticionRamaRef.current === id
      // Se pregunta solo por los commits cargados: la respuesta es su subconjunto teñible.
      return window.tessera.git
        .commitsRamaActual(raiz, rutaHostRepo, deEstos)
        .then((r) => {
          if (vigente()) setEnRamaActual(r.hashes.length > 0 ? new Set(r.hashes) : SIN_HASHES)
        })
        .catch(() => {
          if (vigente()) setEnRamaActual(SIN_HASHES)
        })
    },
    [raiz, rutaHostRepo, setEnRamaActual]
  )
}

function useCargarRamas(
  ident: IdentidadLog,
  datos: DatosLog
): Pick<CargadoresLog, 'cargarRamas' | 'repoRamasEnVueloRef'> {
  const { rutaHostProyecto: raiz, rutaHostRepo } = ident
  const { setRamas } = datos
  const repoRamasEnVueloRef = useRef<string | null>(null)
  const cargarRamas = useCallback(
    (sigueVivo?: () => boolean): Promise<void> => {
      if (raiz === null || rutaHostRepo === null) return Promise.resolve()
      const vivo = sigueVivo ?? ((): boolean => true)
      repoRamasEnVueloRef.current = rutaHostRepo
      return window.tessera.git
        .listarRamas(raiz, rutaHostRepo)
        .then((resultado) => {
          guardarEnCache(cacheRamas, rutaHostRepo, resultado)
          if (vivo()) setRamas(resultado, rutaHostRepo)
        })
        .catch(() => {
          // Sin ramas el árbol queda vacío, pero el grafo en modo «todas» sigue.
          if (vivo()) setRamas([], rutaHostRepo)
        })
        .finally(() => {
          if (repoRamasEnVueloRef.current === rutaHostRepo) repoRamasEnVueloRef.current = null
        })
    },
    [raiz, rutaHostRepo, setRamas]
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
function adoptarCachesDelRepo(rutaHostRepo: string | null, datos: DatosLog): void {
  const { aplicarCommits, setRamas, setHayMas, historialCompletoRef } = datos
  const enCache = rutaHostRepo === null ? undefined : commitsCache.get(claveCommits(rutaHostRepo, null))
  if (enCache) {
    aplicarCommits(enCache.commits, rutaHostRepo)
    historialCompletoRef.current = enCache.completo
    setHayMas(!enCache.completo && enCache.commits.length >= LIMITE_CARGA_POR_DEFECTO)
  } else {
    // Desemparejado a propósito (null, no el repo): así la reconciliación va a buscarlo.
    aplicarCommits(null, null)
    historialCompletoRef.current = false
    setHayMas(false)
  }
  const ramasEnCache = rutaHostRepo === null ? undefined : cacheRamas.get(rutaHostRepo)
  setRamas(ramasEnCache ?? null, ramasEnCache ? rutaHostRepo : null)
}

/**
 * Adopta el repo nuevo DURANTE EL RENDER (sin frame intermedio con «cargando») y cancela
 * la apertura pendiente en un efecto, que no puede ir en el render.
 */
function useAjusteRepoEnPintado(
  id: IdentidadLog,
  datos: DatosLog,
  sel: SeleccionLog,
  olvidarRama: () => void,
  repoFallidoRef: { current: string | null }
): void {
  const { rutaHostProyecto, rutaHostRepo } = id
  const { olvidarSeleccion, cancelarAuto } = sel
  const [repoAjustado, setRepoAjustado] = useState<string | null>(null)
  if (repoAjustado !== rutaHostRepo) {
    setRepoAjustado(rutaHostRepo)
    datos.setError(null)
    // Con otro repo delante vuelve a tener sentido reintentar lo que falló.
    repoFallidoRef.current = null
    // Una rama del repo A no significa nada en el B; el tinte tampoco. Autor y fecha son del
    // repo y vuelven solos (`useFiltrosDelRepo`).
    olvidarRama()
    datos.setEnRamaActual(SIN_HASHES)
    adoptarCachesDelRepo(rutaHostRepo, datos)
    // La selección se olvida aquí, no en un efecto: en el commit intermedio la memoria
    // del cursor se escribiría bajo la clave del repo nuevo con el hash del viejo.
    olvidarSeleccion()
  }
  useEffect(() => {
    cancelarAuto()
  }, [rutaHostProyecto, rutaHostRepo, cancelarAuto])
}

/** Carga completa del log: datos, cargadores, ajuste al cambiar de repo y sincronización. */
export function useCargaLog(p: {
  id: IdentidadLog
  commitTick: number | undefined
  filtros: FiltrosLog
  olvidarRama: () => void
  sel: SeleccionLog
}): { datos: DatosLog; cargadores: CargadoresLog } {
  const { id, commitTick, filtros, olvidarRama, sel } = p
  const datos = useDatosLog(id.rutaHostRepo)
  const cargadores = useCargadoresLog(id, datos)
  useAjusteRepoEnPintado(id, datos, sel, olvidarRama, cargadores.repoFallidoRef)
  useSincronizacionLog({ id, commitTick, filtros, datos, cargadores })
  return { datos, cargadores }
}
