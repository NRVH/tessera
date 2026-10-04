// =============================================================================
// diffEditability: ¿es EDITABLE el lado derecho de un diff? Módulo aparte porque
// de esa respuesta depende escribir en el disco, y el pane es JSX (no importable
// desde un `test-*.mts`). Solo lo es el archivo real de la sección Cambios, y el
// contenido en memoria (una entrada de un comprimido) se comprueba PRIMERO.
// Puro: solo `import type`.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { DiffTarget } from '../../editor'

/**
 * Lo que recibe el pane cuando los dos lados NO salen de git: una entrada de dentro de
 * un contenedor, ya leída o ya descompilada. Vive aquí porque su presencia ES la
 * respuesta a la pregunta del módulo.
 */
export interface ContenidoEnMemoria {
  original: string
  modificado: string
  /** Lenguaje de Monaco. La ruta del `target` es la del contenedor y no vale. */
  lenguaje: string
  /** true si la ENTRADA (no el contenedor) es un alta o un borrado. */
  unLado: boolean
  /**
   * Identidad O(1) de este contenido, para las dependencias del efecto de carga.
   * Nunca se comparan los textos: serían megas de memcmp por render.
   */
  clave: string
}

/**
 * true si el lado derecho es el archivo en disco y por tanto se puede editar y guardar.
 * La comprobación de la ruta es una guarda para un resolver futuro (un rename) que
 * apunte a otro archivo: se prefiere perder la edición a escribir el equivocado.
 */
export function isDiffEditable(target: DiffTarget, enMemoria?: ContenidoEnMemoria): boolean {
  if (enMemoria !== undefined) return false
  return target.after.source === 'worktree' && target.after.path === target.path
}
