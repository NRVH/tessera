// =============================================================================
// ¿Se ve la capa viva (`CapaViva`) en la que está montado un componente? Fuera de una capa, sí.
// Lo leen las piezas que, ocultas, deben dejar de actuar sobre lo que se ve: un diálogo sale de la
// pila y deja de atender Esc, y un árbol cierra sus menús y no atiende peticiones.
// Decisiones: docs/decisiones/renderer/vivos-y-ocultos.md
// =============================================================================

import { createContext, useContext } from 'react'

/** La visibilidad de la capa viva más cercana; la provee `CapaViva`. */
export const ContextoCapaVisible = createContext(true)

/** `false` si el componente está en una capa viva oculta. */
export function useCapaVisible(): boolean {
  return useContext(ContextoCapaVisible)
}
