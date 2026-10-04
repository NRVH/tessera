// =============================================================================
// Vista del visor de imágenes: zoom, pan, rotación y ajuste al área.
// Mientras está en modo «ajustar» un redimensionado re-ajusta; un zoom o pan manual lo
// desactiva. Lo usa `useImageViewer`.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { IDENTITY, vistaAjustada, zoomAnclado } from './imageViewerGestos'
import { useGestosImagen } from './useGestosImagen'
import type { ViewTransform } from './imageViewerGestos'

interface EntradaZoomPan {
  visible: boolean
  loading: boolean
  error: string | null
  showSource: boolean
}

/** Estado y acciones de la vista de la imagen; `alCargar` ajusta con las medidas recién decodificadas. */
export function useZoomPanImagen({ visible, loading, error, showSource }: EntradaZoomPan) {
  // Dimensiones naturales (px) de la imagen ya decodificada; 0 hasta que carga.
  const [nat, setNat] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [view, setView] = useState<ViewTransform>(IDENTITY)
  const [rotation, setRotation] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  // Espejos para los manejadores nativos, que leen el valor vivo sin re-suscribirse.
  const viewRef = useRef(view)
  viewRef.current = view
  const rotationRef = useRef(rotation)
  rotationRef.current = rotation
  const natRef = useRef(nat)
  natRef.current = nat
  const fitModeRef = useRef(true)

  // Escala para que la imagen quepa entera y la centra. Con el área oculta (0 px) no hace
  // nada: se reintenta al mostrarse, vía el ResizeObserver o el efecto de `visible`.
  const applyFit = useCallback(() => {
    const stage = stageRef.current
    const ajustada = stage && vistaAjustada(stage, natRef.current, rotationRef.current)
    if (!ajustada) return
    fitModeRef.current = true
    setView(ajustada)
  }, [])

  const zoomBy = useCallback((factor: number, dx = 0, dy = 0) => {
    const next = zoomAnclado(viewRef.current, factor, dx, dy)
    if (!next) return
    fitModeRef.current = false
    setView(next)
  }, [])

  const gestos = useGestosImagen({
    stageRef, viewRef, fitModeRef, setView, zoomBy, applyFit, visible, showSource, loading, error
  })

  // Tras rotar se re-ajusta, con las dimensiones ya intercambiadas.
  useEffect(() => {
    if (nat.w && nat.h) applyFit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation])

  const reiniciar = useCallback(() => {
    setNat({ w: 0, h: 0 })
    setRotation(0)
    setView(IDENTITY)
    fitModeRef.current = true
  }, [])

  function alCargar(e: SyntheticEvent<HTMLImageElement>): boolean {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (!w || !h) return false
    setNat({ w, h })
    // applyFit lee natRef, aún sin actualizar en este commit: se ajusta con las medidas recién obtenidas.
    const ajustada = stageRef.current && vistaAjustada(stageRef.current, { w, h }, 0)
    if (ajustada) {
      fitModeRef.current = true
      setView(ajustada)
    }
    return true
  }

  const rotate = (): void => setRotation((r) => (r + 90) % 360)

  return {
    ...gestos,
    nat, view, rotation, stageRef, fitModeRef, applyFit, zoomBy, rotate, reiniciar, alCargar
  }
}
