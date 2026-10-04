// =============================================================================
// ¿Hay un modal abierto? La pregunta que se hacen los atajos globales y los focos automáticos
// antes de actuar, en un solo sitio. Usa dos señales: `[aria-modal="true"]`, la correcta para los
// modales nuevos, y `.modal-overlay`, para los que pintan su velo sin `aria-modal`.
// No cubre menús contextuales ni popovers: no atrapan el foco y los atajos deben seguir vivos.
// Depende solo del DOM.
// =============================================================================

/** `true` si hay algún diálogo modal montado. */
export function hayModalAbierto(): boolean {
  return document.querySelector('[aria-modal="true"], .modal-overlay') !== null
}
