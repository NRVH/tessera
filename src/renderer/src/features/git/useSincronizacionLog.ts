// =============================================================================
// Efectos que mantienen al día lo cargado del panel de Log: la reconciliación de commits y
// ramas, el tinte de la rama actual y la recarga por `commitTick`. Van en este orden.
// Los llama `useCargaLog`; no guardan estado propio.
// Decisiones: docs/decisiones/git/log-identidad-y-anclaje.md
// =============================================================================

import { useEffect, useRef } from 'react'
import { SIN_HASHES } from './constantesLog'
import { purgarRepo } from './modelo/cacheGit'
import type { FiltrosLog } from './modelo/filtrosLog'
import type { CargadoresLog, DatosLog, IdentidadLog } from './useCargaLog'

interface ParamsSincronizacion {
  id: IdentidadLog
  anclado: boolean
  commitTick: number | undefined
  filtros: FiltrosLog
  datos: DatosLog
  cargadores: CargadoresLog
}

/**
 * Si lo cargado no es de este repo y no hay nada en camino, lo pide. `anclado` va por
 * VALOR: es lo que despierta la carga cuando el backend termina de anclarse.
 */
function useReconciliacionLog({ id, anclado, datos, cargadores }: ParamsSincronizacion): void {
  const { projectHostPath, repoHostPath } = id
  const { repoDeCommits, repoDeBranches, repoDeCommitsRef, repoDeBranchesRef } = datos
  const { cargarCommits, cargarRamas, repoEnVueloRef, repoRamasEnVueloRef, repoFallidoRef } = cargadores
  useEffect(() => {
    if (projectHostPath === null || repoHostPath === null) return
    if (!anclado) return
    // Se lee la REF: en el mismo commit el estado sería el de antes de la recarga.
    if (repoDeCommitsRef.current === repoHostPath) return
    if (repoEnVueloRef.current === repoHostPath) return
    if (repoFallidoRef.current === repoHostPath) return // ya falló: no martillear
    let cancelado = false
    void cargarCommits(null, () => !cancelado)
    return () => {
      cancelado = true
    }
  }, [
    projectHostPath,
    repoHostPath,
    repoDeCommits,
    anclado,
    cargarCommits,
    repoDeCommitsRef,
    repoEnVueloRef,
    repoFallidoRef
  ])

  useEffect(() => {
    if (projectHostPath === null || repoHostPath === null) return
    if (!anclado) return
    if (repoDeBranchesRef.current === repoHostPath) return
    if (repoRamasEnVueloRef.current === repoHostPath) return
    let cancelado = false
    void cargarRamas(() => !cancelado)
    return () => {
      cancelado = true
    }
  }, [projectHostPath, repoHostPath, repoDeBranches, anclado, cargarRamas, repoDeBranchesRef, repoRamasEnVueloRef])
}

/**
 * El tinte de la rama actual, colgado de los commits YA CARGADOS: se pregunta por lo que
 * se pinta y se repite justo cuando la lista cambia.
 */
function useTinteRamaActual({ id, anclado, datos, cargadores }: ParamsSincronizacion): void {
  const { projectHostPath, repoHostPath } = id
  const { commits, setEnRamaActual } = datos
  const { cargarRamaActual } = cargadores
  useEffect(() => {
    if (projectHostPath === null || commits === null || commits.length === 0) {
      setEnRamaActual(SIN_HASHES)
      return
    }
    // `anclado` por valor: los commits pueden salir de la caché con el backend en otro sitio.
    if (!anclado) return
    let cancelado = false
    void cargarRamaActual(
      commits.map((c) => c.hash),
      () => !cancelado
    )
    return () => {
      cancelado = true
    }
  }, [projectHostPath, repoHostPath, commits, anclado, cargarRamaActual, setEnRamaActual])
}

/**
 * Recarga tras un commit o tras tocar HEAD/refs (`commitTick`) y, aparte, reproduce el tick
 * que llegó sin anclaje. Efectos APARTE de los de reconciliación: un commit no debe
 * resetear lo que estás mirando.
 */
function useRecargaPorTick({
  id,
  anclado,
  commitTick,
  filtros,
  datos,
  cargadores
}: ParamsSincronizacion): void {
  const { projectHostPath, repoHostPath, ancladoRef } = id
  const { repoDeCommits, repoDeCommitsRef } = datos
  const { cargarCommits, cargarRamas } = cargadores
  const tickPendienteRef = useRef<string | null>(null)
  useEffect(() => {
    if (!commitTick || projectHostPath === null) return
    // Sin anclaje se aplaza y NO se purga: la caché es lo que se está pintando y los
    // cargadores no traerían nada a cambio. Lo reproduce el efecto de abajo.
    if (!ancladoRef.current) {
      tickPendienteRef.current = repoHostPath
      return
    }
    let cancelado = false
    if (repoHostPath) purgarRepo(repoHostPath)
    void cargarCommits(filtros.rama, () => !cancelado)
    void cargarRamas(() => !cancelado)
    return () => {
      cancelado = true
    }
    // Solo `commitTick` dispara la recarga; cambiar de rama ya recarga por su cuenta y
    // meter la rama y los cargadores en las deps duplicaría el fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitTick])

  useEffect(() => {
    if (!anclado || projectHostPath === null || repoHostPath === null) return
    // Solo si el tick era de ESTE repo y los datos ya están emparejados (si no, la
    // reconciliación se despierta en este mismo flanco y ya lo pide).
    if (tickPendienteRef.current !== repoHostPath) return
    if (repoDeCommitsRef.current !== repoHostPath) return
    tickPendienteRef.current = null
    let cancelado = false
    purgarRepo(repoHostPath)
    void cargarCommits(filtros.rama, () => !cancelado)
    void cargarRamas(() => !cancelado)
    return () => {
      cancelado = true
    }
    // Mismas deps acotadas que el efecto anterior, más `anclado`, que es su flanco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anclado, projectHostPath, repoHostPath, repoDeCommits])
}

/** Los cinco efectos de sincronización del log, en su orden. */
export function useSincronizacionLog(p: ParamsSincronizacion): void {
  useReconciliacionLog(p)
  useTinteRamaActual(p)
  useRecargaPorTick(p)
}
