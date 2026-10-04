// =============================================================================
// Gestos del escenario de imagen: rueda (zoom), arrastre (pan) y reajuste al redimensionar o mostrarse.
// Los refs y setters que recibe son estables; figuran en las dependencias solo por el linter.
// Lo usa `useZoomPanImagen`.
// =============================================================================

import { useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { engancharArrastre, engancharRueda } from './imageViewerGestos'
import type { Arrastre, ViewTransform } from './imageViewerGestos'

interface EntradaGestos {
  stageRef: MutableRefObject<HTMLDivElement | null>
  viewRef: MutableRefObject<ViewTransform>
  fitModeRef: MutableRefObject<boolean>
  setView: Dispatch<SetStateAction<ViewTransform>>
  zoomBy: (factor: number, dx?: number, dy?: number) => void
  applyFit: () => void
  visible: boolean
  showSource: boolean
  loading: boolean
  error: string | null
}

/** Engancha rueda, arrastre y ResizeObserver al escenario; devuelve los manejadores del pan y del doble clic. */
export function useGestosImagen(e: EntradaGestos) {
  const { stageRef, viewRef, fitModeRef, setView, zoomBy, applyFit, visible, showSource, loading, error } = e
  const dragRef = useRef<Arrastre | null>(null)
  const draggingClassRef = useRef(false)

  // showSource/error re-montan el .image-stage (elemento nuevo): hay que reenganchar.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    return engancharRueda(stage, zoomBy)
  }, [stageRef, zoomBy, showSource, error])

  useEffect(
    () => engancharArrastre({ dragRef, draggingClassRef, stageRef, fitModeRef, setView }),
    [stageRef, fitModeRef, setView]
  )

  // Re-ajusta al redimensionar el área solo si seguimos en modo «ajustar».
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => {
      if (fitModeRef.current) applyFit()
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [stageRef, fitModeRef, applyFit, showSource, error])

  // Al hacerse visible (el área pasa de display:none a tener tamaño): re-ajusta si toca.
  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => {
      if (fitModeRef.current) applyFit()
    })
    return () => cancelAnimationFrame(raf)
  }, [visible, fitModeRef, applyFit])

  function onPointerDown(ev: ReactPointerEvent): void {
    if (ev.button !== 0 || error || loading) return
    const { tx, ty } = viewRef.current
    dragRef.current = { startX: ev.clientX, startY: ev.clientY, baseTx: tx, baseTy: ty }
  }

  function actualSize(): void {
    fitModeRef.current = false
    setView({ scale: 1, tx: 0, ty: 0 })
  }

  // Doble clic alterna: si estamos ajustados, ve a 100 %; si no, ajusta.
  function onDoubleClick(): void {
    if (error || loading) return
    if (fitModeRef.current) actualSize()
    else applyFit()
  }

  return { onPointerDown, onDoubleClick, actualSize }
}
