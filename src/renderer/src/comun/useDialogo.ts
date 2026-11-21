// =============================================================================
// useDialogo: el comportamiento de teclado y foco que comparten los modales — Esc,
// devolución del foco a quien abrió, trampa de Tab opcional (`alPulsarTecla`) y la salida
// animada al cerrarse (`despedida.ts`).
// Es un hook porque las cáscaras de los modales difieren y lo común es el comportamiento.
// Se llama arriba del todo del componente, antes de cualquier efecto que mueva el foco.
// Con varios diálogos abiertos en la misma ventana (`pilaDialogos`), el Esc solo lo
// atiende el de encima, y ninguno si cierra la lista de un select.
// Decisiones: docs/decisiones/renderer/dialogos-foco-y-teclado.md
// =============================================================================

import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { documentoDe, esElemento, esElementoHtml } from '../util/ventanaDe'
import { useCapaVisible } from './capaVisible'
import { useDocumentoActual } from './contextoDocumento'
import { despedir } from './despedida.ts'
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
  return esElemento(destino) && destino.closest('select')?.matches(':open') === true
}

/** ¿Viene la tecla de un menú abierto sobre el diálogo? Su Esc también llega a `window`, y debe cerrar solo el menú. */
export function esDeUnMenu(destino: EventTarget | null): boolean {
  return esElemento(destino) && destino.closest('.ctx-menu') !== null
}

/**
 * El `onMouseDown` del VELO de un diálogo que cierra con el clic fuera. Solo cierra si el clic es
 * en el propio velo (`target === currentTarget`) y frena la propagación: un diálogo montado dentro
 * de otro (renombrar o eliminar sobre el historial) burbujearía, por el árbol de React, hasta el
 * velo del padre y lo cerraría también.
 */
export function alClicEnVelo(onCancelar: () => void): (e: React.MouseEvent) => void {
  return (e) => {
    if (e.target !== e.currentTarget) return
    e.stopPropagation()
    onCancelar()
  }
}

/**
 * Al volver a verse la capa de un diálogo (`CapaViva`), el foco regresa a donde estaba dentro de
 * la card: `inert` lo sacó al ocultarse. Si aquel elemento ya no está, al primer enfocable.
 */
function useFocoAlVolver(ref: React.RefObject<HTMLDivElement>, visible: boolean): void {
  const ultimoFoco = useRef<HTMLElement | null>(null)
  const vistoAntes = useRef(visible)

  useEffect(() => {
    const tarjeta = ref.current
    if (!tarjeta) return
    const doc = documentoDe(tarjeta)
    // El diálogo pudo enfocar un campo antes de este efecto, y ese foco no llega como `focusin`.
    if (esElementoHtml(doc.activeElement) && tarjeta.contains(doc.activeElement)) {
      ultimoFoco.current = doc.activeElement
    }
    const apuntar = (e: FocusEvent): void => {
      if (esElementoHtml(e.target)) ultimoFoco.current = e.target
    }
    tarjeta.addEventListener('focusin', apuntar)
    return () => tarjeta.removeEventListener('focusin', apuntar)
  }, [ref])

  useEffect(() => {
    const volvio = visible && !vistoAntes.current
    vistoAntes.current = visible
    const tarjeta = ref.current
    if (!volvio || !tarjeta) return
    const doc = documentoDe(tarjeta)
    if (tarjeta.contains(doc.activeElement)) return
    const previo = ultimoFoco.current
    const destino = previo && previo.isConnected && tarjeta.contains(previo) ? previo : tarjeta.querySelector<HTMLElement>(ENFOCABLES)
    destino?.focus({ preventScroll: true })
  }, [ref, visible])
}

/**
 * Devolución del foco a quien abrió el modal. Se guarda la cadena de ancestros y no solo el
 * elemento: si quien abrió era la fila que se borra, se sube hasta el primer ancestro conectado y
 * enfocable. `preventScroll` para que devolver el foco no mueva la vista. Solo con la capa a la
 * vista: oculta, el foco no es de este diálogo, así que el opener se captura al verse por primera
 * vez y el foco solo se devuelve si al desmontar se veía.
 */
