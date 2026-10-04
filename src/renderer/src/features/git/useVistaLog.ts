// =============================================================================
// Lo derivado de los commits cargados en el panel de Log: lista filtrada, grafo, chips,
// ancho de la columna de autor, coincidencias de la búsqueda y memoria del cursor.
// Los llama `useEstadoLog` en orden; los filtros de cliente están en `modelo/filtrosLog`.
// Decisiones: docs/decisiones/git/log-filtros-y-grafo.md
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { anchoColumnaAutorPx } from './modelo/anchoColumnas'
import { recordarSeleccion, seleccionARestaurar } from './modelo/cacheGit'
import {
  aplicarFiltros,
  autoresDe,
  indiceDeHash,
  interpretarBusqueda,
  type AutorConteo,
  type Busqueda,
  type FiltrosLog
} from './modelo/filtrosLog'
import type { GraphLayout } from './modelo/graphLayout'
import { chipsDeRefs, type Chip } from './modelo/refsCommit'
import { reescribirPadres } from './modelo/reescribirPadres'
import { useGraphLayout } from './modelo/useGraphLayout'
import { revelarIndice, type SeleccionLog } from './useSeleccionLog'
import type { Branch, Commit } from '../../../../shared/git-ipc'

export interface VistaFiltrada {
  busqueda: Busqueda
  /** Commits que pasan los filtros de cliente, o null mientras no hay lista. */
  visibles: readonly Commit[] | null
  layout: GraphLayout
  autores: AutorConteo[]
  chipsPorHash: Map<string, Chip[]>
  /** Cuántas coincidencias hay (en los dos modos: la lista visible ES el conjunto). */
  coincidencias: number
}

/** Lista visible, grafo con padres reescritos, autores y chips de refs. */
export function useVistaFiltrada(p: {
  commits: Commit[] | null
  filtros: FiltrosLog
  consulta: string
  branches: Branch[] | null
}): VistaFiltrada {
  const { commits, filtros, consulta, branches } = p
  const busqueda = useMemo(() => interpretarBusqueda(consulta), [consulta])
  // El «ahora» del filtro de fecha se lee DENTRO del memo: la hora buena es la del
  // momento en que cambia algo real.
  const visibles = useMemo(
    () => (commits === null ? null : aplicarFiltros(commits, filtros, busqueda, Date.now())),
    [commits, filtros, busqueda]
  )
  // Sin reescribir los padres, filtrar abriría lanes que nunca cierran.
  const entradaGrafo = useMemo(
    () => (commits === null || visibles === null ? null : reescribirPadres(commits, visibles)),
    [commits, visibles]
  )
  const layout = useGraphLayout(entradaGrafo)
  const autores = useMemo(() => autoresDe(commits ?? []), [commits])
  const chipsPorHash = useMemo(() => {
    const m = new Map<string, Chip[]>()
    for (const c of visibles ?? []) {
      if (c.refs.length > 0) m.set(c.hash, chipsDeRefs(c.refs, branches ?? []))
    }
    return m
  }, [visibles, branches])
  const coincidencias = busqueda.modo === 'vacio' ? 0 : (visibles?.length ?? 0)
  return { busqueda, visibles, layout, autores, chipsPorHash, coincidencias }
}

/**
 * Ancho de la columna de AUTOR, medido con la fuente real de la celda. Se calcula sobre
 * todo lo cargado y no sobre lo visible: el ancho es del repo, no de la consulta.
 */
export function useAnchoAutor(
  commits: Commit[] | null,
  altoFila: number
): { centroRef: React.MutableRefObject<HTMLDivElement | null>; anchoAutorPx: number | null } {
  const centroRef = useRef<HTMLDivElement | null>(null)
  const [anchoAutorPx, setAnchoAutorPx] = useState<number | null>(null)
  useLayoutEffect(() => {
    const centro = centroRef.current
    if (centro === null) return
    // Fuente de una celda real si ya hay filas; si no, del contenedor.
    const muestra = centro.querySelector('.git-commit-autor') ?? centro
    const cs = getComputedStyle(muestra)
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx === null) return
    ctx.font = cs.font !== '' ? cs.font : `${cs.fontSize} ${cs.fontFamily}`
    const padH = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
    setAnchoAutorPx(
      anchoColumnaAutorPx(commits ?? [], {
        medir: (t) => ctx.measureText(t).width,
        // Sin filas no hay padding que leer: la celda reserva 10px por la derecha.
        paddingPx: muestra === centro ? 10 : padH
      })
    )
    // `altoFila` cambia con el tamaño de letra, que es cuando hay que volver a medir.
  }, [commits, altoFila])
  return { centroRef, anchoAutorPx }
}

/**
 * Modo hash (deja el cursor en la coincidencia), rescate de la selección, posición de la
 * coincidencia enfocada y salto entre coincidencias.
 */
