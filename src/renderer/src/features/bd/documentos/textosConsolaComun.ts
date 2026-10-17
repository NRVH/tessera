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
    roAgentes: 'RO agentes',
    baseDeLaConsola: 'Base de la consola',
    baseDeLaConsolaEn: 'Base de la consola en ',
    filtrarBases: 'Filtrar bases',
    cargandoBases: 'Cargando bases…',
    reintentar: 'Reintentar',
    ningunaBase: 'Ninguna base coincide.',
    // --- carcasa ---
    consolaAria: (nombre: string) => `Consola ${nombre}`,
    archivoCambio: 'El archivo cambió fuera de Tessera',
    cargarDelDisco: 'Cargar la del disco',
    conservarLaMia: 'Conservar la mía',
    // --- cierre ---
    detenerYCerrarTitulo: '¿Detener y cerrar?',
    detenerYCerrarMensaje: (nombre: string) => `${nombre} está ejecutando. Se detendrá lo que corre y se cerrará la pestaña.`,
    detenerYCerrar: 'Detener y cerrar',
    conflictoMensaje: (nombre: string) =>
      `${nombre} tiene cambios sin guardar y el archivo cambió fuera de Tessera. Si la cierras, se queda la versión del disco y se pierden tus cambios.`,
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
    cargarDelDisco: 'Load the one on disk',
    conservarLaMia: 'Keep mine',
    detenerYCerrarTitulo: 'Stop and close?',
    detenerYCerrarMensaje: (nombre: string) => `${nombre} is running. What is running will be stopped and the tab will be closed.`,
    detenerYCerrar: 'Stop and close',
    conflictoMensaje: (nombre: string) =>
      `${nombre} has unsaved changes and the file changed outside Tessera. If you close it, the version on disk stays and your changes are lost.`,
    cerrarSinGuardar: 'Close without saving',
    errorDesconocido: 'Unknown error',
    ejecutando: 'Running',
    ejecutandoN: (i: number, total: number) => `Running ${i} of ${total}`,
    consolaCargando: 'The console is still loading',
    yaEjecutando: 'An execution is already in progress'
  }
)
