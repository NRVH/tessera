// =============================================================================
// Qué archivos sabe COMPARAR Tessera revisión contra revisión. Es otro catálogo que el
// de `viewerKind.ts` («¿qué visor abre este archivo?»): el `.svg` ya diverge.
// Superconjunto de `jarPath.EXT_CONTENEDOR`, y el test lo fija: lo que el árbol expande
// se compara solo. 7z, rar y tar.gz no están porque no son ZIP y nada aquí los lee.
// No va en `viewerKindForPath`: un .zip perdería su listado y un .jar su fila expandible.
// Decisiones: docs/decisiones/comprimidos/diff-de-contenedores.md
// =============================================================================

// Extensión explícita: este módulo lo carga `node` a secas desde su test.
import { EXT_CONTENEDOR } from './jarPath.ts'

/**
 * Extensiones cuyo diff es "comparar el contenido de dos contenedores ZIP".
 * Contiene a `EXT_CONTENEDOR` (jar/war/ear/aar) y añade el resto de la familia.
 */
export const EXT_COMPRIMIDOS: ReadonlySet<string> = new Set([
  ...EXT_CONTENEDOR,
  'zip',
  // Todos estos son ZIP con otro nombre y otra convención interna.
  'apk',
  'whl',
  'nupkg',
  'jmod'
])

/** Extensión en minúsculas, sin punto; '' si no tiene. Un punto ANTES del último
 *  '/' no cuenta (`carpeta.jar/x.ts` no es un comprimido). */
function extensionDe(ruta: string): string {
  const lower = ruta.toLowerCase()
  const barra = lower.lastIndexOf('/')
  const punto = lower.lastIndexOf('.')
  if (punto < 0 || punto < barra) return ''
  return lower.slice(punto + 1)
}

/**
 * ¿Esta ruta nombra un contenedor comparable? Insensible a mayúsculas: en un
 * proyecto legacy `LIBRERIA.JAR` es lo normal, no la excepción.
 */
export function esComprimido(ruta: string): boolean {
  return EXT_COMPRIMIDOS.has(extensionDe(ruta))
}
