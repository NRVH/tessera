// =============================================================================
// Piezas de `ListaVirtual`: sumas prefijas de alturas, búsqueda del índice por scroll y los
// efectos de medida, scroll, revelado y aviso del rango montado.
// Los hooks se llaman desde `ListaVirtual` en el mismo orden que tenían dentro del componente.
// Solo depende de React.
// Decisiones: docs/decisiones/renderer/lista-virtual.md
// =============================================================================

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** Altura de una fila: constante o por índice. */
export type AlturaFila = number | ((indice: number) => number)

/** Sumas prefijas: `offsets[i]` es el borde superior de la fila i y `offsets[n]` el alto total. */
export function calcularDesplazamientos(n: number, altoElemento: AlturaFila): Float64Array {
  const arr = new Float64Array(n + 1)
  if (typeof altoElemento === 'number') {
    for (let i = 0; i < n; i++) arr[i + 1] = arr[i] + altoElemento
  } else {
    for (let i = 0; i < n; i++) arr[i + 1] = arr[i] + altoElemento(i)
  }
  return arr
}

/** Índice de la fila cuyo rango [offset[i], offset[i+1]) contiene `y` (clamp a [0, n-1]). */
function indiceEn(desplazamientos: Float64Array, y: number): number {
  let lo = 0
  let tope = desplazamientos.length - 2 // último índice de fila válido
  let resultado = 0
  while (lo <= tope) {
    const medio = (lo + tope) >> 1
    if (desplazamientos[medio] <= y) {
      resultado = medio
      lo = medio + 1
    } else {
      tope = medio - 1
    }
  }
  return resultado
}

/** Rango [start, end) de filas montadas: las visibles más el colchón de `overscan`. */
export function ventanaMontada(
  desplazamientos: Float64Array,
  n: number,
  desplazamientoRelativo: number,
  viewport: number,
  overscan: number
): { inicio: number; fin: number } {
  const inicio = n === 0 ? 0 : Math.max(0, indiceEn(desplazamientos, desplazamientoRelativo) - overscan)
  const fin = n === 0 ? 0 : Math.min(n, indiceEn(desplazamientos, desplazamientoRelativo + viewport) + 1 + overscan)
  return { inicio, fin }
}

/** Mide el alto del contenedor antes de pintar y lo mantiene al redimensionar. */
export function useMedirViewport(el: () => HTMLDivElement | null, setViewport: (px: number) => void): void {
  useLayoutEffect(() => {
    const nodo = el()
    if (!nodo) return
    setViewport(nodo.clientHeight)
    const ro = new ResizeObserver(() => setViewport(nodo.clientHeight))
    ro.observe(nodo)
    return () => ro.disconnect()
    // el() se resuelve del scrollRef/scrollInternoRef, estables durante la vida del comp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Devuelve el manejador de scroll, que actualiza `scrollTop` como mucho una vez por frame. */
export function useScrollPorFotograma(
  el: () => HTMLDivElement | null,
  onScroll: (() => void) | undefined,
  setDesplazamiento: (px: number) => void
): () => void {
  const rafRef = useRef<number | null>(null)
  const alDesplazar = (): void => {
    onScroll?.()
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const nodo = el()
      if (nodo) setDesplazamiento(nodo.scrollTop)
    })
  }
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    []
  )
  return alDesplazar
}

/** Revela una fila que puede estar fuera de la ventana montada ajustando `scrollTop` con su offset. */
export function useRevelarIndice(
  el: () => HTMLDivElement | null,
  espaciadorRef: RefObject<HTMLDivElement>,
  desplazamientos: Float64Array,
  n: number,
  indiceARevelar: number | null | undefined,
  scrollToken: number | undefined
): void {
  useEffect(() => {
    if (indiceARevelar == null || indiceARevelar < 0 || indiceARevelar >= n) return
    const nodo = el()
    if (!nodo) return
    const base = espaciadorRef.current?.offsetTop ?? 0
    const arriba = base + desplazamientos[indiceARevelar]
    const abajo = base + desplazamientos[indiceARevelar + 1]
    if (arriba < nodo.scrollTop) nodo.scrollTop = arriba
    else if (abajo > nodo.scrollTop + nodo.clientHeight) nodo.scrollTop = abajo - nodo.clientHeight
    // Reacciona al cambio de destino Y al token (revelar OTRA VEZ el mismo índice);
    // offsets/items estables entre tanto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indiceARevelar, scrollToken])
}

/** Avisa al padre del rango montado solo cuando cambia (los números o la identidad de `items`). */
export function useAvisoRango<T>(
  inicio: number,
  fin: number,
  elementos: readonly T[],
  onRangoVisible: ((inicio: number, fin: number) => void) | undefined
): void {
  const rangoPrevio = useRef<{ a: number; b: number; elementos: readonly T[] } | null>(null)
  useEffect(() => {
    if (!onRangoVisible) return
    const p = rangoPrevio.current
    if (p !== null && p.a === inicio && p.b === fin && p.elementos === elementos) return
    rangoPrevio.current = { a: inicio, b: fin, elementos }
    onRangoVisible(inicio, fin)
  }, [inicio, fin, elementos, onRangoVisible])
}
