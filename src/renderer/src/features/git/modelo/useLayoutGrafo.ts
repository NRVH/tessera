// =============================================================================
// useLayoutGrafo: calcula el layout del grafo sin bloquear el hilo de UI. Híbrido por
// tamaño: hasta `UMBRAL_SINCRONO` commits, síncrono y memoizado; por encima, en el worker
// `layoutGrafo.worker`, con un `id` monótono que descarta las respuestas viejas. Un layout
// vacío un instante es seguro: `CeldaGrafo` no dibuja filas sin dato.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import TrabajadorLayoutGrafo from './layoutGrafo.worker?worker'
import { calcularLayoutGrafo, type EntradaCommitGrafo, type LayoutGrafo } from './layoutGrafo'

const LAYOUT_VACIO: LayoutGrafo = { filas: [], cantidadCarriles: 0 }
const LISTA_VACIA: readonly EntradaCommitGrafo[] = []

/**
 * Umbral (nº de commits) por encima del cual el layout se calcula en el worker en
 * vez de en el hilo de UI. El fetch normal está topado en 2000; el historial
 * completo lo supera holgadamente. 3000 deja el caso normal siempre síncrono.
 */
const UMBRAL_SINCRONO = 3000

export function useLayoutGrafo(commits: readonly EntradaCommitGrafo[] | null): LayoutGrafo {
  const lista = commits ?? LISTA_VACIA
  const small = lista.length <= UMBRAL_SINCRONO

  // Camino SÍNCRONO (caso normal): memoizado por identidad de la lista.
  const layoutSincrono = useMemo(() => (small ? calcularLayoutGrafo(lista) : null), [small, lista])

  // Camino ASÍNCRONO (historial completo): worker + descarte de respuestas viejas.
  // El layout se guarda ATADO a la LISTA para la que se calculó: mientras el worker
  // recomputa una lista nueva, NO se devuelve el layout de la lista anterior (sus
  // filas mapearían a la geometría equivocada al indexar por índice de fila). Se
  // devuelve vacío hasta que llega el layout de ESTA lista.
  const [estadoAsincrono, setEstadoAsincrono] = useState<{
    layout: LayoutGrafo
    lista: readonly EntradaCommitGrafo[]
  }>({ layout: LAYOUT_VACIO, lista: LISTA_VACIA })
  const trabajadorRef = useRef<Worker | null>(null)
  const peticionRef = useRef(0)
  // Lista pendiente por id de petición: al responder el worker sabemos a qué lista
  // pertenece su layout (el onmessage se registra una vez; lee refs, siempre al día).
  const pendienteRef = useRef<Map<number, readonly EntradaCommitGrafo[]>>(new Map())

  useEffect(() => {
    if (small) return
    if (!trabajadorRef.current) {
      trabajadorRef.current = new TrabajadorLayoutGrafo()
      trabajadorRef.current.onmessage = (e: MessageEvent<{ id: number; layout: LayoutGrafo }>): void => {
        const listaPeticion = pendienteRef.current.get(e.data.id)
        pendienteRef.current.delete(e.data.id)
        if (e.data.id === peticionRef.current && listaPeticion) {
          setEstadoAsincrono({ layout: e.data.layout, lista: listaPeticion })
        }
      }
    }
    const id = ++peticionRef.current
    pendienteRef.current.set(id, lista)
    // Envía SOLO los campos que el layout necesita, para minimizar el
    // structured-clone hacia el worker. `padresSaltados` va SOLO cuando existe
    // (log filtrado): omitirlo dejaría las líneas que atraviesan commits ocultos
    // sin puntear, y únicamente en repos grandes —el camino síncrono sí las
    // pintaba—, que es la clase de incoherencia imposible de diagnosticar.
    trabajadorRef.current.postMessage({
      id,
      commits: lista.map((c) =>
        c.padresSaltados
          ? { hash: c.hash, parents: c.padres, padresSaltados: c.padresSaltados }
          : { hash: c.hash, parents: c.padres }
      )
    })
  }, [small, lista])

  // Termina el worker al desmontar el panel (libera el hilo del worker).
  useEffect(
    () => () => {
      trabajadorRef.current?.terminate()
      trabajadorRef.current = null
    },
    []
  )

  // Solo se sirve el layout async si es EL de la lista actual; si el worker aún
  // recomputa una lista nueva, vacío (el grafo no dibuja líneas para filas sin dato).
  return small ? (layoutSincrono as LayoutGrafo) : estadoAsincrono.lista === lista ? estadoAsincrono.layout : LAYOUT_VACIO
}
