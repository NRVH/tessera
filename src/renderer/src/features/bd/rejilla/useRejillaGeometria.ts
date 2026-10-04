// =============================================================================
// Anchos de columna (medidos con la fuente calculada del DOM) y ventana visible de la
// rejilla de datos. React solo repinta cuando cambia el rango de filas o columnas
// visibles. Hooks de `DbRejilla`: el orden de declaración fija el de los efectos.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { anchoColumnaRejilla } from '../panesBd'
import { MUESTRA_INICIAL, OPCIONES_ANCHO } from './anchoColumnas'
import { ANCHO_PROVISIONAL, mismaVentana, SIN_VENTANA } from './rejillaVista'
import { anchoTotal, prefijosColumnas, ventana, type Ventana } from './ventanaRejilla'
import type { BaseRejilla, GeometriaRejilla } from './rejillaTipos'

let ctxMedida: CanvasRenderingContext2D | null | undefined

/**
 * Medidor con la fuente CALCULADA de un elemento (`canvas.measureText`): la ponen el CSS
 * y la densidad, y medir con otra daría columnas que no casan con lo pintado. Sin canvas,
 * una estimación por carácter.
 */
export function medidorDe(el: Element | null, porCaracter: number): (s: string) => number {
  if (ctxMedida === undefined) ctxMedida = document.createElement('canvas').getContext('2d')
  const ctx = ctxMedida
  if (!el || !ctx) return (s) => s.length * porCaracter
  const cs = getComputedStyle(el)
  const fuente = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  return (s) => {
    ctx.font = fuente
    return ctx.measureText(s).width
  }
}

interface EstadoAnchos {
  /** Firma de columnas + alto de fila con la que se midió. */
  firma: string
  anchos: number[]
  /** Se midió con filas (si no, se vuelve a medir cuando lleguen). */
  conFilas: boolean
}

type AnchosRejilla = Pick<GeometriaRejilla, 'anchos' | 'pref' | 'anchoFijo' | 'anchoLienzo' | 'cambiarAncho'>

/** Anchos medidos por resultado y densidad; la columna de números crece con los dígitos. */
export function useAnchosRejilla(b: BaseRejilla): AnchosRejilla {
  const { columnas, altoFila } = b.props
  const { numCols, numFilas, filas, pk, cuerpoRef, cabRef } = b
  // El alto de fila entra en la firma: cambia con la densidad, y con él la letra.
  const firmaAnchos = `${b.firmaCols}|${altoFila}`
  const [estAnchos, setEstAnchos] = useState<EstadoAnchos>({ firma: '', anchos: [], conFilas: false })
  const provisionales = useMemo(() => columnas.map(() => ANCHO_PROVISIONAL), [columnas])
  const anchos =
    estAnchos.firma === firmaAnchos && estAnchos.anchos.length === numCols ? estAnchos.anchos : provisionales
  const pref = useMemo(() => prefijosColumnas(anchos), [anchos])
  const [anchoDigito, setAnchoDigito] = useState(8)
  const anchoFijo = Math.max(40, Math.ceil(String(Math.max(1, b.numServidor)).length * anchoDigito) + 17)

  useLayoutEffect(() => {
    setAnchoDigito(medidorDe(cuerpoRef.current, 7.5)('0'))
  }, [altoFila, cuerpoRef])

  useLayoutEffect(() => {
    const conFilas = numFilas > 0
    if (estAnchos.firma === firmaAnchos && estAnchos.anchos.length === numCols && (estAnchos.conFilas || !conFilas)) {
      return
    }
    const celda = medidorDe(cuerpoRef.current, 7.5)
    const cabecera = medidorDe(cabRef.current, 7.5)
    const nuevos = columnas.map((col, c) =>
      anchoColumnaRejilla(col, c, filas, MUESTRA_INICIAL, celda, cabecera, pk.has(col.nombre), OPCIONES_ANCHO)
    )
    setEstAnchos({ firma: firmaAnchos, anchos: nuevos, conFilas })
  }, [estAnchos, firmaAnchos, numCols, numFilas, columnas, filas, pk, cuerpoRef, cabRef])

  const cambiarAncho = useCallback(
    (c: number, ancho: number): void => {
      setEstAnchos((prev) => {
        if (prev.firma !== firmaAnchos || prev.anchos[c] === ancho) return prev
        const anchosNuevos = prev.anchos.slice()
        anchosNuevos[c] = ancho
        return { ...prev, anchos: anchosNuevos }
      })
    },
    [firmaAnchos]
  )
  return { anchos, pref, anchoFijo, anchoLienzo: anchoFijo + anchoTotal(pref), cambiarAncho }
}

type VentanaRejilla = Pick<GeometriaRejilla, 'ven' | 'dims' | 'recalcularRef'>

/** El rango visible, recalculado al desplazar (en un rAF) y al cambiar de tamaño. */
export function useVentanaRejilla(b: BaseRejilla, a: AnchosRejilla): VentanaRejilla {
  const { altoFila } = b.props
  const { numFilas, altoCab, scrollRef } = b
  const { pref, anchoFijo } = a
  const [ven, setVen] = useState<Ventana>(SIN_VENTANA)
  const [dims, setDims] = useState({ alto: 0, ancho: 0 })

  const recalcular = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const v = ventana({
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      alto: el.clientHeight,
      ancho: el.clientWidth,
      altoFila,
      numFilas,
      pref,
      anchoFijo,
      altoFijo: altoCab
    })
    setVen((prev) => (mismaVentana(prev, v) ? prev : v))
  }, [altoFila, numFilas, pref, anchoFijo, altoCab, scrollRef])
  const recalcularRef = useRef(recalcular)
  useLayoutEffect(() => {
    recalcularRef.current = recalcular
    recalcular()
  }, [recalcular, dims])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setDims((d) =>
        d.alto === el.clientHeight && d.ancho === el.clientWidth ? d : { alto: el.clientHeight, ancho: el.clientWidth }
      )
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef])
  return { ven, dims, recalcularRef }
}
