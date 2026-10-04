// =============================================================================
// Extensiones de archivo que se asocian a Tessera: validación pura y ESTRICTA a propósito.
// Lo que sale de aquí es el nombre de una clave del registro y un argumento de `reg.exe`:
// una barra, una comilla o un espacio escribirían una clave imposible de encontrar y borrar.
// Acepta `unknown` para sanear igual lo leído de `workspace-state.json` y lo tecleado.
// Sin puntos interiores (`.tar.gz`): Windows asocia por el último punto y sería clave muerta.
// Decisiones: docs/decisiones/sistema/menu-contextual-de-windows.md
// =============================================================================

/**
 * Una extensión aceptable: punto, un alfanumérico, y hasta 15 caracteres más de un
 * juego que el registro digiere sin sorpresas. Sin espacios, sin comillas, sin barras
 * y sin metacaracteres.
 */
const EXTENSION_VALIDA = /^\.[a-z0-9][a-z0-9+_-]{0,15}$/

/** Prefijo de los ProgID propios. `Tessera.java`, `Tessera.sql`… */
export const PREFIJO_PROGID = 'Tessera'

/**
 * Extensiones que se ofrecen marcadas en Configuración. No es una lista cerrada —hay
 * un campo libre al lado—, es el atajo para los casos que ya se editan aquí a diario.
 */
export const EXTENSIONES_SUGERIDAS: readonly string[] = [
  '.java',
  '.xml',
  '.properties',
  '.sql',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.py',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.sh',
  '.txt'
]

/**
 * Deja una entrada cualquiera en una lista de extensiones válidas, en minúsculas, sin
 * repetidos y ORDENADA.
 *
 * El orden no es cosmético: la lista se compara consigo misma para saber qué
 * asociaciones hay que borrar del registro cuando el usuario desmarca una. Con un
 * orden inestable, esa comparación diría "cambió" en cada guardado y reescribiría el
 * registro entero sin motivo.
 */
export function normalizarExtensiones(entrada: unknown): string[] {
  const crudo = Array.isArray(entrada)
    ? entrada.map((x) => (typeof x === 'string' ? x : ''))
    : typeof entrada === 'string'
      ? [entrada]
      : []
  const piezas = crudo.flatMap((s) => s.split(/[\s,;]+/))
  const limpias = piezas
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    // Se admite que el usuario escriba `java` y se le pone el punto: nadie piensa en
    // la extensión como ".java" cuando la teclea a mano.
    .map((s) => (s.startsWith('.') ? s : '.' + s))
    .filter((s) => EXTENSION_VALIDA.test(s))
  return [...new Set(limpias)].sort()
}

/** El ProgID propio de una extensión: `.java` -> `Tessera.java`. */
export function progIdDe(ext: string): string {
  return `${PREFIJO_PROGID}${ext}`
}

/**
 * Cómo se llama el tipo en el Explorador ("Archivo Java · Tessera"). Se pone el nombre
 * de la app al final y no delante para que la columna "Tipo" siga ordenándose por lo
 * que el archivo ES, que es como la lee quien la mira.
 */
export function nombreAmigableDe(ext: string): string {
  return `Archivo ${ext.slice(1).toUpperCase()} · ${PREFIJO_PROGID}`
}
