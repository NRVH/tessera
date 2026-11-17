// =============================================================================
// Compone el estado del panel de Log llamando a los hooks de la carga, la selección, lo
// derivado, la apertura y el teclado EN ESTE ORDEN: el de los efectos es el que tenía el
// componente y decide cuándo se pide, se selecciona y se abre.
// Lo llama `PanelLogGit`; no pinta nada.
// Decisiones: docs/decisiones/git/log-identidad-y-anclaje.md
// =============================================================================

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { purgarRepo } from './modelo/cacheGit'
import type { FiltrosLog } from './modelo/filtrosLog'
import { useFiltrosDelRepo } from './useFiltrosDelRepo'
import { calcularEtiquetasRepos } from './modelo/rutasArchivo'
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
import type { PropsPanelLogGit } from './PanelLogGit'

/** ¿Se mira el HISTORIAL de un archivo o el log? Local del panel; qué archivo vive en el store. */
function useVistaHistorial(
  historial: string | null,
  historialToken: number
): { vistaHistorial: boolean; setVistaHistorial: Dispatch<SetStateAction<boolean>> } {
  const [vistaHistorial, setVistaHistorial] = useState(false)
  // Solo el gesto de abrir un historial (su token) LLEVA a él, también si se pide dos veces el mismo.
  // Que el proyecto que se ve traiga el suyo al volver no cambia la pestaña que se dejó.
  useEffect(() => {
    if (historialToken > 0) setVistaHistorial(true)
  }, [historialToken])
  return { vistaHistorial: vistaHistorial && historial !== null, setVistaHistorial }
}

/** Cambio de filtros y recarga: el único punto que escribe `filtros.rama`. */
function useAccionesFiltros(p: {
  id: IdentidadLog
  filtros: FiltrosLog
  setFiltros: (f: FiltrosLog) => void
  cargadores: CargadoresLog
  limpiarSeleccion: () => void
}): {
  aplicarFiltrosNuevos: (f: FiltrosLog) => void
  seleccionarRama: (rama: string | null) => void
  recargar: () => void
} {
  const { id, filtros, setFiltros, cargadores, limpiarSeleccion } = p
  const { rutaHostRepo } = id
  const { cargarCommits, cargarRamas } = cargadores
  const aplicarFiltrosNuevos = useCallback(
    (f: FiltrosLog): void => {
      const cambiaRama = f.rama !== filtros.rama
      setFiltros(f)
      if (cambiaRama) {
        limpiarSeleccion()
        // Rama explícita: el estado aún no se ha aplicado.
        void cargarCommits(f.rama)
      }
    },
    [filtros.rama, cargarCommits, limpiarSeleccion, setFiltros]
  )
  const seleccionarRama = useCallback(
    (rama: string | null): void => aplicarFiltrosNuevos({ ...filtros, rama }),
    [filtros, aplicarFiltrosNuevos]
  )
  const recargar = useCallback((): void => {
    if (!rutaHostRepo) return
    purgarRepo(rutaHostRepo)
    void cargarCommits(filtros.rama)
    void cargarRamas()
  }, [rutaHostRepo, cargarCommits, cargarRamas, filtros.rama])
  return { aplicarFiltrosNuevos, seleccionarRama, recargar }
}

interface Compuesto {
  id: IdentidadLog
  datos: DatosLog
  cargadores: CargadoresLog
  filtros: FiltrosLog
  setFiltros: (f: FiltrosLog) => void
  sel: SeleccionLog
}

/** Lo derivado de los commits, el cursor recordado y las coincidencias. */
function useVistaDelLog(props: PropsPanelLogGit, c: Compuesto) {
  const { datos, filtros, sel } = c
  const vista = useVistaFiltrada({
    commits: datos.commits,
    filtros,
    consulta: props.consulta,
    ramas: datos.ramas
  })
  const ancho = useAnchoAutor(datos.commits, props.altoFila)
  const navegacion = useCoincidenciasLog({ busqueda: vista.busqueda, visibles: vista.visibles, sel })
  const revelarRutaPendienteRef = useMemoriaCursor({
    rutaHostRepo: c.id.rutaHostRepo,
    repoDeCommits: datos.repoDeCommits,
    commits: datos.commits,
    visibles: vista.visibles,
    sel
  })
  return { vista, ancho, navegacion, revelarRutaPendienteRef }
}

/** Aperturas, historial, copia del hash, apertura automática y teclado. */
function useGestosDelLog(
  props: PropsPanelLogGit,
  c: Compuesto,
  v: ReturnType<typeof useVistaDelLog>
) {
  const { sel } = c
  const { visibles } = v.vista
  const apertura = useAperturaLog(props.onAbrirDiff, sel, v.revelarRutaPendienteRef)
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
export function useEstadoLog(props: PropsPanelLogGit) {
  const id = useIdentidadLog(props.proyectoActivo, props.repoActivo)
  const { filtros, setFiltros, olvidarRama } = useFiltrosDelRepo(id.rutaHostRepo)
  const sel = useSeleccionLog()
  const { datos, cargadores } = useCargaLog({
    id,
    commitTick: props.commitTick,
    filtros,
    olvidarRama,
    sel
  })
  const etiquetasRepos = useMemo(
    () => (props.repos ? calcularEtiquetasRepos(props.repos) : new Map<string, string>()),
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
  return { ...c, etiquetasRepos, ...v, ...gestos, ...acciones }
}

export type EstadoLog = ReturnType<typeof useEstadoLog>
