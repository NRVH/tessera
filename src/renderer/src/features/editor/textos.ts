// =============================================================================
// Textos del editor que no son de un visor: el panel de edición, la tira de pestañas, la cabecera
// y los avisos del diff, y los rechazos del registro de modelos.
// Sin JSX ni DOM. Los visores (imagen, binarios, clases Java, comprimidos) están en textosVisores.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txEditor = crearTextos(
  {
    errorBoundary: 'el editor',
    noSePudoAbrirArchivo: 'No se pudo abrir el archivo',
    noSePudoGuardar: 'No se pudo guardar',
    vistaPreviaDe: (nombre: string) => `Vista previa de ${nombre}`,
    buscarEnDocumento: 'Buscar en el documento',
    archivoBinarioNoSeMuestra: 'Archivo binario: no se muestra en el editor.',
    archivoGrandeTruncado: 'Archivo grande: se muestra solo el inicio (truncado a 2 MiB).',
    buscarConHistorial: 'Buscar (↑↓ para el historial)',
    reemplazar: 'Reemplazar',
    modoVista: 'Modo de vista',
    modoSoloEditor: 'Solo editor',
    modoDividida: 'Editor y vista previa',
    modoSoloVista: 'Solo vista previa',
    sinTitulo: (n: number) => `Sin título-${n}`,
    noSePuedeGuardarBinario: 'No se puede guardar un archivo binario.',
    noSePuedeConvertirBinario: 'No se puede convertir un archivo binario.',
    noSePuedeGuardarTruncado: 'No se puede guardar un archivo abierto truncado (>2 MiB): se perdería el resto.',
    noSePuedeConvertirTruncado: 'No se puede convertir un archivo abierto truncado (>2 MiB).'
  },
  {
    errorBoundary: 'the editor',
    noSePudoAbrirArchivo: 'Could not open the file',
    noSePudoGuardar: 'Could not save',
    vistaPreviaDe: (nombre: string) => `Preview of ${nombre}`,
    buscarEnDocumento: 'Search in the document',
    archivoBinarioNoSeMuestra: 'Binary file: not shown in the editor.',
    archivoGrandeTruncado: 'Large file: only the beginning is shown (truncated to 2 MiB).',
    buscarConHistorial: 'Find (↑↓ for history)',
    reemplazar: 'Replace',
    modoVista: 'View mode',
    modoSoloEditor: 'Editor only',
    modoDividida: 'Editor and preview',
    modoSoloVista: 'Preview only',
    sinTitulo: (n: number) => `Untitled-${n}`,
    noSePuedeGuardarBinario: 'Cannot save a binary file.',
    noSePuedeConvertirBinario: 'Cannot convert a binary file.',
    noSePuedeGuardarTruncado: 'Cannot save a truncated open file (>2 MiB): the rest would be lost.',
    noSePuedeConvertirTruncado: 'Cannot convert a truncated open file (>2 MiB).'
  }
)

export const txPestanas = crearTextos(
  {
    diferencias: 'Diferencias',
    cerrar: 'Cerrar',
    cerrarArchivo: (nombre: string) => `Cerrar ${nombre}`,
    fueraDelProyecto: (nombre: string) => `${nombre} (fuera del proyecto)`,
    sinGuardar: (nombre: string) => `${nombre} (sin guardar)`,
    diffDe: (ruta: string) => `${ruta} (diff)`,
    sufijoBorrado: ' · el archivo ya no existe en disco; Ctrl+S vuelve a crearlo',
    sufijoEfimera: ' · vista previa (se reemplaza al abrir otro diff del historial)',
    abrirEnExplorador: 'Abrir en el explorador',
    noSePudoAbrirExplorador: 'No se pudo abrir el explorador',
    guardarComo: 'Guardar como…',
    cerrarDerecha: 'Cerrar los de la derecha',
    cerrarIzquierda: 'Cerrar los de la izquierda',
    cerrarTodo: 'Cerrar todo',
    archivosAbiertos: 'Archivos abiertos',
    pestanasOcultas: 'Pestañas que no se ven'
  },
  {
    diferencias: 'Differences',
    cerrar: 'Close',
    cerrarArchivo: (nombre: string) => `Close ${nombre}`,
    fueraDelProyecto: (nombre: string) => `${nombre} (outside the project)`,
    sinGuardar: (nombre: string) => `${nombre} (unsaved)`,
    diffDe: (ruta: string) => `${ruta} (diff)`,
    sufijoBorrado: ' · the file no longer exists on disk; Ctrl+S creates it again',
    sufijoEfimera: ' · preview (replaced when you open another history diff)',
    abrirEnExplorador: 'Show in file manager',
    noSePudoAbrirExplorador: 'Could not open the file manager',
    guardarComo: 'Save as…',
    cerrarDerecha: 'Close tabs to the right',
    cerrarIzquierda: 'Close tabs to the left',
    cerrarTodo: 'Close all',
    archivosAbiertos: 'Open files',
    pestanasOcultas: 'Tabs out of view'
  }
)

