// =============================================================================
// estadoArchivo: la letra mostrable del estado de un archivo POR EJE. Distinta de
// `statusBadge.badgeLetter`, que colapsa los dos ejes en una letra: en el panel un
// archivo MM está en dos listas y cada una enseña la letra de SU eje.
// Puro: solo `import type`.
// =============================================================================

import type { WorkingFileStatus } from '../../../../../shared/git-ipc'

/** Letra de UN eje: '?' (sin rastrear) se muestra como alta y '.' como vacío, por robustez. */
export function letterForStatus(status: WorkingFileStatus): string {
  return status === '?' ? 'A' : status === '.' ? '' : status
}
