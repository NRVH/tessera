// =============================================================================
// El orden de los agentes que elige el usuario: aplicarlo a una lista y moverlos (arrastrando
// o un paso arriba o abajo). Las operaciones trabajan sobre la lista COMPLETA del perfil, así
// que mover entre las pestañas de un modo no desordena los agentes del otro. Puro, sin React.
// =============================================================================

/**
 * Ordena según la preferencia guardada: primero los que la lista nombra, en su orden; los que no
 * nombra (uno nuevo, o todos si no hay preferencia) van detrás en su orden de siempre.
 */
export function aplicarOrden<T>(items: readonly T[], idDe: (x: T) => string, orden: readonly string[] | undefined): T[] {
  if (!orden || orden.length === 0) return [...items]
  const pos = new Map(orden.map((id, i) => [id, i]))
  const conOrden = items.filter((x) => pos.has(idDe(x))).sort((a, b) => (pos.get(idDe(a)) ?? 0) - (pos.get(idDe(b)) ?? 0))
  return [...conOrden, ...items.filter((x) => !pos.has(idDe(x)))]
}

/**
 * Suelta `id` sobre `destino`: si venía de antes queda detrás de él, y si venía de después, delante.
 * Devuelve null si no cambia nada (el mismo, o alguno que no está).
 */
export function soltarSobre<T extends string>(lista: readonly T[], id: T, destino: T): T[] | null {
  const desde = lista.indexOf(id)
  const hasta = lista.indexOf(destino)
  if (desde < 0 || hasta < 0 || desde === hasta) return null
  const sin = lista.filter((x) => x !== id)
  const i = sin.indexOf(destino) + (desde < hasta ? 1 : 0)
  return [...sin.slice(0, i), id, ...sin.slice(i)]
}

/** Mueve `id` un puesto (−1 arriba, +1 abajo); null en los extremos o si no está. */
export function moverUnPaso<T extends string>(lista: readonly T[], id: T, delta: 1 | -1): T[] | null {
  const i = lista.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= lista.length) return null
  const copia = [...lista]
  copia[i] = lista[j]
  copia[j] = id
  return copia
}
