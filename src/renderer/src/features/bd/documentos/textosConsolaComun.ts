// =============================================================================
// Textos que comparten las consolas de MongoDB y de Redis: las piezas de la barra (candado, selector de
// base, estado), el aviso de conflicto con el archivo, las preguntas de cierre y el estado de la barra.
// Sin JSX: los leen `piezasBarra.tsx`, `CarcasaConsola.tsx`, `cierreConsola.ts`, `consolaComun.ts` y
// `useBarraConsola.ts`. Depende de shared/i18n.ts.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txConsolaComun = crearTextos(
  {
    // --- piezas de la barra ---
    editarConexion: 'Editar conexión…',
    roAgentes: 'Solo lectura (agentes)',
    baseDeLaConsola: 'Base de la consola',
    baseDeLaConsolaEn: 'Base de la consola en ',
    filtrarBases: 'Filtrar bases',
    cargandoBases: 'Cargando bases…',
    reintentar: 'Reintentar',
    ningunaBase: 'Ninguna base coincide.',
    // --- carcasa ---
    consolaAria: (nombre: string) => `Consola ${nombre}`,
    archivoCambio: 'El archivo cambió fuera de Tessera',
    cargarDelDisco: 'Cargar la versión del disco',
    conservarLaMia: 'Conservar mi versión',
    // --- cierre ---
    detenerYCerrarTitulo: (nombre: string) => `¿Detener la ejecución y cerrar ${nombre}?`,
    detenerYCerrarMensaje: (nombre: string) => `Se detendrá la ejecución en curso y se cerrará la pestaña. ${nombre} está ejecutando una sentencia.`,
    detenerYCerrar: 'Detener y cerrar',
    conflictoCerrarTitulo: (nombre: string) => `¿Cerrar ${nombre} y perder sus cambios?`,
    conflictoMensaje: (nombre: string) =>
      `Si la cierra, se conservará la versión del disco y se perderán sus cambios. ${nombre} tiene cambios sin guardar y el archivo cambió fuera de Tessera.`,
    cerrarSinGuardar: 'Cerrar sin guardar',
    // --- errores y estado ---
    errorDesconocido: 'Error desconocido',
    ejecutando: 'Ejecutando',
    ejecutandoN: (i: number, total: number) => `Ejecutando ${i} de ${total}`,
    consolaCargando: 'La consola todavía se está cargando',
    yaEjecutando: 'Ya hay una ejecución en curso'
  },
  {
    editarConexion: 'Edit connection…',
    roAgentes: 'RO agents',
    baseDeLaConsola: 'Console database',
    baseDeLaConsolaEn: 'Console database on ',
    filtrarBases: 'Filter databases',
    cargandoBases: 'Loading databases…',
    reintentar: 'Retry',
    ningunaBase: 'No database matches.',
    consolaAria: (nombre: string) => `Console ${nombre}`,
    archivoCambio: 'The file changed outside Tessera',
    cargarDelDisco: 'Load from disk',
    conservarLaMia: 'Keep mine',
    detenerYCerrarTitulo: (nombre: string) => `Stop the execution and close ${nombre}?`,
    detenerYCerrarMensaje: (nombre: string) => `Closing the tab stops the current execution. ${nombre} is running.`,
    detenerYCerrar: 'Stop and close',
    conflictoCerrarTitulo: (nombre: string) => `Close ${nombre} and lose your changes?`,
    conflictoMensaje: (nombre: string) =>
      `If you close it, the version on disk is kept and your changes are lost. ${nombre} has unsaved changes and the file changed outside Tessera.`,
    cerrarSinGuardar: 'Close without saving',
    errorDesconocido: 'Unknown error',
    ejecutando: 'Running',
    ejecutandoN: (i: number, total: number) => `Running ${i} of ${total}`,
    consolaCargando: 'The console is still loading',
    yaEjecutando: 'An execution is already in progress'
  }
)
