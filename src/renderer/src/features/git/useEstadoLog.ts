// =============================================================================
// Compone el estado del panel de Log llamando a los hooks de la carga, la selección, lo
// derivado, la apertura y el teclado EN ESTE ORDEN: el de los efectos es el que tenía el
// componente y decide cuándo se pide, se selecciona y se abre.
// Lo llama `GitLogPanel`; no pinta nada.
// Decisiones: docs/decisiones/git/log-identidad-y-anclaje.md
// =============================================================================

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { purgarRepo } from './modelo/cacheGit'
import { FILTROS_VACIOS, type FiltrosLog } from './modelo/filtrosLog'
import { computeRepoLabels } from './modelo/rutasArchivo'
import {
  useCargaLog,
  useIdentidadLog,
  type CargadoresLog,
  type DatosLog,
  type IdentidadLog
} from './useCargaLog'
import {
  useAperturaLog,
  useAutoApertura,
  useCopiaHash,
  useDerivadosSeleccion,
  useSeleccionarArchivo
} from './useAperturaLog'
import { useSeleccionLog, type SeleccionLog } from './useSeleccionLog'
import { useTeclasLog } from './useTeclasLog'
import { useAnchoAutor, useCoincidenciasLog, useMemoriaCursor, useVistaFiltrada } from './useVistaLog'
import type { GitLogPanelProps } from './GitLogPanel'

/** ¿Se mira el HISTORIAL de un archivo o el log? Local del panel; qué archivo vive en el store. */
function useVistaHistorial(
  historial: string | null,
  historialToken: number
): { vistaHistorial: boolean; setVistaHistorial: Dispatch<SetStateAction<boolean>> } {
  const [vistaHistorial, setVistaHistorial] = useState(false)
  // Abrir un historial LLEVA a él; el token hace que pedir dos veces el mismo también.
  useEffect(() => {
    if (historial !== null) setVistaHistorial(true)
  }, [historial, historialToken])
  return { vistaHistorial, setVistaHistorial }
}

/** Cambio de filtros y recarga: el único punto que escribe `filtros.rama`. */
function useAccionesFiltros(p: {
  id: IdentidadLog
  filtros: FiltrosLog
  setFiltros: Dispatch<SetStateAction<FiltrosLog>>
  cargadores: CargadoresLog
  limpiarSeleccion: () => void
}): {
  aplicarFiltrosNuevos: (f: FiltrosLog) => void
  seleccionarRama: (rama: string | null) => void
  recargar: () => void
} {
  const { id, filtros, setFiltros, cargadores, limpiarSeleccion } = p
  const { repoHostPath, ancladoRef } = id
  const { cargarCommits, cargarRamas } = cargadores
  const aplicarFiltrosNuevos = useCallback(
    (f: FiltrosLog): void => {
      const cambiaRama = f.rama !== filtros.rama
      // La rama es el único eje que resuelve el backend: sin poder recargar no se fija,
      // o el chip diría `feature/x` sobre la lista de `--all`.
      if (cambiaRama && !ancladoRef.current) return
      setFiltros(f)
      if (cambiaRama) {
        limpiarSeleccion()
        // Rama explícita: el estado aún no se ha aplicado.
        void cargarCommits(f.rama)
      }
    },
    [filtros.rama, cargarCommits, limpiarSeleccion, ancladoRef, setFiltros]
  )
  const seleccionarRama = useCallback(
    (rama: string | null): void => aplicarFiltrosNuevos({ ...filtros, rama }),
    [filtros, aplicarFiltrosNuevos]
  )
  const recargar = useCallback((): void => {
    // Sin anclaje no se purga: los cargadores se niegan solos, `purgarRepo` no, y el
    // botón destruiría la caché sin traer nada.
    if (!ancladoRef.current || !repoHostPath) return
    purgarRepo(repoHostPath)
    void cargarCommits(filtros.rama)
    void cargarRamas()
  }, [repoHostPath, cargarCommits, cargarRamas, filtros.rama, ancladoRef])
  return { aplicarFiltrosNuevos, seleccionarRama, recargar }
}