function useDevolverFocoAlOpener(visible: boolean, doc: Document): void {
  const cadenaOpener = useRef<HTMLElement[] | null>(null)
  const visibleRef = useRef(visible)
  useEffect(() => {
    visibleRef.current = visible
    if (!visible || cadenaOpener.current !== null) return
    const cadena: HTMLElement[] = []
    for (let el: Element | null = doc.activeElement; esElementoHtml(el); el = el.parentElement) {
      cadena.push(el)
    }
    cadenaOpener.current = cadena
  }, [visible, doc])
  useEffect(
    () => () => {
      if (!visibleRef.current) return
      cadenaOpener.current?.find((el) => el.isConnected && el.tabIndex >= 0)?.focus({ preventScroll: true })
    },
    []
  )
}

export interface Dialogo {
  /** Va en la CARD (no en el overlay): delimita la trampa de foco. */
  ref: React.RefObject<HTMLDivElement>
  /** Va en el `onKeyDown` de la card: implementa la trampa de Tab. */
  alPulsarTecla: (e: React.KeyboardEvent) => void
}

/** Esc, devolución del foco al cerrar y trampa de Tab opcional para un modal. */
export function useDialogo({
  onCerrar,
  cerrable = true,
  documento
}: {
  onCerrar: () => void
  /** `false` mientras el modal no se pueda abandonar (un proceso a medias). */
  cerrable?: boolean
  /** Documento del diálogo; sin indicar, usa el del contexto o el principal. */
  documento?: Document
}): Dialogo {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const docActual = useDocumentoActual(documento)
  // Uno en una capa viva oculta (`CapaViva`) sigue montado con lo que tenga a medias, pero no
  // tapa nada: fuera de la pila y sin Esc hasta que su capa vuelva a verse.
  const visible = useCapaVisible()

  // En la pila de su documento mientras esté montado y a la vista, sea o no `cerrable`: uno que
  // no se puede cerrar sigue tapando a los de debajo en su ventana, sin bloquear a otras ventanas.
  useEffect(() => {
    if (!visible) return
    const doc = ref.current ? documentoDe(ref.current) : docActual
    apilar(id, doc)
    return () => desapilar(id, doc)
  }, [id, visible, docActual])

  // Esc en la ventana del diálogo y no en la card: el foco puede estar en un hueco no enfocable
  // y la card no recibiría teclas. Quien necesite quedarse un Esc lo para con `stopPropagation()`
  // en su handler de React, que corre antes de que el evento nativo llegue a la ventana.
  // Solo lo atiende el diálogo de la cima de esa ventana.
  useEffect(() => {
    if (!cerrable || !visible) return
    const doc = ref.current ? documentoDe(ref.current) : docActual
    const ventana = doc.defaultView ?? window
    function alPulsarTeclaVentana(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || !esCima(id, e, doc) || esDeUnaListaDeSelect(e.target) || esDeUnMenu(e.target)) return
      e.preventDefault()
      onCerrar()
    }
    ventana.addEventListener('keydown', alPulsarTeclaVentana)
    return () => ventana.removeEventListener('keydown', alPulsarTeclaVentana)
  }, [onCerrar, cerrable, id, visible, docActual])

  useDevolverFocoAlOpener(visible, docActual)
  useFocoAlVolver(ref, visible)

  // Al desmontarse a la vista, el modal entero (velo y tarjeta) se despide con su salida en vez de desaparecer.
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  useLayoutEffect(() => {
    const tarjeta = ref
    return () => {
      if (!visibleRef.current || !tarjeta.current) return
      despedir(tarjeta.current.closest<HTMLElement>('.modal-overlay') ?? tarjeta.current, 'modal')
    }
  }, [])

  function alPulsarTecla(e: React.KeyboardEvent): void {
    if (e.key !== 'Tab' || esDeUnaListaDeSelect(e.target)) return
    const tarjeta = ref.current
    if (!tarjeta) return
    const doc = documentoDe(tarjeta)
    const activo = doc.activeElement
    const lista = [...tarjeta.querySelectorAll<HTMLElement>(ENFOCABLES)].filter(
      // `offsetParent === null` descarta lo que está oculto por display:none, que
      // es como se esconden las filas que el buscador filtra.
      (el) => el.offsetParent !== null || el === activo
    )
    if (lista.length === 0) return
    const primero = lista[0]
    const ultimo = lista[lista.length - 1]
    if (e.shiftKey && (activo === primero || !tarjeta.contains(activo))) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && activo === ultimo) {
      e.preventDefault()
      primero.focus()
    }
  }

  return { ref, alPulsarTecla }
}
