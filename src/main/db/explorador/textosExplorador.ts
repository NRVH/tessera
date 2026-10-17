// =============================================================================
// Textos que el explorador de bases de datos entrega al usuario desde el main: el diálogo de salida con
// cambios sin enviar, los avisos de la máquina de sesión, los errores de consolas, exportación y
// familias de motor. Se leen al producirse el mensaje, nunca al cargar el módulo.
// Depende de shared/i18n.ts.
// =============================================================================

import { crearTextos } from '../../../shared/i18n.ts'

export const txSalida = crearTextos(
  {
    etiquetaGenerica: 'Pestaña de tabla',
    unCambio: 'un cambio',
    cambios: (n: number) => `${n} cambios`,
    cambiosLinea: (n: number) => (n === 1 ? '1 cambio' : `${n} cambios`),
    pestanasMas: (n: number) => (n === 1 ? 'y 1 pestaña más' : `y ${n} pestañas más`),
    titulo: 'Cambios sin enviar',
    mensaje: (_n: number, frase: string) => `Hay ${frase} sin enviar.`,
    detalle: (lineas: string) => `${lineas}\n\nSi sales, se descartan: no llegaron a la base de datos.`,
    descartarYSalir: 'Descartar y salir',
    cancelar: 'Cancelar',
    bloque: (lineas: string) =>
      '\n\nCambios sin enviar de la rejilla, que se descartan con cualquiera de las dos ' +
      `opciones («Confirmar y salir» solo confirma las transacciones):\n${lineas}`
  },
  {
    etiquetaGenerica: 'Table tab',
    unCambio: 'one change',
    cambios: (n: number) => `${n} changes`,
    cambiosLinea: (n: number) => (n === 1 ? '1 change' : `${n} changes`),
    pestanasMas: (n: number) => (n === 1 ? 'and 1 more tab' : `and ${n} more tabs`),
    titulo: 'Unsubmitted changes',
    mensaje: (n: number, _frase: string) =>
      n === 1 ? 'There is 1 unsubmitted change.' : `There are ${n} unsubmitted changes.`,
    detalle: (lineas: string) => `${lineas}\n\nIf you quit, they are discarded: they never reached the database.`,
    descartarYSalir: 'Discard and quit',
    cancelar: 'Cancel',
    bloque: (lineas: string) =>
      '\n\nUnsubmitted grid changes, which are discarded with either option ' +
      `(“Commit and quit” only commits the transactions):\n${lineas}`
  }
)

