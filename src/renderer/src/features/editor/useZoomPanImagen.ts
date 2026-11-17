// =============================================================================
// Vista del visor de imágenes: zoom, pan, rotación y ajuste al área.
// Mientras está en modo «ajustar» un redimensionado re-ajusta; un zoom o pan manual lo
// desactiva. Lo usa `useVisorImagen`.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { IDENTIDAD, vistaAjustada, zoomAnclado } from './gestosVisorImagen'
import { useGestosImagen } from './useGestosImagen'
import type { TransformacionVista } from './gestosVisorImagen'

interface EntradaZoomPan {
  visible: boolean
  cargando: boolean
  error: string | null
  verCodigo: boolean
}

/** Estado y acciones de la vista de la imagen; `alCargar` ajusta con las medidas recién decodificadas. */
export function useZoomPanImagen({ visible, cargando, error, verCodigo }: EntradaZoomPan) {
  // Dimensiones naturales (px) de la imagen ya decodificada; 0 hasta que carga.
  const [medidasNaturales, setMedidasNaturales] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [vista, setVista] = useState<TransformacionVista>(IDENTIDAD)
  const [rotacion, setRotacion] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  // Espejos para los manejadores nativos, que leen el valor vivo sin re-suscribirse.
  const vistaRef = useRef(vista)
  vistaRef.current = vista
  const rotacionRef = useRef(rotacion)
  rotacionRef.current = rotacion
  const medidasNaturalesRef = useRef(medidasNaturales)
  medidasNaturalesRef.current = medidasNaturales
  const modoAjusteRef = useRef(true)

  // Escala para que la imagen quepa entera y la centra. Con el área oculta (0 px) no hace
  // nada: se reintenta al mostrarse, vía el ResizeObserver o el efecto de `visible`.
  const ajustarVista = useCallback(() => {
    const stage = stageRef.current
    const ajustada = stage && vistaAjustada(stage, medidasNaturalesRef.current, rotacionRef.current)
    if (!ajustada) return
    modoAjusteRef.current = true
    setVista(ajustada)
  }, [])

  const aplicarZoom = useCallback((factor: number, dx = 0, dy = 0) => {
    const siguiente = zoomAnclado(vistaRef.current, factor, dx, dy)
    if (!siguiente) return
    modoAjusteRef.current = false
    setVista(siguiente)
  }, [])

  const gestos = useGestosImagen({
    stageRef, vistaRef, modoAjusteRef, setVista, aplicarZoom, ajustarVista, visible, verCodigo, cargando, error
  })

  // Tras rotar se re-ajusta, con las dimensiones ya intercambiadas.
  useEffect(() => {
    if (medidasNaturales.w && medidasNaturales.h) ajustarVista()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotacion])

  const reiniciar = useCallback(() => {
    setMedidasNaturales({ w: 0, h: 0 })
    setRotacion(0)
    setVista(IDENTIDAD)
    modoAjusteRef.current = true
  }, [])

  function alCargar(e: SyntheticEvent<HTMLImageElement>): boolean {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (!w || !h) return false
    setMedidasNaturales({ w, h })
    // ajustarVista lee medidasNaturalesRef, aún sin actualizar en este commit: se ajusta con las medidas recién obtenidas.
    const ajustada = stageRef.current && vistaAjustada(stageRef.current, { w, h }, 0)
    if (ajustada) {
      modoAjusteRef.current = true
      setVista(ajustada)
    }
    return true
  }

  const rotar = (): void => setRotacion((r) => (r + 90) % 360)

  return {
    ...gestos,
    medidasNaturales, vista, rotacion, stageRef, modoAjusteRef, ajustarVista, aplicarZoom, rotar, reiniciar, alCargar
  }
}
