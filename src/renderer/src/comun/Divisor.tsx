// =============================================================================
// Divisor: borde arrastrable propio (sin librería) que redimensiona el panel adyacente, en
// vertical (arrastra el ancho) o en horizontal (arrastra el alto). El cálculo es absoluto:
// `clamp(tamañoInicial + direction * delta, min, max)`, así el borde no se desengancha del
// cursor al topar un límite. `direction` es +1 si arrastrar en el sentido positivo del eje
// agranda el panel y -1 si lo encoge. Los mousemove se coalescen por frame. Sin dependencias.
// =============================================================================

import { useCallback, useRef, type MutableRefObject } from 'react'

type Orientacion = 'vertical' | 'horizontal'

interface PropsDivisor {
  orientacion: Orientacion
  /** Tamaño actual del panel adyacente (px). Se snapshotea al iniciar el drag. */
  tamano: number
  min: number
  max: number
  /** +1 si arrastrar en sentido +eje agranda el panel; -1 si lo encoge. */
  direccion: 1 | -1
  onRedimensionar: (pxSiguiente: number) => void
  etiqueta: string
  /** Clase propia además de `splitter` (p. ej. `splitter-agente`, que el CSS de `.shell` busca). */
  className?: string
}

/** Paso del teclado (flechas) para mover el borde sin ratón. */
const PASO_TECLADO = 16

function acotar(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

interface ArrastreOpts {
  vertical: boolean
  tamano: number
  min: number
  max: number
  direccion: 1 | -1
  onRedimensionar: (pxSiguiente: number) => void
  rafRef: MutableRefObject<number | null>
  pendienteRef: MutableRefObject<number | null>
}

/** Arranca un arrastre: mousemove coalescido por frame y limpieza al soltar. */
function iniciarArrastre(e: React.MouseEvent<HTMLDivElement>, o: ArrastreOpts): void {
  const { vertical, tamano, min, max, direccion, onRedimensionar, rafRef, pendienteRef } = o
  const posInicio = vertical ? e.clientX : e.clientY
  const tamanoInicio = tamano
  const el = e.currentTarget

  function vaciar(): void {
    rafRef.current = null
    if (pendienteRef.current === null) return
    onRedimensionar(pendienteRef.current)
    pendienteRef.current = null
  }
  function alMover(ev: MouseEvent): void {
    const pos = vertical ? ev.clientX : ev.clientY
    const delta = pos - posInicio
    pendienteRef.current = acotar(tamanoInicio + direccion * delta, min, max)
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(vaciar)
  }
  function alSoltar(): void {
    window.removeEventListener('mousemove', alMover)
    window.removeEventListener('mouseup', alSoltar)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // Aplica el último valor pendiente que no llegó a su frame.
    if (pendienteRef.current !== null) {
      onRedimensionar(pendienteRef.current)
      pendienteRef.current = null
    }
    el.classList.remove('dragging')
    document.body.classList.remove('is-resizing')
    document.body.style.cursor = ''
  }
  window.addEventListener('mousemove', alMover)
  window.addEventListener('mouseup', alSoltar)
  el.classList.add('dragging')
  document.body.classList.add('is-resizing')
  document.body.style.cursor = vertical ? 'col-resize' : 'row-resize'
}

/** Paso con signo que pide una tecla de flecha para esa orientación, o 0 si no es de las suyas. */
function pasoDeTecla(tecla: string, vertical: boolean): number {
  const dec = vertical ? 'ArrowLeft' : 'ArrowUp'
  const inc = vertical ? 'ArrowRight' : 'ArrowDown'
  if (tecla === inc) return PASO_TECLADO
  if (tecla === dec) return -PASO_TECLADO
  return 0
}

export function Divisor({
  orientacion,
  tamano,
  min,
  max,
  direccion,
  onRedimensionar,
  etiqueta,
  className
}: PropsDivisor): React.JSX.Element {
  const rafRef = useRef<number | null>(null)
  const pendienteRef = useRef<number | null>(null)

  const alPulsarRaton = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      // Solo botón principal; ignora medio/derecho.
      if (e.button !== 0) return
      e.preventDefault()
      iniciarArrastre(e, {
        vertical: orientacion === 'vertical',
        tamano,
        min,
        max,
        direccion,
        onRedimensionar,
        rafRef,
        pendienteRef
      })
    },
    [orientacion, tamano, min, max, direccion, onRedimensionar]
  )

  const alPulsarTecla = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const paso = pasoDeTecla(e.key, orientacion === 'vertical')
      if (paso === 0) return
      e.preventDefault()
      onRedimensionar(acotar(tamano + direccion * paso, min, max))
    },
    [orientacion, tamano, min, max, direccion, onRedimensionar]
  )

  return (
    <div
      className={`splitter splitter-${orientacion}${className ? ` ${className}` : ''}`}
      role="separator"
      aria-orientation={orientacion}
      aria-label={etiqueta}
      aria-valuenow={Math.round(tamano)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={alPulsarRaton}
      onKeyDown={alPulsarTecla}
    />
  )
}
