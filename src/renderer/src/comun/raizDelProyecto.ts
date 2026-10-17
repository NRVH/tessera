// =============================================================================
// La contenedora del proyecto al que pertenece un componente: la proveen el área del editor (por
// target), el árbol del explorador y los paneles de git, y la leen sus panes, visores, filas y menús
// para mandarla con cada petición de archivos o de git. Así nada lee ni escribe contra el proyecto
// que el main tenga anclado en ese momento, sino contra el suyo (`FileService.paraRaiz`, `GitService.paraRaiz`).
// =============================================================================
import { createContext, useContext } from 'react'

/** Sin proveedor vale '', que el main rechaza: un componente fuera de su proyecto no toca el disco. */
export const RaizDelProyecto = createContext('')

/** La contenedora del proyecto del componente que la pide. */
export function useRaizDelProyecto(): string {
  return useContext(RaizDelProyecto)
}
