// =============================================================================
// Splitter: borde arrastrable propio (sin librería) que redimensiona el panel adyacente, en
// vertical (arrastra el ancho) o en horizontal (arrastra el alto). El cálculo es absoluto:
// `clamp(tamañoInicial + direction * delta, min, max)`, así el borde no se desengancha del
// cursor al topar un límite. `direction` es +1 si arrastrar en el sentido positivo del eje
// agranda el panel y -1 si lo encoge. Los mousemove se coalescen por frame. Sin dependencias.
// =============================================================================

import { useCallback, useRef, type MutableRefObject } from 'react'

type Orientation = 'vertical' | 'horizontal'

interface SplitterProps {
  orientation: Orientation
  /** Tamaño actual del panel adyacente (px). Se snapshotea al iniciar el drag. */
  size: number
  min: number
  max: number
  /** +1 si arrastrar en sentido +eje agranda el panel; -1 si lo encoge. */
  direction: 1 | -1
  onResize: (nextPx: number) => void
  label: string
}

/** Paso del teclado (flechas) para mover el borde sin ratón. */
const KEYBOARD_STEP = 16

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

interface ArrastreOpts {
  vertical: boolean
  size: number
  min: number
  max: number
  direction: 1 | -1
  onResize: (nextPx: number) => void
  rafRef: MutableRefObject<number | null>
  pendingRef: MutableRefObject<number | null>
}

/** Arranca un arrastre: mousemove coalescido por frame y limpieza al soltar. */
function iniciarArrastre(e: React.MouseEvent<HTMLDivElement>, o: ArrastreOpts): void {
  const { vertical, size, min, max, direction, onResize, rafRef, pendingRef } = o
  const startPos = vertical ? e.clientX : e.clientY
  const startSize = size
  const el = e.currentTarget

  function flush(): void {
    rafRef.current = null
    if (pendingRef.current === null) return
    onResize(pendingRef.current)
    pendingRef.current = null
  }
  function onMove(ev: MouseEvent): void {
    const pos = vertical ? ev.clientX : ev.clientY
    const delta = pos - startPos
    pendingRef.current = clamp(startSize + direction * delta, min, max)
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush)
  }
  function onUp(): void {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // Aplica el último valor pendiente que no llegó a su frame.
    if (pendingRef.current !== null) {
      onResize(pendingRef.current)
      pendingRef.current = null
    }
    el.classList.remove('dragging')
    document.body.classList.remove('is-resizing')
    document.body.style.cursor = ''
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  el.classList.add('dragging')
  document.body.classList.add('is-resizing')
  document.body.style.cursor = vertical ? 'col-resize' : 'row-resize'
}

/** Paso con signo que pide una tecla de flecha para esa orientación, o 0 si no es de las suyas. */
function pasoDeTecla(key: string, vertical: boolean): number {
  const dec = vertical ? 'ArrowLeft' : 'ArrowUp'
  const inc = vertical ? 'ArrowRight' : 'ArrowDown'
  if (key === inc) return KEYBOARD_STEP
  if (key === dec) return -KEYBOARD_STEP
  return 0
}

export function Splitter({
  orientation,
  size,
  min,
  max,
  direction,
  onResize,
  label
}: SplitterProps): React.JSX.Element {
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<number | null>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      // Solo botón principal; ignora medio/derecho.
      if (e.button !== 0) return
      e.preventDefault()
      iniciarArrastre(e, {
        vertical: orientation === 'vertical',
        size,
        min,
        max,
        direction,
        onResize,
        rafRef,
        pendingRef
      })
    },
    [orientation, size, min, max, direction, onResize]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const step = pasoDeTecla(e.key, orientation === 'vertical')
      if (step === 0) return
      e.preventDefault()
      onResize(clamp(size + direction * step, min, max))
    },
    [orientation, size, min, max, direction, onResize]
  )

  return (
    <div
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    />
  )
}
