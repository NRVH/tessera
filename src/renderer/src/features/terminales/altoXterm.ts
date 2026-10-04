// =============================================================================
// Ajusta el alto del `.xterm` al de su lienzo tras cada fit, para que el renglón de
// abajo no quede partido contra el borde del hueco. Lo usan las terminales de shell
// y del agente.
// Decisiones: docs/decisiones/terminales/ajuste-de-alto-y-anclaje-al-fondo.md
// =============================================================================

/**
 * Ajusta el alto del `.xterm` al de su lienzo para que la última fila quede al ras.
 * `host` es el contenedor que se le pasó a `term.open()`. No-op si xterm todavía no
 * ha pintado (al montar, o con el pane oculto: ahí mide 0 y fijar 0 lo escondería).
 */
export function ajustarAltoAlUltimoRenglon(host: HTMLElement | null): void {
  if (host === null) return
  const raiz = host.querySelector<HTMLElement>('.xterm')
  const pantalla = host.querySelector<HTMLElement>('.xterm-screen')
  if (raiz === null || pantalla === null) return
  const alto = pantalla.offsetHeight
  if (alto <= 0) return
  raiz.style.height = `${alto}px`
}