/** Los avisos de la sesión: se leen con `MENSAJES.x`, que resuelve el idioma en cada acceso. */
export const txSesion = crearTextos(
  {
    perdidaConTx: 'Sesión perdida; el servidor revirtió la transacción',
    perdidaSinTx: 'Sesión perdida; se reabrirá en la siguiente operación',
    caidaConTx: 'El proceso de la conexión terminó de forma inesperada; el servidor revirtió la transacción',
    caidaSinTx: 'El proceso de la conexión terminó de forma inesperada; se reabrirá en la siguiente operación',
    perdidaEnCommit:
      'Sesión perdida con el COMMIT en camino: no se sabe si llegó a aplicarse. Comprueba los datos antes de repetir los cambios',
    caidaEnCommit:
      'El proceso de la conexión terminó con el COMMIT en camino: no se sabe si llegó a aplicarse. Comprueba los datos antes de repetir los cambios',
    perdidaEnAuto:
      'Sesión perdida con la sentencia en camino, que se confirma sola (Auto, o un DDL de Oracle): no se sabe si llegó a aplicarse. Comprueba los datos antes de repetirla',
    caidaEnAuto:
      'El proceso de la conexión terminó con la sentencia en camino, que se confirma sola (Auto, o un DDL de Oracle): no se sabe si llegó a aplicarse. Comprueba los datos antes de repetirla',
    perdidaPorDentro:
      'Sesión perdida con un bloque PL/SQL o una rutina en camino, que pueden confirmar por dentro: no se sabe si se aplicó. Comprueba los datos antes de repetir los cambios',
    caidaPorDentro:
      'El proceso de la conexión terminó con un bloque PL/SQL o una rutina en camino, que pueden confirmar por dentro: no se sabe si se aplicó. Comprueba los datos antes de repetir los cambios',
    inactividad: 'Sesión cerrada por inactividad; se reabrirá al usarla y se pierden sus ALTER SESSION y SET',
    detenidaConTx:
      'Consulta detenida: para pararla se cerró la sesión de la consola, y la transacción que tenía abierta se revirtió',
    editada: 'La conexión se editó; la sesión se reabrirá con los datos nuevos',
    expulsada: 'Sesión cerrada para dejar sitio a otra (límite de sesiones vivas)',
    commitImplicito: 'El DDL confirmó de forma implícita los cambios pendientes',
    ocupada: 'La sesión está ocupada con otra operación',
    txPendiente: 'Confirma o revierte primero',
    txFallida: 'La transacción falló; solo se puede revertir',
    soloLectura: 'La conexión es de solo lectura',
    cerrada: 'La sesión no está abierta'
  },
  {
    perdidaConTx: 'Session lost; the server rolled back the transaction',
    perdidaSinTx: 'Session lost; it will reopen on the next operation',
    caidaConTx: 'The connection process ended unexpectedly; the server rolled back the transaction',
    caidaSinTx: 'The connection process ended unexpectedly; it will reopen on the next operation',
    perdidaEnCommit:
      'Session lost while the COMMIT was in flight: it is not known whether it was applied. Check the data before repeating the changes',
    caidaEnCommit:
      'The connection process ended while the COMMIT was in flight: it is not known whether it was applied. Check the data before repeating the changes',
    perdidaEnAuto:
      'Session lost while the statement was in flight, which commits on its own (Auto, or an Oracle DDL): it is not known whether it was applied. Check the data before repeating it',
    caidaEnAuto:
      'The connection process ended while the statement was in flight, which commits on its own (Auto, or an Oracle DDL): it is not known whether it was applied. Check the data before repeating it',
    perdidaPorDentro:
      'Session lost while a PL/SQL block or routine was in flight, which can commit internally: it is not known whether it was applied. Check the data before repeating the changes',
    caidaPorDentro:
      'The connection process ended while a PL/SQL block or routine was in flight, which can commit internally: it is not known whether it was applied. Check the data before repeating the changes',
    inactividad: 'Session closed for inactivity; it will reopen when used and its ALTER SESSION and SET settings are lost',
    detenidaConTx:
      'Query stopped: to stop it the console session was closed, and the transaction it had open was rolled back',
    editada: 'The connection was edited; the session will reopen with the new settings',
    expulsada: 'Session closed to make room for another (live session limit)',
    commitImplicito: 'The DDL implicitly committed the pending changes',
    ocupada: 'The session is busy with another operation',
    txPendiente: 'Commit or roll back first',
    txFallida: 'The transaction failed; it can only be rolled back',
    soloLectura: 'The connection is read-only',
    cerrada: 'The session is not open'
  }
)

export const txCola = crearTextos(
  {
    cancelada: 'Operación cancelada antes de empezar',
    descartada: 'Operación sustituida por una petición más reciente',
    vaciada: 'Operación descartada: la sesión se cerró'
  },
  {
    cancelada: 'Operation canceled before it started',
    descartada: 'Operation replaced by a more recent request',
    vaciada: 'Operation discarded: the session was closed'
  }
)

