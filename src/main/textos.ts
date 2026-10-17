// =============================================================================
// Textos sueltos del main que llegan a la persona y no tienen una carpeta con módulo propio: el
// historial de conversaciones, la búsqueda, la comparación de comprimidos, el portapapeles, el
// diálogo de abrir proyecto, las terminales SSH y la papelera. Español e inglés juntos; se leen al
// usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../shared/i18n.ts'

export const txMain = crearTextos(
  {
    sinTitulo: '(sin título)',
    busqueda: {
      fallo: (err: string) => `La búsqueda falló: ${err}`,
      rutaInvalida: 'Ruta de proyecto inválida.'
    },
    comprimidos: {
      revisionGrande: (ruta: string, mb: number) =>
        `«${ruta}» ocupa ${mb} MB en esa revisión y supera lo que Tessera puede abrir de una vez.`,
      niveles: (max: number) => `Sólo se puede bajar ${max} niveles dentro de un archivo comprimido.`,
      entradaGrande: (nombre: string, kb: number) =>
        `«${nombre}» ocupa ${kb} KB descomprimida y supera el máximo que se puede comparar.`,
      binario: 'Esta entrada tiene bytes nulos: no hay diff de texto que mostrar.',
      yaNoEsta: (nombre: string) => `«${nombre}» ya no está en el contenedor.`,
      ningunaRevision: 'Este archivo comprimido no existe en ninguna de las dos revisiones.'
    },
    portapapeles: {
      noSeLeyo: 'No se pudo leer lo que hay en el portapapeles.',
      noSeLeyoImagen: 'No se pudo leer la imagen del portapapeles.',
      vacio: 'No hay archivos ni imágenes en el portapapeles.'
    },
    abrirProyecto: 'Abrir proyecto',
    terminales: {
      faltaConexion: 'Falta la conexión SSH que abrir.',
      sinSsh: 'Las conexiones SSH no están disponibles en esta sesión de Tessera.'
    },
    papelera: 'No se pudo mandar la carpeta a la papelera: se queda en su sitio.'
  },
  {
    sinTitulo: '(untitled)',
    busqueda: {
      fallo: (err: string) => `The search failed: ${err}`,
      rutaInvalida: 'Invalid project path.'
    },
    comprimidos: {
      revisionGrande: (ruta: string, mb: number) =>
        `“${ruta}” is ${mb} MB in that revision and exceeds what Tessera can open at once.`,
      niveles: (max: number) => `You can only go down ${max} levels inside a compressed file.`,
      entradaGrande: (nombre: string, kb: number) =>
        `“${nombre}” is ${kb} KB uncompressed and exceeds the maximum that can be compared.`,
      binario: 'This entry has null bytes: there is no text diff to show.',
      yaNoEsta: (nombre: string) => `“${nombre}” is no longer in the container.`,
      ningunaRevision: 'This compressed file does not exist in either of the two revisions.'
    },
    portapapeles: {
      noSeLeyo: 'Could not read what is on the clipboard.',
      noSeLeyoImagen: 'Could not read the image from the clipboard.',
      vacio: 'There are no files or images on the clipboard.'
    },
    abrirProyecto: 'Open project',
    terminales: {
      faltaConexion: 'The SSH connection to open is missing.',
      sinSsh: 'SSH connections are not available in this Tessera session.'
    },
    papelera: 'Could not move the folder to the trash: it stays where it is.'
  }
)
