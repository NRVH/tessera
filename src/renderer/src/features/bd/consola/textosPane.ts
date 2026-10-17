// =============================================================================
// Textos del pane de la consola SQL que no son de la barra ni de la Salida: los diálogos de
// cierre y de «Forzar», los avisos de los hooks, las acciones del menú del editor, el
// historial y la ayuda de los parámetros. Sin JSX; los leen los `use*Consola`, `monacoConsola.ts`,
// `historialConsola.ts`, `parametrosConsola.ts` y `EstadoCargaPopover.tsx`.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txPane = crearTextos(
  {
    cargando: 'Cargando…',
    noSePudoLeer: (motivo: string) => `No se pudo leer la consola: ${motivo}`,
    noSePudoGuardar: (motivo: string) => `No se pudo guardar la consola: ${motivo}`,
    contextoCierre: 'Para cerrar la consola hay que confirmarla o revertirla antes.',
    contextoAuto: 'Para pasar a Tx Auto hay que confirmarla o revertirla antes.',
    detenerTitulo: '¿Detener y cerrar?',
    detenerMensaje: (nombre: string) => `${nombre} está ejecutando. Se detendrá lo que corre y se cerrará la pestaña.`,
    detenerConfirmar: 'Detener y cerrar',
    conflictoTitulo: 'El archivo cambió fuera de Tessera',
    conflictoMensaje: (nombre: string) =>
      `${nombre} tiene cambios sin guardar y el archivo cambió fuera de Tessera. Si la cierras, se queda la versión del disco y se pierden tus cambios.`,
    conflictoConfirmar: 'Cerrar sin guardar',
    noSePudoCerrar: (motivo: string) => `No se pudo cerrar la sesión: ${motivo}`,
    forzarSesion: 'Forzar el cierre de la sesión',
    forzarConexion: 'Forzar el cierre de la conexión',
    forzarConfirmar: 'Forzar el cierre',
    noSePudoForzar: (motivo: string) => `No se pudo forzar el cierre: ${motivo}`,
    noSePudoCambiarEsquema: (motivo: string) => `No se pudo cambiar el esquema: ${motivo}`,
    consolaSinSentencias: 'La consola no tiene ninguna sentencia',
    textoCambio: 'El texto cambió desde ese lote: vuelve a ejecutar',
    noSePudoFormatear: (motivo: string) => `No se pudo formatear: ${motivo}`,
    noSePudoBorrar: (motivo: string) => `No se pudo borrar: ${motivo}`,
    noSePudieronContar: (motivo: string) => `No se pudieron contar las filas: ${motivo}`,
    reintentar: 'Reintentar',
    enterElige: 'Enter elige · Esc cancela',
    marcadorLinea: (linea: number, columna: number) => `línea ${linea}, col. ${columna}`,
    // Acciones del menú del editor
    accionEjecutar: 'Ejecutar sentencia o selección',
    accionEjecutarTodo: 'Ejecutar todo',
    accionDetener: 'Detener',
    accionCommit: 'Confirmar (Commit)',
    accionRollback: 'Revertir (Rollback)',
    accionExplicar: 'Explicar plan',
    accionHistorial: 'Historial de consultas…',
    accionFormatear: 'Formatear SQL'
  },
  {
    cargando: 'Loading…',
    noSePudoLeer: (motivo: string) => `Could not read the console: ${motivo}`,
    noSePudoGuardar: (motivo: string) => `Could not save the console: ${motivo}`,
    contextoCierre: 'To close the console, commit or roll back first.',
    contextoAuto: 'To switch to Tx Auto, commit or roll back first.',
    detenerTitulo: 'Stop and close?',
    detenerMensaje: (nombre: string) => `${nombre} is running. What is running will be stopped and the tab will be closed.`,
    detenerConfirmar: 'Stop and close',
    conflictoTitulo: 'The file changed outside Tessera',
    conflictoMensaje: (nombre: string) =>
      `${nombre} has unsaved changes and the file changed outside Tessera. If you close it, the version on disk is kept and your changes are lost.`,
    conflictoConfirmar: 'Close without saving',
    noSePudoCerrar: (motivo: string) => `Could not close the session: ${motivo}`,
    forzarSesion: 'Force the session to close',
    forzarConexion: 'Force the connection to close',
    forzarConfirmar: 'Force close',
    noSePudoForzar: (motivo: string) => `Could not force the close: ${motivo}`,
    noSePudoCambiarEsquema: (motivo: string) => `Could not change the schema: ${motivo}`,
    consolaSinSentencias: 'The console has no statements',
    textoCambio: 'The text has changed since that batch: run it again',
    noSePudoFormatear: (motivo: string) => `Could not format: ${motivo}`,
    noSePudoBorrar: (motivo: string) => `Could not delete: ${motivo}`,
    noSePudieronContar: (motivo: string) => `Could not count the rows: ${motivo}`,
    reintentar: 'Retry',
    enterElige: 'Enter selects · Esc cancels',
    marcadorLinea: (linea: number, columna: number) => `line ${linea}, col. ${columna}`,
    accionEjecutar: 'Run statement or selection',
    accionEjecutarTodo: 'Run all',
    accionDetener: 'Stop',
    accionCommit: 'Commit',
    accionRollback: 'Roll back',
    accionExplicar: 'Explain plan',
    accionHistorial: 'Query history…',
    accionFormatear: 'Format SQL'
  }
)

