// =============================================================================
// Textos de los diálogos nativos de confirmación del descarte de git. Viven junto al adaptador
// porque un adaptador solo importa de `adaptadores/`, `shared/` y `util/`. Español e inglés juntos;
// se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../../../shared/i18n.ts'

export const txConfirmaciones = crearTextos(
  {
    cancelar: 'Cancelar',
    descartar: 'Descartar cambios',
    eliminar: 'Eliminar del disco',
    descartarYEliminar: 'Descartar y eliminar',
    titulo: 'Descartar cambios',
    unoPregunta: (nombre: string) => `¿Descartar los cambios de "${nombre}"?`,
    unoBorrarPregunta: (nombre: string) => `¿Descartar "${nombre}"?`,
    variosPregunta: (n: number) => `¿Descartar los cambios de ${n} archivos?`,
    unoDetalle:
      'Vuelve a su versión del último commit: sus cambios sin commitear se pierden, y no se puede deshacer.',
    unoBorrarDetalle:
      'Este archivo no tiene una versión en git a la que volver: descartar sus cambios lo elimina del disco, y no se puede deshacer.',
    resto: (n: number) => `\n…y ${n} más`,
    revierten: (lista: string) =>
      `Vuelven a su versión del último commit y sus cambios sin commitear se pierden:\n${lista}`,
    borran: (lista: string) => `No tienen una versión en git a la que volver y se eliminarán del disco:\n${lista}`,
    sinDeshacer: 'No se puede deshacer.'
  },
  {
    cancelar: 'Cancel',
    descartar: 'Discard changes',
    eliminar: 'Delete from disk',
    descartarYEliminar: 'Discard and delete',
    titulo: 'Discard changes',
    unoPregunta: (nombre: string) => `Discard the changes to "${nombre}"?`,
    unoBorrarPregunta: (nombre: string) => `Discard "${nombre}"?`,
    variosPregunta: (n: number) => `Discard the changes to ${n} files?`,
    unoDetalle:
      'It reverts to its version in the last commit: its uncommitted changes are lost, and you cannot undo this.',
    unoBorrarDetalle:
      'This file has no version in Git to revert to: discarding its changes deletes it from disk, and you cannot undo this.',
    resto: (n: number) => `\n…and ${n} more`,
    revierten: (lista: string) =>
      `These files revert to their version in the last commit, and their uncommitted changes are lost:\n${lista}`,
    borran: (lista: string) => `These files have no version in Git to revert to and will be deleted from disk:\n${lista}`,
    sinDeshacer: 'You cannot undo this.'
  }
)
