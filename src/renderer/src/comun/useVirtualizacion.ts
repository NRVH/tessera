// =============================================================================
// Piezas de `VirtualList`: sumas prefijas de alturas, búsqueda del índice por scroll y los
// efectos de medida, scroll, revelado y aviso del rango montado.
// Los hooks se llaman desde `VirtualList` en el mismo orden que tenían dentro del componente.
// Solo depende de React.
// Decisiones: docs/decisiones/renderer/lista-virtual.md
// =============================================================================

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** Altura de una fila: constante o por índice. */
export type AlturaFila = number | ((index: number) => number)

/** Sumas prefijas: `offsets[i]` es el borde superior de la fila i y `offsets[n]` el alto total. */
export function calcularOffsets(n: number, itemHeight: AlturaFila): Float64Array {
  const arr = new Float64Array(n + 1)
  if (typeof itemHeight === 'number') {
    for (let i = 0; i < n; i++) arr[i + 1] = arr[i] + itemHeight
  } else {
    for (let i = 0; i < n; i++) arr[i + 1] = arr[i] + itemHeight(i)
  }
  return arr
}

/** Índice de la fila cuyo rango [offset[i], offset[i+1]) contiene `y` (clamp a [0, n-1]). */
function indexAt(offsets: Float64Array, y: number): number {
  let lo = 0
  let hi = offsets.length - 2 // último índice de fila válido
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid] <= y) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** Rango [start, end) de filas montadas: las visibles más el colchón de `overscan`. */
export function ventanaMontada(
  offsets: Float64Array,
  n: number,
  relTop: number,
  viewport: number,
  overscan: number
): { start: number; end: number } {
  const start = n === 0 ? 0 : Math.max(0, indexAt(offsets, relTop) - overscan)
  const end = n === 0 ? 0 : Math.min(n, indexAt(offsets, relTop + viewport) + 1 + overscan)
  return { start, end }
}

/** Mide el alto del contenedor antes de pintar y lo mantiene al redimensionar. */
export function useMedirViewport(el: () => HTMLDivElement | null, setViewport: (px: number) => void): void {
  useLayoutEffect(() => {
    const node = el()
    if (!node) return
    setViewport(node.clientHeight)
    const ro = new ResizeObserver(() => setViewport(node.clientHeight))
    ro.observe(node)
    return () => ro.disconnect()
    // el() se resuelve del scrollRef/innerScrollRef, estables durante la vida del comp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Devuelve el manejador de scroll, que actualiza `scrollTop` como mucho una vez por frame. */
export function useScrollPorFrame(
  el: () => HTMLDivElement | null,
  onScroll: (() => void) | undefined,
  setScrollTop: (px: number) => void
): () => void {
  const rafRef = useRef<number | null>(null)
  const handleScroll = (): void => {
    onScroll?.()
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const node = el()
      if (node) setScrollTop(node.scrollTop)
    })
  }
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    []
  )
  return handleScroll
}

/** Revela una fila que puede estar fuera de la ventana montada ajustando `scrollTop` con su offset. */
export function useRevelarIndice(
  el: () => HTMLDivElement | null,
  spacerRef: RefObject<HTMLDivElement>,
  offsets: Float64Array,
  n: number,
  scrollToIndex: number | null | undefined,
  scrollToken: number | undefined
): void {
  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0 || scrollToIndex >= n) return
    const node = el()
    if (!node) return
    const base = spacerRef.current?.offsetTop ?? 0
    const top = base + offsets[scrollToIndex]
    const bottom = base + offsets[scrollToIndex + 1]
    if (top < node.scrollTop) node.scrollTop = top
    else if (bottom > node.scrollTop + node.clientHeight) node.scrollTop = bottom - node.clientHeight
    // Reacciona al cambio de destino Y al token (revelar OTRA VEZ el mismo índice);
    // offsets/items estables entre tanto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToIndex, scrollToken])
}

/** Avisa al padre del rango montado solo cuando cambia (los números o la identidad de `items`). */
export function useAvisoRango<T>(
  start: number,
  end: number,
  items: readonly T[],
  onRangoVisible: ((inicio: number, fin: number) => void) | undefined
): void {
  const rangoPrevio = useRef<{ a: number; b: number; items: readonly T[] } | null>(null)
  useEffect(() => {
    if (!onRangoVisible) return
    const p = rangoPrevio.current
    if (p !== null && p.a === start && p.b === end && p.items === items) return
    rangoPrevio.current = { a: start, b: end, items }
    onRangoVisible(start, end)
  }, [start, end, items, onRangoVisible])
}
