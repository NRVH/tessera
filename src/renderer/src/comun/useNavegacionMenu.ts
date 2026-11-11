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
export function useDevolverFoco(menuRef: RefObject<HTMLDivElement>, disparador?: RefObject<HTMLElement>, panelRef?: RefObject<HTMLDivElement>): void {
  useLayoutEffect(
    () => () => {
      const dentro = (el: HTMLDivElement | null | undefined): boolean => el?.contains(document.activeElement) === true
      if (dentro(menuRef.current) || dentro(panelRef?.current)) disparador?.current?.focus({ preventScroll: true })
    },
    [menuRef, disparador, panelRef]
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

/** Lo que cambia entre el menú y su submenú, que comparten la misma ventana de teclado. */
export interface OpcionesNavegacion {
  /** El submenú abierto con el ratón no se lleva el foco. */
  enfocarAlAbrir?: boolean
  /** El foco está en el otro panel: estas teclas son suyas. */
  suspendido?: () => boolean
  /** El menú y su submenú escuchan en la misma ventana: Esc en el submenú no debe llegar también al menú. */
  consumirEscape?: boolean
  /** ← o → sobre la entrada `indice`, o -1 si el foco no está en una. */
  alLado?: (tecla: 'ArrowLeft' | 'ArrowRight', indice: number) => void
}

/** Foco inicial en el menú y teclado (↑/↓ con wrap, Inicio/Fin, Escape, ←/→) sobre las entradas enfocables. */
export function useNavegacionMenu(
  entries: ContextMenuEntry[],
  menuRef: RefObject<HTMLDivElement>,
  itemRefs: MutableRefObject<(HTMLButtonElement | null)[]>,
  onClose: () => void,
  { enfocarAlAbrir = true, suspendido, consumirEscape = false, alLado }: OpcionesNavegacion = {}
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
    if (!enfocarAlAbrir) return
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
    // Un diálogo frena el `mousedown` de su tarjeta para no cerrar lo que tiene detrás: por `onDown` nunca se oiría.
    function onDownEnDialogo(e: MouseEvent): void {
      if (e.target instanceof Element && e.target.closest('.modal-overlay') && !e.target.closest('.ctx-menu, [aria-haspopup="menu"][aria-expanded="true"]')) onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (suspendido?.() || e.defaultPrevented) return
      if (e.key === 'Escape') {
        if (consumirEscape) e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const nth = currentNth()
        alLado?.(e.key, nth === -1 ? -1 : focusable[nth])
      } else if (e.key === 'ArrowDown') {
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
    window.addEventListener('mousedown', onDownEnDialogo, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousedown', onDownEnDialogo, true)
      window.removeEventListener('keydown', onKey)
    }
    // focusAt/currentNth leen `focusable` del render vigente; el menú no cambia de
    // items mientras está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, focusable])
}
