// =============================================================================
// Revelar y abrir una ruta con el `shell` de Electron, lo que piden al escritorio el explorador
// de archivos, el de BD y el ciclo de actualización. `Escritorio` es el contrato y
// `escritorioDelSistema()` lo implementa; lo componen sus adaptadores y las raíces de composición.
// =============================================================================

import { shell } from 'electron'

/** Lo que se pide al gestor de archivos y a las aplicaciones del sistema. */
export interface Escritorio {
  /** `shell.showItemInFolder`: abre el gestor de archivos del sistema con la ruta seleccionada. */
  revelarEnCarpeta(abs: string): void
  /** `shell.openPath`: resuelve con el error como texto, o `''` si abrió. */
  abrirRuta(abs: string): Promise<string>
}

/** El escritorio real. */
export function escritorioDelSistema(): Escritorio {
  return {
    revelarEnCarpeta: (abs) => shell.showItemInFolder(abs),
    abrirRuta: (abs) => shell.openPath(abs)
  }
}
