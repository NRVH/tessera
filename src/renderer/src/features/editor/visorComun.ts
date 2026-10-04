// =============================================================================
// Piezas comunes de los visores de archivos (imagen, pdf, docx, zip): acciones de sistema y
// object-URL. Solo IPC; el renderer no toca disco ni ve rutas del host.
// Lo usan `useBinaryViewer` y `useCargaImagen`.
// =============================================================================

import type { MutableRefObject } from 'react'

/** Abre el archivo con la app del sistema; devuelve el aviso a mostrar si falla. */
export async function abrirExterno(path: string): Promise<string | null> {
  try {
    const err = await window.tessera.files.openPath(path)
    return err ? `No se pudo abrir con una app del sistema: ${err}` : null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Revela el archivo en el gestor de archivos del sistema; devuelve el aviso si falla. */
export async function revelarEnCarpeta(path: string): Promise<string | null> {
  try {
    await window.tessera.files.reveal(path)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Revoca el object-URL guardado en la ref, si lo hay, y la deja vacía. */
export function revocarUrl(ref: MutableRefObject<string | null>): void {
  if (ref.current) {
    URL.revokeObjectURL(ref.current)
    ref.current = null
  }
}
