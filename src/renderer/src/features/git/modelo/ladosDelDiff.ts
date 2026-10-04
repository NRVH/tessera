// =============================================================================
// ladosDelDiff: ¿este diff tiene DOS lados que comparar o solo uno? Se deduce del
// `source` (`empty` = ese lado no existe), no de la letra de estado. «De un solo
// lado» no implica «solo lectura»: son dos preguntas sobre el mismo target.
// Puro: solo `import type`.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { DiffTarget } from '../../editor'

/**
 * true si uno de los dos lados no existe (un alta, un borrado o el primer commit): el
 * visor fuerza entonces la vista unificada, porque un panel vacío al lado de otro lleno
 * no compara nada.
 */
export function esDiffDeUnLado(target: DiffTarget): boolean {
  return target.before.source === 'empty' || target.after.source === 'empty'
}
