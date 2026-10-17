// =============================================================================
// Textos del gestor de sesiones del explorador de bases de datos (errores y avisos que llegan a
// la interfaz) en español e inglés. Se leen al producirse el error, nunca al cargar el módulo.
// Depende solo de `shared/i18n.ts`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

const es = {
  pista: 'Pista: ',
  exportarNoReleible:
    'Solo se puede volver a ejecutar para exportar una consulta sin efectos (un SELECT sin nextval ni FOR UPDATE): exporta lo que ya está cargado.',
  filaDesaparecida: 'La fila ya no existe (se borró o cambió su clave): vuelve a ejecutar la consulta.',
  exportarPorPaginas:
    'Se exportó por páginas, volviendo a ejecutar la consulta: si alguien escribió en la base mientras tanto, puede faltar o repetirse alguna fila.',
  detenida:
    'Detenida: para pararla se cerró la sesión de la consola, que se vuelve a abrir sola en la siguiente operación.',
  sinLector: 'El resultado ya no está disponible: vuelve a ejecutar la consulta.',
  noReleible:
    'Para leer más filas habría que volver a ejecutar una sentencia que modifica datos: vuelve a ejecutarla tú si quieres verlas.',
  esquemaCambiado:
    'El esquema de la consola cambió desde que se ejecutó esta consulta: volver a ejecutarla ahora leería otras tablas. Vuelve a ejecutarla tú.',
  sinOrden:
    'Sin orden estable: la tabla no tiene clave primaria y no hay ORDER BY, así que las páginas pueden repetir o saltarse filas.',
  consolaAtada: 'La consola está atada a otra conexión.',
  exportacionEnCurso: 'Ya hay una exportación con ese identificador en curso.',
  envioEnCurso: 'Ya hay un envío con ese identificador en curso.',
  conexionNoExiste: 'La conexión ya no existe.',
  conexionConsolaNoExiste: 'La conexión de esta consola ya no existe.',
  consolaOtroPerfil: 'La consola no pertenece a este perfil.',
  secretoNoDescifrable: 'La contraseña guardada no se puede descifrar en este equipo. Edita la conexión y vuelve a escribirla.',
  sinSecreto: 'Esta conexión no tiene contraseña guardada. Edítala para añadirla.',
  sinArchivoBase: 'La conexión no tiene archivo de base guardado. Edítala y elige el archivo.',
  consolasOcupadas: (n: number) =>
    `Hay ${n} consolas con sesión abierta en esta conexión y todas están ocupadas o con transacciones pendientes.`,
  cerrando: 'Tessera se está cerrando.',
  sesionCerradaAbriendo: 'La sesión se cerró mientras se abría.',
  operacionCancelada: 'Operación cancelada.',
  errorInterno: 'Error interno del explorador de bases de datos.',
  servidorTimeout: 'El servidor no respondió a tiempo.',
  txPendientesDriver: (n: number) =>
    `Hay ${n === 1 ? 'una consola' : `${n} consolas`} con transacciones pendientes que usan este cliente: confírmalas o revierte antes de cambiarlo.`,
  resolucionDesconocida: 'Resolución de transacción desconocida.',
  sentenciaGrande: 'La sentencia es demasiado grande.',
  paginaFuera: (max: number) => `El tamaño de página tiene que estar entre 1 y ${max}.`,
  consolaOcupada: 'La consola ya está ejecutando otra operación.',
  sinSentenciaEjecutar: 'No hay ninguna sentencia que ejecutar.',
  variasSentencias: (n: number) => `El texto contiene ${n} sentencias y se ejecuta una por petición.`,
  comandoCliente: (verbo: string) => `«${verbo}» es un comando del cliente: no se envía al servidor.`,
  procesoNoResponde: (op: string, segundos: number) =>
    `El proceso de la conexión no respondió a «${op}» en ${segundos} s.`,
  sinCambiosEnviar: 'No hay cambios que enviar.',
  bloqueoArchivo: (nombre: string | null, alias: string, cambiosSinConfirmar: boolean) => {
    const quien = nombre ? `La consola «${nombre}» (${alias})` : `Una consola de «${alias}»`
    const que = cambiosSinConfirmar ? 'tiene cambios sin confirmar' : 'tiene una transacción abierta'
    return `${quien} ${que} en este mismo archivo, y mientras tanto el archivo entero queda bloqueado para escribir. Confírmala o revírtela en esa consola y vuelve a enviar.`
  },
  nadaAplicado: (base: string) => `${base}: no se aplicó nada.`,
  envioDetenidoNada: 'Envío detenido: no se aplicó nada.',
  envioDetenido: 'Envío detenido.',
  sinSentenciaExplicar: 'No hay ninguna sentencia que explicar.',
  unaSentenciaExplicar: 'Se explica una sola sentencia cada vez.',
  consolaOtraConexion: 'Esa consola no es de esta conexión.',
  consolaEjecutando: 'La consola está ejecutando.',
  valorSinFilas: 'La lectura del valor no devolvió filas.',
  consultaGrande: 'La consulta es demasiado grande.',
  exportacionCancelada: 'Exportación cancelada.',
  tablaSinFilas: 'La consulta de la tabla no devolvió filas.',
  exportarSinPaginar: 'Exportar una tabla necesita leerla sin paginar: la forma ROWNUM no lo permite.',
  sinUltimaClave: 'El trabajador no devolvió la clave de la última fila.',
  recuentoSinFilas: 'El recuento no devolvió filas.',
  recuentoSinNumero: 'El recuento no devolvió un número.',
  limiteProcesosConsola: (tope: number) =>
    `Hay ${tope} consolas con proceso propio abiertas a la vez y ninguna se puede cerrar sin perder trabajo. Cierra alguna para abrir otra.`,
  limiteProcesosConexion: (tope: number) =>
    `Hay ${tope} conexiones abiertas a la vez y ninguna se puede cerrar sin perder trabajo. Desconecta alguna para abrir otra.`,
  sinProceso: 'No se pudo lanzar el proceso de la conexión.',
  listaBlancaNoSql: 'La lista blanca de solo lectura no es de una sesión SQL.',
  revirtioServidor: (etiqueta: string, codigo?: string) =>
    `${etiqueta} revirtió la transacción${codigo ? ` (error ${codigo})` : ''}: los cambios sin confirmar se perdieron.`,
  creadoConErrores: (mensaje: string) => `Creado con errores de compilación: ${mensaje}`,
  tablaBloqueada: (mensaje: string) =>
    'La tabla está bloqueada por una transacción sin confirmar (quizá una consola tuya): Reintentar cuando termine, ' +
    `o «Leer sin esperar», que enseña también lo que aún no se ha confirmado. (${mensaje})`,
  accionTxDesconocida: 'Acción de transacción desconocida.',
  modoTxDesconocido: 'Modo de transacción desconocido.',
  txSigue: 'La transacción sigue pendiente.'
}

