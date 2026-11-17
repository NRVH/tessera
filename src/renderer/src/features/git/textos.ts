// =============================================================================
// Textos de la interfaz de git (panel de Cambios, panel de Log, historial de un archivo, menú de
// una fila, fechas relativas y avisos de las acciones) en español e inglés.
// Sin JSX ni DOM: lo importan también los módulos puros de `modelo/` y sus pruebas.
// Depende solo de `shared/i18n.ts`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txGit = crearTextos(
  {
    hooksTitulo: (repo: string) => `¿Permitir que «${repo}» ejecute sus hooks?`,
    hooksTituloIncompleta: (repo: string) => `Los hooks de «${repo}» no se pueden aceptar`,
    hooksGrupo: 'Hooks por aceptar',
    hooksAceptar: 'Ejecutar y recordar',
    hooksContinuar: 'Continuar sin ejecutarlos',
    hooksDetalleGeneral: 'Este repositorio puede ejecutar estos programas en su equipo al continuar. No los ha aceptado antes o cambiaron desde entonces.',
    hooksCancelar: 'Cancelar',
    hooksVer: 'Ver',
    hooksNuevo: 'nuevo',
    hooksCambiado: 'cambiado',
    hooksTruncado: 'Se muestran los primeros 32 KiB.',
    // Cabeceras, estados vacíos y de carga
    sinProyectoTitulo: 'Sin proyecto abierto',
    sinProyectoCambios: 'Abra un proyecto para ver sus cambios de Git.',
    sinProyectoHistorial: 'Abra un proyecto para ver su historial de Git.',
    noEsRepoTitulo: 'La carpeta abierta no es un repositorio de Git',
    noEsRepoCambios: 'La carpeta abierta no está versionada, por lo que no hay cambios que seguir.',
    noEsRepoHistorial:
      'La carpeta abierta no está versionada, por lo que no hay historial que mostrar. Abra un proyecto con Git para ver sus commits y sus ramas.',
    cargandoCambios: 'Cargando cambios…',
    motivoReposLeidos: (leidos: number, total: number) => `${leidos} de ${total} repositorios leídos`,
    sinCambiosTitulo: 'Sin cambios',
    sinCambiosPista: 'El directorio de trabajo está limpio: no hay archivos modificados ni sin versionar.',
    sinCambiosLinea: 'Sin cambios en el directorio de trabajo.',
    ningunRepoConCambios: (total: number) => `Ninguno de los ${total} repositorios tiene cambios sin confirmar.`,
    errorCambios: (error: string) => `No se pudieron leer los cambios: ${error}`,
    cambiosWorktree: 'Cambios del directorio de trabajo',
    repositoriosConCambios: 'Repositorios con cambios',

    // Panel lateral de Cambios
    panelCambios: 'Cambios de Git',
    cambios: 'Cambios',
    plegarRepos: 'Contraer todos los repositorios',
    desplegarRepos: 'Expandir los repositorios con cambios',
    recargarCambios: 'Refrescar los cambios',
    repoActivo: 'Repositorio activo (el del historial de abajo)',
    repoAbrir: 'Ver el historial de este repositorio en el panel de abajo',
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
    quitarN: (n: number) => `Quitar ${n} de preparados`,
    quitarNTitulo: (n: number) => `Quitar ${n} ${n === 1 ? 'archivo' : 'archivos'} de preparados; sus cambios se conservan`,
    marcarResueltosN: (n: number) => `Marcar ${n} como ${n === 1 ? 'resuelto' : 'resueltos'}`,
    marcarResueltosNTitulo: (n: number) => `Marcar ${n} ${n === 1 ? 'archivo' : 'archivos'} como ${n === 1 ? 'resuelto' : 'resueltos'}`,
    prepararN: (n: number) => `Preparar ${n}`,
    prepararNTitulo: (n: number) => `Preparar ${n} ${n === 1 ? 'archivo' : 'archivos'}`,
    descartarN: (n: number) => `Descartar ${n}`,
    descartarNTitulo: (n: number) =>
      `Restaura ${n} ${n === 1 ? 'archivo' : 'archivos'} a su versión de Git: sus cambios se pierden y los archivos nuevos se eliminan del disco`,

    // Menú contextual de una fila de Cambios
    abrirArchivo: 'Abrir archivo',
    mostrarEn: (gestor: string) => `Mostrar en ${gestor}`,
    quitarDePreparados: 'Quitar de preparados',
    marcarResuelto: 'Marcar como resuelto',
    preparar: 'Preparar',
    agregarGitignore: 'Añadir a .gitignore',
    agregarGitignoreN: (n: number) => `Añadir ${n} a .gitignore`,
    agregarExclusionLocal: 'Ignorar solo en este equipo (.git/info/exclude)',
    agregarExclusionLocalN: (n: number) => `Ignorar ${n} solo en este equipo (.git/info/exclude)`,
    descartarCambios: 'Descartar cambios (restaura la versión de Git)',
    descartarArchivosN: (n: number) => `Descartar ${n} ${n === 1 ? 'archivo' : 'archivos'}…`,

    // Fila de archivo
    archivosDeCarpeta: (n: number) => `${n} ${n === 1 ? 'archivo' : 'archivos'}`,
    dobleClicDiferencias: 'Haga doble clic para ver las diferencias',
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
    panelHistorial: 'Historial de Git',
    recargarHistorial: 'Refrescar el historial y las ramas',
    maximizarPanel: 'Maximizar el panel de Git',
    maximizarTitulo: 'Maximizar: el panel de Git ocupa toda el área de trabajo (sin cerrar nada)',
    ocultarPanel: 'Ocultar el panel de Git',
    vistasGit: 'Vistas de Git',
    historialDe: (nombre: string) => `Historial: ${nombre}`,
    cerrarHistorial: 'Cerrar el historial',
    anchoRamas: 'Ancho de la columna de ramas',
    anchoDetalle: 'Ancho de la columna de detalle',

    // Árbol de ramas
    repoDelHistorial: 'Repositorio del historial. Haga clic para cambiar',
    ramas: 'Ramas',
    repositorio: 'Repositorio',
    cargandoRamas: 'Cargando ramas…',
    sinRamas: 'Este repositorio no tiene ramas.',
    todasLasRamas: 'Todas las ramas',
    ramaActualHead: (rama: string) => `${rama} — rama actual (HEAD)`,
    ramaQuitarFiltro: (rama: string) => `${rama} — haga clic para quitar el filtro`,
    ramaFiltrar: (rama: string) => `Filtrar el historial por ${rama}`,
    carpetaRamas: (ruta: string, n: number) => `${ruta} (${n} rama${n === 1 ? '' : 's'})`,
    local: 'Local',
    remoto: 'Remoto',

    // Barra de filtros
    sinResultados: 'Sin resultados',
    coincidenciaAnteriorTitulo: 'Coincidencia anterior (Mayús+Intro)',
    coincidenciaAnterior: 'Coincidencia anterior',
    coincidenciaSiguienteTitulo: 'Coincidencia siguiente (Intro)',
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
    errorHistoria: 'No se pudo leer el historial de Git:',
    cargandoHistorial: 'Cargando historial…',
    ningunCommitCoincide: 'Ningún commit coincide con los filtros.',
    avisoOculto: (lista: number, total: number, hayMas: boolean) =>
      `${lista} de ${total} commits${hayMas ? ' cargados (el filtro solo se aplica a estos)' : ''}`,
    cargarCompletoTitulo: (n: number) =>
      `Se muestran los últimos ${n} commits. Cargar el historial completo del repositorio`,
    cargando: 'Cargando…',
    cargarCompleto: (n: number) => `Cargar el historial completo (más de ${n})`,
    sinCommitsTitulo: 'Aún no hay commits',
    sinCommitsPista:
      'Este repositorio se acaba de crear. Cuando se confirme el primer commit, su historial aparecerá aquí.',
    copiado: 'Copiado',
    copiarHashFila: (hash: string) => `Copiar el hash completo (${hash})`,
    copiarHashLista: (mod: string) => `Copiar el hash completo · ${mod}+C en la lista`,
    noSePudoCopiarHash: 'No se pudo copiar el hash',

    // Detalle del commit
    detalle: 'Detalle',
    ningunCommitTitulo: 'Ningún commit seleccionado',
    ningunCommitPista: 'Seleccione uno del historial para ver su mensaje, su autor y los archivos que modificó.',
    repartoArchivosMensaje: 'Reparto entre los archivos y el mensaje del commit',
    errorRamas: 'No se pudieron leer las ramas.',
    buscandoRamas: 'Buscando las ramas que contienen este commit…',
    enNingunaRama: 'No está en ninguna rama.',
    enNRamas: (n: number) => `En ${n} rama${n === 1 ? '' : 's'}:`,
    mostrarNMas: (n: number) => `Mostrar ${n} más`,
    mostrarMenos: 'Mostrar menos',
    aplicadoPor: (nombre: string) => `Aplicado por ${nombre}`,
    archivosDelCommit: 'Archivos del commit',
    errorArchivos: (error: string) => `No se pudieron leer los archivos: ${error}`,
    cargandoArchivos: 'Cargando archivos…',
    commitSinArchivos: 'Este commit no modificó ningún archivo.',

    // Chips de referencias
    chipEtiqueta: (nombre: string) => `Etiqueta ${nombre}`,
    chipRamaActual: (nombre: string) => `${nombre} (rama actual)`,
    chipHeadSinRama: 'HEAD (sin rama, detached HEAD)',
    chipRamaRemota: (nombre: string) => `Rama remota ${nombre}`,
    chipRama: (nombre: string) => `Rama ${nombre}`,

    // Historial de un archivo
    errorHistorial: 'No se pudo leer el historial',
    sinHistorialTitulo: 'Sin historial',
    sinHistorialPista: (nombre: string) =>
      `Git no registra ningún commit que haya modificado «${nombre}». Es posible que sea un archivo nuevo que todavía no se ha confirmado.`,
    anchoListaArchivo: 'Ancho de la lista de commits del archivo',
    commitsDe: (nombre: string) => `Commits de ${nombre}`,
    cargandoHistorialArchivo: 'Cargando el historial…',
    errorDiff: 'No se pudo preparar el diff',
    noTocaArchivoTitulo: 'Este commit no modifica el archivo con este nombre',
    noTocaArchivoDetalle: (nombre: string) =>
      `El historial de «${nombre}» incluye cambios de nombre, por lo que la lista contiene commits en los que el archivo se llamaba de otra forma. En esos commits no hay un cambio que comparar con el nombre actual.`,
    elegirCommit: 'Seleccione un commit para ver qué cambió.',
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
      `${ignorados} ignorados · ${omitidos} omitidos porque Git ya los rastrea.\n` +
      'Para dejar de rastrearlos habría que quitarlos del repositorio, y el resto del equipo lo vería como un borrado.',
    algunosNoDescartados: 'No se pudieron descartar algunos archivos',

    // Fechas relativas
    justoAhora: 'justo ahora',
    haceMin: (n: number) => `hace ${n} min`,
    haceHoras: (n: number) => `hace ${n} h`,
    haceDias: (n: number) => `hace ${n} día${n === 1 ? '' : 's'}`
  },
  {
    hooksTitulo: (repo: string) => `Allow “${repo}” to run its hooks?`,
    hooksTituloIncompleta: (repo: string) => `The hooks in “${repo}” cannot be accepted`,
    hooksGrupo: 'Hooks to accept',
    hooksAceptar: 'Run and remember',
    hooksContinuar: 'Continue without running them',
    hooksDetalleGeneral: 'This repository may run these programs on your computer when continuing. You have not accepted them before, or they have changed.',
    hooksCancelar: 'Cancel',
    hooksVer: 'View',
    hooksNuevo: 'new',
    hooksCambiado: 'changed',
    hooksTruncado: 'Showing the first 32 KiB.',
    sinProyectoTitulo: 'No project open',
    sinProyectoCambios: 'Open a project to see its Git changes.',
    sinProyectoHistorial: 'Open a project to see its Git history.',
    noEsRepoTitulo: 'This is not a Git repository',
    noEsRepoCambios: 'The open folder is not under version control, so there are no changes to track.',
    noEsRepoHistorial:
      'The open folder is not under version control, so there is no history to show. Open a Git project to see its commits and branches.',
    cargandoCambios: 'Loading changes…',
    motivoReposLeidos: (leidos: number, total: number) => `${leidos} of ${total} repositories read`,
    sinCambiosTitulo: 'No changes',
    sinCambiosPista: 'The working tree is clean: nothing is modified or untracked.',
    sinCambiosLinea: 'No changes in the working tree.',
    ningunRepoConCambios: (total: number) =>
      `None of the ${total} repositories has uncommitted changes.`,
    errorCambios: (error: string) => `Could not read the changes: ${error}`,
    cambiosWorktree: 'Working tree changes',
    repositoriosConCambios: 'Repositories with changes',

    panelCambios: 'Git changes',
    cambios: 'Changes',
    plegarRepos: 'Collapse all repositories',
    desplegarRepos: 'Expand repositories with changes',
    recargarCambios: 'Refresh changes',
    repoActivo: 'Active repository (the one shown in the history below)',
    repoAbrir: 'Show this repository’s history in the panel below',
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
    quitarNTitulo: (n: number) => `Unstage ${n} ${n === 1 ? 'file' : 'files'}; their changes are kept`,
    marcarResueltosN: (n: number) => `Mark ${n} as resolved`,
    marcarResueltosNTitulo: (n: number) => `Mark ${n} ${n === 1 ? 'file' : 'files'} as resolved`,
    prepararN: (n: number) => `Stage ${n}`,
    prepararNTitulo: (n: number) => `Stage ${n} ${n === 1 ? 'file' : 'files'}`,
    descartarN: (n: number) => `Discard ${n}`,
    descartarNTitulo: (n: number) =>
      `Restores ${n} ${n === 1 ? 'file' : 'files'} to their Git version: their changes are lost and new files are deleted from disk`,

    abrirArchivo: 'Open file',
    mostrarEn: (gestor: string) => `Show in ${gestor}`,
    quitarDePreparados: 'Unstage',
    marcarResuelto: 'Mark as resolved',
    preparar: 'Stage',
    agregarGitignore: 'Add to .gitignore',
    agregarGitignoreN: (n: number) => `Add ${n} to .gitignore`,
    agregarExclusionLocal: 'Ignore on this computer only (.git/info/exclude)',
    agregarExclusionLocalN: (n: number) => `Ignore ${n} on this computer only (.git/info/exclude)`,
    descartarCambios: 'Discard changes (restore the Git version)',
    descartarArchivosN: (n: number) => `Discard ${n} ${n === 1 ? 'file' : 'files'}…`,

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
    recargarHistorial: 'Refresh history and branches',
    maximizarPanel: 'Maximize Git panel',
    maximizarTitulo: 'Maximize: Git fills the whole work area (nothing is closed)',
    ocultarPanel: 'Hide Git panel',
    vistasGit: 'Git views',
    historialDe: (nombre: string) => `History: ${nombre}`,
    cerrarHistorial: 'Close history',
    anchoRamas: 'Branches column width',
    anchoDetalle: 'Details column width',

    repoDelHistorial: 'History repository. Click to change',
    ramas: 'Branches',
    repositorio: 'Repository',
    cargandoRamas: 'Loading branches…',
    sinRamas: 'This repository has no branches.',
    todasLasRamas: 'All branches',
    ramaActualHead: (rama: string) => `${rama} — current branch (HEAD)`,
    ramaQuitarFiltro: (rama: string) => `${rama} — click to clear the filter`,
    ramaFiltrar: (rama: string) => `Filter history by ${rama}`,
    carpetaRamas: (ruta: string, n: number) => `${ruta} (${n} branch${n === 1 ? '' : 'es'})`,
    local: 'Local',
    remoto: 'Remote',

    sinResultados: 'No results',
    coincidenciaAnteriorTitulo: 'Previous match (Shift+Enter)',
    coincidenciaAnterior: 'Previous match',
    coincidenciaSiguienteTitulo: 'Next match (Enter)',
    coincidenciaSiguiente: 'Next match',
    textoOHash: 'Text or hash',
    buscarEnHistorial: 'Search the commit history',
    limpiarBusqueda: 'Clear search',
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
    errorHistoria: 'Could not read the Git history:',
    cargandoHistorial: 'Loading history…',
    ningunCommitCoincide: 'No commits match the filters.',
    avisoOculto: (lista: number, total: number, hayMas: boolean) =>
      `${lista} of ${total} commits${hayMas ? ' loaded (the filter searches only these)' : ''}`,
    cargarCompletoTitulo: (n: number) =>
      `Showing the latest ${n} commits; load the full repository history`,
    cargando: 'Loading…',
    cargarCompleto: (n: number) => `Load full history (more than ${n})`,
    sinCommitsTitulo: 'No commits yet',
    sinCommitsPista:
      'This repository is new. After your first commit, its history appears here.',
    copiado: 'Copied',
    copiarHashFila: (hash: string) => `Copy full hash (${hash})`,
    copiarHashLista: (mod: string) => `Copy full hash · ${mod}+C in the list`,
    noSePudoCopiarHash: 'Could not copy the hash',

    detalle: 'Details',
    ningunCommitTitulo: 'No commit selected',
    ningunCommitPista: 'Select a commit in the history to see its message, author, and changed files.',
    repartoArchivosMensaje: 'Resize files and commit message',
    errorRamas: 'Could not read the branches.',
    buscandoRamas: 'Finding which branches contain it…',
    enNingunaRama: 'Not in any branch.',
    enNRamas: (n: number) => `In ${n} branch${n === 1 ? '' : 'es'}:`,
    mostrarNMas: (n: number) => `Show ${n} more`,
    mostrarMenos: 'Show less',
    aplicadoPor: (nombre: string) => `Applied by ${nombre}`,
    archivosDelCommit: 'Files in this commit',
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
      `Git has no commits that changed “${nombre}”. It may be a new file that has not been committed yet.`,
    anchoListaArchivo: 'File commit list width',
    commitsDe: (nombre: string) => `Commits for ${nombre}`,
    cargandoHistorialArchivo: 'Loading history…',
    errorDiff: 'Could not prepare the diff',
    noTocaArchivoTitulo: 'This commit does not change the file under its current name',
    noTocaArchivoDetalle: (nombre: string) =>
      `The history of “${nombre}” follows renames, so the list includes commits where the file had a different name. This commit has no change to compare under the current name.`,
    elegirCommit: 'Select a commit to see what changed.',
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
      `${ignorados} ignored · ${omitidos} skipped because Git already tracks them.\n` +
      'To stop tracking them, you would have to remove them from the repository, and the rest of the team would see that as a deletion.',
    algunosNoDescartados: 'Some files could not be discarded',

    justoAhora: 'just now',
    haceMin: (n: number) => `${n} min ago`,
    haceHoras: (n: number) => `${n} h ago`,
    haceDias: (n: number) => `${n} day${n === 1 ? '' : 's'} ago`
  }
)
