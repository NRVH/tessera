// =============================================================================
// useGraphLayout: calcula el layout del grafo sin bloquear el hilo de UI. Híbrido por
// tamaño: hasta `SYNC_THRESHOLD` commits, síncrono y memoizado; por encima, en el worker
// `graphLayout.worker`, con un `id` monótono que descarta las respuestas viejas. Un layout
// vacío un instante es seguro: `CeldaGrafo` no dibuja filas sin dato.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import GraphLayoutWorker from './graphLayout.worker?worker'
import { computeGraphLayout, type GraphCommitInput, type GraphLayout } from './graphLayout'

const EMPTY_LAYOUT: GraphLayout = { rows: [], laneCount: 0 }
const EMPTY_LIST: readonly GraphCommitInput[] = []

/**
 * Umbral (nº de commits) por encima del cual el layout se calcula en el worker en
 * vez de en el hilo de UI. El fetch normal está topado en 2000; el historial
 * completo lo supera holgadamente. 3000 deja el caso normal siempre síncrono.
 */
const SYNC_THRESHOLD = 3000

export function useGraphLayout(commits: readonly GraphCommitInput[] | null): GraphLayout {
  const list = commits ?? EMPTY_LIST
  const small = list.length <= SYNC_THRESHOLD

  // Camino SÍNCRONO (caso normal): memoizado por identidad de la lista.
  const syncLayout = useMemo(() => (small ? computeGraphLayout(list) : null), [small, list])

  // Camino ASÍNCRONO (historial completo): worker + descarte de respuestas viejas.
  // El layout se guarda ATADO a la LISTA para la que se calculó: mientras el worker
  // recomputa una lista nueva, NO se devuelve el layout de la lista anterior (sus
  // filas mapearían a la geometría equivocada al indexar por índice de fila). Se
  // devuelve vacío hasta que llega el layout de ESTA lista.
  const [asyncState, setAsyncState] = useState<{
    layout: GraphLayout
    list: readonly GraphCommitInput[]
  }>({ layout: EMPTY_LAYOUT, list: EMPTY_LIST })
  const workerRef = useRef<Worker | null>(null)
  const reqRef = useRef(0)
  // Lista pendiente por id de petición: al responder el worker sabemos a qué lista
  // pertenece su layout (el onmessage se registra una vez; lee refs, siempre al día).
  const pendingRef = useRef<Map<number, readonly GraphCommitInput[]>>(new Map())

  useEffect(() => {
    if (small) return
    if (!workerRef.current) {
      workerRef.current = new GraphLayoutWorker()
      workerRef.current.onmessage = (e: MessageEvent<{ id: number; layout: GraphLayout }>): void => {
        const reqList = pendingRef.current.get(e.data.id)
        pendingRef.current.delete(e.data.id)
        if (e.data.id === reqRef.current && reqList) {
          setAsyncState({ layout: e.data.layout, list: reqList })
        }
      }
    }
    const id = ++reqRef.current
    pendingRef.current.set(id, list)
    // Envía SOLO los campos que el layout necesita, para minimizar el
    // structured-clone hacia el worker. `parentsSaltados` va SOLO cuando existe
    // (log filtrado): omitirlo dejaría las líneas que atraviesan commits ocultos
    // sin puntear, y únicamente en repos grandes —el camino síncrono sí las
    // pintaba—, que es la clase de incoherencia imposible de diagnosticar.
    workerRef.current.postMessage({
      id,
      commits: list.map((c) =>
        c.parentsSaltados
          ? { hash: c.hash, parents: c.parents, parentsSaltados: c.parentsSaltados }
          : { hash: c.hash, parents: c.parents }
      )
    })
  }, [small, list])

  // Termina el worker al desmontar el panel (libera el hilo del worker).
  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    []
  )

  // Solo se sirve el layout async si es EL de la lista actual; si el worker aún
  // recomputa una lista nueva, vacío (el grafo no dibuja líneas para filas sin dato).
  return small ? (syncLayout as GraphLayout) : asyncState.list === list ? asyncState.layout : EMPTY_LAYOUT
}
