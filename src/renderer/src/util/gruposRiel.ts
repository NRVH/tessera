// =============================================================================
// gruposRiel: mover un icono del riel de un GRUPO al otro (arriba ↔ abajo). Hermano de
// `reorderByDrag`, que reordena UNA lista; esto opera sobre DOS a la vez. La guarda vive aquí,
// en lo puro: un grupo NO puede quedarse vacío. La otra mitad es el saneado del archivo de
// ajustes, `normalizarParticion` en `shared/workspace-state-ipc.ts`; sin ella el icono volvería
// a su grupo en el siguiente arranque. Puro y sin React: se prueba con `node` a secas.
// =============================================================================

/** Resultado de mover: las DOS listas ya actualizadas. Nunca muta las entradas. */
export interface MovimientoGrupos {
  desde: string[]
  hasta: string[]
}

/**
 * Mueve `dragId` del grupo `desde` al grupo `hasta`, insertándolo delante de
 * `targetId`. Con `targetId === null` va al final (soltar en el hueco del grupo).
 *
 * Devuelve `null` cuando la operación no procede, y son cuatro casos distintos
 * que al llamador le da igual distinguir:
 *   - `dragId` no está en `desde` (o ya está en `hasta`: se arrastró dentro del
 *     mismo grupo, y de eso se encarga `reorderByDrag`).
 *   - `targetId` no está en `hasta`.
 *   - `desde` se quedaría VACÍO.
 *
 * Al contrario que `reorderByDrag`, aquí NO hay ajuste direccional: el elemento
 * llega de otra lista, así que no ocupaba ningún hueco en la de destino y
 * "insertar antes del destino" es siempre lo que el usuario ve.
 */
export function moverEntreGrupos(
  desde: readonly string[],
  hasta: readonly string[],
  dragId: string,
  targetId: string | null
): MovimientoGrupos | null {
  if (!desde.includes(dragId)) return null
  if (hasta.includes(dragId)) return null
  // UN GRUPO NUNCA SE QUEDA VACÍO. Con un solo icono, arrastrarlo fuera no hace
  // nada: un riel con un lado en blanco no se puede deshacer sin ir a los
  // ajustes, y no hay ajustes para esto.
  if (desde.length <= 1) return null
  if (targetId !== null && !hasta.includes(targetId)) return null

  const nuevoDesde = desde.filter((id) => id !== dragId)
  const nuevoHasta = [...hasta]
  const at = targetId === null ? nuevoHasta.length : nuevoHasta.indexOf(targetId)
  nuevoHasta.splice(at, 0, dragId)
  return { desde: nuevoDesde, hasta: nuevoHasta }
}
