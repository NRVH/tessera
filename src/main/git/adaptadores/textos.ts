// =============================================================================
// Textos de los diálogos nativos de confirmación del descarte de git. Viven junto al adaptador
// porque un adaptador solo importa de `adaptadores/`, `shared/` y `util/`. Español e inglés juntos;
// se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../../../shared/i18n.ts'

export const txHooks = crearTextos(
  {
    inspeccionIncompleta: (motivo: 'enlace' | 'limite' | 'otro', ruta: string) =>
      `No se pueden aceptar estos hooks: ${
        motivo === 'enlace'
          ? `"${ruta}" es un enlace simbólico, y solo se aceptan hooks que sean archivos dentro de su carpeta`
          : motivo === 'limite'
            ? `en "${ruta}" se supera un límite de inspección (1024 entradas, 256 archivos, 1 MiB por archivo, 8 MiB en total)`
            : `"${ruta}" no es un archivo ni una carpeta que se pueda leer`
      }. Corrija la carpeta de hooks o continúe sin ejecutarlos.`,
    fichaInvalida: 'El permiso de hooks ha caducado o no corresponde a esta operación. Vuelva a intentarlo.'
  },
  {
    inspeccionIncompleta: (motivo: 'enlace' | 'limite' | 'otro', ruta: string) =>
      `These hooks cannot be accepted: ${
        motivo === 'enlace'
          ? `"${ruta}" is a symbolic link, and only hooks that are files inside their folder can be accepted`
          : motivo === 'limite'
            ? `"${ruta}" exceeds an inspection limit (1024 entries, 256 files, 1 MiB per file, 8 MiB total)`
            : `"${ruta}" is not a readable file or folder`
      }. Please fix the hooks folder or continue without running them.`,
    fichaInvalida: 'The hook permission has expired or does not match this operation. Please try again.'
  }
)

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
      'El archivo vuelve a su versión del último commit: sus cambios sin confirmar se pierden y no se pueden recuperar.',
    unoBorrarDetalle:
      'Este archivo no tiene una versión en Git a la que volver: descartar sus cambios lo elimina del disco y no se puede deshacer.',
    resto: (n: number) => `\n…y ${n} más`,
    revierten: (lista: string) =>
      `Estos archivos vuelven a su versión del último commit y sus cambios sin confirmar se pierden:\n${lista}`,
    borran: (lista: string) => `Estos archivos no tienen una versión en Git a la que volver y se eliminarán del disco:\n${lista}`,
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
