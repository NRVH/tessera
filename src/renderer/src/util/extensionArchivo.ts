// =============================================================================
// Extensión de un archivo a partir de su ruta POSIX. Puro y sin dependencias: lo
// cargan con `node` a secas las pruebas de los módulos que clasifican por extensión
// (el enrutado de visores y el modo de vista del editor, la apertura automática de git).
// =============================================================================

/**
 * Extensión (sin punto, en minúsculas) de una ruta POSIX; '' si no tiene.
 * Un solo parser para todos: un punto ANTES del último "/" no cuenta.
 */
export function extensionDe(path: string): string {
  const lower = path.toLowerCase()
  const slash = lower.lastIndexOf('/')
  const dot = lower.lastIndexOf('.')
  // Un punto que esté antes del último "/" (p. ej. "carpeta.old/archivo") no cuenta.
  if (dot < 0 || dot < slash) return ''
  return lower.slice(dot + 1)
}
