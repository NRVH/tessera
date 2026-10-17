// =============================================================================
// Textos del subsistema de bases de datos del main que el usuario lee: errores de validación y de
// altas, diálogos de archivos y de drivers, avisos de la importación y mensajes de los túneles. Se
// leen al producirse el error, con el idioma ya fijado, nunca en el nivel superior de un módulo.
// Depende solo de `shared/i18n.ts`.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txDb = crearTextos(
  {
    conexion: {
      desconocida: (id: string) => `Conexión desconocida: "${id}".`,
      seleccionEsquemas: 'La selección de esquemas no es válida.',
      seleccionBases: 'La selección de bases no es válida.',
      sinTuneles: 'Tessera aún no puede abrir túneles SSH.',
      perfilNoExiste: 'Ese perfil no existe: no se prepara su espacio de datos.',
      sinAlmacen: (almacen: string, remedio: string) =>
        'No se puede guardar la contraseña: ' + `${almacen} no está disponible. ` + `Tessera nunca la guarda en claro.${remedio}`,
      formaInvalida: 'La conexión no tiene una forma válida.',
      idInvalido: 'La conexión no tiene un id válido.',
      sinNombreOPerfil: 'La conexión no tiene nombre o perfil.',
      formaInvalidaDe: (alias: string) => `La conexión "${alias}" no tiene una forma válida.`
    },
    validacion: {
      requierePerfil: 'Una conexión requiere un perfil.',
      necesitaNombre: 'La conexión necesita un nombre.',
      nombreLargo: (max: number) => `El nombre no puede pasar de ${max} caracteres.`,
      nombreRepetido: (alias: string) => `Este perfil ya tiene una conexión llamada "${alias}".`,
      motorDesconocido: (motor: string) => `Motor desconocido: "${motor}".`,
      sshNoExiste: 'La conexión SSH del túnel no existe en este perfil.',
      certificadoPorTunel: (etiqueta: string) =>
        `${etiqueta} no puede verificar su certificado a través de un túnel SSH: desmarca el cifrado (el túnel ya cifra el tramo hasta el servidor SSH) o quita el túnel.`,
      sinContrasena: (etiqueta: string) => `${etiqueta} no usa contraseña.`,
      contrasenaSentinels: 'La contraseña de los sentinels no es válida.'
    },
    opcionales: {
      srvPorTunel: 'Una dirección SRV (mongodb+srv) no puede ir por un túnel SSH: pon el servidor y el puerto.',
      redisPorTunel:
        'Sentinel y Cluster no van por túnel SSH: el cliente se conecta a servidores que el túnel no lleva. Quita el túnel o elige «Un servidor».',
      variosServidoresPorTunel: 'Con túnel SSH, la conexión admite un solo servidor.',
      replicaSetPorTunel: 'Con túnel SSH, la conexión va directa a un servidor: quita replicaSet y directConnection=false de las opciones.',
      instanciaPorTunel: 'Con túnel SSH, la conexión necesita el puerto y no la instancia: el túnel no lleva la consulta que la resuelve.',
      instanciaInvalida: 'La instancia no es válida.',
      instanciaSoloNombre: 'En la instancia va solo su nombre (p. ej. SQLEXPRESS), sin el servidor ni el puerto.',
      autenticacionDesconocida: (v: string) => `Autenticación desconocida: "${v}".`,
      dominioInvalido: 'El dominio no es válido.',
      faltaDominio: 'Falta el dominio de la cuenta.',
      cifradoInvalido: 'El cifrado de la conexión no es válido.',
      usuarioInvalido: 'El usuario no es válido.',
      srvInvalido: 'El tipo de dirección (SRV) no es válido.',
      opcionesUriInvalidas: 'Las opciones de la URI no son válidas.',
      tunelInvalido: 'El túnel SSH de la conexión no es válido.'
    },
    archivos: {
      fichaDesconocida: 'Ese archivo ya no está elegido (pasó demasiado tiempo o se reinició Tessera). Vuelve a elegirlo.',
      fichaOtroMotor: (elegido: string, pedido: string) => `Ese archivo se eligió para ${elegido}, no para ${pedido}: vuelve a elegirlo.`,
      proyectoDesconocido: 'Proyecto desconocido.',
      faltaArchivo: 'Falta el archivo.',
      dentroDeComprimido: 'Ese archivo está dentro de un comprimido: no se puede abrir como base de datos.',
      fueraDelProyecto: 'Ese archivo está fuera del proyecto.',
      enlaceFuera: (nombre: string) => `«${nombre}» es un enlace a un archivo de fuera del proyecto: Tessera no lo abre como base de datos.`,
      noExiste: (nombre: string) => `No existe «${nombre}».`,
      noSePudoLeer: (nombre: string, errno: string | null) => `No se pudo leer «${nombre}»${errno !== null ? ` (${errno})` : ''}.`,
      ningunaSabeAbrir: 'Ninguna base de datos de archivo sabe abrir ese archivo.',
      faltaRuta: 'Falta la ruta del archivo.',
      rutaNoAbsoluta: (ruta: string) => `La ruta del archivo tiene que ser absoluta: ${ruta}`,
      noEsArchivoDelEquipo: 'Ese elemento no es un archivo del equipo.',
      motorNoEsDeArchivo: 'Ese motor no es de archivo.',
      noEsDelProyectoAbierto: 'Ese archivo no es del proyecto abierto en el explorador: ábrelo desde su proyecto.',
      origenDesconocido: 'No se sabe de dónde sale el archivo de la base.',
      elegirTitulo: (etiqueta: string) => `Elige la base de datos ${etiqueta}`,
      filtroBases: (etiqueta: string) => `Bases ${etiqueta}`,
      filtroTodos: 'Todos los archivos',
      botonElegir: 'Elegir',
      nuevaTitulo: (etiqueta: string) => `Nueva base de datos ${etiqueta}`,
      botonCrear: 'Crear'
    },
    probar: {
      cambioEnVuelo: 'La conexión cambió mientras se probaba. Vuelve a probarla.',
      sinContrasenaGuardada: 'Esta conexión no tiene contraseña guardada.',
      contrasenaIlegible: (almacen: string) =>
        'La contraseña guardada no se puede descifrar en este equipo.\n' +
        `La guarda ${almacen}, que la ata a tu ` +
        'usuario y a esta máquina, así que un perfil copiado de otro equipo (o un ' +
        'cambio de cuenta) la deja ilegible. Edita la conexión y vuelve a escribirla.',
      conectado: (ms: string, modo: string, aviso: string) => `Conectado en ${ms} ms (${modo}).${aviso}`,
      falloDesconocido: 'Fallo desconocido.'
    },
    tdb: {
      sinRespuesta: 'terminó sin dar respuesta',
      sinPlazo: (s: number) => `no respondió en ${s} s y se detuvo`,
      salidaExcesiva: 'su salida pasó del tope y se detuvo',
      noArranco: (codigo: string) => `no arrancó (${codigo})`,
      conCodigo: (codigo: number) => `terminó con el código ${codigo} sin dar respuesta`,
      detenido: (senal: string) => `se detuvo (${senal}) sin dar respuesta`,
      fallo: (causa: string, conDetalle: boolean) =>
        `No se pudo ejecutar tdb: ${causa}.${conDetalle ? ' El detalle queda en el log de bases de datos (logs/db.log).' : ''}`,
      sesionNoAutorizada:
        '\n  ✗ Esta sesión ya no está autorizada.\n' + '    Recarga la terminal para que Tessera vuelva a emitir sus credenciales.\n\n'
    },
    puente: {
      sinTunel: 'Esta conexión no lleva túnel SSH, o Tessera no puede abrirlo ahora.',
      fileNoLlega:
        '\n  ✗ --file no llega por el puente: la ruta sería del equipo anfitrión, no de tu carpeta.\n' +
        '    El tdb del contenedor lee el archivo y manda su SQL; recarga la terminal para\n' +
        "    usarlo, o pásalo por la entrada estándar:  tdb query <base> --stdin <<'SQL'\n\n",
      tdbCortado: (s: number) => `\n  ✗ tdb no terminó en ${s} s y se cortó.\n\n`,
      programaDesconocido: (que: string) => `\n  ✗ Esta Tessera no sabe atender «${que}» por el buzón: reiníciala o actualízala.\n\n`,
      respuestaGrande: (mib: number) => `\n  ✗ La respuesta superó los ${mib} MiB que admite el puente al host y se descartó.\n\n`,
      respuestaDescartada: (mib: number) =>
        `La respuesta superó los ${mib} MiB y se descartó.\n` + `Acota la consulta (por ejemplo con --limit).\n`
    },
    drivers: {
      noDisponible: (packId: string) => `El driver "${packId}" no está disponible en este sistema.`,
      desconocido: (packId: string) => `Driver desconocido: "${packId}".`,
      noEncontrado: (centinela: string, ruta: string) =>
        `No encontré "${centinela}" en "${ruta}". Elige la carpeta del Instant Client (la que contiene ${centinela}).`,
      oracleSinDescarga: (nombre: string) =>
        `Oracle ya no publica ${nombre} para descarga directa: solo queda en su ` +
        'archivo histórico, que exige iniciar sesión y aceptar la licencia en el ' +
        'navegador. Descárgalo a mano y usa "Seleccionar carpeta…".',
      sinContenido: (centinela: string) => `El paquete descargado no contiene "${centinela}".`,
      noSePudoInstalar: (nombre: string, mensaje: string) =>
        `No se pudo instalar ${nombre}: ${mensaje}\n` + `Alternativa: descárgalo a mano y usa "Seleccionar carpeta…".`,
      sinDescargaAutomatica: 'Este cliente no tiene descarga automática.',
      huellaNoCoincide: (bytes: number) =>
        `lo descargado (${bytes} bytes) no coincide con la huella SHA-256 publicada ` +
        'del paquete. Puede ser una descarga cortada o un proxy que devolvió otra cosa; si ' +
        'se repite, el paquete publicado cambió y Tessera tiene que actualizar su ficha.',
      noEsZip: 'Lo descargado no es un ZIP (¿la red devolvió una página de error?).',
      necesitaMacos: (nombre: string, minimo: number, actual: number) =>
        `${nombre} necesita macOS ${minimo} o posterior, y este Mac tiene ` +
        `macOS ${actual}: sus bibliotecas no cargarían. Con un cliente que sí funcione ` +
        'aquí, usa "Seleccionar carpeta…".',
      cubre: {
        'oracle-ic-19': 'Oracle 11.2 y superior',
        'oracle-ic-12.1': 'Oracle 10.2 – 11.1 (más antiguas que las que alcanza el 19)',
        'oracle-ic-23-macos-arm64': 'Oracle 11.2 y superior',
        'oracle-ic-19-linux-x64': 'Oracle 11.2 y superior'
      } as Record<string, string>,
      avisoSoporte: {
        'oracle-ic-23-macos-arm64': '11.2–18c están fuera del soporte de Oracle; probado.'
      } as Record<string, string>,
      sinDescarga: {
        'oracle-ic-12.1':
          'Oracle ya no publica Oracle Instant Client 12.1 (Basic Light) para descarga directa: ' +
          'solo queda en su archivo histórico, que exige iniciar sesión y aceptar la licencia ' +
          'en el navegador. Descárgalo a mano y usa "Seleccionar carpeta…".'
      } as Record<string, string>,
      carpetaTitulo: 'Elige la carpeta del cliente de base de datos',
      carpetaBoton: 'Usar esta carpeta',
      imagenVacia: 'la imagen de disco está vacía.',
      imagenSinArchivo: (archivo: string) => `La imagen de disco no contiene "${archivo}".`,
      noSeMonto: (detalle: string) => `No se pudo montar la imagen de disco: ${detalle}`,
      noSeCopio: (detalle: string) => `No se pudo copiar el cliente desde la imagen de disco: ${detalle}`,
      firmaIncorrecta: (nombre: string, teamId: string, detalle: string) =>
        `"${nombre}" no lleva la firma esperada del fabricante (Team ID ${teamId}): ${detalle}`
    },
    descarga: {
      inactividad: (s: number) =>
        `La descarga se detuvo: el servidor lleva ${s} s sin enviar datos. ` +
        'Vuelve a intentarlo; si se repite, comprueba la conexión a internet o el proxy.',
      servidorRespondio: (estado: string) => `El servidor respondió ${estado}.`,
      sinCuerpo: 'Respuesta sin cuerpo.'
    },
    importacion: {
      sinContrasena: (alias: string) =>
        `La base «${alias}» se importó sin su contraseña: este equipo no tiene dónde guardarla, así que te la pedirá al conectar.`,
      archivoAusente: (alias: string) => `La base «${alias}» apunta a un archivo que no está en este equipo: edítala y elige el suyo.`
    },
    tuneles: {
      sshNoExiste: (alias: string) => `La conexión SSH del túnel de «${alias}» ya no existe: edita la conexión y elige otra.`,
      cerradoAlAbrir: 'El túnel se cerró mientras se abría.',
      noSeAbrio: (alias: string, causa: string) => `No se pudo abrir el túnel SSH por «${alias}»${causa ? `: ${causa}` : '.'}`,
      tiempoAgotado: (alias: string, s: number) => `El túnel SSH por «${alias}» no se abrió en ${s} s.`,
      sinPuerto: 'No se encontró un puerto libre para el túnel.'
    },
    sintaxis: {
      gramaticaDesconocida: 'Gramática desconocida.',
      peticionMalFormada: 'Petición de sintaxis mal formada.',
      demasiadasSentencias: 'Demasiadas sentencias para validarlas a la vez.',
      demasiadoTexto: 'Demasiado texto para validarlo a la vez.',
      gramaticaCaida: 'La gramática local dejó de responder; vuelve al reiniciar Tessera.',
      gramaticaNoCargo: 'No se pudo cargar la gramática local.'
    }
  },
  {
    conexion: {
      desconocida: (id) => `Unknown connection: "${id}".`,
      seleccionEsquemas: 'The schema selection is not valid.',
      seleccionBases: 'The database selection is not valid.',
      sinTuneles: 'Tessera can’t open SSH tunnels yet.',
      perfilNoExiste: 'That profile does not exist: its data space is not prepared.',
      sinAlmacen: (almacen, remedio) =>
        `Can’t save the password: ${almacen} isn’t available. Tessera never stores it in plain text.${remedio}`,
      formaInvalida: 'The connection is not in a valid format.',
      idInvalido: 'The connection does not have a valid id.',
      sinNombreOPerfil: 'The connection has no name or profile.',
      formaInvalidaDe: (alias) => `The connection "${alias}" is not in a valid format.`
    },
    validacion: {
      requierePerfil: 'A connection requires a profile.',
      necesitaNombre: 'The connection needs a name.',
      nombreLargo: (max) => `The name can’t be longer than ${max} characters.`,
      nombreRepetido: (alias) => `This profile already has a connection named "${alias}".`,
      motorDesconocido: (motor) => `Unknown engine: "${motor}".`,
      sshNoExiste: 'The tunnel’s SSH connection does not exist in this profile.',
      certificadoPorTunel: (etiqueta) =>
        `${etiqueta} can’t verify its certificate through an SSH tunnel: clear the encryption option (the tunnel already encrypts the leg to the SSH server) or remove the tunnel.`,
      sinContrasena: (etiqueta) => `${etiqueta} does not use a password.`,
      contrasenaSentinels: 'The Sentinel password is not valid.'
    },
    opcionales: {
      srvPorTunel: 'An SRV address (mongodb+srv) can’t go through an SSH tunnel: enter the server and port.',
      redisPorTunel:
        'Sentinel and Cluster can’t go through an SSH tunnel: the client connects to servers the tunnel doesn’t carry. Remove the tunnel or choose “Single server”.',
      variosServidoresPorTunel: 'With an SSH tunnel, the connection accepts a single server.',
      replicaSetPorTunel: 'With an SSH tunnel, the connection goes straight to one server: remove replicaSet and directConnection=false from the options.',
      instanciaPorTunel: 'With an SSH tunnel, the connection needs the port, not the instance: the tunnel doesn’t carry the query that resolves it.',
      instanciaInvalida: 'The instance is not valid.',
      instanciaSoloNombre: 'The instance takes only its name (e.g. SQLEXPRESS), without the server or the port.',
      autenticacionDesconocida: (v) => `Unknown authentication: "${v}".`,
      dominioInvalido: 'The domain is not valid.',
      faltaDominio: 'The account domain is missing.',
      cifradoInvalido: 'The connection encryption setting is not valid.',
      usuarioInvalido: 'The user is not valid.',
      srvInvalido: 'The address type (SRV) is not valid.',
      opcionesUriInvalidas: 'The URI options are not valid.',
      tunelInvalido: 'The connection’s SSH tunnel is not valid.'
    },
    archivos: {
      fichaDesconocida: 'That file is no longer selected (too much time has passed or Tessera was restarted). Choose it again.',
      fichaOtroMotor: (elegido, pedido) => `That file was chosen for ${elegido}, not for ${pedido}: choose it again.`,
      proyectoDesconocido: 'Unknown project.',
      faltaArchivo: 'The file is missing.',
      dentroDeComprimido: 'That file is inside an archive: it can’t be opened as a database.',
      fueraDelProyecto: 'That file is outside the project.',
      enlaceFuera: (nombre) => `“${nombre}” is a link to a file outside the project: Tessera doesn’t open it as a database.`,
      noExiste: (nombre) => `“${nombre}” does not exist.`,
      noSePudoLeer: (nombre, errno) => `Couldn’t read “${nombre}”${errno !== null ? ` (${errno})` : ''}.`,
      ningunaSabeAbrir: 'No file database knows how to open that file.',
      faltaRuta: 'The file path is missing.',
      rutaNoAbsoluta: (ruta) => `The file path must be absolute: ${ruta}`,
      noEsArchivoDelEquipo: 'That item is not a file on this computer.',
      motorNoEsDeArchivo: 'That engine is not a file-based engine.',
      noEsDelProyectoAbierto: 'That file is not from the project open in the explorer: open it from its project.',
      origenDesconocido: 'Can’t tell where the database file comes from.',
      elegirTitulo: (etiqueta) => `Choose the ${etiqueta} database`,
      filtroBases: (etiqueta) => `${etiqueta} databases`,
      filtroTodos: 'All files',
      botonElegir: 'Choose',
      nuevaTitulo: (etiqueta) => `New ${etiqueta} database`,
      botonCrear: 'Create'
    },
    probar: {
      cambioEnVuelo: 'The connection changed while it was being tested. Test it again.',
      sinContrasenaGuardada: 'This connection has no saved password.',
      contrasenaIlegible: (almacen) =>
        'The saved password can’t be decrypted on this computer.\n' +
        `It is stored by ${almacen}, which ties it to your ` +
        'user and to this machine, so a profile copied from another computer (or an ' +
        'account change) leaves it unreadable. Edit the connection and enter it again.',
      conectado: (ms, modo, aviso) => `Connected in ${ms} ms (${modo}).${aviso}`,
      falloDesconocido: 'Unknown failure.'
    },
    tdb: {
      sinRespuesta: 'ended without answering',
      sinPlazo: (s) => `did not answer within ${s} s and was stopped`,
      salidaExcesiva: 'its output went over the limit and it was stopped',
      noArranco: (codigo) => `did not start (${codigo})`,
      conCodigo: (codigo) => `ended with code ${codigo} without answering`,
      detenido: (senal) => `was stopped (${senal}) without answering`,
      fallo: (causa, conDetalle) =>
        `Couldn’t run tdb: ${causa}.${conDetalle ? ' The details are in the database log (logs/db.log).' : ''}`,
      sesionNoAutorizada:
        '\n  ✗ This session is no longer authorized.\n' + '    Reload the terminal so Tessera issues its credentials again.\n\n'
    },
    puente: {
      sinTunel: 'This connection has no SSH tunnel, or Tessera can’t open it right now.',
      fileNoLlega:
        '\n  ✗ --file does not go through the bridge: the path would belong to the host computer, not to your folder.\n' +
        '    The container’s tdb reads the file and sends its SQL; reload the terminal to\n' +
        "    use it, or pass it through standard input:  tdb query <database> --stdin <<'SQL'\n\n",
      tdbCortado: (s) => `\n  ✗ tdb did not finish within ${s} s and was cut off.\n\n`,
      programaDesconocido: (que) => `\n  ✗ This Tessera can’t handle “${que}” through the mailbox: restart or update it.\n\n`,
      respuestaGrande: (mib) => `\n  ✗ The response exceeded the ${mib} MiB the host bridge allows and was discarded.\n\n`,
      respuestaDescartada: (mib) =>
        `The response exceeded ${mib} MiB and was discarded.\n` + `Narrow the query (for example with --limit).\n`
    },
    drivers: {
      noDisponible: (packId) => `The driver "${packId}" is not available on this system.`,
      desconocido: (packId) => `Unknown driver: "${packId}".`,
      noEncontrado: (centinela, ruta) =>
        `Couldn’t find "${centinela}" in "${ruta}". Choose the Instant Client folder (the one that contains ${centinela}).`,
      oracleSinDescarga: (nombre) =>
        `Oracle no longer publishes ${nombre} for direct download: it only remains in its ` +
        'historical archive, which requires signing in and accepting the license in the ' +
        'browser. Download it manually and use “Select folder…”.',
      sinContenido: (centinela) => `The downloaded package does not contain "${centinela}".`,
      noSePudoInstalar: (nombre, mensaje) =>
        `Couldn’t install ${nombre}: ${mensaje}\n` + `Alternative: download it manually and use “Select folder…”.`,
      sinDescargaAutomatica: 'This client has no automatic download.',
      huellaNoCoincide: (bytes) =>
        `the download (${bytes} bytes) does not match the package’s published SHA-256 fingerprint. ` +
        'It may be a truncated download or a proxy that returned something else; if ' +
        'it happens again, the published package changed and Tessera needs to update its entry.',
      noEsZip: 'The download is not a ZIP file (did the network return an error page?).',
      necesitaMacos: (nombre, minimo, actual) =>
        `${nombre} needs macOS ${minimo} or later, and this Mac has ` +
        `macOS ${actual}: its libraries wouldn’t load. With a client that does work ` +
        'here, use “Select folder…”.',
      cubre: {
        'oracle-ic-19': 'Oracle 11.2 and later',
        'oracle-ic-12.1': 'Oracle 10.2 – 11.1 (older than what 19 reaches)',
        'oracle-ic-23-macos-arm64': 'Oracle 11.2 and later',
        'oracle-ic-19-linux-x64': 'Oracle 11.2 and later'
      },
      avisoSoporte: {
        'oracle-ic-23-macos-arm64': '11.2–18c are outside Oracle support; tested.'
      },
      sinDescarga: {
        'oracle-ic-12.1':
          'Oracle no longer publishes Oracle Instant Client 12.1 (Basic Light) for direct download: ' +
          'it only remains in its historical archive, which requires signing in and accepting the license ' +
          'in the browser. Download it manually and use “Select folder…”.'
      },
      carpetaTitulo: 'Choose the database client folder',
      carpetaBoton: 'Use this folder',
      imagenVacia: 'the disk image is empty.',
      imagenSinArchivo: (archivo) => `The disk image does not contain "${archivo}".`,
      noSeMonto: (detalle) => `Couldn’t mount the disk image: ${detalle}`,
      noSeCopio: (detalle) => `Couldn’t copy the client from the disk image: ${detalle}`,
      firmaIncorrecta: (nombre, teamId, detalle) =>
        `"${nombre}" does not carry the vendor’s expected signature (Team ID ${teamId}): ${detalle}`
    },
    descarga: {
      inactividad: (s) =>
        `The download stopped: the server has sent no data for ${s} s. ` +
        'Try again; if it keeps happening, check your internet connection or proxy.',
      servidorRespondio: (estado) => `The server responded ${estado}.`,
      sinCuerpo: 'Response without a body.'
    },
    importacion: {
      sinContrasena: (alias) =>
        `The database “${alias}” was imported without its password: this computer has nowhere to store it, so it will ask for it when you connect.`,
      archivoAusente: (alias) => `The database “${alias}” points to a file that is not on this computer: edit it and choose its file.`
    },
    tuneles: {
      sshNoExiste: (alias) => `The SSH connection for the “${alias}” tunnel no longer exists: edit the connection and choose another.`,
      cerradoAlAbrir: 'The tunnel closed while it was opening.',
      noSeAbrio: (alias, causa) => `Couldn’t open the SSH tunnel through “${alias}”${causa ? `: ${causa}` : '.'}`,
      tiempoAgotado: (alias, s) => `The SSH tunnel through “${alias}” did not open within ${s} s.`,
      sinPuerto: 'Couldn’t find a free port for the tunnel.'
    },
    sintaxis: {
      gramaticaDesconocida: 'Unknown grammar.',
      peticionMalFormada: 'Malformed syntax request.',
      demasiadasSentencias: 'Too many statements to validate at once.',
      demasiadoTexto: 'Too much text to validate at once.',
      gramaticaCaida: 'The local grammar stopped responding; it comes back when you restart Tessera.',
      gramaticaNoCargo: 'Couldn’t load the local grammar.'
    }
  }
)
