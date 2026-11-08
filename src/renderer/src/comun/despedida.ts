// =============================================================================
// La salida de lo que se cierra desmontándose (modales, menús, popovers, tooltips): al desmontarse deja en su sitio
// una copia inerte que hace la animación de salida de `movimiento.css` y se borra. Así quien lo cierra no cambia
// nada: sigue quitándolo del árbol, y el usuario lo ve irse en vez de desaparecer. La copia no se puede enfocar ni
// pulsar, no tiene ids ni está en el árbol de accesibilidad, y conserva lo escrito en sus campos. No se hace con
// «reducir movimiento», ni si el elemento no se veía (una capa oculta que se desmonta).
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useLayoutEffect, useRef } from 'react'
import { MS_SALIDA, movimientoReducido } from './presencia.ts'

/** Marca de un elemento que ya dejó su copia: un menú dentro de la capa flotante se despediría dos veces. */
const DESPEDIDO = 'data-despedido'

/** Lo escrito en los campos no viaja con `cloneNode`: se copia a mano, campo a campo y en el mismo orden. */
function copiarValores(de: HTMLElement, a: HTMLElement): void {
  const origen = de.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  const destino = a.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  origen.forEach((campo, i) => {
    const copia = destino[i]
    if (!copia) return
    if (campo instanceof HTMLInputElement && (campo.type === 'checkbox' || campo.type === 'radio')) (copia as HTMLInputElement).checked = campo.checked
    else copia.value = campo.value
  })
}

/**
 * Deja la copia de salida de `el` justo donde estaba, fijada a la ventana, y la borra al terminar. `variante` elige la
 * animación: un modal entero, o un elemento flotante.
 */
export function despedir(el: HTMLElement | null, variante: 'modal' | 'flotante'): void {
  if (!el || !el.isConnected || el.hasAttribute(DESPEDIDO) || movimientoReducido() || el.getClientRects().length === 0) return
  const caja = el.getBoundingClientRect()
  // Sin tamaño no hay nada que ver irse: un envoltorio cuyo contenido se pinta en otra capa.
  if (caja.width === 0 || caja.height === 0) return
  const copia = el.cloneNode(true) as HTMLElement
  el.setAttribute(DESPEDIDO, '')
  copiarValores(el, copia)
  copia.removeAttribute('id')
  copia.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
  copia.setAttribute('aria-hidden', 'true')
  copia.inert = true
  copia.classList.add('mov-despedida', `mov-despedida-${variante}`)
  Object.assign(copia.style, {
    position: 'fixed',
    left: `${caja.left}px`,
    top: `${caja.top}px`,
    width: `${caja.width}px`,
    height: `${caja.height}px`,
    right: 'auto',
    bottom: 'auto',
    margin: '0',
    pointerEvents: 'none'
  })
  // En su capa y no junto al original: su contenedor puede estar desmontándose con él. Un modal, en la de los
  // diálogos, que va encima de todo lo que abre diálogos; lo demás, en la flotante. Las dos están dentro de `.shell`,
  // así que la copia conserva el color del perfil.
  const capa = variante === 'modal' ? (document.querySelector('.capa-dialogos') ?? document.querySelector('.capa-flotante')) : document.querySelector('.capa-flotante')
  ;(capa ?? document.body).appendChild(copia)
  setTimeout(() => copia.remove(), MS_SALIDA + 40)
}

/** Que el elemento de `ref` se despida al desmontarse el componente. */
export function useDespedidaDe(ref: React.RefObject<HTMLElement>, variante: 'modal' | 'flotante'): void {
  useLayoutEffect(() => {
    // La limpieza de un efecto de diseño corre con el nodo aún en la página, justo antes de quitarlo.
    const nodo = ref
    return () => despedir(nodo.current, variante)
  }, [ref, variante])
}

/** Una ref nueva para el elemento que debe despedirse al desmontarse. */
export function useDespedida<T extends HTMLElement>(variante: 'modal' | 'flotante'): React.RefObject<T> {
  const ref = useRef<T>(null)
  useDespedidaDe(ref, variante)
  return ref
}
