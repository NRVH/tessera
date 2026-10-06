// =============================================================================
// useDialogo: el comportamiento de teclado y foco que comparten los modales — Esc,
// devolución del foco a quien abrió y trampa de Tab opcional (`alPulsarTecla`).
// Es un hook y no un componente porque las cáscaras de los modales difieren y lo común
// es el comportamiento. Se llama arriba del todo del componente, antes de cualquier
// efecto que mueva el foco. Depende de React y de `pilaDialogos`: con varios diálogos
// abiertos, el Esc solo lo atiende el de encima, y ninguno si cierra la lista de un select.
// Decisiones: docs/decisiones/renderer/dialogos-foco-y-teclado.md
// =============================================================================

import { useEffect, useId, useRef } from 'react'
import { apilar, desapilar, esCima } from './pilaDialogos'

/** Enfocables de verdad para la trampa de Tab: `[tabindex="-1"]` queda fuera (tabs inactivos, botones ocultos). */
const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]'
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(',')

/**
 * ¿Viene la tecla de un `<select>` con su lista desplegada? Esa lista es un popover del motor
 * (`selectDesplegable.css`), no un menú del sistema: su Esc también llega a `window`, y debe
 * cerrar solo la lista.
 */
export function esDeUnaListaDeSelect(destino: EventTarget | null): boolean {
  return destino instanceof Element && destino.closest('select')?.matches(':open') === true
}

/**
 * El `onMouseDown` del VELO de un diálogo que cierra con el clic fuera. Solo cierra si el clic es
 * en el propio velo (`target === currentTarget`) y frena la propagación: un diálogo montado dentro
 * de otro (renombrar o eliminar sobre el historial) burbujearía, por el árbol de React, hasta el
 * velo del padre y lo cerraría también.
 */
export function alClicEnVelo(onCancel: () => void): (e: React.MouseEvent) => void {
  return (e) => {
    if (e.target !== e.currentTarget) return
    e.stopPropagation()
    onCancel()
  }
}

export interface Dialogo {
  /** Va en la CARD (no en el overlay): delimita la trampa de foco. */
  ref: React.RefObject<HTMLDivElement>
  /** Va en el `onKeyDown` de la card: implementa la trampa de Tab. */
  alPulsarTecla: (e: React.KeyboardEvent) => void
}

/** Esc, devolución del foco al cerrar y trampa de Tab opcional para un modal. */
export function useDialogo({
  onClose,
  cerrable = true
}: {
  onClose: () => void
  /** `false` mientras el modal no se pueda abandonar (un proceso a medias). */
  cerrable?: boolean
}): Dialogo {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  // En la pila mientras esté montado, sea o no `cerrable`: uno que no se puede cerrar sigue
  // tapando a los de debajo, y el Esc que él no atiende tampoco debe cerrarlos.
  useEffect(() => {
    apilar(id)
    return () => desapilar(id)
  }, [id])

  // Esc en WINDOW y no en la card: el foco puede estar en un hueco no enfocable y la card
  // no recibiría teclas. Quien necesite quedarse un Esc lo para con `stopPropagation()`
  // en su handler de React, que corre antes de que el evento nativo llegue a window.
  // Solo lo atiende el diálogo de la cima; `esCima` recibe el evento para que el orden de
  // los manejadores en window no cambie la respuesta.
  useEffect(() => {
    if (!cerrable) return
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || !esCima(id, e) || esDeUnaListaDeSelect(e.target)) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, cerrable, id])

  // Devolución del foco a quien abrió el modal, capturado en el montaje. Se guarda la
  // cadena de ancestros y no solo el elemento: si quien abrió era la fila que se borra,
  // se sube hasta el primer ancestro conectado y enfocable. `preventScroll` para que
  // devolver el foco no mueva la vista.
  useEffect(() => {
    const cadena: HTMLElement[] = []
    for (let el: Element | null = document.activeElement; el instanceof HTMLElement; el = el.parentElement) {
      cadena.push(el)
    }
    return () => {
      cadena.find((el) => el.isConnected && el.tabIndex >= 0)?.focus({ preventScroll: true })
    }
  }, [])

  function alPulsarTecla(e: React.KeyboardEvent): void {
    if (e.key !== 'Tab' || esDeUnaListaDeSelect(e.target)) return
    const card = ref.current
    if (!card) return
    const lista = [...card.querySelectorAll<HTMLElement>(ENFOCABLES)].filter(
      // `offsetParent === null` descarta lo que está oculto por display:none, que
      // es como se esconden las filas que el buscador filtra.
      (el) => el.offsetParent !== null || el === document.activeElement
    )
    if (lista.length === 0) return
    const primero = lista[0]
    const ultimo = lista[lista.length - 1]
    const activo = document.activeElement
    if (e.shiftKey && (activo === primero || !card.contains(activo))) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && activo === ultimo) {
      e.preventDefault()
      primero.focus()
    }
  }

  return { ref, alPulsarTecla }
}