interface Compuesto {
  id: IdentidadLog
  datos: DatosLog
  cargadores: CargadoresLog
  filtros: FiltrosLog
  setFiltros: Dispatch<SetStateAction<FiltrosLog>>
  sel: SeleccionLog
}

/** Lo derivado de los commits, el cursor recordado y las coincidencias. */
function useVistaDelLog(props: GitLogPanelProps, c: Compuesto) {
  const { datos, filtros, sel } = c
  const vista = useVistaFiltrada({
    commits: datos.commits,
    filtros,
    consulta: props.consulta,
    branches: datos.branches
  })
  const ancho = useAnchoAutor(datos.commits, props.altoFila)
  const navegacion = useCoincidenciasLog({ busqueda: vista.busqueda, visibles: vista.visibles, sel })
  const revelarRutaPendienteRef = useMemoriaCursor({
    repoHostPath: c.id.repoHostPath,
    repoDeCommits: datos.repoDeCommits,
    commits: datos.commits,
    visibles: vista.visibles,
    sel
  })
  return { vista, ancho, navegacion, revelarRutaPendienteRef }
}

/** Aperturas, historial, copia del hash, apertura automática y teclado. */
function useGestosDelLog(
  props: GitLogPanelProps,
  c: Compuesto,
  v: ReturnType<typeof useVistaDelLog>
) {
  const { sel } = c
  const { visibles } = v.vista
  const apertura = useAperturaLog(props.onOpenDiff, sel, v.revelarRutaPendienteRef)
  const historial = useVistaHistorial(props.historial, props.historialToken)
  const copia = useCopiaHash(sel.hashSeleccionado, apertura.seleccionarCommit)
  const derivados = useDerivadosSeleccion(visibles, sel)
  const { commitSeleccionado, filasVigentes, indiceSeleccionado } = derivados
  const seleccionarArchivo = useSeleccionarArchivo({
    sel,
    filasVigentes,
    commitSeleccionado,
    programarApertura: apertura.programarApertura
  })
  useAutoApertura({ sel, filasVigentes, visibles, abrirDiff: apertura.abrirDiff })
  const teclas = useTeclasLog({
    sel,
    visibles,
    commitSeleccionado,
    filasVigentes,
    indiceSeleccionado,
    apertura,
    copiarHashDeCommit: copia.copiarHashDeCommit
  })
  return { apertura, historial, copia, commitSeleccionado, seleccionarArchivo, teclas }
}

/** Todo el estado y las acciones que necesita el árbol de componentes del panel. */
export function useEstadoLog(props: GitLogPanelProps) {
  const id = useIdentidadLog(props.activeProject, props.activeRepo, props.anclado)
  const [filtros, setFiltros] = useState<FiltrosLog>(FILTROS_VACIOS)
  const sel = useSeleccionLog()
  const { datos, cargadores } = useCargaLog({
    id,
    anclado: props.anclado,
    commitTick: props.commitTick,
    filtros,
    setFiltros,
    sel
  })
  const repoLabels = useMemo(
    () => (props.repos ? computeRepoLabels(props.repos) : new Map<string, string>()),
    [props.repos]
  )
  const c: Compuesto = { id, datos, cargadores, filtros, setFiltros, sel }
  const v = useVistaDelLog(props, c)
  const gestos = useGestosDelLog(props, c, v)
  const acciones = useAccionesFiltros({
    id,
    filtros,
    setFiltros,
    cargadores,
    limpiarSeleccion: sel.limpiarSeleccion
  })
  return { ...c, anclado: props.anclado, repoLabels, ...v, ...gestos, ...acciones }
}

export type EstadoLog = ReturnType<typeof useEstadoLog>
