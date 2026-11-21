// =============================================================================
// Dónde abrir un menú pedido por teclado (o por un botón que no pasa su posición):
// junto a lo que tiene el foco. Bajo un control pequeño, debajo; dentro de uno
// grande, en su esquina. Sin foco útil, a un tercio de la ventana.
// =============================================================================

import { esElementoHtml } from '../util/ventanaDe'

/** Posición de anclaje para un menú abierto sin ratón en `doc`; MenuContextual la acota al viewport. */
export function anclaDelFoco(doc: Document = document): { x: number; y: number } {
  const el = doc.activeElement
  if (esElementoHtml(el) && el !== doc.body) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      return r.height > 60 ? { x: r.left + 12, y: r.top + 12 } : { x: r.left, y: r.bottom + 2 }
    }
  }
  const ventana = doc.defaultView ?? window
  return { x: Math.round(ventana.innerWidth / 2) - 120, y: Math.round(ventana.innerHeight / 3) }
}
