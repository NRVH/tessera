// =============================================================================
// VirtualList: lista virtualizada por reciclado de DOM. Monta solo las filas visibles más un
// colchón de `overscan`; un spacer con la altura total reserva el recorrido del scroll y las
// filas se posicionan en absoluto sobre él. Las alturas (número o función por índice) se
// conocen de antemano: el scroll se mapea a índice por búsqueda binaria sobre sumas prefijas.
// `header` y `footer` scrollean dentro del contenedor. Depende de `useVirtualizacion.ts`.
// Decisiones: docs/decisiones/renderer/lista-virtual.md
// =============================================================================

import { useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import {
  calcularOffsets,
  useAvisoRango,
  useMedirViewport,
  useRevelarIndice,
  useScrollPorFrame,
  ventanaMontada,
  type AlturaFila
} from './useVirtualizacion'

interface VirtualListProps<T> {
  /** Datos completos (la lista entera; se monta solo la ventana visible). */
  items: readonly T[]
  /** Alto de una fila en px: constante, o por índice si varía por tipo/estado. */
  itemHeight: AlturaFila
  /** Pinta el contenido de la fila `index`. El wrapper posicionado lo aporta la lista. */
  renderItem: (item: T, index: number) => ReactNode
  /** Clave estable por fila (para el reconciliador de React). */
  getKey: (item: T, index: number) => string
  /** Filas extra montadas fuera de vista a cada lado (anti-parpadeo). Def. 6. */
  overscan?: number
  className?: string
  ariaLabel?: string
  /**
   * Estilos extra del contenedor que scrollea. Existe para que el padre pueda
   * fijar su ALTO (p. ej. el reparto arrastrable de la columna de detalle del log)
   * sin envolver la lista en otro div, que rompería el `flex` de la columna. Se
   * mezcla ANTES que los estilos propios: `overflowY`/`position` no son negociables.
   */
  style?: CSSProperties
  /** Contenido fijo arriba (estados, buscador…): scrollea con la lista. */
  header?: ReactNode
  /** Contenido al final (p. ej. "cargar más historial"): scrollea con la lista. */
  footer?: ReactNode
  /** Ref al DIV que scrollea (para que el padre pueda resetear scrollTop, etc.). */
  scrollRef?: RefObject<HTMLDivElement>
  /** Se invoca en cada scroll (p. ej. para ocultar un tooltip). */
  onScroll?: () => void
  /**
   * Rango MONTADO (incluye el colchón de `overscan`), cuando cambia.
   *
   * Existe para la carga perezosa: con cientos de repos no se pide el estado de
   * todos, solo el de los que se ven, y esto es lo que le dice al padre cuáles son.
   * Se avisa del rango montado y no del estrictamente visible a propósito: lo que
   * está en el colchón es lo próximo que se va a ver, y pedir su dato entonces es
   * lo que hace que aparezca ya cargado en vez de en blanco.
   */
  onRangoVisible?: (inicio: number, fin: number) => void
  /**
   * Si se da (y es un índice válido), asegura que esa fila quede A LA VISTA. Para
   * revelar una fila que puede estar FUERA de la ventana montada (no existe su DOM,
   * así que scrollIntoView no sirve): se calcula su offset y se ajusta scrollTop.
   */
  scrollToIndex?: number | null
  /**
   * Contador para volver a revelar el MISMO índice.
   *
   * El efecto de revelado depende solo de `scrollToIndex`, así que pedir dos veces
   * la misma fila no hace nada: el segundo intento no cambia la dependencia. Se
   * nota en cuanto hay navegación de verdad —volver a una fila a la que ya se había
   * saltado, o un buscador con una sola coincidencia— y no da ningún error, solo no
   * scrollea. Subir este número fuerza el revelado. Idioma de TOKEN, el mismo que
   * App usa para "abre este archivo Y llévame a la línea N".
   */
  scrollToken?: number
  /**
   * Foco y teclado del CONTENEDOR. Van aquí y no en las filas porque esta lista las
   * DESMONTA al salir de la ventana: un foco que viviera en una fila se perdería a
   * media navegación (y se lo llevaría `<body>`). El patrón es contenedor
   * enfocable + `aria-activedescendant` nombrando la fila activa.
   */
  tabIndex?: number
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void
  /** 'listbox' cuando la lista es navegable con teclado (filas con role="option"). */
  role?: string
  /** Id de la fila ACTIVA. Puede apuntar a una fila no montada: entonces no se anuncia. */
  'aria-activedescendant'?: string
}

/** Asigna el nodo al ref interno y al `scrollRef` del padre (solo lo lee, aunque el tipo sea readonly). */
function asignarNodo(
  innerScrollRef: { current: HTMLDivElement | null },
  scrollRef: RefObject<HTMLDivElement> | undefined,
  node: HTMLDivElement | null
): void {
  innerScrollRef.current = node
  if (scrollRef) (scrollRef as { current: HTMLDivElement | null }).current = node
}

/** Filas montadas [start, end), cada una en su offset absoluto. */
function filasMontadas<T>(
  items: readonly T[],
  offsets: Float64Array,
  start: number,
  end: number,
  getKey: (item: T, index: number) => string,
  renderItem: (item: T, index: number) => ReactNode
): ReactNode[] {
  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    rows.push(
      <div
        key={getKey(items[i], i)}
        // `presentation`: el div solo posiciona; así las `option` cuelgan del `listbox` en el árbol de accesibilidad.
        role="presentation"
        style={{ position: 'absolute', top: offsets[i], left: 0, right: 0, height: offsets[i + 1] - offsets[i] }}
      >
        {renderItem(items[i], i)}
      </div>
    )
  }
  return rows
}

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  getKey,
  overscan = 6,
  className,
  ariaLabel,
  style,
  header,
  footer,
  scrollRef,
  onScroll,
  onRangoVisible,
  scrollToIndex,
  scrollToken,
  ...resto
}: VirtualListProps<T>): React.JSX.Element {
  const innerScrollRef = useRef<HTMLDivElement | null>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  const el = (): HTMLDivElement | null => (scrollRef ? scrollRef.current : null) ?? innerScrollRef.current

  // Se recalcula solo si cambian datos o alturas.
  const offsets = useMemo(() => calcularOffsets(items.length, itemHeight), [items, itemHeight])
  const total = offsets[items.length]

  useMedirViewport(el, setViewport)
  const handleScroll = useScrollPorFrame(el, onScroll, setScrollTop)
  useRevelarIndice(el, spacerRef, offsets, items.length, scrollToIndex, scrollToken)

  // Offset del spacer dentro del contenido scrolleable (= alto del header, medido en vivo).
  const spacerTop = spacerRef.current?.offsetTop ?? 0
  const relTop = Math.max(0, scrollTop - spacerTop)
  const { start, end } = ventanaMontada(offsets, items.length, relTop, viewport, overscan)
  useAvisoRango(start, end, items, onRangoVisible)

  return (
    <div
      {...resto}
      ref={(node) => asignarNodo(innerScrollRef, scrollRef, node)}
      className={className}
      aria-label={ariaLabel}
      onScroll={handleScroll}
      style={{ ...style, overflowY: 'auto', position: 'relative' }}
    >
      {header}
      {/* El espaciador es geometría pura: fuera del árbol de accesibilidad, como los envoltorios de fila. */}
      <div ref={spacerRef} role="presentation" style={{ height: total, position: 'relative' }}>
        {filasMontadas(items, offsets, start, end, getKey, renderItem)}
      </div>
      {footer}
    </div>
  )
}
