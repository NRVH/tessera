// =============================================================================
// Hooks de `ContextMenu`: posición acotada al viewport, navegación por teclado (foco al
// abrir en la primera opción, flechas, Inicio/Fin y Escape) y la devolución del
// foco al disparador al cerrarse. Se llaman desde el propio componente, en este orden, para
// que los efectos corran como corrían dentro de él. Depende de `contextMenuModel.ts`.
// =============================================================================

import { useEffect, useLayoutEffect, useMemo, useState, type MutableRefObject, type RefObject } from 'react'
import { focusableIndices, type ContextMenuEntry } from './contextMenuModel'

/**
 * Al cerrarse el menú, si el foco seguía DENTRO de él, vuelve al disparador (el botón que lo
 * abrió). Es un efecto de layout a propósito: su limpieza corre antes de que React quite el
 * DOM del menú, cuando el foco aún está en él; después ya habría caído en `<body>`. Si el
 * foco se había ido a otro sitio (un clic fuera en un campo) no se toca.
 */
export function useDevolverFoco(menuRef: RefObject<HTMLDivElement>, disparador?: RefObject<HTMLElement>): void {
  useLayoutEffect(
    () => () => {
      const menu = menuRef.current
      if (menu && menu.contains(document.activeElement)) disparador?.current?.focus({ preventScroll: true })
    },
    [menuRef, disparador]
  )
}

/** Posición efectiva del menú: parte de (x, y) y, tras medir, se acota al viewport con 8px de margen. */
export function usePosicionMenu(
  menuRef: RefObject<HTMLDivElement>,
  x: number,
  y: number,
  numEntradas: number
): { left: number; top: number } {
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - height - margin))
    setPos({ left, top })
  }, [menuRef, x, y, numEntradas])
  return pos
}

/** Foco inicial en el menú y teclado (↑/↓ con wrap, Inicio/Fin, Escape) sobre las entradas enfocables. */
export function useNavegacionMenu(
  entries: ContextMenuEntry[],
  menuRef: RefObject<HTMLDivElement>,
  itemRefs: MutableRefObject<(HTMLButtonElement | null)[]>,
  onClose: () => void
): void {
  /** Índices de las entradas ENFOCABLES (ni separador ni deshabilitada). */
  const focusable = useMemo(() => focusableIndices(entries), [entries])

  /** Mueve el foco al n-ésimo enfocable, con wrap en ambos extremos. */
  function focusAt(nth: number): void {
    if (focusable.length === 0) return
    const wrapped = (nth + focusable.length) % focusable.length
    itemRefs.current[focusable[wrapped]]?.focus()
  }

  /** Posición ACTUAL dentro de `focusable`, o -1 si el foco no está en un ítem. */
  function currentNth(): number {
    const active = document.activeElement
    return focusable.findIndex((i) => itemRefs.current[i] === active)
  }

  // Al abrirse el foco entra en la primera opción; sin ítems enfocables se enfoca el contenedor
  // para que Esc siga valiendo.
  useEffect(() => {
    if (focusable.length > 0) focusAt(0)
    else menuRef.current?.focus()
    // Solo al montar (y si cambia el conjunto enfocable, que en la práctica no ocurre
    // con el menú abierto).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onDown(): void {
      onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault() // no scrollear la página detrás del menú
        focusAt(currentNth() + 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        // Sin foco previo (-1), ArrowUp entra por el ÚLTIMO ítem: -1 + (-1) = -2 -> wrap.
        focusAt(currentNth() <= 0 ? focusable.length - 1 : currentNth() - 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        focusAt(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        focusAt(focusable.length - 1)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
    // focusAt/currentNth leen `focusable` del render vigente; el menú no cambia de
    // items mientras está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, focusable])
}
