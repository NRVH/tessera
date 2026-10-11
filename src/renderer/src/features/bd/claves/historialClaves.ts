// =============================================================================
// El historial de la consola de Redis: qué se inserta en el editor al elegir un comando. Es un comando por
// línea, sin terminador: va en su propia línea si el cursor tiene texto a los lados. Puro, sin React ni
// DOM; el popover y la inserción en el editor son los de la consola de MongoDB (`useHistorialConsolaDocs`)
// con esta composición; la prueba es `test-historial-claves.mts`.
// Decisiones: docs/decisiones/bd/ui-claves-consola-historial-y-completado.md
// =============================================================================

import { insercionConTerminador, type ContextoCursor, type Insercion } from '../consola/historialConsola.ts'

/** El comando del historial recortado, sin terminador, en su propia línea si hace falta. */
export function insercionHistorialClaves(texto: string, ctx: ContextoCursor, eol: '\n' | '\r\n' = '\n'): Insercion {
  return insercionConTerminador(texto.replace(/^\s+|\s+$/g, ''), '', ctx, eol)
}
