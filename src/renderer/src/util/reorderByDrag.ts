// =============================================================================
// reorderByDrag: reordenamiento por arrastre de una lista de ids, con la misma semántica para
// las pestañas de perfil y de proyecto y el riel de iconos. Puro y sin React: testeable bajo node.
// Semántica direccional: soltar `dragId` sobre `targetId` lo inserta ANTES del destino si venía
// por detrás y DESPUÉS si venía por delante; sin ese ajuste, soltar sobre el vecino inmediato
// en la dirección de avance no movería nada. `ladoDeSoltar` dice ese lado, para pintarlo.
// =============================================================================

/** De qué lado del destino quedará lo arrastrado al soltarlo encima. */
export type LadoSoltar = 'antes' | 'despues'

/**
 * El lado en que `reorderByDrag` dejaría `dragId` respecto a `targetId`, o null si soltar
 * ahí no mueve nada (mismo id, o alguno no está). Sale de la MISMA regla, para que la raya
 * que se pinta durante el arrastre no pueda decir otra cosa que lo que hará el soltar.
 */
export function ladoDeSoltar(ids: readonly string[], dragId: string, targetId: string): LadoSoltar | null {
  if (dragId === targetId) return null
  const desde = ids.indexOf(dragId)
  const hasta = ids.indexOf(targetId)
  if (desde === -1 || hasta === -1) return null
  return desde < hasta ? 'despues' : 'antes'
}

/**
 * Devuelve el nuevo orden tras soltar `dragId` sobre `targetId`, o `null` si no hay
 * cambio (mismo id, o alguno no está en la lista). No muta `ids`.
 */
export function reorderByDrag(ids: string[], dragId: string, targetId: string): string[] | null {
  if (dragId === targetId) return null
  const fromIdx = ids.indexOf(dragId)
  const toIdx = ids.indexOf(targetId)
  if (fromIdx === -1 || toIdx === -1) return null
  const without = ids.filter((id) => id !== dragId)
  let insertAt = without.indexOf(targetId)
  if (insertAt === -1) return null
  if (fromIdx < toIdx) insertAt += 1 // mover hacia adelante => insertar DESPUÉS del destino
  without.splice(insertAt, 0, dragId)
  return without
}
