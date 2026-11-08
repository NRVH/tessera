// =============================================================================
// Los documentos de referencia de un perfil: carpetas del equipo que el usuario elige y que sus agentes leen
// con `tctx docs` por su nombre, igual en nativo y en Docker. Aquí, los topes y la forma de la lista; los comparten el main, que
// los lee, y el renderer, que la edita.
// Decisiones: docs/decisiones/agentes/documentos-del-perfil.md
// =============================================================================

/** Cuántas carpetas puede tener un perfil. */
export const MAX_CARPETAS_DOCUMENTOS = 10

/** Lo más grande que se entrega de un documento: más que eso no es un texto de referencia para un agente. */
export const MAX_BYTES_DOCUMENTO = 256 * 1024

/** Cuántos documentos se listan como mucho, sumando todas las carpetas. */
export const MAX_DOCUMENTOS = 500

/** Hasta cuántos niveles de subcarpetas se recorre cada carpeta. */
export const PROFUNDIDAD_DOCUMENTOS = 4

/** Lo que se considera un documento: texto que un agente puede leer. Lo demás no se lista ni se entrega. */
export const EXTENSIONES_DOCUMENTO: readonly string[] = [
  '.md', '.markdown', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml', '.toml', '.csv', '.xml', '.sql', '.properties', '.ini'
]

/**
 * El perfil sin sus carpetas de documentos, para la copia de configuración. Son rutas de este equipo y los
 * agentes del perfil las leen, también en Docker: traídas de una copia ajena, darían a sus agentes cualquier
 * carpeta que esa copia nombrara. Se eligen otra vez en el equipo de destino.
 */
export function sinCarpetasDocumentos<T extends object>(perfil: T): T {
  if (!('documentos' in perfil)) return perfil
  const copia: Record<string, unknown> = { ...perfil }
  delete copia.documentos
  return copia as T
}

/** La lista tal como se guarda: sin vacías ni repetidas, y dentro del tope (el de un nivel, salvo que se pida otro). */
export function normalizarCarpetasDocumentos(carpetas: readonly unknown[], tope = MAX_CARPETAS_DOCUMENTOS): string[] {
  const vistas = new Set<string>()
  const salida: string[] = []
  for (const c of carpetas) {
    if (typeof c !== 'string') continue
    const limpia = c.trim()
    if (limpia === '' || vistas.has(limpia.toLowerCase())) continue
    vistas.add(limpia.toLowerCase())
    salida.push(limpia)
    if (salida.length === tope) break
  }
  return salida
}
