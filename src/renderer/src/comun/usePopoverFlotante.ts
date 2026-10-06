// =============================================================================
// La mecánica de foco y cierre de los popovers flotantes de la app (los de la vista de BD —esquemas
// visibles, selector de esquema de la consola, historial y los selectores de base de documentos y
// claves— y la lista de conexiones SSH): cerrar con un clic fuera y dar el foco al filtro,
// devolviéndolo al cerrar. Solo depende de React.
// Decisiones: docs/decisiones/bd/ui-consola-popovers.md, docs/decisiones/renderer/boton-dividido-y-capa-flotante.md
// =============================================================================

import { useEffect, useRef, type RefObject } from 'react'

/** Da el foco al filtro al abrir y lo devuelve a quien lo tenía si al cerrar queda huérfano. */
export function useFocoDelFiltro(filtroRef: RefObject<HTMLInputElement>): void {
  // Solo si el foco quedó HUÉRFANO: si se cerró con un clic en el editor, es suyo.
  useEffect(() => {
    const antes = document.activeElement
    filtroRef.current?.focus()
    return () => {
      const huerfano = document.activeElement === null || document.activeElement === document.body
      if (huerfano && antes instanceof HTMLElement && document.contains(antes)) antes.focus()
    }
  }, [filtroRef])
}

/**
 * Clic FUERA del popover llama a `alFuera` (la versión viva), y el foco entra en el
 * filtro y vuelve a donde estaba al cerrar si quedó huérfano en `<body>`.
 */
export function useCierreYFoco(
  raizRef: RefObject<HTMLElement>,
  filtroRef: RefObject<HTMLInputElement>,
  alFuera: () => unknown
): void {
  const alFueraRef = useRef(alFuera)
  alFueraRef.current = alFuera

  // `mousedown` y no `click`: el popover se resuelve antes de que el clic llegue a lo
  // que hay debajo (una fila del árbol, otra insignia que abre su propio popover).
  useEffect(() => {
    function fuera(e: MouseEvent): void {
      const raiz = raizRef.current
      if (raiz && e.target instanceof Node && raiz.contains(e.target)) return
      void alFueraRef.current()
    }
    window.addEventListener('mousedown', fuera)
    return () => window.removeEventListener('mousedown', fuera)
  }, [raizRef])

  useFocoDelFiltro(filtroRef)
}
