// =============================================================================
// Navegación del riel de categorías del modal de Configuración: saltar a un bloque
// de resultados y mover la selección con ↑/↓/Home/End (con vuelta al principio).
// Depende de `siguienteCategoria` del catálogo; el modal posee la categoría elegida.
// =============================================================================

import { useRef, type MutableRefObject, type RefObject } from 'react'
import { siguienteCategoria, type CategoriaId } from './catalogo'

/** Destino de las teclas del riel (↑/↓/Home/End), o null si la tecla no navega. */
function destinoEnRiel(
  tecla: string,
  categoria: CategoriaId,
  categorias: readonly { id: CategoriaId }[]
): CategoriaId | null {
  if (tecla === 'ArrowDown') return siguienteCategoria(categoria, 1, categorias)
  if (tecla === 'ArrowUp') return siguienteCategoria(categoria, -1, categorias)
  if (tecla === 'Home') return categorias[0].id
  if (tecla === 'End') return categorias[categorias.length - 1].id
  return null
}

/** Refs y manejadores del riel: el nodo del riel, los bloques de resultados, `irA` y el teclado. */
export function useRielAjustes(
  categoria: CategoriaId,
  categorias: readonly { id: CategoriaId }[],
  onCambiarCategoria: (id: CategoriaId) => void
): {
  rielRef: RefObject<HTMLElement>
  bloques: MutableRefObject<Map<string, HTMLDivElement>>
  irA: (id: CategoriaId) => void
  alPulsarEnRiel: (e: React.KeyboardEvent) => void
} {
  const rielRef = useRef<HTMLElement>(null)
  /** Cada bloque de categoría del panel, para poder saltar a él desde el riel. */
  const bloques = useRef(new Map<string, HTMLDivElement>())

  /** Salta al bloque de una categoría (solo existe mientras hay consulta). */
  function irA(id: CategoriaId): void {
    onCambiarCategoria(id)
    bloques.current.get(id)?.scrollIntoView({ block: 'start' })
  }

  /** ↑/↓/Home/End sobre el riel, con vuelta al principio. Activación inmediata. */
  function alPulsarEnRiel(e: React.KeyboardEvent): void {
    const destino = destinoEnRiel(e.key, categoria, categorias)
    if (destino === null) return
    e.preventDefault()
    irA(destino)
    // El roving tabindex mueve el `tabIndex=0` al nuevo, pero el foco hay que
    // llevarlo a mano o se queda en el botón anterior, que ya es inalcanzable.
    rielRef.current?.querySelector<HTMLElement>(`[data-cat="${destino}"]`)?.focus()
  }

  return { rielRef, bloques, irA, alPulsarEnRiel }
}
