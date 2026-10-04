// =============================================================================
// statusBadge: fuente ÚNICA de la decoración de estado git del working-tree para
// toda la UI (panel de Cambios, explorador y pestañas): la letra y la clase de
// color salen del MISMO sitio. Solo lectura: mapea un WorkingChange (dos ejes) a
// una letra efectiva, sin tocar IPC.
// =============================================================================

import type { WorkingChange } from '../../../../../shared/git-ipc'

/**
 * ¿El archivo está en conflicto? Un eje `U`, o AA (los dos lados lo añaden) o DD (los dos
 * lo borran): esas dos parejas solo las da un registro `u` de `status` (fuera de un
 * conflicto, el eje del árbol nunca es `A` y un borrado preparado no tiene eje del árbol).
 * Es la regla de la sección Conflictos y de la letra `U`, donde descartar no se ofrece.
 */
export function enConflicto(change: WorkingChange): boolean {
  const x = change.indexStatus
  const y = change.worktreeStatus
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

/**
 * Letra efectiva a mostrar para un archivo del working-tree, colapsando los dos
 * ejes (indexStatus/worktreeStatus) a un solo símbolo por PRECEDENCIA:
 * U(conflicto, ver `enConflicto`) > R(rename) > A(alta, incl. untracked '?') > D(borrado) >
 * C(copy) > T(typechange) > M(modificado).
 */
export function badgeLetter(change: WorkingChange): string {
  const x = change.indexStatus
  const y = change.worktreeStatus
  if (enConflicto(change)) return 'U'
  if (x === 'R' || y === 'R') return 'R'
  if (x === 'A' || y === 'A' || y === '?') return 'A'
  if (x === 'D' || y === 'D') return 'D'
  if (x === 'C' || y === 'C') return 'C'
  if (x === 'T' || y === 'T') return 'T'
  return 'M'
}

/** Clase CSS de COLOR DE TEXTO para una letra de status (árbol, pestañas, panel). */
export function statusClass(letter: string): string {
  return `git-status-${letter}`
}

/**
 * Índice de decoraciones de la lista completa de cambios: la letra de cada archivo y
 * toda carpeta ancestro de un cambio. Las claves son POSIX relativas a la contenedora,
 * el mismo espacio que `FileEntry.path` del explorador.
 */
export interface WorktreeDecorations {
  /** path de archivo -> letra de status. */
  byPath: Map<string, string>
  /** paths de carpeta que contienen (recursivamente) algún cambio. */
  dirtyDirs: Set<string>
}

/** Construye el índice de decoraciones a partir de los cambios del working-tree. */
export function buildDecorations(changes: WorkingChange[]): WorktreeDecorations {
  const byPath = new Map<string, string>()
  const dirtyDirs = new Set<string>()

  for (const change of changes) {
    byPath.set(change.path, badgeLetter(change))
    // Rollup: cada prefijo de carpeta del path ("app/src/Foo.java" -> "app", "app/src").
    const segments = change.path.split('/')
    let prefix = ''
    for (let i = 0; i < segments.length - 1; i++) {
      prefix = prefix === '' ? segments[i] : `${prefix}/${segments[i]}`
      dirtyDirs.add(prefix)
    }
  }

  return { byPath, dirtyDirs }
}
