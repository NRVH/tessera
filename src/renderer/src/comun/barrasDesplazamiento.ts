// =============================================================================
// Hace visible la pastilla de una zona mientras se desplaza aunque el ratón no esté encima
// (teclado, «ir a», arrastre desde fuera): marca con `.desplazandose` el elemento que se mueve
// y se la quita al rato de pararse. El aspecto vive en `styles.css` («Scrollbars»).
// Una sola escucha en captura por documento: `scroll` no burbujea.
// Decisiones: docs/decisiones/renderer/barras-de-desplazamiento.md
// =============================================================================

import { esElemento } from '../util/ventanaDe'

/** Lo que sigue visible la pastilla tras el último desplazamiento. */
const VISIBLE_TRAS_PARAR_MS = 800

export function instalarBarrasAlDesplazar(doc: Document = document): () => void {
  const temporizadores = new Map<Element, number>()
  const ventana = doc.defaultView ?? window
  const alDesplazar = (e: Event): void => {
    const el = esElemento(e.target) ? e.target : doc.scrollingElement
    // Una terminal desplaza su viewport ella sola con cada línea de salida: marcarla dejaría la
    // pastilla encendida mientras escribe. La suya se ve con el ratón encima.
    if (!el || el.classList.contains('xterm-viewport')) return
    // Solo se toca la clase al empezar: cada cambio de clase recalcula estilos.
    if (!el.classList.contains('desplazandose')) el.classList.add('desplazandose')
    const previo = temporizadores.get(el)
    if (previo !== undefined) ventana.clearTimeout(previo)
    temporizadores.set(
      el,
      ventana.setTimeout(() => {
        el.classList.remove('desplazandose')
        temporizadores.delete(el)
      }, VISIBLE_TRAS_PARAR_MS)
    )
  }
  doc.addEventListener('scroll', alDesplazar, { capture: true, passive: true })
  return () => {
    doc.removeEventListener('scroll', alDesplazar, true)
    for (const [el, id] of temporizadores) {
      ventana.clearTimeout(id)
      el.classList.remove('desplazandose')
    }
    temporizadores.clear()
  }
}
