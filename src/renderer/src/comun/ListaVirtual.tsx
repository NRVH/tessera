// =============================================================================
// ListaVirtual: lista virtualizada por reciclado de DOM. Monta solo las filas visibles más un
// colchón de `overscan`; un spacer con la altura total reserva el recorrido del scroll y las
// filas se posicionan en absoluto sobre él. Las alturas (número o función por índice) se
// conocen de antemano: el scroll se mapea a índice por búsqueda binaria sobre sumas prefijas.
// `header` y `footer` scrollean dentro del contenedor. Depende de `useVirtualizacion.ts`.
// Decisiones: docs/decisiones/renderer/lista-virtual.md
// =============================================================================

import { useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import {
  calcularDesplazamientos,
  useAvisoRango,
  useMedirViewport,
  useRevelarIndice,
  useScrollPorFotograma,
  ventanaMontada,
  type AlturaFila
} from './useVirtualizacion'

interface PropsListaVirtual<T> {
  /** Datos completos (la lista entera; se monta solo la ventana visible). */
  elementos: readonly T[]
  /** Alto de una fila en px: constante, o por índice si varía por tipo/estado. */
  altoElemento: AlturaFila
  /** Pinta el contenido de la fila `index`. El wrapper posicionado lo aporta la lista. */
  pintarElemento: (elemento: T, indice: number) => ReactNode
  /** Clave estable por fila (para el reconciliador de React). */
  obtenerClave: (elemento: T, indice: number) => string
  /** Filas extra montadas fuera de vista a cada lado (anti-parpadeo). Def. 6. */
  overscan?: number
  /** Id del contenedor que scrollea: lo que nombra `aria-controls` de un filtro que gobierna la lista. */
  id?: string
  className?: string
  etiquetaAria?: string
  /**
   * Estilos extra del contenedor que scrollea. Existe para que el padre pueda
   * fijar su ALTO (p. ej. el reparto arrastrable de la columna de detalle del log)
   * sin envolver la lista en otro div, que rompería el `flex` de la columna. Se
   * mezcla ANTES que los estilos propios: `overflowY`/`position` no son negociables.
   */
  style?: CSSProperties
  /** Contenido fijo arriba (estados, buscador…): scrollea con la lista. */
  cabecera?: ReactNode
  /** Contenido al final (p. ej. "cargar más historial"): scrollea con la lista. */
  pie?: ReactNode
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
  indiceARevelar?: number | null
  /**
   * Contador para volver a revelar el MISMO índice.
   *
   * El efecto de revelado depende solo de `indiceARevelar`, así que pedir dos veces
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
  /** La lista deja marcar varias filas (`aria-selected` en cada una). */
  'aria-multiselectable'?: boolean
}

/** Asigna el nodo al ref interno y al `scrollRef` del padre (solo lo lee, aunque el tipo sea readonly). */
function asignarNodo(
  scrollInternoRef: { current: HTMLDivElement | null },
  scrollRef: RefObject<HTMLDivElement> | undefined,
  nodo: HTMLDivElement | null
): void {
  scrollInternoRef.current = nodo
  if (scrollRef) (scrollRef as { current: HTMLDivElement | null }).current = nodo
}

/** Filas montadas [start, end), cada una en su offset absoluto. */
function filasMontadas<T>(
  elementos: readonly T[],
  desplazamientos: Float64Array,
  inicio: number,
  fin: number,
  obtenerClave: (elemento: T, indice: number) => string,
  pintarElemento: (elemento: T, indice: number) => ReactNode
): ReactNode[] {
  const filas: ReactNode[] = []
  for (let i = inicio; i < fin; i++) {
    filas.push(
      <div
        key={obtenerClave(elementos[i], i)}
        // `presentation`: el div solo posiciona; así las `option` cuelgan del `listbox` en el árbol de accesibilidad.
        role="presentation"
        style={{ position: 'absolute', top: desplazamientos[i], left: 0, right: 0, height: desplazamientos[i + 1] - desplazamientos[i] }}
      >
        {pintarElemento(elementos[i], i)}
      </div>
    )
  }
  return filas
}

export function ListaVirtual<T>({
  elementos,
  altoElemento,
  pintarElemento,
  obtenerClave,
  overscan = 6,
  className,
  etiquetaAria,
  style,
  cabecera,
  pie,
  scrollRef,
  onScroll,
  onRangoVisible,
  indiceARevelar,
  scrollToken,
  ...resto
}: PropsListaVirtual<T>): React.JSX.Element {
  const scrollInternoRef = useRef<HTMLDivElement | null>(null)
  const espaciadorRef = useRef<HTMLDivElement>(null)
  const [desplazamiento, setDesplazamiento] = useState(0)
  const [viewport, setViewport] = useState(0)

  const el = (): HTMLDivElement | null => (scrollRef ? scrollRef.current : null) ?? scrollInternoRef.current

  // Se recalcula solo si cambian datos o alturas.
  const desplazamientos = useMemo(() => calcularDesplazamientos(elementos.length, altoElemento), [elementos, altoElemento])
  const total = desplazamientos[elementos.length]

  useMedirViewport(el, setViewport)
  const alDesplazar = useScrollPorFotograma(el, onScroll, setDesplazamiento)
  useRevelarIndice(el, espaciadorRef, desplazamientos, elementos.length, indiceARevelar, scrollToken)

  // Offset del spacer dentro del contenido scrolleable (= alto del header, medido en vivo).
  const desplazamientoEspaciador = espaciadorRef.current?.offsetTop ?? 0
  const desplazamientoRelativo = Math.max(0, desplazamiento - desplazamientoEspaciador)
  const { inicio, fin } = ventanaMontada(desplazamientos, elementos.length, desplazamientoRelativo, viewport, overscan)
  useAvisoRango(inicio, fin, elementos, onRangoVisible)

  return (
    <div
      {...resto}
      ref={(nodo) => asignarNodo(scrollInternoRef, scrollRef, nodo)}
      className={className}
      aria-label={etiquetaAria}
      onScroll={alDesplazar}
      style={{ ...style, overflowY: 'auto', position: 'relative' }}
    >
      {cabecera}
      {/* El espaciador es geometría pura: fuera del árbol de accesibilidad, como los envoltorios de fila. */}
      <div ref={espaciadorRef} role="presentation" style={{ height: total, position: 'relative' }}>
        {filasMontadas(elementos, desplazamientos, inicio, fin, obtenerClave, pintarElemento)}
      </div>
      {pie}
    </div>
  )
}
