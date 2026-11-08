// =============================================================================
// Textos de git que ve la persona: los rechazos y errores de preparar, confirmar y descartar, y los
// diálogos nativos de confirmación del descarte. Español e inglés juntos; se leen al usarse. Solo
// depende de shared/i18n (las confirmaciones nativas lo importan sin traer `electron`).
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txGit = crearTextos(
  {
    rutaNoValida: 'Ruta no válida.',
    carpetaAlPreparar: 'Es una carpeta: prepare sus archivos uno a uno.',
    carpetaAlQuitar: 'Es una carpeta: quite sus archivos de preparados uno a uno.',
    gitNoResponde: 'Git no respondió; inténtelo de nuevo.',
    gitFallo: (linea: string) => `Git falló: ${linea}`,
    gitFalloSalida: (codigo: number) => `Git falló (código de salida ${codigo}).`,
    sinRepo: 'No hay repositorio activo.',
    sinRepoRuta: 'No hay repositorio para esta ruta.',
    proyectoDesconocido: 'Esta operación de Git corresponde a un proyecto que no está abierto: no se realizó ningún cambio.',
    mensajeVacio: 'El mensaje de commit está vacío.',
    demasiadosEnLote: (tope: number) => `Hay demasiados archivos en un lote (límite: ${tope}).`,
    copiaNoLeida: (codigo: string) => `No se pudo leer la copia del disco: ${codigo}`,
    cambioDeEstado: 'El archivo cambió de estado durante la confirmación.',
    descarte: {
      esCarpeta: 'Es una carpeta: descarte sus archivos uno a uno.',
      fueraDelRepo: 'La ruta está fuera del repositorio.',
      enConflicto: 'El archivo está en conflicto: resuélvalo (o aborte la fusión) antes de descartar.',
      carpetaSobreArchivo: 'Hay una carpeta donde estaba el archivo: muévala antes de descartar.',
      archivoSobreCarpeta: 'Hay un archivo donde estaba una de sus carpetas: muévalo antes de descartar.',
      borradoConCambios:
        'El borrado del archivo ya está preparado y la copia del disco tiene cambios: quítelo de preparados antes de descartar.',
      borradoGrande:
        'El borrado del archivo ya está preparado y la copia del disco es demasiado grande para comprobarla: quítelo de preparados antes de descartar.',
      fueraDelArbol:
        'El archivo está marcado para que Git no lo modifique en el directorio de trabajo (skip-worktree): quite la marca antes de descartar.',
      ramaRota: 'La rama actual no apunta a un commit válido (su referencia está dañada): no se descartó nada.'
    }
  },
  {
    rutaNoValida: 'Invalid path.',
    carpetaAlPreparar: 'It is a folder: stage its files one by one.',
    carpetaAlQuitar: 'It is a folder: unstage its files one by one.',
    gitNoResponde: 'Git did not respond; try again.',
    gitFallo: (linea: string) => `Git failed: ${linea}`,
    gitFalloSalida: (codigo: number) => `Git failed (exit code ${codigo}).`,
    sinRepo: 'There is no active repository.',
    sinRepoRuta: 'There is no repository for this path.',
    proyectoDesconocido: 'This Git operation belongs to a project that is not open: nothing was done.',
    mensajeVacio: 'The commit message is empty.',
    demasiadosEnLote: (tope: number) => `Too many files in a batch (limit ${tope}).`,
    copiaNoLeida: (codigo: string) => `Could not read the copy on disk: ${codigo}`,
    cambioDeEstado: 'The file’s state changed while you were confirming.',
    descarte: {
      esCarpeta: 'It is a folder: discard its files one by one.',
      fueraDelRepo: 'Path outside the repository.',
      enConflicto: 'It is in conflict: resolve it (or abort the merge) before discarding.',
      carpetaSobreArchivo: 'There is a folder where the file used to be: move it before discarding.',
      archivoSobreCarpeta: 'There is a file where one of its folders used to be: move it before discarding.',
      borradoConCambios:
        'Its deletion is already staged and the copy on disk has changes: unstage it before discarding.',
      borradoGrande:
        'Its deletion is already staged and the copy on disk is too large to check: unstage it before discarding.',
      fueraDelArbol:
        'It is marked to be skipped in the working tree (skip-worktree): remove the flag before discarding.',
      ramaRota: 'The current branch does not point to a valid commit (its reference is damaged): nothing is discarded.'
    }
  }
)
