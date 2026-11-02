// =============================================================================
// Textos del explorador de archivos en español e inglés: cabecera, diálogos, menú contextual,
// estados de las filas y errores de las operaciones. Se leen al usarse (`tx()` dentro de la
// función), nunca en el nivel superior de un módulo.
// Depende solo de `shared/i18n`.
// =============================================================================
import { crearTextos } from '../../../../shared/i18n.ts'

export const txExplorador = crearTextos(
  {
    titulo: 'Explorador',
    sinProyecto: 'Sin proyecto abierto',
    sinProyectoPista: 'Abre un proyecto para explorar sus archivos.',
    arbolArchivos: 'Árbol de archivos',
    cargando: 'cargando…',
    vacio: '(vacío)',
    errorGenerico: 'error',
    noSePudoLeerProyecto: 'No se pudo leer el proyecto:',
    nuevoArchivo: 'Nuevo archivo',
    nuevaCarpeta: 'Nueva carpeta',
    nuevoArchivoEn: (dir: string) => `Nuevo archivo en "${dir}"`,
    nuevaCarpetaEn: (dir: string) => `Nueva carpeta en "${dir}"`,
    refrescar: 'Refrescar',
    // Diálogos
    nombreArchivo: 'Nombre del archivo',
    nombreCarpeta: 'Nombre de la carpeta',
    crear: 'Crear',
    renombrar: 'Renombrar',
    nuevoNombre: 'Nuevo nombre',
    reemplazarArchivos: 'Reemplazar archivos',
    reemplazarArchivo: 'Reemplazar archivo',
    yaExiste: (varios: boolean, lista: string) =>
      `Ya existe${varios ? 'n' : ''} en la carpeta destino:\n${lista}\n\nSi reemplazas, se sustituyen (una carpeta se sustituye entera, con todo lo que tenga) y lo anterior no se puede recuperar.`,
    reemplazar: 'Reemplazar',
    eliminar: 'Eliminar',
    eliminarCarpeta: 'Eliminar carpeta',
    eliminarArchivo: 'Eliminar archivo',
    eliminarElementos: (n: number) => `Eliminar ${n} elementos`,
    avisoContenidoCarpetas: '\nSe eliminará también todo el contenido de las carpetas.',
    avisoContenido: '\nSe eliminará también todo su contenido.',
    seguroEliminar: (nombre: string, aviso: string) =>
      `¿Eliminar "${nombre}"? Se borra del disco sin pasar por la papelera: no se puede deshacer.${aviso}`,
    seguroEliminarVarios: (n: number, listado: string, resto: number, aviso: string) =>
      `¿Eliminar estos ${n} elementos? Se borran del disco sin pasar por la papelera: no se puede deshacer.\n${listado}${resto > 0 ? `\n…y ${resto} más` : ''}${aviso}`,
    ymas: (n: number) => `y ${n} más`,
    // Menú contextual
    abrirJarEn: (gestor: string) => `Abrir el .jar en ${gestor}`,
    abrirEn: (gestor: string) => `Abrir en ${gestor}`,
    historialArchivo: 'Historial del archivo',
    desmontarBd: 'Desmontar la base de datos',
    montarBd: 'Montar como base de datos',
    cortar: (n: number) => (n > 1 ? `Cortar ${n} elementos` : 'Cortar'),
    copiar: (n: number) => (n > 1 ? `Copiar ${n} elementos` : 'Copiar'),
    pegarImagen: 'Pegar imagen',
    pegar: 'Pegar',
    copiarRutas: (n: number) => (n > 1 ? `Copiar ${n} rutas` : 'Copiar ruta'),
    copiarRutasRelativas: (n: number) => (n > 1 ? `Copiar ${n} rutas relativas` : 'Copiar ruta relativa'),
    renombrarPuntos: 'Renombrar…',
    descartarCambios: 'Descartar cambios (vuelve a la versión de git)',
    eliminarElementosPuntos: (n: number) => `Eliminar ${n} elementos…`,
    eliminarCarpetaPuntos: 'Eliminar carpeta…',
    eliminarArchivoPuntos: 'Eliminar archivo…',
    // Errores de las operaciones
    noSePudoEliminar: (lista: string) => `No se pudo eliminar: ${lista}.`,
    noSeMovio: (varios: boolean, nombres: string) =>
      `No se movió nada: ya ${varios ? 'existen' : 'existe'} ${nombres} en la carpeta destino.`,
    noSePudoLeerUbicacion: 'No se pudo leer la ubicación de lo que soltaste.',
    noSePudoPegar: (lista: string) => `No se pudo pegar: ${lista}. El resto sí se pegó.`,
    noSePudoObtenerRuta: 'No se pudo obtener la ruta.'
  },
  {
    titulo: 'Explorer',
    sinProyecto: 'No project open',
    sinProyectoPista: 'Open a project to browse its files.',
    arbolArchivos: 'File tree',
    cargando: 'loading…',
    vacio: '(empty)',
    errorGenerico: 'error',
    noSePudoLeerProyecto: 'Could not read the project:',
    nuevoArchivo: 'New file',
    nuevaCarpeta: 'New folder',
    nuevoArchivoEn: (dir: string) => `New file in “${dir}”`,
    nuevaCarpetaEn: (dir: string) => `New folder in “${dir}”`,
    refrescar: 'Refresh',
    nombreArchivo: 'File name',
    nombreCarpeta: 'Folder name',
    crear: 'Create',
    renombrar: 'Rename',
    nuevoNombre: 'New name',
    reemplazarArchivos: 'Replace files',
    reemplazarArchivo: 'Replace file',
    yaExiste: (varios: boolean, lista: string) =>
      `${varios ? 'These already exist' : 'This already exists'} in the destination folder:\n${lista}\n\nReplacing overwrites ${varios ? 'them' : 'it'} (a folder is replaced with everything in it), and the previous content cannot be recovered.`,
    reemplazar: 'Replace',
    eliminar: 'Delete',
    eliminarCarpeta: 'Delete folder',
    eliminarArchivo: 'Delete file',
    eliminarElementos: (n: number) => `Delete ${n} items`,
    avisoContenidoCarpetas: '\nEverything inside the folders will be deleted too.',
    avisoContenido: '\nEverything inside it will be deleted too.',
    seguroEliminar: (nombre: string, aviso: string) =>
      `Delete “${nombre}”? It is deleted from disk without being moved to the trash. This cannot be undone.${aviso}`,
    seguroEliminarVarios: (n: number, listado: string, resto: number, aviso: string) =>
      `Delete these ${n} items? They are deleted from disk without being moved to the trash. This cannot be undone.\n${listado}${resto > 0 ? `\n…and ${resto} more` : ''}${aviso}`,
    ymas: (n: number) => `and ${n} more`,
    abrirJarEn: (gestor: string) => `Open .jar in ${gestor}`,
    abrirEn: (gestor: string) => `Open in ${gestor}`,
    historialArchivo: 'File history',
    desmontarBd: 'Unmount database',
    montarBd: 'Mount as database',
    cortar: (n: number) => (n > 1 ? `Cut ${n} items` : 'Cut'),
    copiar: (n: number) => (n > 1 ? `Copy ${n} items` : 'Copy'),
    pegarImagen: 'Paste image',
    pegar: 'Paste',
    copiarRutas: (n: number) => (n > 1 ? `Copy ${n} paths` : 'Copy path'),
    copiarRutasRelativas: (n: number) => (n > 1 ? `Copy ${n} relative paths` : 'Copy relative path'),
    renombrarPuntos: 'Rename…',
    descartarCambios: 'Discard changes (restore the Git version)',
    eliminarElementosPuntos: (n: number) => `Delete ${n} items…`,
    eliminarCarpetaPuntos: 'Delete folder…',
    eliminarArchivoPuntos: 'Delete file…',
    noSePudoEliminar: (lista: string) => `Could not delete: ${lista}.`,
    noSeMovio: (varios: boolean, nombres: string) =>
      `Nothing was moved: ${nombres} already ${varios ? 'exist' : 'exists'} in the destination folder.`,
    noSePudoLeerUbicacion: 'Could not read the location of the dropped items.',
    noSePudoPegar: (lista: string) => `Could not paste: ${lista}. Everything else was pasted.`,
    noSePudoObtenerRuta: 'Could not get the path.'
  }
)
