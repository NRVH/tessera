// =============================================================================
// Store del explorador de archivos compartido con la ventana: la ruta que el árbol
// tiene que desplegar y traer a la vista («Abrir con Tessera» sobre un archivo).
// El token hace que pedir dos veces la misma ruta vuelva a revelarla.
// =============================================================================
import { create } from 'zustand'

/** Estado del explorador compartido con la ventana. */
export interface EstadoExplorador {
  revelarEnArbol: { path: string; token: number } | null
}

/** Estado del explorador compartido con la ventana. */
export const useStoreExplorador = create<EstadoExplorador>()(() => ({
  revelarEnArbol: null
}))

/** Pide al árbol que revele `path`. */
export function revelarRuta(path: string): void {
  useStoreExplorador.setState((s) => ({ revelarEnArbol: { path, token: (s.revelarEnArbol?.token ?? 0) + 1 } }))
}
