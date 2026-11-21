// =============================================================================
// La mecánica de foco y cierre de los popovers flotantes de la app (los de la vista de BD —esquemas
// visibles, selector de esquema de la consola, historial y los selectores de base de documentos y
// claves— y la lista de conexiones SSH): cerrar con un clic fuera y dar el foco al filtro,
// devolviéndolo al cerrar. Solo depende de React y `ventanaDe`.
// Decisiones: docs/decisiones/bd/ui-consola-popovers.md, docs/decisiones/renderer/boton-dividido-y-capa-flotante.md
// =============================================================================

import { useEffect, useRef, type RefObject } from 'react'
import { documentoDe, esElementoHtml, esNodo, ventanaDeNodo } from '../util/ventanaDe'

/** Da el foco al filtro al abrir y lo devuelve a quien lo tenía si al cerrar queda huérfano. */
export function useFocoDelFiltro(filtroRef: RefObject<HTMLInputElement>): void {
  // Solo si el foco quedó HUÉRFANO: si se cerró con un clic en el editor, es suyo.
  useEffect(() => {
    const filtro = filtroRef.current
    const doc = documentoDe(filtro)
    const antes = doc.activeElement
    filtro?.focus()
    return () => {
      const huerfano = doc.activeElement === null || doc.activeElement === doc.body
      if (huerfano && esElementoHtml(antes) && doc.contains(antes)) antes.focus()
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
    const ventana = ventanaDeNodo(raizRef.current)
    function fuera(e: MouseEvent): void {
      const raiz = raizRef.current
      if (raiz && esNodo(e.target) && raiz.contains(e.target)) return
      void alFueraRef.current()
    }
    ventana.addEventListener('mousedown', fuera)
    return () => ventana.removeEventListener('mousedown', fuera)
  }, [raizRef])

  useFocoDelFiltro(filtroRef)
}
