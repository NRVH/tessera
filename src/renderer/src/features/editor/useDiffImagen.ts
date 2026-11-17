// =============================================================================
// Estado y carga de PaneDiffImagen: los dos lados, sus medidas y los object-URL.
// Solo pide el pane del proyecto activo, y el tick del watcher solo cuenta si un lado es mutable.
// Es un hook del mismo pane (no un hijo) para conservar el orden de estados y efectos.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import { VACIO, ladoMutable, leerLados, revocarUrls } from './cargaDiffImagen'
import type { LadoCargado, Medidas } from './cargaDiffImagen'
import type { DestinoDiff } from './diffEditorTipos'

interface EntradaDiffImagen {
  destino: DestinoDiff
  claveDestino: string
  claveDestinoActivo: string
  fsTick: number
}

/** Estado del diff de imagen: lados cargados, medidas, legibilidad y estado de la carga. */
export function useDiffImagen({ destino, claveDestino, claveDestinoActivo, fsTick }: EntradaDiffImagen) {
  const [antes, setAntes] = useState<LadoCargado>(VACIO)
  const [despues, setDespues] = useState<LadoCargado>(VACIO)
  const [medAntes, setMedAntes] = useState<Medidas | null>(null)
  const [medDespues, setMedDespues] = useState<Medidas | null>(null)
  const [ilegAntes, setIlegAntes] = useState(false)
  const [ilegDespues, setIlegDespues] = useState(false)
  // Sin esta guarda el pane se engancharía al tick global y un diff de historial parpadearía.
  const tick = ladoMutable(destino) ? fsTick : 0
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Espejo en ref: el cleanup no debe capturar el estado, o revocaría la URL de otra carga.
  const urlsRef = useRef<string[]>([])
  const raiz = useRaizDelProyecto()

  useEffect(() => {
    // Los panes de otro proyecto no piden: se despiertan al volver a ser el activo.
    if (claveDestino !== claveDestinoActivo) return
    let cancelado = false
    setCargando(true)
    setError(null)
    setMedAntes(null)
    setMedDespues(null)
    setIlegAntes(false)
    setIlegDespues(false)

    async function cargar(): Promise<void> {
      try {
        const [a, d] = await leerLados(destino, raiz, urlsRef)
        if (cancelado) {
          for (const u of [a.url, d.url]) if (u) URL.revokeObjectURL(u)
          return
        }
        setAntes(a)
        setDespues(d)
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelado) setCargando(false)
      }
    }
    void cargar()

    return () => {
      cancelado = true
      revocarUrls(urlsRef)
    }
    // `target` es un objeto nuevo en cada render (se construye en el JSX de `PaneDePestana`):
    // depender de él relanzaría la carga en cada render. Se depende de sus campos primitivos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    destino.ruta,
    destino.antes.origen,
    destino.antes.hash,
    destino.antes.ruta,
    destino.despues.origen,
    destino.despues.hash,
    destino.despues.ruta,
    raiz,
    tick,
    // Despiertan al pane dormido cuando su proyecto vuelve a ser el activo.
    claveDestino,
    claveDestinoActivo
  ])

  return {
    antes, despues, medAntes, medDespues, ilegAntes, ilegDespues, cargando, error,
    setMedAntes, setMedDespues, setIlegAntes, setIlegDespues
  }
}
