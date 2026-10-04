// =============================================================================
// ordenEstable: el orden en que se montan en el DOM los panes vivos (keep-alive) que
// llevan un xterm. Va por CLAVE y no por el orden de las pestañas: un nodo que React
// cambia de sitio pierde su scroll, así que reordenar pestañas no puede mover panes.
// Puro; lo usan la columna del agente y la pila de terminales.
// Decisiones: docs/decisiones/renderer/reordenar-proyectos-arrastrando.md
// =============================================================================

/**
 * Copia de `items` ordenada por su clave (comparación de cadenas, sin configuración
 * regional: tiene que dar lo mismo en cualquier equipo). No depende del orden de entrada,
 * y añadir o quitar un elemento no cambia el orden relativo de los demás.
 */
export function enOrdenEstable<T>(items: readonly T[], clave: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, clave: clave(item) }))
    .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
    .map((x) => x.item)
}
