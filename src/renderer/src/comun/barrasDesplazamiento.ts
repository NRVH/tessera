// =============================================================================
// Hace visible la pastilla de una zona mientras se desplaza aunque el ratón no esté encima
// (teclado, «ir a», arrastre desde fuera): marca con `.desplazandose` el elemento que se mueve
// y se la quita al rato de pararse. El aspecto vive en `styles.css` («Scrollbars»).
// Una sola escucha en captura para toda la app: `scroll` no burbujea.
// Decisiones: docs/decisiones/renderer/barras-de-desplazamiento.md
// =============================================================================

/** Lo que sigue visible la pastilla tras el último desplazamiento. */
const VISIBLE_TRAS_PARAR_MS = 800

export function instalarBarrasAlDesplazar(): void {
  const temporizadores = new WeakMap<Element, number>()
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target instanceof Element ? e.target : document.scrollingElement
      // Una terminal desplaza su viewport ella sola con cada línea de salida: marcarla dejaría la
      // pastilla encendida mientras escribe. La suya se ve con el ratón encima.
      if (!el || el.classList.contains('xterm-viewport')) return
      // Solo se toca la clase al empezar: cada cambio de clase recalcula estilos.
      if (!el.classList.contains('desplazandose')) el.classList.add('desplazandose')
      const previo = temporizadores.get(el)
      if (previo !== undefined) window.clearTimeout(previo)
      temporizadores.set(
        el,
        window.setTimeout(() => {
          el.classList.remove('desplazandose')
          temporizadores.delete(el)
        }, VISIBLE_TRAS_PARAR_MS)
      )
    },
    { capture: true, passive: true }
  )
}
