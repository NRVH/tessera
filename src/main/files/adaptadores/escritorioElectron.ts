// =============================================================================
// Lo que el servicio de archivos pide al escritorio a través de Electron: revelar y abrir una
// ruta (`util/adaptadores/escritorio.ts`), la imagen del icono de un arrastre nativo con
// `nativeImage` y el diálogo de «Guardar como» (`util/adaptadores/dialogosNativos.ts`).
// `EscritorioArchivos` es el contrato que recibe `FileService`; `escritorioElectron()` lo
// implementa y lo crea la raíz de composición. Las pruebas pasan un objeto literal.
// =============================================================================

import { nativeImage, type NativeImage } from 'electron'
import { escritorioDelSistema, type Escritorio } from '../../util/adaptadores/escritorio'
import { guardarConDialogo } from '../../util/adaptadores/dialogosNativos'

export interface EscritorioArchivos extends Escritorio {
  /** `nativeImage.createFromDataURL`: vacía (`isEmpty()`) si el data-URL no es una imagen. */
  imagenDesdeDataUrl(dataUrl: string): NativeImage
  /** El diálogo de guardar con su carpeta inicial y su memoria. */
  guardarConDialogo: typeof guardarConDialogo
}

/** El escritorio real. */
export function escritorioElectron(): EscritorioArchivos {
  return {
    ...escritorioDelSistema(),
    imagenDesdeDataUrl: (dataUrl) => nativeImage.createFromDataURL(dataUrl),
    guardarConDialogo
  }
}
