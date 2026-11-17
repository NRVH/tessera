// =============================================================================
// reordenarPorArrastre: reordenamiento por arrastre de una lista de ids, con la misma semántica para
// las pestañas de perfil y de proyecto y el riel de iconos. Puro y sin React: testeable bajo node.
// Semántica direccional: soltar `arrastradoId` sobre `destinoId` lo inserta ANTES del destino si venía
// por detrás y DESPUÉS si venía por delante; sin ese ajuste, soltar sobre el vecino inmediato
// en la dirección de avance no movería nada. `ladoDeSoltar` dice ese lado, para pintarlo.
// =============================================================================

/**
 * Una tira con raya por mitades: antes de qué pestaña caería `arrastrada` con el puntero sobre una
 * mitad de `sobre` (`sobre` null = el hueco tras la última). `null` = al final; `undefined` = soltar
 * ahí no mueve nada, o alguna no está en la tira.
 */
export function destinoArrastre(
  pestanas: readonly { id: string }[],
  arrastrada: string,
  sobre: string | null,
  mitad: 'izquierda' | 'derecha'
): string | null | undefined {
  const desde = pestanas.findIndex((t) => t.id === arrastrada)
  if (desde < 0) return undefined
  let antesDe: string | null
  if (sobre === null) {
    antesDe = null
  } else {
    const i = pestanas.findIndex((t) => t.id === sobre)
    if (i < 0) return undefined
    antesDe = mitad === 'izquierda' ? sobre : i + 1 < pestanas.length ? pestanas[i + 1].id : null
  }
  // Pegada a sí misma (antes de ella o antes de la que la sigue): no se mueve.
  const siguiente = desde + 1 < pestanas.length ? pestanas[desde + 1].id : null
  if (antesDe === arrastrada || antesDe === siguiente) return undefined
  return antesDe
}

/** De qué lado del destino quedará lo arrastrado al soltarlo encima. */
export type LadoSoltar = 'antes' | 'despues'

/**
 * El lado en que `reordenarPorArrastre` dejaría `arrastradoId` respecto a `destinoId`, o null si soltar
 * ahí no mueve nada (mismo id, o alguno no está). Sale de la MISMA regla, para que la raya
 * que se pinta durante el arrastre no pueda decir otra cosa que lo que hará el soltar.
 */
export function ladoDeSoltar(ids: readonly string[], arrastradoId: string, destinoId: string): LadoSoltar | null {
  if (arrastradoId === destinoId) return null
  const desde = ids.indexOf(arrastradoId)
  const hasta = ids.indexOf(destinoId)
  if (desde === -1 || hasta === -1) return null
  return desde < hasta ? 'despues' : 'antes'
}

/**
 * Devuelve el nuevo orden tras soltar `arrastradoId` sobre `destinoId`, o `null` si no hay
 * cambio (mismo id, o alguno no está en la lista). No muta `ids`.
 */
export function reordenarPorArrastre(ids: string[], arrastradoId: string, destinoId: string): string[] | null {
  if (arrastradoId === destinoId) return null
  const idxOrigen = ids.indexOf(arrastradoId)
  const idxDestino = ids.indexOf(destinoId)
  if (idxOrigen === -1 || idxDestino === -1) return null
  const without = ids.filter((id) => id !== arrastradoId)
  let idxInsercion = without.indexOf(destinoId)
  if (idxInsercion === -1) return null
  if (idxOrigen < idxDestino) idxInsercion += 1 // mover hacia adelante => insertar DESPUÉS del destino
  without.splice(idxInsercion, 0, arrastradoId)
  return without
}
