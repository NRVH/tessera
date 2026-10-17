// =============================================================================
// Textos de la interfaz de git (panel de Cambios, panel de Log, historial de un archivo, menú de
// una fila, fechas relativas y avisos de las acciones) en español e inglés.
// Sin JSX ni DOM: lo importan también los módulos puros de `modelo/` y sus pruebas.
// Depende solo de `shared/i18n.ts`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txGit = crearTextos(
  {
    // Cabeceras, estados vacíos y de carga
    sinProyectoTitulo: 'Sin proyecto abierto',
    sinProyectoCambios: 'Abre un proyecto para ver sus cambios de git.',
    sinProyectoHistorial: 'Abre un proyecto para ver su historial de git.',
    noEsRepoTitulo: 'Esto no es un repositorio de git',
    noEsRepoCambios: 'La carpeta abierta no está versionada, así que no hay cambios que seguir.',
    noEsRepoHistorial:
      'La carpeta abierta no está versionada, así que no hay historial que enseñar. Abre un proyecto con git para ver sus commits y sus ramas.',
    cargandoCambios: 'Cargando cambios…',
    motivoReposLeidos: (leidos: number, total: number) => `${leidos} de ${total} repositorios leídos`,
    sinCambiosTitulo: 'Sin cambios',
    sinCambiosPista: 'El working-tree está limpio: no hay nada modificado ni sin versionar.',
    sinCambiosLinea: 'Sin cambios en el working-tree.',
    ningunRepoConCambios: (total: number) => `Ninguno de los ${total} repositorios tiene cambios sin commitear.`,
    errorCambios: (error: string) => `No se pudieron leer los cambios: ${error}`,
    cambiosWorkingTree: 'Cambios del working-tree',
    repositoriosConCambios: 'Repositorios con cambios',

    // Panel lateral de Cambios
    panelCambios: 'Cambios de git',
    cambios: 'Cambios',
    plegarRepos: 'Plegar todos los repositorios',
    desplegarRepos: 'Desplegar los repositorios con cambios',
    recargarCambios: 'Recargar los cambios',
    repoActivo: 'Repositorio activo (el del historial de abajo)',
    repoAbrir: 'Abrir este repositorio y graficar su historial',
    ramaActual: (rama: string) => `Rama actual: ${rama}`,
    marcarTodo: (etiqueta: string) => `Marcar todo ${etiqueta}`,
    marcar: (nombre: string) => `Marcar ${nombre}`,

    // Secciones de git status
    secciones: {
      conflict: 'Conflictos',
      staged: 'Preparados',
      unstaged: 'Cambios',
      untracked: 'Sin versionar'
    },

    // Botones de lote
    quitarN: (n: number) => `Quitar ${n}`,
    quitarNTitulo: (n: number) => `Quitar ${n} de preparados`,
    marcarResueltosN: (n: number) => `Marcar ${n} como resueltos`,
    marcarResueltosNTitulo: (n: number) => `Marcar ${n} archivos como resueltos`,
    prepararN: (n: number) => `Preparar ${n}`,
    prepararNTitulo: (n: number) => `Preparar ${n} archivos`,
    descartarN: (n: number) => `Descartar ${n}`,
    descartarNTitulo: (n: number) => `Descartar los cambios de ${n} archivos`,

    // Menú contextual de una fila de Cambios
    abrirArchivo: 'Abrir archivo',
    abrirEnExplorador: 'Abrir en el explorador',
    quitarDePreparados: 'Quitar de preparados',
    marcarResuelto: 'Marcar como resuelto',
    preparar: 'Preparar',
    agregarGitignore: 'Agregar a .gitignore',
    agregarGitignoreN: (n: number) => `Agregar ${n} a .gitignore`,
    agregarExclusionLocal: 'Agregar a exclusión local',
    agregarExclusionLocalN: (n: number) => `Agregar ${n} a exclusión local`,
    descartarCambios: 'Descartar cambios…',
    descartarArchivosN: (n: number) => `Descartar ${n} archivos…`,

    // Fila de archivo
    archivosDeCarpeta: (n: number) => `${n} ${n === 1 ? 'archivo' : 'archivos'}`,
    dobleClicDiferencias: 'Doble clic para ver las diferencias',
    letras: {
      A: 'Añadido',
      M: 'Modificado',
      D: 'Eliminado',
      R: 'Renombrado',
      C: 'Copiado',
      U: 'En conflicto',
      T: 'Cambió de tipo'
    },
    indiceDisco: 'Índice ↔ Disco',
    headIndice: 'HEAD ↔ Índice',

    // Panel de Log: cabecera y vistas
    panelHistorial: 'Historial de git',
    recargarHistorial: 'Recargar el historial y las ramas',
    restaurarPanel: 'Restaurar el panel de git',
    maximizarPanel: 'Maximizar el panel de git',
    restaurarTitulo: 'Restaurar: git vuelve al panel inferior',
    maximizarTitulo: 'Maximizar: git ocupa toda el área de trabajo (sin cerrar nada)',
    cerrarPanel: 'Cerrar el panel de git',
    vistasGit: 'Vistas de git',
    historialDe: (nombre: string) => `Historial: ${nombre}`,
    cerrarHistorial: 'Cerrar el historial',
    anchoRamas: 'Ancho de la columna de ramas',
    anchoDetalle: 'Ancho de la columna de detalle',

    // Árbol de ramas
    repoDelHistorial: 'Repositorio del historial (clic para cambiar)',
    ramas: 'Ramas',
    repositorio: 'Repositorio',
    cargandoRamas: 'Cargando ramas…',
    sinRamas: 'Este repositorio no tiene ramas.',
    verTodasRamasTitulo: 'Ver el historial de todas las ramas',
    todasLasRamas: 'Todas las ramas',
    ramaActualHead: (rama: string) => `${rama} — rama actual (HEAD)`,
    ramaQuitarFiltro: (rama: string) => `${rama} — clic para quitar el filtro`,
    ramaFiltrar: (rama: string) => `Filtrar el historial por ${rama}`,
    carpetaRamas: (ruta: string, n: number) => `${ruta} (${n} rama${n === 1 ? '' : 's'})`,
    local: 'Local',
    remoto: 'Remoto',

    // Barra de filtros
    sinResultados: 'sin resultados',
    coincidenciaAnteriorTitulo: 'Coincidencia anterior (Mayús+Enter)',
    coincidenciaAnterior: 'Coincidencia anterior',
    coincidenciaSiguienteTitulo: 'Coincidencia siguiente (Enter)',
    coincidenciaSiguiente: 'Coincidencia siguiente',
    textoOHash: 'Texto o hash',
    buscarEnHistorial: 'Buscar en el historial de commits',
    limpiarBusqueda: 'Limpiar la búsqueda',
    cualquierUsuario: 'Cualquier usuario',
    actual: 'actual',
    filtrarRama: 'Filtrar por rama',
    filtrarUsuario: 'Filtrar por usuario',
    filtrarFecha: 'Filtrar por fecha',
    rama: 'Rama',
    usuario: 'Usuario',
    fecha: 'Fecha',
    fechas: {
      cualquiera: 'Cualquier fecha',
      hoy: 'Hoy',
      semana: 'Última semana',
      mes: 'Último mes',
      anio: 'Último año'
    },

    // Lista de commits
    historialDeCommits: 'Historial de commits',
    errorHistoria: 'No se pudo leer la historia de git:',
    cargandoHistorial: 'Cargando historial…',
    ningunCommitCoincide: 'Ningún commit coincide con los filtros.',
    avisoOculto: (lista: number, total: number, hayMas: boolean) =>
      `${lista} de ${total} commits${hayMas ? ' cargados (el filtro solo mira dentro de estos)' : ''}`,
    cargarCompletoTitulo: (n: number) =>
      `Mostrando los últimos ${n} commits; cargar el historial completo del repositorio`,
    cargando: 'Cargando…',
    cargarCompleto: (n: number) => `Cargar el historial completo (más de ${n})`,
    sinCommitsTitulo: 'Aún no hay commits',
    sinCommitsPista:
      'Este repositorio está recién creado. En cuanto confirmes el primer commit, su historial aparecerá aquí.',
    copiado: 'Copiado',
    copiarHashFila: (hash: string) => `Copiar el hash completo (${hash})`,
    copiarHashLista: (mod: string) => `Copiar el hash completo · ${mod}+C en la lista`,
    noSePudoCopiarHash: 'No se pudo copiar el hash',

    // Detalle del commit
    detalle: 'Detalle',
    ningunCommitTitulo: 'Ningún commit seleccionado',
    ningunCommitPista: 'Elige uno del historial para ver su mensaje, su autor y los archivos que tocó.',
    repartoArchivosMensaje: 'Reparto entre los archivos y el mensaje del commit',
    errorRamas: 'No se pudieron leer las ramas.',
    buscandoRamas: 'Buscando en qué ramas está…',
    enNingunaRama: 'En ninguna rama.',
    enNRamas: (n: number) => `En ${n} rama${n === 1 ? '' : 's'}:`,
    mostrarNMas: (n: number) => `Mostrar ${n} más`,
    mostrarMenos: 'Mostrar menos',
    aplicadoPor: (nombre: string) => `Aplicado por ${nombre}`,
    archivosDelCommit: 'Archivos del commit',
    errorArchivos: (error: string) => `No se pudieron leer los archivos: ${error}`,
    cargandoArchivos: 'Cargando archivos…',
    commitSinArchivos: 'Este commit no cambió archivos.',

    // Chips de referencias
    chipEtiqueta: (nombre: string) => `Etiqueta ${nombre}`,
    chipRamaActual: (nombre: string) => `${nombre} (rama actual)`,
    chipHeadSinRama: 'HEAD (sin rama, detached)',
    chipRamaRemota: (nombre: string) => `Rama remota ${nombre}`,
    chipRama: (nombre: string) => `Rama ${nombre}`,

    // Historial de un archivo
    errorHistorial: 'No se pudo leer el historial',
    sinHistorialTitulo: 'Sin historial',
    sinHistorialPista: (nombre: string) =>
      `git no conoce ningún commit que haya tocado "${nombre}". Puede que sea un archivo nuevo que todavía no se ha confirmado.`,
    anchoListaArchivo: 'Ancho de la lista de commits del archivo',
    commitsDe: (nombre: string) => `Commits de ${nombre}`,
    cargandoHistorialArchivo: 'Cargando el historial…',
    errorDiff: 'No se pudo preparar el diff',
    noTocaArchivoTitulo: 'Este commit no toca el archivo con este nombre',
    noTocaArchivoDetalle: (nombre: string) =>
      `En "${nombre}" el historial cruza renames, así que la lista incluye commits en los que el archivo se llamaba de otra forma. En ese punto no hay un cambio que comparar bajo el nombre actual.`,
    elegirCommit: 'Elige un commit para ver qué cambió.',
    preparandoDiff: 'Preparando el diff…',

    // Avisos de las acciones
    fallosLote: (titulo: string, n: number, total: number) => `${titulo} (${n} de ${total})`,
    masFallos: (n: number) => `…y ${n} más`,
    noSePudieronDescartar: 'No se pudieron descartar los cambios',
    noSePudoPreparar: 'No se pudo preparar el archivo (git add)',
    noSePudoQuitar: 'No se pudo quitar del área de preparación (git reset)',
    algunosNoPreparados: 'No se pudieron preparar algunos archivos',
    algunosNoQuitados: 'No se pudieron quitar de preparados algunos archivos',
    noSePudieronPreparar: 'No se pudieron preparar los archivos (git add)',
    noSePudieronQuitar: 'No se pudieron quitar del área de preparación',
    noSePudoEscribirExclusiones: 'No se pudo escribir el archivo de exclusiones',
    algunosNoIgnorados: 'Algunos archivos no se pudieron ignorar',
    resumenIgnorados: (ignorados: number, omitidos: number) =>
      `${ignorados} ignorados · ${omitidos} omitidos, git ya los rastrea.\n` +
      'Para dejar de seguirlos habría que sacarlos del repositorio, y eso el resto del equipo lo vería como un borrado.',
    algunosNoDescartados: 'No se pudieron descartar algunos archivos',

    // Fechas relativas
    justoAhora: 'justo ahora',
    haceMin: (n: number) => `hace ${n} min`,
    haceHoras: (n: number) => `hace ${n} h`,
    haceDias: (n: number) => `hace ${n} día${n === 1 ? '' : 's'}`
  },
  {
    sinProyectoTitulo: 'No project open',
    sinProyectoCambios: 'Open a project to see its git changes.',
    sinProyectoHistorial: 'Open a project to see its git history.',
    noEsRepoTitulo: 'This is not a git repository',
    noEsRepoCambios: 'The open folder is not under version control, so there are no changes to track.',
    noEsRepoHistorial:
      'The open folder is not under version control, so there is no history to show. Open a project with git to see its commits and branches.',
    cargandoCambios: 'Loading changes…',
    motivoReposLeidos: (leidos: number, total: number) => `${leidos} of ${total} repositories read`,
    sinCambiosTitulo: 'No changes',
    sinCambiosPista: 'The working tree is clean: nothing is modified or untracked.',
    sinCambiosLinea: 'No changes in the working tree.',
    ningunRepoConCambios: (total: number) =>
      `None of the ${total} repositories has uncommitted changes.`,
    errorCambios: (error: string) => `Could not read the changes: ${error}`,
    cambiosWorkingTree: 'Working tree changes',
    repositoriosConCambios: 'Repositories with changes',

    panelCambios: 'Git changes',
    cambios: 'Changes',
    plegarRepos: 'Collapse all repositories',
    desplegarRepos: 'Expand the repositories with changes',
    recargarCambios: 'Reload changes',
    repoActivo: 'Active repository (the one shown in the history below)',
    repoAbrir: 'Open this repository and graph its history',
    ramaActual: (rama: string) => `Current branch: ${rama}`,
    marcarTodo: (etiqueta: string) => `Select all in ${etiqueta}`,
    marcar: (nombre: string) => `Select ${nombre}`,

    secciones: {
      conflict: 'Conflicts',
      staged: 'Staged',
      unstaged: 'Changes',
      untracked: 'Untracked'
    },

    quitarN: (n: number) => `Unstage ${n}`,
    quitarNTitulo: (n: number) => `Unstage ${n} files`,
    marcarResueltosN: (n: number) => `Mark ${n} as resolved`,
    marcarResueltosNTitulo: (n: number) => `Mark ${n} files as resolved`,
    prepararN: (n: number) => `Stage ${n}`,
    prepararNTitulo: (n: number) => `Stage ${n} files`,
    descartarN: (n: number) => `Discard ${n}`,
    descartarNTitulo: (n: number) => `Discard the changes in ${n} files`,

    abrirArchivo: 'Open file',
    abrirEnExplorador: 'Open in file manager',
    quitarDePreparados: 'Unstage',
    marcarResuelto: 'Mark as resolved',
    preparar: 'Stage',
    agregarGitignore: 'Add to .gitignore',
    agregarGitignoreN: (n: number) => `Add ${n} to .gitignore`,
    agregarExclusionLocal: 'Add to local exclude',
    agregarExclusionLocalN: (n: number) => `Add ${n} to local exclude`,
    descartarCambios: 'Discard changes…',
    descartarArchivosN: (n: number) => `Discard ${n} files…`,

    archivosDeCarpeta: (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`,
    dobleClicDiferencias: 'Double-click to see the differences',
    letras: {
      A: 'Added',
      M: 'Modified',
      D: 'Deleted',
      R: 'Renamed',
      C: 'Copied',
      U: 'Conflicted',
      T: 'Type changed'
    },
    indiceDisco: 'Index ↔ Disk',
    headIndice: 'HEAD ↔ Index',

    panelHistorial: 'Git history',
    recargarHistorial: 'Reload history and branches',
    restaurarPanel: 'Restore the git panel',
    maximizarPanel: 'Maximize the git panel',
    restaurarTitulo: 'Restore: git goes back to the bottom panel',
    maximizarTitulo: 'Maximize: git takes the whole work area (nothing is closed)',
    cerrarPanel: 'Close the git panel',
    vistasGit: 'Git views',
    historialDe: (nombre: string) => `History: ${nombre}`,
    cerrarHistorial: 'Close the history',
    anchoRamas: 'Branches column width',
    anchoDetalle: 'Details column width',

    repoDelHistorial: 'History repository (click to change)',
    ramas: 'Branches',
    repositorio: 'Repository',
    cargandoRamas: 'Loading branches…',
    sinRamas: 'This repository has no branches.',
    verTodasRamasTitulo: 'See the history of all branches',
    todasLasRamas: 'All branches',
    ramaActualHead: (rama: string) => `${rama} — current branch (HEAD)`,
    ramaQuitarFiltro: (rama: string) => `${rama} — click to clear the filter`,
    ramaFiltrar: (rama: string) => `Filter the history by ${rama}`,
    carpetaRamas: (ruta: string, n: number) => `${ruta} (${n} branch${n === 1 ? '' : 'es'})`,
    local: 'Local',
    remoto: 'Remote',

    sinResultados: 'no results',
    coincidenciaAnteriorTitulo: 'Previous match (Shift+Enter)',
    coincidenciaAnterior: 'Previous match',
    coincidenciaSiguienteTitulo: 'Next match (Enter)',
    coincidenciaSiguiente: 'Next match',
    textoOHash: 'Text or hash',
    buscarEnHistorial: 'Search the commit history',
    limpiarBusqueda: 'Clear the search',
    cualquierUsuario: 'Any user',
    actual: 'current',
    filtrarRama: 'Filter by branch',
    filtrarUsuario: 'Filter by user',
    filtrarFecha: 'Filter by date',
    rama: 'Branch',
    usuario: 'User',
    fecha: 'Date',
    fechas: {
      cualquiera: 'Any date',
      hoy: 'Today',
      semana: 'Last week',
      mes: 'Last month',
      anio: 'Last year'
    },

    historialDeCommits: 'Commit history',
    errorHistoria: 'Could not read the git history:',
    cargandoHistorial: 'Loading history…',
    ningunCommitCoincide: 'No commit matches the filters.',
    avisoOculto: (lista: number, total: number, hayMas: boolean) =>
      `${lista} of ${total} commits${hayMas ? ' loaded (the filter only looks within these)' : ''}`,
    cargarCompletoTitulo: (n: number) =>
      `Showing the latest ${n} commits; load the full history of the repository`,
    cargando: 'Loading…',
    cargarCompleto: (n: number) => `Load the full history (more than ${n})`,
    sinCommitsTitulo: 'No commits yet',
    sinCommitsPista:
      'This repository was just created. Once you make the first commit, its history will show up here.',
    copiado: 'Copied',
    copiarHashFila: (hash: string) => `Copy the full hash (${hash})`,
    copiarHashLista: (mod: string) => `Copy the full hash · ${mod}+C in the list`,
    noSePudoCopiarHash: 'Could not copy the hash',

    detalle: 'Details',
    ningunCommitTitulo: 'No commit selected',
    ningunCommitPista: 'Pick one from the history to see its message, its author and the files it touched.',
    repartoArchivosMensaje: 'Split between the files and the commit message',
    errorRamas: 'Could not read the branches.',
    buscandoRamas: 'Finding which branches contain it…',
    enNingunaRama: 'In no branch.',
    enNRamas: (n: number) => `In ${n} branch${n === 1 ? '' : 'es'}:`,
    mostrarNMas: (n: number) => `Show ${n} more`,
    mostrarMenos: 'Show less',
    aplicadoPor: (nombre: string) => `Applied by ${nombre}`,
    archivosDelCommit: 'Commit files',
    errorArchivos: (error: string) => `Could not read the files: ${error}`,
    cargandoArchivos: 'Loading files…',
    commitSinArchivos: 'This commit changed no files.',

    chipEtiqueta: (nombre: string) => `Tag ${nombre}`,
    chipRamaActual: (nombre: string) => `${nombre} (current branch)`,
    chipHeadSinRama: 'HEAD (no branch, detached)',
    chipRamaRemota: (nombre: string) => `Remote branch ${nombre}`,
    chipRama: (nombre: string) => `Branch ${nombre}`,

    errorHistorial: 'Could not read the history',
    sinHistorialTitulo: 'No history',
    sinHistorialPista: (nombre: string) =>
      `git does not know of any commit that touched “${nombre}”. It may be a new file that has not been committed yet.`,
    anchoListaArchivo: 'File commit list width',
    commitsDe: (nombre: string) => `Commits of ${nombre}`,
    cargandoHistorialArchivo: 'Loading the history…',
    errorDiff: 'Could not prepare the diff',
    noTocaArchivoTitulo: 'This commit does not touch the file under this name',
    noTocaArchivoDetalle: (nombre: string) =>
      `In “${nombre}” the history crosses renames, so the list includes commits in which the file had a different name. At that point there is no change to compare under the current name.`,
    elegirCommit: 'Pick a commit to see what changed.',
    preparandoDiff: 'Preparing the diff…',

    fallosLote: (titulo: string, n: number, total: number) => `${titulo} (${n} of ${total})`,
    masFallos: (n: number) => `…and ${n} more`,
    noSePudieronDescartar: 'Could not discard the changes',
    noSePudoPreparar: 'Could not stage the file (git add)',
    noSePudoQuitar: 'Could not unstage the file (git reset)',
    algunosNoPreparados: 'Some files could not be staged',
    algunosNoQuitados: 'Some files could not be unstaged',
    noSePudieronPreparar: 'Could not stage the files (git add)',
    noSePudieronQuitar: 'Could not unstage the files',
    noSePudoEscribirExclusiones: 'Could not write the exclude file',
    algunosNoIgnorados: 'Some files could not be ignored',
    resumenIgnorados: (ignorados: number, omitidos: number) =>
      `${ignorados} ignored · ${omitidos} skipped, git already tracks them.\n` +
      'To stop tracking them they would have to be removed from the repository, and the rest of the team would see that as a deletion.',
    algunosNoDescartados: 'Some files could not be discarded',

    justoAhora: 'just now',
    haceMin: (n: number) => `${n} min ago`,
    haceHoras: (n: number) => `${n} h ago`,
    haceDias: (n: number) => `${n} day${n === 1 ? '' : 's'} ago`
  }
)