export function useCoincidenciasLog(p: {
  busqueda: Busqueda
  visibles: readonly Commit[] | null
  sel: SeleccionLog
}): { posCoincidencia: number; saltarCoincidencia: (delta: 1 | -1) => void } {
  const { busqueda, visibles, sel } = p
  const { hashSeleccionado, setHashSeleccionado, setRutaSeleccionada, setRevelar, cancelarAuto } = sel
  const [posCoincidencia, setPosCoincidencia] = useState(0)
  useEffect(() => {
    if (busqueda.modo !== 'hash' || !visibles) return
    const i = indiceDeHash(visibles, busqueda.hash)
    if (i === -1) return
    setHashSeleccionado(visibles[i].hash)
    setRevelar(revelarIndice(i))
  }, [busqueda, visibles, setHashSeleccionado, setRevelar])

  // Rescate: si el commit seleccionado desapareció al filtrar, la selección va al primero.
  // No pisa la selección en los refrescos y no abre nada.
  useEffect(() => {
    if (!visibles || visibles.length === 0) return
    if (hashSeleccionado === null) return
    if (visibles.some((c) => c.hash === hashSeleccionado)) return
    setHashSeleccionado(visibles[0].hash)
  }, [visibles, hashSeleccionado, setHashSeleccionado])

  // Al cambiar el conjunto visible, la navegación de coincidencias vuelve al inicio.
  useEffect(() => {
    setPosCoincidencia(visibles && visibles.length > 0 ? 1 : 0)
  }, [visibles])

  const saltarCoincidencia = useCallback(
    (delta: 1 | -1): void => {
      if (!visibles || visibles.length === 0) return
      // Ciclo 1..n, envolviendo por los dos extremos.
      const siguiente = ((posCoincidencia - 1 + delta + visibles.length) % visibles.length) + 1
      setPosCoincidencia(siguiente)
      setRevelar(revelarIndice(siguiente - 1))
      // Navegar entre coincidencias es leer el log: no abre nada.
      setHashSeleccionado(visibles[siguiente - 1].hash)
      setRutaSeleccionada(null)
      cancelarAuto()
    },
    [visibles, posCoincidencia, cancelarAuto, setRevelar, setHashSeleccionado, setRutaSeleccionada]
  )
  return { posCoincidencia, saltarCoincidencia }
}

/**
 * «Dónde me quedé»: restaura el cursor una vez por repo y apunta cada movimiento. Ambas
 * guardas exigen que la pareja lista/repo sea del mismo repo.
 * Devuelve la ruta que se revelará cuando el hijo eleve las filas de su commit.
 */
export function useMemoriaCursor(p: {
  repoHostPath: string | null
  repoDeCommits: string | null
  commits: Commit[] | null
  visibles: readonly Commit[] | null
  sel: SeleccionLog
}): { current: string | null } {
  const { repoHostPath, repoDeCommits, commits, visibles, sel } = p
  const { hashSeleccionado, rutaSeleccionada, setHashSeleccionado, setRutaSeleccionada, setRevelar } = sel
  // Repo cuya memoria ya se consumió: restaurar con cada cambio de `commits` devolvería
  // el cursor a donde estaba cada pocos segundos.
  const repoRestauradoRef = useRef<string | null>(null)
  const revelarRutaPendienteRef = useRef<string | null>(null)
  useEffect(() => {
    if (repoHostPath === null || commits === null) return
    if (repoDeCommits !== repoHostPath) return
    if (repoRestauradoRef.current === repoHostPath) return
    repoRestauradoRef.current = repoHostPath
    const seleccion = seleccionARestaurar(repoHostPath, commits)
    if (seleccion === null) return
    setHashSeleccionado(seleccion.hash)
    setRutaSeleccionada(seleccion.ruta)
    const i = visibles?.findIndex((c) => c.hash === seleccion.hash) ?? -1
    if (i >= 0) setRevelar(revelarIndice(i))
    // El archivo se revela más tarde: su lista la carga el hijo. Restaurar no abre nada.
    revelarRutaPendienteRef.current = seleccion.ruta
  }, [repoHostPath, repoDeCommits, commits, visibles, setHashSeleccionado, setRutaSeleccionada, setRevelar])

  // Un hash nulo NO borra la memoria: `limpiarSeleccion` lo pone a null al cambiar de rama.
  useEffect(() => {
    if (hashSeleccionado === null) return
    if (repoDeCommits !== repoHostPath) return
    recordarSeleccion(repoHostPath, { hash: hashSeleccionado, ruta: rutaSeleccionada })
  }, [repoHostPath, repoDeCommits, hashSeleccionado, rutaSeleccionada])
  return revelarRutaPendienteRef
}
