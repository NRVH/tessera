// =============================================================================
// Efectos que mantienen al día lo cargado del panel de Log: la reconciliación de commits y
// ramas, el tinte de la rama actual y la recarga por `commitTick`. Van en este orden.
// Los llama `useCargaLog`; no guardan estado propio.
// Decisiones: docs/decisiones/git/log-identidad-y-anclaje.md
// =============================================================================

import { useEffect } from 'react'
import { SIN_HASHES } from './constantesLog'
import { purgarRepo } from './modelo/cacheGit'
import type { FiltrosLog } from './modelo/filtrosLog'
import type { CargadoresLog, DatosLog, IdentidadLog } from './useCargaLog'

interface ParametrosSincronizacion {
  id: IdentidadLog
  commitTick: number | undefined
  filtros: FiltrosLog
  datos: DatosLog
  cargadores: CargadoresLog
}

/** Si lo cargado no es de este repo y no hay nada en camino, lo pide. */
function useReconciliacionLog({ id, datos, cargadores }: ParametrosSincronizacion): void {
  const { rutaHostProyecto, rutaHostRepo } = id
  const { repoDeCommits, repoDeRamas, repoDeCommitsRef, repoDeRamasRef } = datos
  const { cargarCommits, cargarRamas, repoEnVueloRef, repoRamasEnVueloRef, repoFallidoRef } = cargadores
  useEffect(() => {
    if (rutaHostProyecto === null || rutaHostRepo === null) return
    // Se lee la REF: en el mismo commit el estado sería el de antes de la recarga.
    if (repoDeCommitsRef.current === rutaHostRepo) return
    if (repoEnVueloRef.current === rutaHostRepo) return
    if (repoFallidoRef.current === rutaHostRepo) return // ya falló: no martillear
    let cancelado = false
    void cargarCommits(null, () => !cancelado)
    return () => {
      cancelado = true
    }
  }, [rutaHostProyecto, rutaHostRepo, repoDeCommits, cargarCommits, repoDeCommitsRef, repoEnVueloRef, repoFallidoRef])

  useEffect(() => {
    if (rutaHostProyecto === null || rutaHostRepo === null) return
    if (repoDeRamasRef.current === rutaHostRepo) return
    if (repoRamasEnVueloRef.current === rutaHostRepo) return
    let cancelado = false
    void cargarRamas(() => !cancelado)
    return () => {
      cancelado = true
    }
  }, [rutaHostProyecto, rutaHostRepo, repoDeRamas, cargarRamas, repoDeRamasRef, repoRamasEnVueloRef])
}

/**
 * El tinte de la rama actual, colgado de los commits YA CARGADOS: se pregunta por lo que
 * se pinta y se repite justo cuando la lista cambia.
 */
function useTinteRamaActual({ id, datos, cargadores }: ParametrosSincronizacion): void {
  const { rutaHostProyecto, rutaHostRepo } = id
  const { commits, setEnRamaActual } = datos
  const { cargarRamaActual } = cargadores
  useEffect(() => {
    if (rutaHostProyecto === null || commits === null || commits.length === 0) {
      setEnRamaActual(SIN_HASHES)
      return
    }
    let cancelado = false
    void cargarRamaActual(
      commits.map((c) => c.hash),
      () => !cancelado
    )
    return () => {
      cancelado = true
    }
  }, [rutaHostProyecto, rutaHostRepo, commits, cargarRamaActual, setEnRamaActual])
}

/**
 * Recarga tras un commit o tras tocar HEAD/refs (`commitTick`). Efecto APARTE de los de
 * reconciliación: un commit no debe resetear lo que estás mirando.
 */
function useRecargaPorTick({ id, commitTick, filtros, cargadores }: ParametrosSincronizacion): void {
  const { rutaHostProyecto, rutaHostRepo } = id
  const { cargarCommits, cargarRamas } = cargadores
  useEffect(() => {
    if (!commitTick || rutaHostProyecto === null) return
    let cancelado = false
    if (rutaHostRepo) purgarRepo(rutaHostRepo)
    void cargarCommits(filtros.rama, () => !cancelado)
    void cargarRamas(() => !cancelado)
    return () => {
      cancelado = true
    }
    // Solo `commitTick` dispara la recarga; cambiar de rama ya recarga por su cuenta y
    // meter la rama y los cargadores en las deps duplicaría el fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitTick])
}

/** Los efectos de sincronización del log, en su orden. */
export function useSincronizacionLog(p: ParametrosSincronizacion): void {
  useReconciliacionLog(p)
  useTinteRamaActual(p)
  useRecargaPorTick(p)
}
