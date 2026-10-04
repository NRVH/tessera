// =============================================================================
// resolveWorkingDiffTarget: arma el DiffTarget de un archivo del working-tree según
// el EJE desde el que se abre: 'staged' compara HEAD con el ÍNDICE ("qué vas a
// commitear") y 'unstaged' el ÍNDICE con el DISCO. El status efectivo A/M/D/R sale
// del eje pedido, porque qué lado va vacío depende de él. Hermano de
// `resolveDiffTarget` (commit contra su padre).
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { WorkingChange, WorkingFileStatus, FileStatus } from '../../../../../shared/git-ipc'
import type { DiffSide, DiffTarget } from '../../editor'

/** Los dos CENTINELAS que ocupan `commitHash` en un diff del working-tree; forman parte del id de la pestaña. */
export const REV_WORKTREE = 'WORKTREE'
export const REV_STAGED = 'STAGED'

/** Qué se compara, en palabras, para la cabecera del visor: un centinela nunca se pinta crudo. */
export function etiquetaRevisiones(commitHash: string): string {
  if (commitHash === REV_WORKTREE) return 'Índice ↔ Disco'
  if (commitHash === REV_STAGED) return 'HEAD ↔ Índice'
  return commitHash.slice(0, 7)
}

/** Colapsa el status de UN eje al A/M/D/R del visor; '?' es alta y C/T/U caen a 'M' (el lado seguro). */
function axisStatus(status: WorkingFileStatus): FileStatus {
  if (status === 'R') return 'R'
  if (status === 'A' || status === '?') return 'A'
  if (status === 'D') return 'D'
  return 'M' // M, C, T, U (y '.' teórico) -> modificación
}

/**
 * ¿El archivo existe HOY en disco? El menú apaga «Abrir» sobre un borrado (en el disco
 * o ya preparado). En un rename se mira `path`, que es siempre el destino.
 */
export function existeEnDisco(change: WorkingChange): boolean {
  if (change.worktreeStatus === 'D') return false
  if (change.indexStatus === 'D' && change.worktreeStatus === '.') return false
  return true
}

export function resolveWorkingDiffTarget(change: WorkingChange, axis: 'staged' | 'unstaged'): DiffTarget {
  const status = axisStatus(axis === 'staged' ? change.indexStatus : change.worktreeStatus)

  const renameFrom = change.oldPath ?? change.path

  let before: DiffSide
  let after: DiffSide

  if (axis === 'staged') {
    // before = HEAD (commit), after = índice.
    before =
      status === 'A'
        ? { source: 'empty', path: change.path }
        : { source: 'commit', hash: 'HEAD', path: status === 'R' ? renameFrom : change.path }
    after =
      status === 'D' ? { source: 'empty', path: change.path } : { source: 'index', path: change.path }
  } else {
    // axis === 'unstaged': before = índice, after = disco (working-tree).
    before =
      status === 'A'
        ? { source: 'empty', path: change.path }
        : { source: 'index', path: status === 'R' ? renameFrom : change.path }
    after =
      status === 'D' ? { source: 'empty', path: change.path } : { source: 'worktree', path: change.path }
  }

  return {
    // El CENTINELA del eje: parte del id de la pestaña, no una etiqueta (ver `etiquetaRevisiones`).
    commitHash: axis === 'staged' ? REV_STAGED : REV_WORKTREE,
    status,
    path: change.path,
    oldPath: change.oldPath,
    before,
    after
  }
}
