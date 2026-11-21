// =============================================================================
// Hooks de `MenuContextual`: posición acotada al viewport, navegación por teclado (foco al
// abrir en la primera opción, flechas, Inicio/Fin y Escape) y la devolución del
// foco al disparador al cerrarse. Se llaman desde el propio componente, en este orden, para
// que los efectos corran como corrían dentro de él. Depende de `menuContextualModelo.ts`.
// =============================================================================

import { useEffect, useLayoutEffect, useMemo, useState, type MutableRefObject, type RefObject } from 'react'
import { documentoDe, esElemento, ventanaDeNodo } from '../util/ventanaDe'
import { indicesEnfocables, posicionMenu, type AnclajeMenuContextual, type EntradaMenuContextual } from './menuContextualModelo'

/**
 * Al cerrarse el menú, si el foco seguía DENTRO de él, vuelve al disparador (el botón que lo
 * abrió). Es un efecto de layout a propósito: su limpieza corre antes de que React quite el
 * DOM del menú, cuando el foco aún está en él; después ya habría caído en `<body>`. Si el
 * foco se había ido a otro sitio (un clic fuera en un campo) no se toca.
 */
export function useDevolverFoco(menuRef: RefObject<HTMLDivElement>, disparador?: RefObject<HTMLElement>, panelRef?: RefObject<HTMLDivElement>): void {
  useLayoutEffect(
    () => () => {
      const dentro = (el: HTMLDivElement | null | undefined): boolean =>
        el != null && el.contains(documentoDe(el).activeElement)
      if (dentro(menuRef.current) || dentro(panelRef?.current)) disparador?.current?.focus({ preventScroll: true })
    },
    [menuRef, disparador, panelRef]
  )
}

/** Mide el menú y lo acota a la ventana según su anclaje, con 8 px de margen. */
export function usePosicionMenu(
  menuRef: RefObject<HTMLDivElement>,
  x: number,
  y: number,
  numEntradas: number,
  anclaje: AnclajeMenuContextual = 'cursor'
): { left: number; top: number } {
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y })
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const ventana = ventanaDeNodo(el)
    setPos(posicionMenu({ x, y }, { width, height }, { width: ventana.innerWidth, height: ventana.innerHeight }, anclaje))
  }, [menuRef, x, y, numEntradas, anclaje])
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
  entradas: EntradaMenuContextual[],
  menuRef: RefObject<HTMLDivElement>,
  elementoRefs: MutableRefObject<(HTMLButtonElement | null)[]>,
  onCerrar: () => void,
  { enfocarAlAbrir = true, suspendido, consumirEscape = false, alLado }: OpcionesNavegacion = {}
): void {
  /** Índices de las entradas ENFOCABLES (ni separador ni deshabilitada). */
  const enfocables = useMemo(() => indicesEnfocables(entradas), [entradas])

  /** Mueve el foco al n-ésimo enfocable, con wrap en ambos extremos. */
  function enfocarEn(ordinal: number): void {
    if (enfocables.length === 0) return
    const wrapped = (ordinal + enfocables.length) % enfocables.length
    elementoRefs.current[enfocables[wrapped]]?.focus()
  }

  /** Posición ACTUAL dentro de `focusable`, o -1 si el foco no está en un ítem. */
  function ordinalActual(): number {
    const activo = documentoDe(menuRef.current).activeElement
    return enfocables.findIndex((i) => elementoRefs.current[i] === activo)
  }

  // Al abrirse el foco entra en la primera opción; sin ítems enfocables se enfoca el contenedor
  // para que Esc siga valiendo.
  useEffect(() => {
    if (!enfocarAlAbrir) return
    if (enfocables.length > 0) enfocarEn(0)
    else menuRef.current?.focus()
    // Solo al montar (y si cambia el conjunto enfocable, que en la práctica no ocurre
    // con el menú abierto).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const ventana = ventanaDeNodo(menuRef.current)
    function alPulsarRaton(): void {
      onCerrar()
    }
    // Un diálogo frena el `mousedown` de su tarjeta para no cerrar lo que tiene detrás: por `alPulsarRaton` nunca se oiría.
    function alPulsarRatonEnDialogo(e: MouseEvent): void {
      if (esElemento(e.target) && e.target.closest('.modal-overlay') && !e.target.closest('.ctx-menu, [aria-haspopup="menu"][aria-expanded="true"]')) onCerrar()
    }
    function alPulsarTeclaVentana(e: KeyboardEvent): void {
      if (suspendido?.() || e.defaultPrevented) return
      if (e.key === 'Escape') {
        if (consumirEscape) e.preventDefault()
        onCerrar()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const ordinal = ordinalActual()
        alLado?.(e.key, ordinal === -1 ? -1 : enfocables[ordinal])
      } else if (e.key === 'ArrowDown') {
        e.preventDefault() // no scrollear la página detrás del menú
        enfocarEn(ordinalActual() + 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        // Sin foco previo (-1), ArrowUp entra por el ÚLTIMO ítem: -1 + (-1) = -2 -> wrap.
        enfocarEn(ordinalActual() <= 0 ? enfocables.length - 1 : ordinalActual() - 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        enfocarEn(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        enfocarEn(enfocables.length - 1)
      }
    }
    ventana.addEventListener('mousedown', alPulsarRaton)
    ventana.addEventListener('mousedown', alPulsarRatonEnDialogo, true)
    ventana.addEventListener('keydown', alPulsarTeclaVentana)
    // Solo la raíz cierra al perder el foco de la ventana: desmonta también el submenú sin tocar el foco.
    if (!consumirEscape) ventana.addEventListener('blur', alPulsarRaton)
    return () => {
      ventana.removeEventListener('mousedown', alPulsarRaton)
      ventana.removeEventListener('mousedown', alPulsarRatonEnDialogo, true)
      ventana.removeEventListener('keydown', alPulsarTeclaVentana)
      if (!consumirEscape) ventana.removeEventListener('blur', alPulsarRaton)
    }
    // enfocarEn/ordinalActual leen `enfocables` del render vigente; el menú no cambia de
    // items mientras está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCerrar, enfocables])
}
