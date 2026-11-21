// =============================================================================
// ¿Hay un modal abierto? La pregunta que se hacen los atajos globales y los focos automáticos
// antes de actuar, en un solo sitio. Usa dos señales: `[aria-modal="true"]`, la correcta para los
// modales nuevos, y `.modal-overlay`, para los que pintan su velo sin `aria-modal`. No cuenta el
// que está en una capa viva oculta (`comun/useVivosRecientes`): es de otro perfil, no tapa nada.
// No cubre menús contextuales ni popovers: no atrapan el foco y los atajos deben seguir vivos.
// Consulta el documento que recibe: un modal abierto en una ventana no
// bloquea el teclado de la otra. Depende solo del DOM.
// =============================================================================

/** Un modal a la vista: fuera de las capas vivas ocultas. */
const MODAL_A_LA_VISTA = '[aria-modal="true"]:not(.capa-viva.oculta *), .modal-overlay:not(.capa-viva.oculta *)'

/** `true` si hay algún diálogo modal montado y a la vista en `doc`. */
export function hayModalAbierto(doc: Document): boolean {
  return doc.querySelector(MODAL_A_LA_VISTA) !== null
}