export const txDiff = crearTextos(
  {
    unLado:
      'Este archivo solo existe en un lado (alta o borrado): no hay dos revisiones que poner una junto a otra.',
    estado: { A: 'Alta', M: 'Modificado', D: 'Borrado', R: 'Rename' },
    carpetaTitulo: 'Esto es una carpeta, no un archivo.',
    carpetaHint: 'Las carpetas no tienen diff. Abre uno de los archivos de dentro para ver sus cambios.',
    binarioTitulo: 'Archivo binario: no hay diff de texto que mostrar.',
    binarioHintBlob:
      'Se detectaron bytes nulos. Si el archivo sigue en el proyecto, ábrelo desde el explorador con la aplicación del sistema.',
    binarioHintCarga:
      'Se detectaron bytes nulos. Ábrelo desde el explorador y se pintará con el visor que le corresponda.',
    grandeVerTitulo: 'El archivo es demasiado grande para mostrar el diff.',
    grandeVerHint: 'Supera el tope de 2 MiB. Puedes abrirlo desde el explorador si necesitas verlo.',
    grandeEditarTitulo: 'El archivo es demasiado grande para editarlo aquí.',
    grandeEditarHint:
      'Supera el tope de 2 MiB, así que solo se cargó el principio y guardarlo perdería el resto.',
    yaNoEstaTitulo: 'El archivo ya no está en el disco.',
    yaNoEstaHint:
      'Se movió o se borró después de abrir esta vista. Recarga los cambios para actualizar la lista.',
    sinPermisosTitulo: 'No hay permisos para leer este archivo.',
    sinPermisosHint: 'Comprueba los permisos del archivo, o si otro programa lo tiene bloqueado.',
    enUsoTitulo: 'El archivo está en uso por otro programa.',
    enUsoHint: 'Ciérralo y vuelve a abrir el diff.',
    noSePudoMostrarTitulo: 'No se pudo mostrar este diff.',
    noSePudoMostrarHint:
      'Prueba a recargar los cambios. Si vuelve a pasar, el detalle de abajo ayuda a diagnosticarlo.',
    sinDiferencias: 'Sin diferencias',
    unaDiferencia: '1 diferencia',
    diferencias: (n: number) => `${n} diferencias`,
    aria: 'Diff',
    // Cabecera
    sinFuenteBorrado: 'Este archivo está borrado: no hay fuente al que saltar',
    sinFuenteNoProyecto:
      'Lo que se compara no es un archivo del proyecto, así que no hay fuente al que saltar',
    saltarAlFuenteTitulo: 'Saltar al fuente (abre el archivo en la línea que estás mirando)',
    saltarAlFuente: 'Saltar al fuente',
    mostrarCompleto: 'Mostrar el archivo completo',
    sinFragmentos: 'Este diff no tiene fragmentos sin cambios que colapsar',
    colapsarTitulo: (lineas: number) => `Colapsar los fragmentos sin cambios (${lineas} líneas de contexto)`,
    colapsar: 'Colapsar los fragmentos sin cambios',
    cambioAnteriorTitulo: 'Cambio anterior (Shift+F7)',
    cambioAnterior: 'Ir al cambio anterior',
    cambioSiguienteTitulo: 'Cambio siguiente (F7)',
    cambioSiguiente: 'Ir al cambio siguiente',
    modoDelDiff: 'Modo de vista del diff',
    ladoALado: 'Vista lado a lado',
    unificada: 'Vista unificada',
    sinCambiosIndice: 'Sin cambios respecto al índice',
    diferenciasEntreRevisiones: 'Diferencias entre las dos revisiones',
    revisionesQueSeComparan: 'Revisiones que se comparan'
  },
  {
    unLado:
      'This file exists on only one side (added or deleted), so there are no two revisions to place side by side.',
    estado: { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed' },
    carpetaTitulo: 'This is a folder, not a file.',
    carpetaHint: 'Folders have no diff. Open one of the files inside to see its changes.',
    binarioTitulo: 'Binary file: there is no text diff to show.',
    binarioHintBlob:
      'Null bytes were detected. If the file is still in the project, open it from the explorer with the system application.',
    binarioHintCarga:
      'Null bytes were detected. Open it from the explorer and it will be shown with the matching viewer.',
    grandeVerTitulo: 'The file is too large to show the diff.',
    grandeVerHint: 'It exceeds the 2 MiB limit. You can open it from the explorer if you need to see it.',
    grandeEditarTitulo: 'The file is too large to edit here.',
    grandeEditarHint:
      'It exceeds the 2 MiB limit, so only the beginning was loaded and saving it would lose the rest.',
    yaNoEstaTitulo: 'The file is no longer on disk.',
    yaNoEstaHint: 'It was moved or deleted after this view was opened. Reload the changes to refresh the list.',
    sinPermisosTitulo: 'There is no permission to read this file.',
    sinPermisosHint: 'Check the file permissions, or whether another program has it locked.',
    enUsoTitulo: 'The file is in use by another program.',
    enUsoHint: 'Close it and open the diff again.',
    noSePudoMostrarTitulo: 'Could not show this diff.',
    noSePudoMostrarHint: 'Try reloading the changes. If it happens again, the detail below helps diagnose it.',
    sinDiferencias: 'No differences',
    unaDiferencia: '1 difference',
    diferencias: (n: number) => `${n} differences`,
    aria: 'Diff',
    sinFuenteBorrado: 'This file is deleted: there is no source to jump to',
    sinFuenteNoProyecto: 'What is being compared is not a project file, so there is no source to jump to',
    saltarAlFuenteTitulo: 'Jump to source (opens the file at the line you are looking at)',
    saltarAlFuente: 'Jump to source',
    mostrarCompleto: 'Show the whole file',
    sinFragmentos: 'This diff has no unchanged sections to collapse',
    colapsarTitulo: (lineas: number) => `Collapse unchanged sections (${lineas} lines of context)`,
    colapsar: 'Collapse unchanged sections',
    cambioAnteriorTitulo: 'Previous change (Shift+F7)',
    cambioAnterior: 'Go to previous change',
    cambioSiguienteTitulo: 'Next change (F7)',
    cambioSiguiente: 'Go to next change',
    modoDelDiff: 'Diff view mode',
    ladoALado: 'Side-by-side view',
    unificada: 'Unified view',
    sinCambiosIndice: 'No changes compared to the index',
    diferenciasEntreRevisiones: 'Differences between the two revisions',
    revisionesQueSeComparan: 'Revisions being compared'
  }
)
