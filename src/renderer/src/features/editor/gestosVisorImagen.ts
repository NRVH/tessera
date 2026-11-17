// =============================================================================
// Gestos y matemática del visor de imágenes: rueda con anclaje al cursor, arrastre y ajuste.
// Origen de la transformación en el CENTRO: rotar y escalar no lo mueven, así que el anclaje
// al cursor no depende de la rotación. Lo usa `useZoomPanImagen`.
// =============================================================================

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

/** Transformación de la vista: escala y desplazamiento del centro de la imagen. */
export interface TransformacionVista {
  escala: number
  /** Desplazamiento en píxeles de pantalla del centro de la imagen respecto al del área. */
  tx: number
  ty: number
}

export const IDENTIDAD: TransformacionVista = { escala: 1, tx: 0, ty: 0 }

/** Límites de zoom: del 5 % (imágenes enormes) al 6400 % (inspeccionar píxeles). */
const ESCALA_MIN = 0.05
const ESCALA_MAX = 64
/** Factor por muesca de rueda / clic en los botones de zoom. */
export const PASO_ZOOM = 1.15

/** Estado de un arrastre en curso. */
export interface Arrastre {
  inicioX: number
  inicioY: number
  baseTx: number
  baseTy: number
}

/** Dimensiones visibles (px) según la rotación: en 90/270 se intercambian ancho y alto. */
function dimsVisibles(w: number, h: number, rot: number): { w: number; h: number } {
  return rot % 180 === 0 ? { w, h } : { w: h, h: w }
}

/** Escala para que una imagen w×h quepa entera en el área, sin ampliar más allá del 100 %. */
function escalaAjustada(cw: number, ch: number, w: number, h: number): number {
  const escala = Math.min(cw / w, ch / h, 1)
  return escala > 0 ? escala : 1
}

/**
 * Vista que centra la imagen y la hace caber entera en el área medida. Null si aún no hay
 * medidas o el área está oculta (0 px): se reintentará al mostrarse.
 */
export function vistaAjustada(
  stage: HTMLElement,
  medidasNaturales: { w: number; h: number },
  rot: number
): TransformacionVista | null {
  const cw = stage.clientWidth
  const ch = stage.clientHeight
  if (!medidasNaturales.w || !medidasNaturales.h || cw <= 0 || ch <= 0) return null
  const d = dimsVisibles(medidasNaturales.w, medidasNaturales.h, rot)
  return { escala: escalaAjustada(cw, ch, d.w, d.h), tx: 0, ty: 0 }
}

/**
 * Zoom por un factor anclado a (dx, dy), relativo al centro del área. Mantener fijo el
 * punto bajo el cursor es t' = d·(1−k) + t·k, con k = escala'/escala. Devuelve null si el
 * zoom no cambia nada (tope alcanzado).
 */
export function zoomAnclado(
  v: TransformacionVista,
  factor: number,
  dx: number,
  dy: number
): TransformacionVista | null {
  const ns = Math.min(Math.max(v.escala * factor, ESCALA_MIN), ESCALA_MAX)
  if (ns === v.escala) return null
  const k = ns / v.escala
  return { escala: ns, tx: dx * (1 - k) + v.tx * k, ty: dy * (1 - k) + v.ty * k }
}

/**
 * Rueda del ratón como zoom anclado al cursor. Listener nativo con `passive: false`: React
 * registra `onWheel` como pasivo y ahí `preventDefault` no surte efecto.
 */
export function engancharRueda(
  stage: HTMLElement,
  aplicarZoom: (factor: number, dx: number, dy: number) => void
): () => void {
  function alGirarRueda(e: WheelEvent): void {
    e.preventDefault()
    const rect = stage.getBoundingClientRect()
    const dx = e.clientX - rect.left - rect.width / 2
    const dy = e.clientY - rect.top - rect.height / 2
    aplicarZoom(e.deltaY < 0 ? PASO_ZOOM : 1 / PASO_ZOOM, dx, dy)
  }
  stage.addEventListener('wheel', alGirarRueda, { passive: false })
  return () => stage.removeEventListener('wheel', alGirarRueda)
}

interface EntradaArrastre {
  arrastreRef: MutableRefObject<Arrastre | null>
  claseArrastreRef: MutableRefObject<boolean>
  stageRef: MutableRefObject<HTMLDivElement | null>
  modoAjusteRef: MutableRefObject<boolean>
  setVista: Dispatch<SetStateAction<TransformacionVista>>
}

/**
 * Arrastrar para desplazar. Sigue al ratón fuera del área (listeners en window) para no
 * perder el arrastre si el cursor se sale.
 */
export function engancharArrastre(e: EntradaArrastre): () => void {
  const { arrastreRef, claseArrastreRef, stageRef, modoAjusteRef, setVista } = e
  function alMover(ev: PointerEvent): void {
    const d = arrastreRef.current
    if (!d) return
    const ntx = d.baseTx + (ev.clientX - d.inicioX)
    const nty = d.baseTy + (ev.clientY - d.inicioY)
    // Marca "arrastrando" para el cursor y desactiva el ajuste automático.
    if (!claseArrastreRef.current) {
      stageRef.current?.classList.add('dragging')
      claseArrastreRef.current = true
      modoAjusteRef.current = false
    }
    setVista((v) => ({ ...v, tx: ntx, ty: nty }))
  }
  function alSoltar(): void {
    if (!arrastreRef.current) return
    arrastreRef.current = null
    stageRef.current?.classList.remove('dragging')
    claseArrastreRef.current = false
  }
  window.addEventListener('pointermove', alMover)
  window.addEventListener('pointerup', alSoltar)
  return () => {
    window.removeEventListener('pointermove', alMover)
    window.removeEventListener('pointerup', alSoltar)
  }
}
