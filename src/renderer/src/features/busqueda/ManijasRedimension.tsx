// =============================================================================
// Las ocho manijas (cuatro lados y cuatro esquinas) con las que se redimensiona el modal de
// búsqueda. El modal sigue centrado, de ahí que cada desplazamiento se aplique doble.
// No usa `Splitter`: aquel es de un eje y reparte entre dos paneles; esto es el contorno.
// =============================================================================

/** Tamaño mínimo del modal. */
const MODAL_MIN_ANCHO = 560
const MODAL_MIN_ALTO = 420

/** `n`/`s`/`e`/`o` son los cuatro lados y las combinaciones, las esquinas. */
const LADOS = ['n', 's', 'e', 'o', 'no', 'ne', 'so', 'se'] as const
type Lado = (typeof LADOS)[number]

const CURSOR_DE: Record<Lado, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  o: 'ew-resize',
  no: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  so: 'nesw-resize'
}

const ETIQUETA_DE: Record<Lado, string> = {
  n: 'Redimensionar por arriba',
  s: 'Redimensionar por abajo',
  e: 'Redimensionar por la derecha',
  o: 'Redimensionar por la izquierda',
  no: 'Redimensionar por la esquina superior izquierda',
  ne: 'Redimensionar por la esquina superior derecha',
  so: 'Redimensionar por la esquina inferior izquierda',
  se: 'Redimensionar por la esquina inferior derecha'
}

interface ManijasProps {
  ancho: number
  alto: number
  onResize: (t: { ancho: number; alto: number }) => void
}

/** Tamaño tras arrastrar `lado` (dx, dy) desde (a0, h0), acotado a la ventana. */
function tamanoTrasArrastre(
  lado: Lado,
  d: { dx: number; dy: number },
  base: { a0: number; h0: number }
): { ancho: number; alto: number } {
  let a = base.a0
  let h = base.h0
  if (lado.includes('e')) a += d.dx * 2
  if (lado.includes('o')) a -= d.dx * 2
  if (lado.includes('s')) h += d.dy * 2
  if (lado.includes('n')) h -= d.dy * 2
  return {
    ancho: Math.round(Math.min(Math.max(a, MODAL_MIN_ANCHO), window.innerWidth - 24)),
    alto: Math.round(Math.min(Math.max(h, MODAL_MIN_ALTO), window.innerHeight - 24))
  }
}

/** Las ocho manijas de redimensión del modal. */
export function ManijasRedimension({ ancho, alto, onResize }: ManijasProps): React.JSX.Element {
  function alPresionar(e: React.MouseEvent, lado: Lado): void {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const y0 = e.clientY
    let pedido = 0

    const mover = (ev: MouseEvent): void => {
      if (pedido) return
      pedido = requestAnimationFrame(() => {
        pedido = 0
        const d = { dx: ev.clientX - x0, dy: ev.clientY - y0 }
        onResize(tamanoTrasArrastre(lado, d, { a0: ancho, h0: alto }))
      })
    }
    const soltar = (): void => {
      if (pedido) cancelAnimationFrame(pedido)
      window.removeEventListener('mousemove', mover)
      window.removeEventListener('mouseup', soltar)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    // Cursor y anti-selección van en el body: en la manija, salirse un píxel los perdería.
    document.body.style.cursor = CURSOR_DE[lado]
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', mover)
    window.addEventListener('mouseup', soltar)
  }

  return (
    <>
      {LADOS.map((lado) => (
        <div
          key={lado}
          className={`buscar-manija buscar-manija-${lado}`}
          role="separator"
          aria-label={ETIQUETA_DE[lado]}
          onMouseDown={(e) => alPresionar(e, lado)}
        />
      ))}
    </>
  )
}
