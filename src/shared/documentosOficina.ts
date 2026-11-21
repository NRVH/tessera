// =============================================================================
// Formatos de oficina que se abren con la aplicación del sistema.
// Puro: clasifica por la extensión de la ruta relativa, con independencia del sistema.
// Lo comparten la apertura de archivos, la sesión y los diffs del editor.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

const EXTENSIONES_OFICINA: ReadonlySet<string> = new Set([
  'doc', 'docx', 'docm', 'dotx',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'odt', 'ods', 'odp'
])

/** Devuelve la extensión normalizada si la ruta corresponde a un documento de oficina. */
export function extensionDeOficina(ruta: string): string | null {
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1)
  const punto = nombre.lastIndexOf('.')
  if (punto <= 0) return null
  const extension = nombre.slice(punto + 1).toLowerCase()
  return EXTENSIONES_OFICINA.has(extension) ? extension : null
}
