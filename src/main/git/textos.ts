// =============================================================================
// Textos de git que ve la persona: los rechazos y errores de preparar, confirmar y descartar, y los
// diálogos nativos de confirmación del descarte. Español e inglés juntos; se leen al usarse. Solo
// depende de shared/i18n (las confirmaciones nativas lo importan sin traer `electron`).
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txGit = crearTextos(
  {
    rutaNoValida: 'Ruta no válida.',
    carpetaAlPreparar: 'Es una carpeta: prepara sus archivos uno a uno.',
    carpetaAlQuitar: 'Es una carpeta: quita sus archivos de preparados uno a uno.',
    gitNoResponde: 'git no respondió; inténtalo de nuevo.',
    gitFallo: (linea: string) => `git falló: ${linea}`,
    gitFalloSalida: (codigo: number) => `git falló (salida ${codigo}).`,
    sinRepo: 'No hay repositorio activo.',
    sinRepoRuta: 'No hay repositorio para esta ruta.',
    proyectoDesconocido: 'Esta operación de git es de un proyecto que no está abierto: no se hizo nada.',
    mensajeVacio: 'El mensaje de commit está vacío.',
    demasiadosEnLote: (tope: number) => `Demasiados archivos en un lote (tope ${tope}).`,
    copiaNoLeida: (codigo: string) => `No se pudo leer la copia del disco: ${codigo}`,
    cambioDeEstado: 'El archivo cambió de estado durante la confirmación.',
    descarte: {
      esCarpeta: 'Es una carpeta: descarta sus archivos uno a uno.',
      fueraDelRepo: 'Ruta fuera del repositorio.',
      enConflicto: 'Está en conflicto: resuélvelo (o aborta la fusión) antes de descartar.',
      carpetaSobreArchivo: 'Hay una carpeta donde estaba el archivo: muévela antes de descartar.',
      archivoSobreCarpeta: 'Hay un archivo donde estaba una de sus carpetas: muévelo antes de descartar.',
      borradoConCambios:
        'Su borrado ya está preparado y la copia del disco tiene cambios: quítalo de preparados antes de descartar.',
      borradoGrande:
        'Su borrado ya está preparado y la copia del disco es demasiado grande para comprobarla: quítalo de preparados antes de descartar.',
      fueraDelArbol:
        'Está marcado para no tocarse en el árbol de trabajo (skip-worktree): quita la marca antes de descartar.',
      ramaRota: 'La rama actual no apunta a un commit válido (su referencia está dañada): no se descarta nada.'
    }
  },
  {
    rutaNoValida: 'Invalid path.',
    carpetaAlPreparar: 'It is a folder: stage its files one by one.',
    carpetaAlQuitar: 'It is a folder: unstage its files one by one.',
    gitNoResponde: 'git did not respond; try again.',
    gitFallo: (linea: string) => `git failed: ${linea}`,
    gitFalloSalida: (codigo: number) => `git failed (exit ${codigo}).`,
    sinRepo: 'There is no active repository.',
    sinRepoRuta: 'There is no repository for this path.',
    proyectoDesconocido: 'This git operation belongs to a project that isn’t open: nothing was done.',
    mensajeVacio: 'The commit message is empty.',
    demasiadosEnLote: (tope: number) => `Too many files in a batch (limit ${tope}).`,
    copiaNoLeida: (codigo: string) => `Could not read the copy on disk: ${codigo}`,
    cambioDeEstado: 'The file changed state during the confirmation.',
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
        'It is marked as not to be touched in the working tree (skip-worktree): remove the mark before discarding.',
      ramaRota: 'The current branch does not point to a valid commit (its reference is damaged): nothing is discarded.'
    }
  }
)
