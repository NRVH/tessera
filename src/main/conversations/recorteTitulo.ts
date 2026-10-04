// =============================================================================
// Recorte de los títulos de conversación por caracteres VISIBLES (graphemes), no por unidades
// UTF-16: cortar por `slice` partía un emoji (un par sustituto, o una familia unida con ZWJ) y
// el título acababa en «�». Puro y sin E/S; lo usan `ConversationsReader` y `conversationTitles`.
// =============================================================================

const segmentador = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Los primeros `max` caracteres visibles de `texto` (el texto entero si no los pasa). */
export function recortarGraficos(texto: string, max: number): string {
  // Cada carácter visible ocupa al menos una unidad UTF-16: si no las pasa, tampoco los pasa.
  if (texto.length <= max) return texto
  let n = 0
  for (const { index } of segmentador.segment(texto)) {
    if (n === max) return texto.slice(0, index)
    n++
  }
  return texto
}

/** Recorta a `max` caracteres visibles contando la elipsis final, que solo se pone si se cortó. */
export function recortarConElipsis(texto: string, max: number): string {
  if (recortarGraficos(texto, max) === texto) return texto
  return recortarGraficos(texto, max - 1) + '…'
}
