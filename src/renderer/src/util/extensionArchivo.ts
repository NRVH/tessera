// =============================================================================
// Extensión de un archivo a partir de su ruta POSIX. Puro y sin dependencias: lo
// cargan con `node` a secas las pruebas de los módulos que clasifican por extensión
// (el enrutado de visores y el modo de vista del editor, la apertura automática de git).
// =============================================================================

/**
 * Extensión (sin punto, en minúsculas) de una ruta POSIX; '' si no tiene.
 * Un solo parser para todos: un punto ANTES del último "/" no cuenta.
 */
export function extensionDe(ruta: string): string {
  const enMinusculas = ruta.toLowerCase()
  const barra = enMinusculas.lastIndexOf('/')
  const punto = enMinusculas.lastIndexOf('.')
  // Un punto que esté antes del último "/" (p. ej. "carpeta.old/archivo") no cuenta.
  if (punto < 0 || punto < barra) return ''
  return enMinusculas.slice(punto + 1)
}
