// =============================================================================
// Miniatura (data URL) de una imagen pegada, para la vista previa en la terminal.
// Se reduce a `maxPx` en el lado mayor con un canvas: una captura de pantalla
// completa pesa varios MB, y meter ese data URL crudo en el estado de React sería
// un derroche. La miniatura basta para "confirmar visualmente qué adjuntaste".
// =============================================================================

/** Data URL PNG reducido de un blob de imagen; '' si no se pudo decodificar. */
export async function blobToThumbnailDataUrl(blob: Blob, maxPx = 320): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
}
