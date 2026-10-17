// =============================================================================
// Textos de los diálogos nativos de confirmación del descarte de git. Viven junto al adaptador
// porque un adaptador solo importa de `adaptadores/`, `shared/` y `util/`. Español e inglés juntos;
// se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../../../shared/i18n.ts'

export const txConfirmaciones = crearTextos(
  {
    cancelar: 'Cancelar',
    descartar: 'Descartar',
    titulo: 'Descartar cambios',
    unoPregunta: (nombre: string) => `¿Descartar "${nombre}"?`,
    variosPregunta: (n: number) => `¿Descartar ${n} archivos?`,
    unoDetalle:
      'Este archivo no tiene una versión en git a la que volver. Descartar sus cambios lo ELIMINARÁ del disco. Esta acción no se puede deshacer.',
    resto: (n: number) => `\n…y ${n} más`,
    variosDetalle: (lista: string) =>
      `Estos archivos no tienen una versión en git a la que volver, así que se ELIMINARÁN del disco. Esta acción no se puede deshacer.\n\n${lista}` +
      '\n\nSi cancelas, el resto de archivos seleccionados SÍ se revertirá a su versión de git (es recuperable).'
  },
  {
    cancelar: 'Cancel',
    descartar: 'Discard',
    titulo: 'Discard changes',
    unoPregunta: (nombre: string) => `Discard "${nombre}"?`,
    variosPregunta: (n: number) => `Discard ${n} files?`,
    unoDetalle:
      'This file has no version in git to go back to. Discarding its changes will DELETE it from disk. This cannot be undone.',
    resto: (n: number) => `\n…and ${n} more`,
    variosDetalle: (lista: string) =>
      `These files have no version in git to go back to, so they will be DELETED from disk. This cannot be undone.\n\n${lista}` +
      '\n\nIf you cancel, the rest of the selected files WILL be reverted to their git version (recoverable).'
  }
)
