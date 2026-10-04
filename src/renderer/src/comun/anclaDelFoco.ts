// =============================================================================
// Dónde abrir un menú pedido por teclado (o por un botón que no pasa su posición):
// junto a lo que tiene el foco. Bajo un control pequeño, debajo; dentro de uno
// grande, en su esquina. Sin foco útil, a un tercio de la ventana.
// =============================================================================

/** Posición de anclaje para un menú abierto sin ratón; ContextMenu la acota al viewport. */
export function anclaDelFoco(): { x: number; y: number } {
  const el = document.activeElement
  if (el instanceof HTMLElement && el !== document.body) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      return r.height > 60 ? { x: r.left + 12, y: r.top + 12 } : { x: r.left, y: r.bottom + 2 }
    }
  }
  return { x: Math.round(window.innerWidth / 2) - 120, y: Math.round(window.innerHeight / 3) }
}
