// =============================================================================
// Desplazamiento de la rejilla de datos: avisar al dueño de que se acerca al final
// (`onCargarMas`), guardar la posición en `onScroll` y restaurarla al volver a ser
// visible (una pestaña oculta con `display:none` pone `scrollTop` a 0 sin avisar).
// Hook de `DbRejilla`: el orden de declaración fija el de los efectos.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { EXTRA_CABECERA, MAX_FRAMES_RESTAURAR } from './rejillaVista'
import { debeCargarMas } from './ventanaRejilla'
import type { BaseRejilla, EstadoRejilla, GeometriaRejilla, ScrollRejilla } from './rejillaTipos'

/** Pide la página siguiente cerca del final, una vez por `datos`. */
function useCargarMas(b: BaseRejilla, g: GeometriaRejilla): () => void {
  const { datos, cargandoMas, visible, sinLector } = b.props
  const { scrollRef, propsRef } = b
  const { dims } = g
  // Se recuerda PARA QUÉ `datos` se pidió la página siguiente: mientras no lleguen datos
  // nuevos no se vuelve a pedir, y si la petición falla no se reintenta con cada rueda.
  const pedidoParaRef = useRef<unknown>(null)
  const comprobarCargarMas = useCallback((): void => {
    const el = scrollRef.current
    const p = propsRef.current
    if (!el || !p.visible || !p.onCargarMas || !p.datos || p.sinLector) return
    if (pedidoParaRef.current === p.datos) return
    const pedir = debeCargarMas({
      scrollTop: el.scrollTop,
      alto: el.clientHeight,
      altoFila: p.altoFila,
      // Las filas nuevas van arriba y también ocupan alto.
      numFilas: p.datos.filas.length + (p.edicion?.cambios.nuevas.length ?? 0),
      hayMas: p.datos.hayMas,
      cargando: p.cargandoMas,
      altoFijo: p.altoFila + EXTRA_CABECERA
    })
    if (!pedir) return
    pedidoParaRef.current = p.datos
    p.onCargarMas()
  }, [scrollRef, propsRef])
  useEffect(() => {
    comprobarCargarMas()
  }, [comprobarCargarMas, datos, cargandoMas, visible, sinLector, dims])
  return comprobarCargarMas
}

/** Cargar más, guardar el desplazamiento y restaurarlo al volver a verse. */
export function useScrollRejilla(b: BaseRejilla, g: GeometriaRejilla, e: EstadoRejilla): ScrollRejilla {
  const { visible } = b.props
  const { scrollRef } = b
  const { recalcularRef } = g
  const { setMenu } = e
  const comprobarCargarMas = useCargarMas(b, g)

  const posRef = useRef({ top: 0, left: 0 })
  const rafRef = useRef(0)
  const alDesplazar = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    // Solo mientras la caja mide algo: el scroll a 0 del ocultado no pisa el bueno.
    if (el.clientHeight > 0) posRef.current = { top: el.scrollTop, left: el.scrollLeft }
    // Un menú contextual anclado a la pantalla apuntaría a otra celda: se cierra.
    setMenu((m) => (m ? null : m))
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      recalcularRef.current()
      comprobarCargarMas()
    })
  }, [comprobarCargarMas, scrollRef, setMenu, recalcularRef])
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // En layout y unos rAF: el `display:none` del ancestro puede soltarse un fotograma después.
  useLayoutEffect(() => {
    if (!visible) return
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    let frames = 0
    const aplicar = (): void => {
      if (el.clientHeight === 0) {
        if (++frames < MAX_FRAMES_RESTAURAR) raf = requestAnimationFrame(aplicar)
        return
      }
      if (el.scrollTop !== posRef.current.top) el.scrollTop = posRef.current.top
      if (el.scrollLeft !== posRef.current.left) el.scrollLeft = posRef.current.left
      recalcularRef.current()
    }
    aplicar()
    return () => cancelAnimationFrame(raf)
  }, [visible, scrollRef, recalcularRef])
  return { posRef, alDesplazar }
}
