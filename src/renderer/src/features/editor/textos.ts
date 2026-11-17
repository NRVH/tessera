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
    noSePuedeGuardarTruncado: 'No se puede guardar un archivo abierto de forma truncada (más de 2 MiB): se perdería el resto del contenido.',
    noSePuedeConvertirTruncado: 'No se puede convertir un archivo abierto de forma truncada (más de 2 MiB).'
  },
  {
    errorBoundary: 'the editor',
    noSePudoAbrirArchivo: 'Could not open the file',
    noSePudoGuardar: 'Could not save',
    vistaPreviaDe: (nombre: string) => `Preview of ${nombre}`,
    buscarEnDocumento: 'Find in document',
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
    noSePuedeGuardarTruncado: 'Cannot save a file that was opened truncated (>2 MiB): the rest would be lost.',
    noSePuedeConvertirTruncado: 'Cannot convert a file that was opened truncated (>2 MiB).'
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
    sufijoBorrado: (mod: string) => ` · el archivo ya no existe en el disco; ${mod}+S lo vuelve a crear`,
    sufijoEfimera: ' · vista previa (se reemplaza al abrir otro diff del historial)',
    abrirEnExplorador: (gestor: string) => `Mostrar en ${gestor}`,
    noSePudoAbrirExplorador: (gestor: string) => `No se pudo abrir ${gestor}`,
    guardarComo: 'Guardar como…',
    cerrarDerecha: 'Cerrar las de la derecha',
    cerrarIzquierda: 'Cerrar las de la izquierda',
    cerrarTodo: 'Cerrar todas',
    archivosAbiertos: 'Archivos abiertos',
    pestanasOcultas: 'Pestañas ocultas'
  },
  {
    diferencias: 'Differences',
    cerrar: 'Close',
    cerrarArchivo: (nombre: string) => `Close ${nombre}`,
    fueraDelProyecto: (nombre: string) => `${nombre} (outside the project)`,
    sinGuardar: (nombre: string) => `${nombre} (unsaved)`,
    diffDe: (ruta: string) => `${ruta} (diff)`,
    sufijoBorrado: (mod: string) => ` · the file no longer exists on disk; press ${mod}+S to create it again`,
    sufijoEfimera: ' · preview (replaced when you open another diff from the history)',
    abrirEnExplorador: (gestor: string) => `Show in ${gestor}`,
    noSePudoAbrirExplorador: (gestor: string) => `Could not open ${gestor}`,
    guardarComo: 'Save as…',
    cerrarDerecha: 'Close to the right',
    cerrarIzquierda: 'Close to the left',
    cerrarTodo: 'Close all',
    archivosAbiertos: 'Open files',
    pestanasOcultas: 'Hidden tabs'
  }
)

