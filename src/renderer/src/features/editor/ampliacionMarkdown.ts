// =============================================================================
// Reglas puras de ampliación sobre la vista Markdown: qué elementos ofrecen
// «Ampliar» y qué clics directos sobre ellos abren el visor.
// Sin React ni DOM para probarlas con `node`.
// Decisiones: docs/decisiones/editor/diagramas-mermaid.md
// =============================================================================

/** Lado mínimo pintado (en píxeles CSS) para ofrecer «Ampliar» en una imagen. */
export const MIN_LADO_IMAGEN_AMPLIABLE_PX = 64

/** Estado de una imagen o un diagrama al evaluar si puede ampliarse. */
export type ElementoCandidatoAmpliacion =
  | { tipo: 'imagen'; lista: boolean; ancho: number; alto: number }
  | { tipo: 'diagrama'; dibujado: boolean; conError: boolean }

/** Datos de un clic sobre una imagen o un diagrama de la vista Markdown. */
export interface OpcionesClicAmpliacion {
  elemento: ElementoCandidatoAmpliacion
  /** Botón del ratón según `MouseEvent.button` (0 es el principal). */
  boton: number
  conModificadores: boolean
  enEnlace: boolean
  conSeleccion: boolean
}

/** ¿El tamaño pintado de la imagen alcanza el mínimo en ancho y alto para ampliarla? */
export function imagenEsAmpliable(ancho: number, alto: number): boolean {
  return (
    Number.isFinite(ancho) &&
    Number.isFinite(alto) &&
    ancho >= MIN_LADO_IMAGEN_AMPLIABLE_PX &&
    alto >= MIN_LADO_IMAGEN_AMPLIABLE_PX
  )
}

/** ¿El elemento de la vista Markdown ofrece ampliar ahora mismo? */
export function elementoOfreceAmpliar(elemento: ElementoCandidatoAmpliacion): boolean {
  if (elemento.tipo === 'diagrama') return elemento.dibujado && !elemento.conError
  return elemento.lista && imagenEsAmpliable(elemento.ancho, elemento.alto)
}

/** Decide si un clic directo sobre una imagen o un diagrama abre el visor ampliado. */
export function clicDebeAmpliar(opciones: OpcionesClicAmpliacion): boolean {
  return (
    elementoOfreceAmpliar(opciones.elemento) &&
    opciones.boton === 0 &&
    !opciones.conModificadores &&
    !opciones.enEnlace &&
    !opciones.conSeleccion
  )
}
