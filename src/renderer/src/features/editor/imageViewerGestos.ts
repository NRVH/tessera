// =============================================================================
// Gestos y matemática del visor de imágenes: rueda con anclaje al cursor, arrastre y ajuste.
// Origen de la transformación en el CENTRO: rotar y escalar no lo mueven, así que el anclaje
// al cursor no depende de la rotación. Lo usa `useZoomPanImagen`.
// =============================================================================

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

/** Transformación de la vista: escala y desplazamiento del centro de la imagen. */
export interface ViewTransform {
  scale: number
  /** Desplazamiento en píxeles de pantalla del centro de la imagen respecto al del área. */
  tx: number
  ty: number
}

export const IDENTITY: ViewTransform = { scale: 1, tx: 0, ty: 0 }

/** Límites de zoom: del 5 % (imágenes enormes) al 6400 % (inspeccionar píxeles). */
const MIN_SCALE = 0.05
const MAX_SCALE = 64
/** Factor por muesca de rueda / clic en los botones de zoom. */
export const ZOOM_STEP = 1.15

/** Estado de un arrastre en curso. */
export interface Arrastre {
  startX: number
  startY: number
  baseTx: number
  baseTy: number
}

/** Dimensiones visibles (px) según la rotación: en 90/270 se intercambian ancho y alto. */
function dimsVisibles(w: number, h: number, rot: number): { w: number; h: number } {
  return rot % 180 === 0 ? { w, h } : { w: h, h: w }
}

/** Escala para que una imagen w×h quepa entera en el área, sin ampliar más allá del 100 %. */
function escalaAjustada(cw: number, ch: number, w: number, h: number): number {
  const scale = Math.min(cw / w, ch / h, 1)
  return scale > 0 ? scale : 1
}

/**
 * Vista que centra la imagen y la hace caber entera en el área medida. Null si aún no hay
 * medidas o el área está oculta (0 px): se reintentará al mostrarse.
 */
export function vistaAjustada(
  stage: HTMLElement,
  nat: { w: number; h: number },
  rot: number
): ViewTransform | null {
  const cw = stage.clientWidth
  const ch = stage.clientHeight
  if (!nat.w || !nat.h || cw <= 0 || ch <= 0) return null
  const d = dimsVisibles(nat.w, nat.h, rot)
  return { scale: escalaAjustada(cw, ch, d.w, d.h), tx: 0, ty: 0 }
}

/**
 * Zoom por un factor anclado a (dx, dy), relativo al centro del área. Mantener fijo el
 * punto bajo el cursor es t' = d·(1−k) + t·k, con k = escala'/escala. Devuelve null si el
 * zoom no cambia nada (tope alcanzado).
 */
export function zoomAnclado(
  v: ViewTransform,
  factor: number,
  dx: number,
  dy: number
): ViewTransform | null {
  const ns = Math.min(Math.max(v.scale * factor, MIN_SCALE), MAX_SCALE)
  if (ns === v.scale) return null
  const k = ns / v.scale
  return { scale: ns, tx: dx * (1 - k) + v.tx * k, ty: dy * (1 - k) + v.ty * k }
}

/**
 * Rueda del ratón como zoom anclado al cursor. Listener nativo con `passive: false`: React
 * registra `onWheel` como pasivo y ahí `preventDefault` no surte efecto.
 */
export function engancharRueda(
  stage: HTMLElement,
  zoomBy: (factor: number, dx: number, dy: number) => void
): () => void {
  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const rect = stage.getBoundingClientRect()
    const dx = e.clientX - rect.left - rect.width / 2
    const dy = e.clientY - rect.top - rect.height / 2
    zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, dx, dy)
  }
  stage.addEventListener('wheel', onWheel, { passive: false })
  return () => stage.removeEventListener('wheel', onWheel)
}

interface EntradaArrastre {
  dragRef: MutableRefObject<Arrastre | null>
  draggingClassRef: MutableRefObject<boolean>
  stageRef: MutableRefObject<HTMLDivElement | null>
  fitModeRef: MutableRefObject<boolean>
  setView: Dispatch<SetStateAction<ViewTransform>>
}

/**
 * Arrastrar para desplazar. Sigue al ratón fuera del área (listeners en window) para no
 * perder el arrastre si el cursor se sale.
 */
export function engancharArrastre(e: EntradaArrastre): () => void {
  const { dragRef, draggingClassRef, stageRef, fitModeRef, setView } = e
  function onMove(ev: PointerEvent): void {
    const d = dragRef.current
    if (!d) return
    const ntx = d.baseTx + (ev.clientX - d.startX)
    const nty = d.baseTy + (ev.clientY - d.startY)
    // Marca "arrastrando" para el cursor y desactiva el ajuste automático.
    if (!draggingClassRef.current) {
      stageRef.current?.classList.add('dragging')
      draggingClassRef.current = true
      fitModeRef.current = false
    }
    setView((v) => ({ ...v, tx: ntx, ty: nty }))
  }
  function onUp(): void {
    if (!dragRef.current) return
    dragRef.current = null
    stageRef.current?.classList.remove('dragging')
    draggingClassRef.current = false
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  return () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
}
