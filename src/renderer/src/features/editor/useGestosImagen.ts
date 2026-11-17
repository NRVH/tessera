// =============================================================================
// Gestos del escenario de imagen: rueda (zoom), arrastre (pan) y reajuste al redimensionar o mostrarse.
// Los refs y setters que recibe son estables; figuran en las dependencias solo por el linter.
// Lo usa `useZoomPanImagen`.
// =============================================================================

import { useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { engancharArrastre, engancharRueda } from './gestosVisorImagen'
import type { Arrastre, TransformacionVista } from './gestosVisorImagen'

interface EntradaGestos {
  stageRef: MutableRefObject<HTMLDivElement | null>
  vistaRef: MutableRefObject<TransformacionVista>
  modoAjusteRef: MutableRefObject<boolean>
  setVista: Dispatch<SetStateAction<TransformacionVista>>
  aplicarZoom: (factor: number, dx?: number, dy?: number) => void
  ajustarVista: () => void
  visible: boolean
  verCodigo: boolean
  cargando: boolean
  error: string | null
}

/** Engancha rueda, arrastre y ResizeObserver al escenario; devuelve los manejadores del pan y del doble clic. */
export function useGestosImagen(e: EntradaGestos) {
  const { stageRef, vistaRef, modoAjusteRef, setVista, aplicarZoom, ajustarVista, visible, verCodigo, cargando, error } = e
  const arrastreRef = useRef<Arrastre | null>(null)
  const claseArrastreRef = useRef(false)

  // verCodigo/error re-montan el .image-stage (elemento nuevo): hay que reenganchar.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    return engancharRueda(stage, aplicarZoom)
  }, [stageRef, aplicarZoom, verCodigo, error])

  useEffect(
    () => engancharArrastre({ arrastreRef, claseArrastreRef, stageRef, modoAjusteRef, setVista }),
    [stageRef, modoAjusteRef, setVista]
  )

  // Re-ajusta al redimensionar el área solo si seguimos en modo «ajustar».
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => {
      if (modoAjusteRef.current) ajustarVista()
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [stageRef, modoAjusteRef, ajustarVista, verCodigo, error])

  // Al hacerse visible (el área pasa de display:none a tener tamaño): re-ajusta si toca.
  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => {
      if (modoAjusteRef.current) ajustarVista()
    })
    return () => cancelAnimationFrame(raf)
  }, [visible, modoAjusteRef, ajustarVista])

  function alPulsarPuntero(ev: ReactPointerEvent): void {
    if (ev.button !== 0 || error || cargando) return
    const { tx, ty } = vistaRef.current
    arrastreRef.current = { inicioX: ev.clientX, inicioY: ev.clientY, baseTx: tx, baseTy: ty }
  }

  function tamanoReal(): void {
    modoAjusteRef.current = false
    setVista({ escala: 1, tx: 0, ty: 0 })
  }

  // Doble clic alterna: si estamos ajustados, ve a 100 %; si no, ajusta.
  function alDobleClic(): void {
    if (error || cargando) return
    if (modoAjusteRef.current) tamanoReal()
    else ajustarVista()
  }

  return { onPointerDown: alPulsarPuntero, onDoubleClick: alDobleClic, tamanoReal }
}