export const txFamilia = crearTextos(
  {
    sesionCerradaAntes: 'La sesión se cerró antes de ejecutar la operación.',
    errorInterno: 'Error interno del explorador de bases de datos.',
    conexionNoExiste: 'La conexión ya no existe.',
    procesoTerminoInesperado: 'El proceso de la conexión terminó inesperadamente.',
    cerradaPorInactividad: 'La sesión se cerró por inactividad; se reabre al usarla.',
    sinSecreto: 'La contraseña guardada no se puede descifrar en este equipo. Edita la conexión y vuelve a escribirla.',
    limiteConsolas: (max: number) =>
      `Esta conexión ya tiene ${max} consolas trabajando a la vez. Espera a que termine alguna.`,
    sinConexion: 'La conexión ya no existe.',
    motorDesconocido: (motor: string) => `Motor desconocido: "${motor}".`,
    motorNoEsFamilia: (etiqueta: string, familia: string) =>
      `${etiqueta} no es un motor ${familia}: esta petición no es para esta conexión.`,
    consolaOtroPerfil: 'La consola no pertenece a este perfil.',
    sinNivelBases: 'Esta conexión no tiene nivel «Bases»: la petición no puede llevar una base.',
    nombreFamilia: { sql: 'SQL', documentos: 'de documentos', claves: 'de claves' },
    motorNoEsDeFamilia: (etiqueta: string, familia: string) => `${etiqueta} no es un motor de ${familia}.`,
    sinSoporte: (etiqueta: string) => `Todavía no se puede conectar a ${etiqueta} desde esta versión.`
  },
  {
    sesionCerradaAntes: 'The session was closed before the operation ran.',
    errorInterno: 'Internal error in the database explorer.',
    conexionNoExiste: 'The connection no longer exists.',
    procesoTerminoInesperado: 'The connection process ended unexpectedly.',
    cerradaPorInactividad: 'The session was closed for inactivity; it reopens when used.',
    sinSecreto: 'The saved password cannot be decrypted on this computer. Edit the connection and enter it again.',
    limiteConsolas: (max: number) =>
      `This connection already has ${max} consoles working at once. Wait for one to finish.`,
    sinConexion: 'The connection no longer exists.',
    motorDesconocido: (motor: string) => `Unknown engine: "${motor}".`,
    motorNoEsFamilia: (etiqueta: string, familia: string) =>
      `${etiqueta} is not a ${familia} engine: this request is not for this connection.`,
    consolaOtroPerfil: 'The console does not belong to this profile.',
    sinNivelBases: 'This connection has no “Databases” level: the request cannot carry a database.',
    nombreFamilia: { sql: 'SQL', documentos: 'document', claves: 'key-value' },
    motorNoEsDeFamilia: (etiqueta: string, familia: string) => `${etiqueta} is not a ${familia} engine.`,
    sinSoporte: (etiqueta: string) => `Connecting to ${etiqueta} is not supported in this version yet.`
  }
)

export const txConsolas = crearTextos(
  {
    faltaConexion: 'Falta la conexión de la consola.',
    tipoDesconocido: 'Tipo de consola desconocido.',
    carpetaForma: 'La carpeta de consolas no tiene la forma esperada.',
    archivoNoExiste: 'El archivo de la consola ya no existe.',
    textoNoValido: 'El texto de la consola no es válido.',
    supera: (mib: number) => `La consola supera el máximo de ${mib} MiB.`,
    noExiste: 'La consola ya no existe.',
    nombreRepetido: (nombre: string) => `Ya hay una consola llamada «${nombre}».`,
    esquemaNoValido: 'El esquema no es válido.',
    papelera: (n: number) =>
      n === 1 ? 'No se pudo mover 1 consola a la papelera.' : `No se pudieron mover ${n} consolas a la papelera.`,
    perfilNoValido: 'Perfil no válido.',
    perfilNoExiste: 'El perfil no existe o no está cargado.'
  },
  {
    faltaConexion: 'The console’s connection is missing.',
    tipoDesconocido: 'Unknown console type.',
    carpetaForma: 'The consoles folder does not have the expected shape.',
    archivoNoExiste: 'The console file no longer exists.',
    textoNoValido: 'The console text is not valid.',
    supera: (mib: number) => `The console exceeds the ${mib} MiB maximum.`,
    noExiste: 'The console no longer exists.',
    nombreRepetido: (nombre: string) => `There is already a console named “${nombre}”.`,
    esquemaNoValido: 'The schema is not valid.',
    papelera: (n: number) =>
      n === 1 ? 'Could not move 1 console to the trash.' : `Could not move ${n} consoles to the trash.`,
    perfilNoValido: 'Invalid profile.',
    perfilNoExiste: 'The profile does not exist or is not loaded.'
  }
)

