// =============================================================================
// Store del explorador de archivos compartido con la ventana: la ruta que el árbol
// tiene que desplegar y traer a la vista («Abrir con Tessera» sobre un archivo), y las
// carpetas desplegadas de cada proyecto. El token hace que pedir dos veces la misma ruta
// vuelva a revelarla.
// =============================================================================
import { create } from 'zustand'

/** Estado del explorador compartido con la ventana. */
export interface EstadoExplorador {
  revelarEnArbol: { ruta: string; token: number } | null
  /**
   * Carpetas desplegadas de cada proyecto (`perfil|ruta` -> rutas relativas): el árbol vuelve como estaba al
   * volver a él, y se guardan con la sesión del proyecto para el próximo arranque.
   */
  carpetasPorProyecto: Readonly<Record<string, readonly string[]>>
  /**
   * ¿Llegaron ya las carpetas guardadas? Hasta entonces no se monta ningún árbol: uno montado antes nacería
   * plegado y avisaría de sus carpetas vacías, que pisarían las guardadas.
   */
  carpetasListas: boolean
}

/** Estado del explorador compartido con la ventana. */
export const useStoreExplorador = create<EstadoExplorador>()(() => ({
  revelarEnArbol: null,
  carpetasPorProyecto: {},
  carpetasListas: false
}))

/** Anota las carpetas desplegadas de un proyecto; sin cambios, no avisa a nadie. */
export function recordarCarpetas(clave: string, carpetas: ReadonlySet<string>): void {
  useStoreExplorador.setState((s) => {
    const prev = s.carpetasPorProyecto[clave]
    if (prev && prev.length === carpetas.size && prev.every((c) => carpetas.has(c))) return s
    return { carpetasPorProyecto: { ...s.carpetasPorProyecto, [clave]: [...carpetas] } }
  })
}

/** Pide al árbol que revele `ruta`. */
export function revelarRuta(ruta: string): void {
  useStoreExplorador.setState((s) => ({ revelarEnArbol: { ruta, token: (s.revelarEnArbol?.token ?? 0) + 1 } }))
}
