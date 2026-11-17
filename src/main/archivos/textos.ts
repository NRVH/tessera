// =============================================================================
// Textos de las operaciones sobre archivos que ve la persona: los errores del explorador (crear,
// mover, pegar, arrastrar, borrar, guardar) y el diálogo de «Guardar como». Español e inglés
// juntos; se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txArchivos = crearTextos(
  {
    sinProyecto: 'No hay proyecto activo.',
    proyectoDesconocido: 'Esta operación corresponde a un proyecto que no está abierto: no se realizó ningún cambio.',
    dentroComprimido: 'Esa ruta está dentro de un archivo comprimido y no se puede modificar desde aquí.',
    fueraDelProyecto: 'La ruta está fuera del proyecto (se bloqueó por seguridad).',
    codificacionPierde:
      'El texto contiene caracteres que la codificación seleccionada no admite, ' +
      'por lo que se perderían al guardar. Cambie a UTF-8 para conservarlos.',
    guardarComo: 'Guardar como',
    guardar: 'Guardar',
    yaExiste: (nombre: string) => `Ya existe «${nombre}» en esa carpeta.`,
    destinoNoCarpeta: 'El destino no es una carpeta.',
    origenInvalido: 'El origen no es válido.',
    carpetaEnSiMisma: 'No se puede mover una carpeta dentro de sí misma.',
    dosElementos: (nombre: string) =>
      `Hay dos elementos llamados «${nombre}» en la selección y no pueden estar en la misma carpeta.`,
    yaNoExiste: (nombre: string) => `Ya no existe «${nombre}».`,
    nadaQuePegar: 'No hay nada que pegar.',
    noRenombrarVarios: 'No se puede renombrar al pegar varios elementos.',
    nadaPegado: 'No había nada que pegar.',
    ninguno: 'ninguno de los elementos',
    noSePudoPegar: (que: string) => `No se pudo pegar ${que}.`,
    noSePudoLeer: (nombre: string) => `No se pudo leer «${nombre}».`,
    noEsUnArchivo: (nombre: string) => `«${nombre}» no es un archivo.`,
    noMoverEnSiMisma: (nombre: string) => `No se puede mover «${nombre}» dentro de sí misma.`,
    nadaQueArrastrarUno: 'El elemento ya no está en el proyecto: no hay nada que arrastrar.',
    nadaQueArrastrarVarios: 'Ninguno de esos elementos sigue en el proyecto: no hay nada que arrastrar.',
    noEliminarRaiz: 'No se puede eliminar la raíz del proyecto.',
    errorTrabajador: 'Error en el proceso de trabajo de archivos.',
    trabajadorSalio: (codigo: number) => `El proceso de trabajo de archivos terminó inesperadamente (código ${codigo}).`,
    documentoGrande: 'El documento es demasiado grande para mostrar su vista previa (más de 50 MiB).',
    comprimidoGrande: 'El archivo comprimido es demasiado grande para listar su contenido (más de 50 MiB).',
    nombreVacio: 'El nombre no puede estar vacío.',
    nombreReservado: 'El nombre está reservado por el sistema.',
    nombreBarras: 'El nombre no puede contener «/» ni «\\».',
    nombreInvalido: 'El nombre contiene caracteres no válidos.',
    demasiadasCopias: (nombre: string) => `Demasiadas copias de «${nombre}» en la carpeta destino.`
  },
  {
    sinProyecto: 'There is no active project.',
    proyectoDesconocido: 'This operation belongs to a project that is not open: nothing was done.',
    dentroComprimido: 'That path is inside a compressed file and cannot be modified from here.',
    fueraDelProyecto: 'Path outside the project (path traversal blocked).',
    codificacionPierde:
      'The text has characters the selected encoding does not support; ' +
      'saving would lose them. Switch to UTF-8 to keep them.',
    guardarComo: 'Save as',
    guardar: 'Save',
    yaExiste: (nombre: string) => `“${nombre}” already exists in that folder.`,
    destinoNoCarpeta: 'The destination is not a folder.',
    origenInvalido: 'Invalid source.',
    carpetaEnSiMisma: 'A folder cannot be moved into itself.',
    dosElementos: (nombre: string) =>
      `There are two items named “${nombre}” in the selection: they cannot both fit in the same folder.`,
    yaNoExiste: (nombre: string) => `“${nombre}” no longer exists.`,
    nadaQuePegar: 'There is nothing to paste.',
    noRenombrarVarios: 'Items cannot be renamed when pasting several at once.',
    nadaPegado: 'There was nothing to paste.',
    ninguno: 'none of the items',
    noSePudoPegar: (que: string) => `Could not paste ${que}.`,
    noSePudoLeer: (nombre: string) => `Could not read “${nombre}”.`,
    noEsUnArchivo: (nombre: string) => `“${nombre}” is not a file.`,
    noMoverEnSiMisma: (nombre: string) => `“${nombre}” cannot be moved into itself.`,
    nadaQueArrastrarUno: 'That is no longer in the project: there is nothing to drag.',
    nadaQueArrastrarVarios: 'None of those items are in the project anymore: there is nothing to drag.',
    noEliminarRaiz: 'The project root cannot be deleted.',
    errorTrabajador: 'Error in the file worker.',
    trabajadorSalio: (codigo: number) => `The file worker exited unexpectedly (code ${codigo}).`,
    documentoGrande: 'Document too large to preview (>50 MiB).',
    comprimidoGrande: 'Compressed file too large to list (>50 MiB).',
    nombreVacio: 'The name cannot be empty.',
    nombreReservado: 'Reserved name.',
    nombreBarras: 'The name cannot contain “/” or “\\”.',
    nombreInvalido: 'The name has invalid characters.',
    demasiadasCopias: (nombre: string) => `Too many copies of “${nombre}” in the destination folder.`
  }
)