export const txDiff = crearTextos(
  {
    unLado:
      'Este archivo existe solo en uno de los dos lados (alta o borrado), por lo que no hay dos revisiones que comparar.',
    estado: { A: 'Alta', M: 'Modificado', D: 'Borrado', R: 'Renombrado' },
    carpetaTitulo: 'El elemento seleccionado es una carpeta, no un archivo.',
    carpetaPista: 'Las carpetas no tienen diff. Abra uno de los archivos que contiene para ver sus cambios.',
    binarioTitulo: 'Archivo binario: no hay un diff de texto que mostrar.',
    binarioPistaBlob:
      'Se detectaron bytes nulos. Si el archivo sigue en el proyecto, ábralo desde el explorador con la aplicación predeterminada del sistema.',
    binarioPistaCarga:
      'Se detectaron bytes nulos. Ábralo desde el explorador para verlo con el visor que le corresponda.',
    grandeVerTitulo: 'El archivo es demasiado grande para mostrar su diff.',
    grandeVerPista: 'Supera el límite de 2 MiB. Si necesita verlo, ábralo desde el explorador.',
    grandeEditarTitulo: 'El archivo es demasiado grande para editarlo aquí.',
    grandeEditarPista:
      'Supera el límite de 2 MiB, por lo que solo se cargó el principio y guardarlo eliminaría el resto del contenido.',
    yaNoEstaTitulo: 'El archivo ya no está en el disco.',
    yaNoEstaPista:
      'Se movió o se borró después de abrir esta vista. Recargue los cambios para actualizar la lista.',
    sinPermisosTitulo: 'No hay permiso para leer este archivo.',
    sinPermisosPista: 'Compruebe los permisos del archivo y si otro programa lo tiene bloqueado.',
    enUsoTitulo: 'El archivo está en uso por otro programa.',
    enUsoPista: 'Cierre el archivo en ese programa y vuelva a abrir el diff.',
    noSePudoMostrarTitulo: 'No se pudo mostrar este diff.',
    noSePudoMostrarPista:
      'Recargue los cambios. Si el problema se repite, el detalle que aparece debajo ayuda a diagnosticarlo.',
    sinDiferencias: 'Sin diferencias',
    unaDiferencia: '1 diferencia',
    diferencias: (n: number) => `${n} diferencias`,
    aria: 'Diff',
    // Cabecera
    sinFuenteBorrado: 'Este archivo está borrado: no hay un archivo fuente al que ir',
    sinFuenteNoProyecto:
      'Lo que se compara no es un archivo del proyecto, por lo que no hay un archivo fuente al que ir',
    saltarAlFuenteTitulo: 'Ir al archivo fuente (lo abre en la línea visible en pantalla)',
    saltarAlFuente: 'Ir al archivo fuente',
    mostrarCompleto: 'Mostrar el archivo completo',
    sinFragmentos: 'Este diff no tiene fragmentos sin cambios que contraer',
    colapsarTitulo: (lineas: number) => `Contraer los fragmentos sin cambios (${lineas} líneas de contexto)`,
    colapsar: 'Contraer los fragmentos sin cambios',
    cambioAnteriorTitulo: 'Cambio anterior (Mayús+F7)',
    cambioAnterior: 'Ir al cambio anterior',
    cambioSiguienteTitulo: 'Cambio siguiente (F7)',
    cambioSiguiente: 'Ir al cambio siguiente',
    modoDelDiff: 'Modo de vista del diff',
    ladoALado: 'Vista lado a lado',
    unificada: 'Vista unificada',
    sinCambiosIndice: 'Sin cambios respecto al índice'
  },
  {
    unLado:
      'This file exists on only one side (added or deleted), so there are no two revisions to place side by side.',
    estado: { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed' },
    carpetaTitulo: 'This is a folder, not a file.',
    carpetaPista: 'Folders have no diff. Open one of the files inside to see its changes.',
    binarioTitulo: 'Binary file: there is no text diff to show.',
    binarioPistaBlob:
      'Null bytes were detected. If the file is still in the project, open it from the explorer in its default app.',
    binarioPistaCarga:
      'Null bytes were detected. Open it from the explorer to view it in the matching viewer.',
    grandeVerTitulo: 'The file is too large to show the diff.',
    grandeVerPista: 'It exceeds the 2 MiB limit. You can open it from the explorer if you need to see it.',
    grandeEditarTitulo: 'The file is too large to edit here.',
    grandeEditarPista:
      'It exceeds the 2 MiB limit, so only the beginning was loaded and saving it would lose the rest.',
    yaNoEstaTitulo: 'The file is no longer on disk.',
    yaNoEstaPista: 'It was moved or deleted after this view was opened. Reload the changes to refresh the list.',
    sinPermisosTitulo: 'You do not have permission to read this file.',
    sinPermisosPista: 'Check the file permissions, or whether another program has it locked.',
    enUsoTitulo: 'The file is in use by another program.',
    enUsoPista: 'Close it and open the diff again.',
    noSePudoMostrarTitulo: 'Could not show this diff.',
    noSePudoMostrarPista: 'Try reloading the changes. If it happens again, the details below can help diagnose it.',
    sinDiferencias: 'No differences',
    unaDiferencia: '1 difference',
    diferencias: (n: number) => `${n} differences`,
    aria: 'Diff',
    sinFuenteBorrado: 'This file is deleted: there is no source to jump to',
    sinFuenteNoProyecto: 'The compared item is not a project file, so there is no source to jump to',
    saltarAlFuenteTitulo: 'Jump to source (opens the file at the line you are viewing)',
    saltarAlFuente: 'Jump to source',
    mostrarCompleto: 'Show full file',
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
    sinCambiosIndice: 'No changes compared to the index'
  }
)