const en = {
  pista: 'Hint: ',
  exportarNoReleible:
    'A query can only be run again to export it if it has no side effects (a SELECT without nextval or FOR UPDATE): export what is already loaded.',
  filaDesaparecida: 'The row no longer exists (it was deleted or its key changed): run the query again.',
  exportarPorPaginas:
    'The export was done in pages by running the query again: if someone wrote to the database in the meantime, a row may be missing or repeated.',
  detenida:
    'Stopped: to stop it, the console session was closed; it reopens on its own on the next operation.',
  sinLector: 'The result is no longer available: run the query again.',
  noReleible:
    'Reading more rows would require running a statement that modifies data again: run it again yourself if you want to see them.',
  esquemaCambiado:
    'The console schema changed since this query ran: running it again now would read different tables. Run it again yourself.',
  sinOrden:
    'No stable order: the table has no primary key and there is no ORDER BY, so pages may repeat or skip rows.',
  consolaAtada: 'The console is bound to another connection.',
  exportacionEnCurso: 'An export with that identifier is already in progress.',
  envioEnCurso: 'A submission with that identifier is already in progress.',
  conexionNoExiste: 'The connection no longer exists.',
  conexionConsolaNoExiste: 'This console’s connection no longer exists.',
  consolaOtroPerfil: 'The console does not belong to this profile.',
  secretoNoDescifrable: 'The saved password cannot be decrypted on this computer. Edit the connection and enter it again.',
  sinSecreto: 'This connection has no saved password. Edit it to add one.',
  sinArchivoBase: 'The connection has no saved database file. Edit it and choose the file.',
  consolasOcupadas: (n: number) =>
    `There are ${n} consoles with an open session on this connection and all of them are busy or have pending transactions.`,
  cerrando: 'Tessera is closing.',
  sesionCerradaAbriendo: 'The session was closed while it was opening.',
  operacionCancelada: 'Operation canceled.',
  errorInterno: 'Internal error in the database explorer.',
  servidorTimeout: 'The server did not respond in time.',
  txPendientesDriver: (n: number) =>
    `${n === 1 ? 'One console has' : `${n} consoles have`} pending transactions that use this client: commit or roll them back before changing it.`,
  resolucionDesconocida: 'Unknown transaction resolution.',
  sentenciaGrande: 'The statement is too large.',
  paginaFuera: (max: number) => `The page size must be between 1 and ${max}.`,
  consolaOcupada: 'The console is already running another operation.',
  sinSentenciaEjecutar: 'There is no statement to run.',
  variasSentencias: (n: number) => `The text contains ${n} statements and they run one per request.`,
  comandoCliente: (verbo: string) => `“${verbo}” is a client command: it is not sent to the server.`,
  procesoNoResponde: (op: string, segundos: number) =>
    `The connection process did not respond to “${op}” within ${segundos} s.`,
  sinCambiosEnviar: 'There are no changes to submit.',
  bloqueoArchivo: (nombre: string | null, alias: string, cambiosSinConfirmar: boolean) => {
    const quien = nombre ? `The console “${nombre}” (${alias})` : `A console of “${alias}”`
    const que = cambiosSinConfirmar ? 'has uncommitted changes' : 'has an open transaction'
    return `${quien} ${que} on this same file, and meanwhile the whole file is locked for writing. Commit or roll it back in that console and submit again.`
  },
  nadaAplicado: (base: string) => `${base}: nothing was applied.`,
  envioDetenidoNada: 'Submission stopped: nothing was applied.',
  envioDetenido: 'Submission stopped.',
  sinSentenciaExplicar: 'There is no statement to explain.',
  unaSentenciaExplicar: 'Only one statement is explained at a time.',
  consolaOtraConexion: 'That console does not belong to this connection.',
  consolaEjecutando: 'The console is running.',
  valorSinFilas: 'Reading the value returned no rows.',
  consultaGrande: 'The query is too large.',
  exportacionCancelada: 'Export canceled.',
  tablaSinFilas: 'The table query returned no rows.',
  exportarSinPaginar: 'Exporting a table requires reading it without paging: the ROWNUM form does not allow it.',
  sinUltimaClave: 'The worker did not return the key of the last row.',
  recuentoSinFilas: 'The count returned no rows.',
  recuentoSinNumero: 'The count did not return a number.',
  limiteProcesosConsola: (tope: number) =>
    `There are ${tope} consoles with their own process open at once and none can be closed without losing work. Close one to open another.`,
  limiteProcesosConexion: (tope: number) =>
    `There are ${tope} connections open at once and none can be closed without losing work. Disconnect one to open another.`,
  sinProceso: 'Could not start the connection process.',
  listaBlancaNoSql: 'The read-only allowlist does not belong to a SQL session.',
  revirtioServidor: (etiqueta: string, codigo?: string) =>
    `${etiqueta} rolled back the transaction${codigo ? ` (error ${codigo})` : ''}: uncommitted changes were lost.`,
  creadoConErrores: (mensaje: string) => `Created with compilation errors: ${mensaje}`,
  tablaBloqueada: (mensaje: string) =>
    'The table is locked by an uncommitted transaction (maybe one of your consoles): Retry when it finishes, ' +
    `or “Read without waiting”, which also shows what has not been committed yet. (${mensaje})`,
  accionTxDesconocida: 'Unknown transaction action.',
  modoTxDesconocido: 'Unknown transaction mode.',
  txSigue: 'The transaction is still pending.'
}

export const txSesiones = crearTextos(es, en)
/** El español de referencia: las pruebas comparan contra él, que es el idioma por defecto. */
export const textosSesionesEs = es
