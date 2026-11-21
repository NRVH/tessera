// =============================================================================
// Lo que el servicio de archivos pide al escritorio a través de Electron: revelar y abrir una
// ruta (`util/adaptadores/escritorio.ts`), la imagen del icono de un arrastre nativo con
// `nativeImage` y el diálogo de «Guardar como» (`util/adaptadores/dialogosNativos.ts`).
// `EscritorioArchivos` es el contrato que recibe `ServicioArchivos`; `escritorioElectron()` lo
// implementa y lo crea la raíz de composición. Las pruebas pasan un objeto literal.
// =============================================================================

import { nativeImage, type NativeImage } from 'electron'
import { appendFile } from 'node:fs/promises'
import { lanzadaPorElArnes } from '../../../shared/arnesE2e'
import { escritorioDelSistema, type Escritorio } from '../../util/adaptadores/escritorio'
import { guardarConDialogo } from '../../util/adaptadores/dialogosNativos'

export interface EscritorioArchivos extends Escritorio {
  /** `nativeImage.createFromDataURL`: vacía (`isEmpty()`) si el data-URL no es una imagen. */
  imagenDesdeUrlDatos(urlDatos: string): NativeImage
  /** El diálogo de guardar con su carpeta inicial y su memoria. */
  guardarConDialogo: typeof guardarConDialogo
}

/** El escritorio de archivos. El arnés registra las aperturas sin lanzar aplicaciones. */
export function escritorioElectron(): EscritorioArchivos {
  const escritorio = escritorioDelSistema()
  const registro = lanzadaPorElArnes(process.argv) ? process.env.TESSERA_E2E_APERTURAS : undefined
  return {
    ...escritorio,
    abrirRuta: registro
      ? async (abs) => {
          await appendFile(registro, JSON.stringify(abs) + '\n')
          return process.env.TESSERA_E2E_ERROR_APERTURA ?? ''
        }
      : escritorio.abrirRuta,
    imagenDesdeUrlDatos: (urlDatos) => nativeImage.createFromDataURL(urlDatos),
    guardarConDialogo
  }
}