export const txHistorialConsola = crearTextos(
  {
    conexionBorrada: '(conexión borrada)',
    correcta: 'Correcta',
    conError: 'Con error',
    cancelada: 'Cancelada',
    documento: 'documento',
    documentos: 'documentos',
    comandoUna: 'comando',
    comandoVarias: 'comandos',
    comandoFiltro: 'Filtrar por texto del comando',
    comandoNinguna: 'Ningún comando coincide.',
    comandoVacio: 'Todavía no hay comandos en el historial.',
    ordenUna: 'orden',
    ordenVarias: 'órdenes',
    ordenFiltro: 'Filtrar por texto de la orden',
    ordenNinguna: 'Ninguna orden coincide.',
    ordenVacio: 'Todavía no hay órdenes en el historial.',
    consultaUna: 'consulta',
    consultaVarias: 'consultas',
    consultaFiltro: 'Filtrar por texto del SQL',
    consultaNinguna: 'Ninguna consulta coincide.',
    consultaVacio: 'Todavía no hay consultas en el historial.',
    quePreguntaComandos: (motor: string) => `comandos de ${motor}`,
    quePreguntaOrdenes: (motor: string) => `órdenes de ${motor}`,
    quePreguntaSql: 'consultas SQL',
    borrarTodo: (que: string) =>
      `¿Borrar TODO el historial de ${que} de este perfil? Incluye el de todas sus conexiones y no se puede deshacer.`
  },
  {
    conexionBorrada: '(connection deleted)',
    correcta: 'Succeeded',
    conError: 'Failed',
    cancelada: 'Canceled',
    documento: 'document',
    documentos: 'documents',
    comandoUna: 'command',
    comandoVarias: 'commands',
    comandoFiltro: 'Filter by command text',
    comandoNinguna: 'No command matches.',
    comandoVacio: 'There are no commands in the history yet.',
    ordenUna: 'command',
    ordenVarias: 'commands',
    ordenFiltro: 'Filter by command text',
    ordenNinguna: 'No command matches.',
    ordenVacio: 'There are no commands in the history yet.',
    consultaUna: 'query',
    consultaVarias: 'queries',
    consultaFiltro: 'Filter by SQL text',
    consultaNinguna: 'No query matches.',
    consultaVacio: 'There are no queries in the history yet.',
    quePreguntaComandos: (motor: string) => `${motor} commands`,
    quePreguntaOrdenes: (motor: string) => `${motor} commands`,
    quePreguntaSql: 'SQL queries',
    borrarTodo: (que: string) =>
      `Delete ALL of the history of ${que} for this profile? It includes the history of all its connections and cannot be undone.`
  }
)

export const txParametros = crearTextos(
  {
    nPuntoOrden: (clave: string) => `? n.º ${clave}`,
    pieDolarNumero: 'Por número: $1, $2…',
    pieDosPuntos: 'Sin comillas, :id y :ID son el mismo',
    pieSqlite: 'Por nombre (:id, @id y $id son el mismo) o por número: ?, ?1',
    pieNinguno: 'Sin parámetros: @x es una variable del lote (DECLARE)',
    pieInterrogacion: 'Por orden: cada ? es un valor (@x es una variable de la sesión)',
    valoresExplicar: 'Valores para explicar el plan de la sentencia',
    valoresEjecutarUna: 'Valores para ejecutar la sentencia',
    valoresEjecutarN: (cant: string) => `Valores para ejecutar ${cant} del lote`,
    sentencia: 'sentencia',
    sentencias: 'sentencias',
    finDialogo: (que: string) => `${que}. Se envían como texto y el servidor los convierte al tipo de su sitio.`
  },
  {
    nPuntoOrden: (clave: string) => `? no. ${clave}`,
    pieDolarNumero: 'By number: $1, $2…',
    pieDosPuntos: 'Without quotes, :id and :ID are the same',
    pieSqlite: 'By name (:id, @id and $id are the same) or by number: ?, ?1',
    pieNinguno: 'No parameters: @x is a batch variable (DECLARE)',
    pieInterrogacion: 'By order: each ? is a value (@x is a session variable)',
    valoresExplicar: 'Values to explain the plan of the statement',
    valoresEjecutarUna: 'Values to run the statement',
    valoresEjecutarN: (cant: string) => `Values to run ${cant} in the batch`,
    sentencia: 'statement',
    sentencias: 'statements',
    finDialogo: (que: string) => `${que}. They are sent as text and the server converts them to the type of their position.`
  }
)