export const txExportacion = crearTextos(
  {
    cancelada: 'Exportación cancelada.',
    destinoNoExiste: 'La carpeta de destino ya no existe.',
    sinPermiso: 'Sin permiso para escribir ahí, o el archivo está abierto en otro programa.',
    abierto: 'El archivo está abierto en otro programa: ciérralo y vuelve a exportar.',
    sinEspacio: 'No queda espacio en el disco.',
    soloLectura: 'La carpeta de destino es de solo lectura.',
    nombreLargo: 'El nombre o la ruta del archivo son demasiado largos.',
    esCarpeta: 'Ya hay una carpeta con ese nombre.',
    errorDiscoCodigo: (code: string) => `Error de disco al exportar (${code}).`,
    errorDisco: 'Error de disco al exportar.',
    filasNoValidas: 'Las filas a exportar no son válidas.',
    tituloDialogo: (formato: string) => `Exportar como ${formato}`,
    idEnCurso: 'Ya hay una exportación con ese identificador en curso.'
  },
  {
    cancelada: 'Export canceled.',
    destinoNoExiste: 'The destination folder no longer exists.',
    sinPermiso: 'No permission to write there, or the file is open in another program.',
    abierto: 'The file is open in another program: close it and export again.',
    sinEspacio: 'There is no space left on the disk.',
    soloLectura: 'The destination folder is read-only.',
    nombreLargo: 'The file name or path is too long.',
    esCarpeta: 'A folder with that name already exists.',
    errorDiscoCodigo: (code: string) => `Disk error while exporting (${code}).`,
    errorDisco: 'Disk error while exporting.',
    filasNoValidas: 'The rows to export are not valid.',
    tituloDialogo: (formato: string) => `Export as ${formato}`,
    idEnCurso: 'An export with that identifier is already in progress.'
  }
)

export const txProduccion = crearTextos(
  {
    commit: 'confirma el COMMIT antes de enviarlo',
    enviar: 'confirma los cambios antes de enviarlos',
    escritura: 'confirma la escritura antes de enviarla',
    mensaje: (alias: string, accion: string) => `«${alias}» es una conexión de PRODUCCIÓN: ${accion}. No se envió nada.`
  },
  {
    commit: 'confirm the COMMIT before sending it',
    enviar: 'confirm the changes before submitting them',
    escritura: 'confirm the write before sending it',
    mensaje: (alias: string, accion: string) => `“${alias}” is a PRODUCTION connection: ${accion}. Nothing was sent.`
  }
)

export const txProceso = crearTextos(
  {
    noEnMarcha: 'El proceso de la conexión no está en marcha.',
    noSePudoHablar: (detalle: string) => `No se pudo hablar con el proceso de la conexión: ${detalle}`,
    termino: (como: string) => `El proceso de la conexión terminó (${como}).`,
    senal: (s: string) => `señal ${s}`,
    codigo: (c: string) => `código ${c}`
  },
  {
    noEnMarcha: 'The connection process is not running.',
    noSePudoHablar: (detalle: string) => `Could not talk to the connection process: ${detalle}`,
    termino: (como: string) => `The connection process ended (${como}).`,
    senal: (s: string) => `signal ${s}`,
    codigo: (c: string) => `code ${c}`
  }
)
