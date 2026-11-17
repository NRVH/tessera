// =============================================================================
// gruposRiel: mover un icono del riel de un GRUPO al otro (arriba ↔ abajo). Hermano de
// `reordenarPorArrastre`, que reordena UNA lista; esto opera sobre DOS a la vez. La guarda vive aquí,
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
 * Mueve `arrastradoId` del grupo `desde` al grupo `hasta`, insertándolo delante de
 * `destinoId`. Con `destinoId === null` va al final (soltar en el hueco del grupo).
 *
 * Devuelve `null` cuando la operación no procede, y son cuatro casos distintos
 * que al llamador le da igual distinguir:
 *   - `arrastradoId` no está en `desde` (o ya está en `hasta`: se arrastró dentro del
 *     mismo grupo, y de eso se encarga `reordenarPorArrastre`).
 *   - `destinoId` no está en `hasta`.
 *   - `desde` se quedaría VACÍO.
 *
 * Al contrario que `reordenarPorArrastre`, aquí NO hay ajuste direccional: el elemento
 * llega de otra lista, así que no ocupaba ningún hueco en la de destino y
 * "insertar antes del destino" es siempre lo que el usuario ve.
 */
export function moverEntreGrupos(
  desde: readonly string[],
  hasta: readonly string[],
  arrastradoId: string,
  destinoId: string | null
): MovimientoGrupos | null {
  if (!desde.includes(arrastradoId)) return null
  if (hasta.includes(arrastradoId)) return null
  // UN GRUPO NUNCA SE QUEDA VACÍO. Con un solo icono, arrastrarlo fuera no hace
  // nada: un riel con un lado en blanco no se puede deshacer sin ir a los
  // ajustes, y no hay ajustes para esto.
  if (desde.length <= 1) return null
  if (destinoId !== null && !hasta.includes(destinoId)) return null

  const nuevoDesde = desde.filter((id) => id !== arrastradoId)
  const nuevoHasta = [...hasta]
  const posicion = destinoId === null ? nuevoHasta.length : nuevoHasta.indexOf(destinoId)
  nuevoHasta.splice(posicion, 0, arrastradoId)
  return { desde: nuevoDesde, hasta: nuevoHasta }
}
