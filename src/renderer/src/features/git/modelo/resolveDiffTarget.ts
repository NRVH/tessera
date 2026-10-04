// =============================================================================
// resolveDiffTarget: arma el DiffTarget de un archivo tocado por un commit según su status.
// Lo usan la lista de archivos de un commit y el historial de un archivo. El «antes» se
// resuelve contra el PRIMER padre, que el llamador pasa suelto: un commit raíz (`null`) no
// tiene «antes» y todo cuenta como alta. Solo importa tipos, así que no crea ciclos.
// =============================================================================

import type { FileChange } from '../../../../../shared/git-ipc'
import type { DiffSide, DiffTarget } from '../../editor'

/** Arma el DiffTarget de `change` en `commitHash`, contra el primer padre. */
export function resolveDiffTarget(
  commitHash: string,
  parentHash: string | null,
  change: FileChange
): DiffTarget {
  const before: DiffSide =
    change.status === 'A' || parentHash === null
      ? { source: 'empty', path: change.path }
      : {
          source: 'commit',
          hash: parentHash,
          path: change.status === 'R' ? (change.oldPath ?? change.path) : change.path
        }

  const after: DiffSide =
    change.status === 'D'
      ? { source: 'empty', path: change.path }
      : { source: 'commit', hash: commitHash, path: change.path }

  return {
    commitHash,
    status: change.status,
    path: change.path,
    oldPath: change.oldPath,
    before,
    after
  }
}
