// =============================================================================
// Textos de las conexiones SSH que ve la persona: validación del formulario, errores del registro,
// archivos de clave, el explorador SFTP, los avisos del programa de contraseñas y los títulos de
// los diálogos. Español e inglés juntos; se leen al usarse. No incluye lo que `tssh` dice a un
// agente (puenteTssh, catalogo) ni los avisos del registro de disco.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txSsh = crearTextos(
  {
    validacion: {
      hostFalta: 'Falta el host.',
      hostEspacios: 'El host no puede llevar espacios.',
      hostGuion: 'El host no puede empezar por «-».',
      hostArroba: 'Escriba el host sin el usuario: el usuario va en su propio campo.',
      hostBarra: 'El host no puede llevar «/»: escriba solo el nombre o la dirección.',
      hostDolar: 'El host no puede llevar «${».',
      hostPorciento: 'El host no puede llevar «%».',
      hostCorchetes: 'Escriba la dirección IPv6 sin corchetes: el puerto va en su propio campo.',
      hostPuerto: 'El puerto va en su propio campo, no detrás del host.',
      hostLargo: 'El host es demasiado largo.',
      hostCaracteres: 'El host solo puede llevar letras sin tilde, números, puntos, guiones y «:» (en una dirección IPv6).',
      usuarioFalta: 'Falta el usuario.',
      usuarioEspacios: 'El usuario no puede llevar espacios.',
      usuarioGuion: 'El usuario no puede empezar por «-».',
      usuarioDolar: 'El usuario no puede llevar «${».',
      usuarioPorciento: 'El usuario no puede llevar «%».',
      usuarioControl: 'El usuario no puede llevar caracteres de control.',
      usuarioLargo: 'El usuario es demasiado largo.',
      puerto: 'El puerto debe ser un entero entre 1 y 65535.',
      aliasFalta: 'La conexión necesita un nombre.',
      aliasLargo: (max: number) => `El nombre no puede superar los ${max} caracteres.`,
      aliasDosPuntos: 'El nombre de la conexión no puede llevar «:».',
      aliasOcupado: (nombre: string) => `Este perfil ya tiene una conexión llamada «${nombre}».`,
      faltaClave: 'Seleccione el archivo de la clave privada.',
      secretoTexto: 'La contraseña debe ser un texto.',
      secretoSistema: 'Con «Claves del sistema» no se guarda ninguna contraseña.',
      queClave: 'La frase de la clave',
      quePassword: 'La contraseña',
      secretoSaltos: (que: string) => `${que} no puede llevar saltos de línea ni el carácter nulo.`,
      secretoBytes: (que: string, max: number) => `${que} no puede superar los ${max} bytes.`,
      tunelForma: 'Un túnel no tiene la forma esperada.',
      tunelTipo: (tipo: string) => `Tipo de túnel desconocido: «${tipo}».`,
      tunelPuerto: 'El puerto de un túnel debe ser un entero entre 1 y 65535.',
      tunelDinamico: 'Un túnel dinámico (SOCKS) no lleva destino.',
      tunelDestino: (host: string) => `En el destino de un túnel: ${host}`,
      tunelPuertoDestino: 'El puerto de destino de un túnel debe ser un entero entre 1 y 65535.',
      tunelesLista: 'Los túneles deben ser una lista.',
      tunelesMax: (max: number) => `Una conexión no puede tener más de ${max} túneles.`,
      tunelRemotoRepetido: (p: number) => `Dos túneles remotos usan el puerto ${p} del servidor.`,
      tunelRepetido: (p: number) => `Dos túneles usan el puerto ${p} de este equipo.`,
      saltoTipo: 'El bastión debe ser una conexión.',
      saltoMismo: 'Una conexión no puede usarse a sí misma como bastión.',
      saltoNoExiste: 'La conexión elegida como bastión ya no existe en este perfil.',
      saltosMax: (max: number) => `No se pueden encadenar más de ${max} bastiones.`,
      saltoCirculo: (alias: string) => `El bastión «${alias}» acaba pasando por esta misma conexión: se formaría un ciclo.`,
      saltoHueco: (alias: string) => `El bastión «${alias}» pasa por una conexión que ya no existe: edítelo primero.`,
      sinPerfil: 'Una conexión requiere un perfil.',
      metodoDesconocido: (m: string) => `Método de autenticación desconocido: «${m}».`,
      grupoNoExiste: 'Ese grupo ya no existe en este perfil.',
      grupoSinPerfil: 'Un grupo requiere un perfil.',
      grupoSinNombre: 'El grupo necesita un nombre.',
      grupoLargo: (max: number) => `El nombre del grupo no puede superar los ${max} caracteres.`,
      grupoOcupado: (nombre: string) => `Este perfil ya tiene un grupo llamado «${nombre}».`
    },
    registro: {
      idNoValido: 'El id de la conexión no es válido.',
      sinAlmacen: (que: string, almacen: string) =>
        `No se puede guardar ${que}: ${almacen} no está disponible. Tessera nunca la guarda en claro.`,
      fraseClave: 'la frase de la clave',
      contrasena: 'la contraseña',
      noExiste: 'Esa conexión ya no existe.',
      noExisteSsh: 'Esa conexión SSH ya no existe.',
      noEsDelPerfil: 'Esa conexión SSH no es de este perfil.',
      huellaNoOlvidada: (codigo: string) => `No se pudo olvidar la huella guardada (${codigo}).`,
      huellaNoGuardada: (codigo: string) => `No se pudo guardar la huella del servidor (${codigo}).`,
      huellaCaducada: 'La comprobación de la huella caducó o ya se usó: vuelva a conectar para comprobarla otra vez.',
      huellaConexionCambio: 'La conexión cambió mientras se comprobaba la huella: vuelva a conectar para comprobarla otra vez.',
      sinReconocer: 'Esta ventana de Tessera no puede comprobar la huella de un servidor SSH.',
      sinId: 'No se pudo asignar un id a la conexión: inténtelo de nuevo.',
      sinIdCopia: 'No se pudo asignar un id a la copia: inténtelo de nuevo.',
      cambiarPerfil: 'Una conexión no puede cambiar de perfil.',
      formaInvalida: (alias: string) => `La conexión «${alias}» no tiene una forma válida.`,
      grupoNoExiste: 'Ese grupo ya no existe en este perfil.',
      grupoNoExisteSolo: 'Ese grupo ya no existe.',
      datoMalo: (alias: string, error: string) => `La conexión «${alias}» tiene un dato no válido: ${error} Edítela para corregirlo.`,
      tunelMalo: (alias: string, error: string) => `La conexión «${alias}» tiene un túnel no válido: ${error} Edítela para corregirlo.`,
      sinClaves: 'Esta ventana de Tessera no puede importar archivos de clave.',
      sinImportar: 'Esta ventana de Tessera no puede importar conexiones de OpenSSH.',
      sinExportar: 'Esta ventana de Tessera no puede exportar conexiones a OpenSSH.',
      sinBastion: 'Esta ventana de Tessera no puede conectar a través de un bastión.',
      sinProbar: 'Esta ventana de Tessera no puede probar conexiones SSH.',
      sinHuella: (alias: string) =>
        `La huella del servidor SSH de «${alias}» no está confirmada: haga clic en «Probar» en esa conexión SSH ` +
        '(o conéctese una vez desde la terminal) y vuelva a intentarlo.',
      sinCopiaClave:
        'Esta conexión usa un archivo de clave y no se encuentra la copia que guardó Tessera: edite la conexión y vuelva a seleccionar el archivo.'
    },
    saltos: {
      bastionNoExiste: (alias: string) => `El bastión de «${alias}» ya no existe en este perfil: edite la conexión y seleccione otro.`,
      circulo: (alias: string) => `Los bastiones de «${alias}» forman un ciclo: edite la conexión y seleccione otro.`,
      demasiados: (alias: string, max: number) => `«${alias}» encadena más de ${max} bastiones.`,
      datoMalo: (alias: string, dato: string) => `El bastión «${alias}» tiene un dato no válido: ${dato} Edítelo para corregirlo.`,
      sinCopiaClave: (alias: string) =>
        `El bastión «${alias}» usa un archivo de clave y falta la copia que guardó Tessera: edítelo y vuelva a seleccionar el archivo.`,
      noSePreparo: (codigo: string) => `No se pudo preparar la conexión a través del bastión (${codigo}).`
    },
    openssh: {
      noSeLeyo: 'No se pudo leer ese archivo como configuración de OpenSSH.',
      noSeEscribio: 'No se pudo escribir la exportación en esa carpeta.',
      sinConexiones: 'No hay conexiones que exportar.',
      tituloImportar: 'Seleccionar el archivo de configuración de OpenSSH',
      botonImportar: 'Importar',
      tituloExportar: 'Exportar las conexiones a OpenSSH',
      botonExportar: 'Exportar'
    },
    sftpDialogos: {
      tituloDescarga: 'Seleccionar el destino de la descarga',
      botonDescarga: 'Descargar aquí',
      tituloSubirCarpeta: 'Seleccionar la carpeta que desea subir',
      tituloSubirArchivos: 'Seleccionar los archivos que desea subir',
      botonSubir: 'Subir'
    },
    claves: {
      fichaCaducada: 'La selección de ese archivo de clave caducó (pasó demasiado tiempo o se reinició Tessera). Vuelva a seleccionarlo.',
      otroPerfil: 'Ese archivo de clave se seleccionó para otro perfil: vuelva a seleccionarlo.',
      sinProteger: 'No se pudo guardar una copia protegida de la clave: inténtelo de nuevo.',
      sinInstalar: 'No se pudo guardar la copia de la clave: inténtelo de nuevo.',
      tituloElegir: 'Seleccionar el archivo de la clave privada',
      botonElegir: 'Seleccionar…',
      noEsArchivo: 'Ese elemento no es un archivo del equipo.',
      copiaPerdida: (nombre: string) =>
        `No se encuentra la copia de la clave «${nombre}»: edite la conexión y vuelva a seleccionar el archivo.`,
      noSeImporto: (nombre: string, codigo: string) => `No se pudo importar «${nombre}» (${codigo}).`,
      errorInesperado: 'error inesperado',
      rechazo: {
        grande: (n: string) => `«${n}» es demasiado grande para ser una clave SSH.`,
        binario: (n: string) =>
          `«${n}» no es un archivo de texto, así que no es una clave SSH. Si es un almacén .pfx o .p12, exporte de él la clave privada en formato PEM.`,
        publica: (n: string) => `«${n}» es la clave pública: seleccione la privada (suele llamarse igual, sin «.pub»).`,
        putty: (n: string) =>
          `«${n}» es una clave de PuTTY: conviértala a formato OpenSSH con PuTTYgen (Conversions › Export OpenSSH key).`,
        ssh2: (n: string) => `«${n}» está en el formato SSH2: conviértala a formato OpenSSH con «ssh-keygen -i -f "${n}"».`,
        certificado: (n: string) => `«${n}» es un certificado, no una clave privada: seleccione el archivo de la clave.`,
        dsa: (n: string) => `«${n}» es una clave DSA, que OpenSSH ya no admite: cree otra (por ejemplo, con «ssh-keygen -t ed25519»).`,
        pgp: (n: string) => `«${n}» es una clave PGP, no una clave SSH.`,
        danada: (n: string) => `«${n}» parece una clave SSH, pero está incompleta o dañada.`,
        desconocida: (n: string) => `«${n}» no parece una clave SSH privada.`
      },
      keygenAgotado: 'no respondió a tiempo',
      keygenDesconocido: 'error desconocido',
      malosPermisos: (nombre: string) =>
        `No se pudo dejar la copia de «${nombre}» accesible solo para el usuario actual: ssh no la acepta (bad permissions).`,
      pistaPkcs8: ' Si es Ed25519, guárdela en el formato propio de OpenSSH: en PKCS#8 no la puede leer.',
      noLegible: (nombre: string, motivo: string, pista: string) =>
        `El cliente OpenSSH de este equipo no puede leer «${nombre}» (ssh-keygen: ${motivo}).${pista}`,
      claveSinNombre: 'clave',
      lecturaNoEsta: (n: string) => `«${n}» ya no está donde se seleccionó.`,
      lecturaCarpeta: (n: string) => `«${n}» es una carpeta: seleccione el archivo de la clave.`,
      lecturaFallo: (n: string, codigo: string) => `No se pudo leer «${n}» (${codigo}).`,
      permisosMac: (sistema: string, n: string) =>
        `${sistema} no permite a Tessera leer «${n}». Selecciónela con «Seleccionar…» o dé acceso a Tessera en Ajustes del Sistema › Privacidad y seguridad.`,
      permisosOtra: (sistema: string, n: string) =>
        `${sistema} no permite a Tessera leer «${n}»: compruebe que el usuario actual puede abrirla, o cópiela a otra carpeta y selecciónela desde allí.`
    },
    askpass: {
      fraseGuardada: 'La frase guardada de la clave',
      passwordGuardada: 'La contraseña guardada',
      delBastion: (alias: string) => ` del bastión «${alias}»`,
      noSeUsa: (nombre: string, porque: string) => `${nombre} no se usa: ${porque}`,
      noLegible: (almacen: string) =>
        `no se puede leer con ${almacen}. Escríbala cuando se solicite y vuelva a guardarla editando la conexión.`,
      noContesta: 'el servidor solicitó un dato que Tessera no puede responder. Escriba las respuestas en la terminal.',
      escribela: (motivo: string) => `${motivo} Escríbala cuando se solicite.`,
      sinPuente: 'el puente local de Tessera no está disponible.',
      sinPrograma: 'falta el programa con el que Tessera proporciona la contraseña.',
      preguntaFrase: 'Frase de la clave',
      preguntaPassword: (usuario: string, host: string) => `Contraseña de ${usuario}@${host}`
    },
    sftp: {
      sinPermisoLocal: 'Este equipo no permite leer ni escribir en esa ubicación.',
      yaNoExisteLocal: 'El elemento que se iba a copiar en este equipo ya no existe.',
      sinEspacio: 'No queda espacio disponible en el disco de este equipo.',
      fallo: 'La operación falló.',
      huellaCambiada:
        'La huella del servidor no coincide con la confirmada: alguien podría estar suplantándolo. Compruébelo antes de continuar.',
      huellaSinConfirmar:
        'El servidor presenta una clave cuya huella no está confirmada. Si la conexión ya tenía una huella guardada, el servidor ofrece ahora otro tipo de clave: compruébela antes de olvidar la guardada.',
      autenticacion:
        'El servidor rechazó la autenticación (o se canceló la pregunta). Vuelva a abrir el explorador y escriba la contraseña, o guárdela en la conexión.',
      inalcanzable: 'No se pudo conectar con el servidor. Compruebe la VPN, la red y el puerto.',
      algoritmos: 'El servidor no admite los algoritmos de este cliente SSH.',
      sinSftp: 'El servidor no tiene SFTP activado.',
      noSeAbrio: 'No se pudo abrir la sesión SFTP.',
      conexionPerdida: 'Se perdió la conexión con el servidor.',
      explorador: 'Se cerró el explorador.',
      sesionCerrada: 'La sesión SFTP no está abierta: vuelva a conectarla.',
      yaExiste: (n: string) => `Ya existe «${n}».`,
      nombreLocal: (n: string) => `«${n}» no se puede guardar en este equipo con ese nombre.`,
      copiaCaducada: 'Esa copia ya no está pendiente: vuelva a iniciarla.',
      carpetaNoVale: 'Ese nombre de carpeta no es válido.',
      nombreNoVale: 'Ese nombre no es válido.',
      nadaQueBorrar: 'No hay nada que eliminar.',
      nadaQueDescargar: 'No hay nada que descargar.',
      destinoNoVale: 'La carpeta de destino no es válida.',
      soltadoNoVale: 'Los elementos soltados no son archivos ni carpetas de este equipo.',
      existeServidor: (n: string) => `«${n}» ya existe en el servidor.`,
      carpetaServidor: (n: string) => `«${n}» es una carpeta en el servidor.`,
      noEsCarpeta: (n: string) => `«${n}» existe en el servidor y no es una carpeta.`,
      comillas: (ruta: string) => `«${ruta}»`,
      noExiste: (sobre: string) => `No existe${sobre}.`,
      sinPermiso: (sobre: string) => `El servidor no concede permiso sobre${sobre || ' ese elemento'}.`,
      noAdmitido: 'El servidor no admite esta operación.',
      noPudo: (sobre: string, detalle: string) => `El servidor no pudo realizar la operación${sobre}${detalle}.`,
      noContestoAbrir: 'El servidor no respondió al abrir SFTP.',
      noHablaSftp: 'El servidor no admite el protocolo SFTP.',
      noContesto: 'El servidor no respondió a tiempo.',
      inesperado: 'El servidor envió una respuesta inesperada.',
      noExisteRuta: (ruta: string) => `No existe «${ruta}».`,
      noSeAbrioRuta: (ruta: string) => `No se pudo abrir «${ruta}».`
    },
    binarios: {
      windows:
        'No se encontró el cliente SSH del sistema (OpenSSH). Instale «Cliente OpenSSH» desde las ' +
        'características opcionales del sistema y vuelva a intentarlo.',
      linux:
        'No se encontró el cliente SSH del sistema en /usr/bin/ssh. Instale el paquete del cliente ' +
        'OpenSSH de su distribución (openssh-client u openssh-clients) y vuelva a intentarlo.',
      otra: 'No se encontró el cliente SSH del sistema en /usr/bin/ssh.'
    },
    prueba: {
      noSeLanzo: 'No se pudo ejecutar ssh.',
      salio: (codigo: number) => `ssh terminó con el código ${codigo}.`
    }
  },
  {
    validacion: {
      hostFalta: 'The host is missing.',
      hostEspacios: 'The host cannot contain spaces.',
      hostGuion: 'The host cannot start with “-”.',
      hostArroba: 'Enter the host without the user: the user goes in its own field.',
      hostBarra: 'The host cannot contain “/”: enter just the name or the address.',
      hostDolar: 'The host cannot contain “${”.',
      hostPorciento: 'The host cannot contain “%”.',
      hostCorchetes: 'Enter the IPv6 address without brackets: the port goes in its own field.',
      hostPuerto: 'The port goes in its own field, not after the host.',
      hostLargo: 'The host is too long.',
      hostCaracteres: 'The host can only contain unaccented letters, numbers, dots, hyphens and “:” (in an IPv6 address).',
      usuarioFalta: 'The user is missing.',
      usuarioEspacios: 'The user cannot contain spaces.',
      usuarioGuion: 'The user cannot start with “-”.',
      usuarioDolar: 'The user cannot contain “${”.',
      usuarioPorciento: 'The user cannot contain “%”.',
      usuarioControl: 'The user cannot contain control characters.',
      usuarioLargo: 'The user is too long.',
      puerto: 'The port must be an integer between 1 and 65535.',
      aliasFalta: 'The connection needs a name.',
      aliasLargo: (max: number) => `The name cannot be longer than ${max} characters.`,
      aliasDosPuntos: 'The connection name cannot contain “:”.',
      aliasOcupado: (nombre: string) => `This profile already has a connection named “${nombre}”.`,
      faltaClave: 'Choose the private key file.',
      secretoTexto: 'The password must be text.',
      secretoSistema: 'No password is saved with “System keys”.',
      queClave: 'The key passphrase',
      quePassword: 'The password',
      secretoSaltos: (que: string) => `${que} cannot contain line breaks or the null character.`,
      secretoBytes: (que: string, max: number) => `${que} cannot be longer than ${max} bytes.`,
      tunelForma: 'A tunnel does not have the expected format.',
      tunelTipo: (tipo: string) => `Unknown tunnel type: “${tipo}”.`,
      tunelPuerto: 'A tunnel port must be an integer between 1 and 65535.',
      tunelDinamico: 'A dynamic (SOCKS) tunnel has no destination.',
      tunelDestino: (host: string) => `In a tunnel destination: ${host}`,
      tunelPuertoDestino: 'A tunnel destination port must be an integer between 1 and 65535.',
      tunelesLista: 'Tunnels must be a list.',
      tunelesMax: (max: number) => `A connection cannot have more than ${max} tunnels.`,
      tunelRemotoRepetido: (p: number) => `Two remote tunnels use port ${p} on the server.`,
      tunelRepetido: (p: number) => `Two tunnels use port ${p} on this computer.`,
      saltoTipo: 'The bastion must be a connection.',
      saltoMismo: 'A connection cannot jump through itself.',
      saltoNoExiste: 'The connection chosen as bastion no longer exists in this profile.',
      saltosMax: (max: number) => `You cannot chain more than ${max} bastions.`,
      saltoCirculo: (alias: string) => `Bastion “${alias}” eventually jumps through this same connection, which would create a loop.`,
      saltoHueco: (alias: string) => `Bastion “${alias}” jumps through a connection that no longer exists: edit it first.`,
      sinPerfil: 'A connection requires a profile.',
      metodoDesconocido: (m: string) => `Unknown authentication method: “${m}”.`,
      grupoNoExiste: 'That group no longer exists in this profile.',
      grupoSinPerfil: 'A group requires a profile.',
      grupoSinNombre: 'The group needs a name.',
      grupoLargo: (max: number) => `The group name cannot be longer than ${max} characters.`,
      grupoOcupado: (nombre: string) => `This profile already has a group named “${nombre}”.`
    },
    registro: {
      idNoValido: 'The connection id is not valid.',
      sinAlmacen: (que: string, almacen: string) =>
        `Cannot save ${que}: ${almacen} is not available. Tessera never saves it in plain text.`,
      fraseClave: 'the key passphrase',
      contrasena: 'the password',
      noExiste: 'That connection no longer exists.',
      noExisteSsh: 'That SSH connection no longer exists.',
      noEsDelPerfil: 'That SSH connection does not belong to this profile.',
      huellaNoOlvidada: (codigo: string) => `Could not forget the saved fingerprint (${codigo}).`,
      huellaNoGuardada: (codigo: string) => `Could not save the server fingerprint (${codigo}).`,
      huellaCaducada: 'The fingerprint check expired or was already used: connect again to check it once more.',
      huellaConexionCambio: 'The connection changed while its fingerprint was being checked: connect again to check it once more.',
      sinReconocer: 'This Tessera window cannot check the fingerprint of an SSH server.',
      sinId: 'Could not assign an id to the connection: try again.',
      sinIdCopia: 'Could not assign an id to the copy: try again.',
      cambiarPerfil: 'A connection cannot change profile.',
      formaInvalida: (alias: string) => `Connection “${alias}” does not have a valid format.`,
      grupoNoExiste: 'That group no longer exists in this profile.',
      grupoNoExisteSolo: 'That group no longer exists.',
      datoMalo: (alias: string, error: string) => `Connection “${alias}” has an invalid value: ${error} Edit it to fix it.`,
      tunelMalo: (alias: string, error: string) => `Connection “${alias}” has an invalid tunnel: ${error} Edit it to fix it.`,
      sinClaves: 'This Tessera window cannot import key files.',
      sinImportar: 'This Tessera window cannot import OpenSSH connections.',
      sinExportar: 'This Tessera window cannot export connections to OpenSSH.',
      sinBastion: 'This Tessera window cannot jump through a bastion.',
      sinProbar: 'This Tessera window cannot test SSH connections.',
      sinHuella: (alias: string) =>
        `The fingerprint of the SSH server for “${alias}” is not confirmed: click “Test” on that SSH connection ` +
        '(or connect once from the terminal) and try again.',
      sinCopiaClave:
        'This connection uses a key file and the copy Tessera saved cannot be found: edit it and choose the file again.'
    },
    saltos: {
      bastionNoExiste: (alias: string) => `The bastion of “${alias}” no longer exists in this profile: edit the connection and choose another.`,
      circulo: (alias: string) => `The bastions of “${alias}” form a loop: edit the connection and choose another.`,
      demasiados: (alias: string, max: number) => `“${alias}” chains more than ${max} bastions.`,
      datoMalo: (alias: string, dato: string) => `Bastion “${alias}” has an invalid value: ${dato} Edit it to fix it.`,
      sinCopiaClave: (alias: string) =>
        `Bastion “${alias}” uses a key file and the copy Tessera saved is missing: edit it and choose the file again.`,
      noSePreparo: (codigo: string) => `Could not prepare the jump through the bastion (${codigo}).`
    },
    openssh: {
      noSeLeyo: 'That file could not be read as an OpenSSH configuration.',
      noSeEscribio: 'The export could not be written to that folder.',
      sinConexiones: 'There are no connections to export.',
      tituloImportar: 'Choose the OpenSSH configuration file',
      botonImportar: 'Import',
      tituloExportar: 'Export the connections to OpenSSH',
      botonExportar: 'Export'
    },
    sftpDialogos: {
      tituloDescarga: 'Choose where to download',
      botonDescarga: 'Download here',
      tituloSubirCarpeta: 'Choose the folder to upload',
      tituloSubirArchivos: 'Choose the files to upload',
      botonSubir: 'Upload'
    },
    claves: {
      fichaCaducada: 'That key file is no longer selected (too much time has passed or Tessera was restarted). Choose it again.',
      otroPerfil: 'That key file was chosen for another profile: choose it again.',
      sinProteger: 'A protected copy of the key could not be saved: try again.',
      sinInstalar: 'The copy of the key could not be saved: try again.',
      tituloElegir: 'Choose the private key file',
      botonElegir: 'Choose…',
      noEsArchivo: 'That item is not a file on this computer.',
      copiaPerdida: (nombre: string) =>
        `The copy of key “${nombre}” cannot be found: edit the connection and choose the file again.`,
      noSeImporto: (nombre: string, codigo: string) => `Could not import “${nombre}” (${codigo}).`,
      errorInesperado: 'unexpected error',
      rechazo: {
        grande: (n: string) => `“${n}” is too large to be an SSH key.`,
        binario: (n: string) =>
          `“${n}” is not a text file, so it is not an SSH key. If it is a .pfx or .p12 store, export the private key from it in PEM format.`,
        publica: (n: string) => `“${n}” is the public key; choose the private one (usually named the same, without “.pub”).`,
        putty: (n: string) =>
          `“${n}” is a PuTTY key: convert it to OpenSSH format with PuTTYgen: Conversions › Export OpenSSH key.`,
        ssh2: (n: string) => `“${n}” is in SSH2 format: convert it to OpenSSH format with “ssh-keygen -i -f "${n}"”.`,
        certificado: (n: string) => `“${n}” is a certificate, not a private key: choose the key file.`,
        dsa: (n: string) => `“${n}” is a DSA key, which OpenSSH no longer supports: create another one (for example, with “ssh-keygen -t ed25519”).`,
        pgp: (n: string) => `“${n}” is a PGP key, not an SSH key.`,
        danada: (n: string) => `“${n}” looks like an SSH key, but it is incomplete or damaged.`,
        desconocida: (n: string) => `“${n}” does not look like a private SSH key.`
      },
      keygenAgotado: 'did not respond in time',
      keygenDesconocido: 'unknown error',
      malosPermisos: (nombre: string) =>
        `Could not restrict the copy of “${nombre}” to your user only: ssh does not accept it (incorrect permissions).`,
      pistaPkcs8: ' If it is an Ed25519 key, save it in OpenSSH format: OpenSSH cannot read it in PKCS#8.',
      noLegible: (nombre: string, motivo: string, pista: string) =>
        `This computer’s OpenSSH client cannot read “${nombre}” (ssh-keygen: ${motivo}).${pista}`,
      claveSinNombre: 'key',
      lecturaNoEsta: (n: string) => `“${n}” is no longer where you chose it.`,
      lecturaCarpeta: (n: string) => `“${n}” is a folder: choose the key file.`,
      lecturaFallo: (n: string, codigo: string) => `Could not read “${n}” (${codigo}).`,
      permisosMac: (sistema: string, n: string) =>
        `${sistema} does not let Tessera read “${n}”. Choose it with “Choose…” or give Tessera access in System Settings › Privacy & Security.`,
      permisosOtra: (sistema: string, n: string) =>
        `${sistema} does not let Tessera read “${n}”: check that your user can open it, or copy it to another folder and choose it from there.`
    },
    askpass: {
      fraseGuardada: 'The saved key passphrase',
      passwordGuardada: 'The saved password',
      delBastion: (alias: string) => ` of bastion “${alias}”`,
      noSeUsa: (nombre: string, porque: string) => `${nombre} is not used: ${porque}`,
      noLegible: (almacen: string) =>
        `it cannot be read with ${almacen}. Type it when prompted, then edit the connection to save it again.`,
      noContesta: 'the server asked for something Tessera cannot answer. Type the answers yourself in the terminal.',
      escribela: (motivo: string) => `${motivo} Type it when prompted.`,
      sinPuente: 'the local Tessera bridge is not available.',
      sinPrograma: 'the program Tessera uses to supply it is missing.',
      preguntaFrase: 'Key passphrase',
      preguntaPassword: (usuario: string, host: string) => `Password for ${usuario}@${host}`
    },
    sftp: {
      sinPermisoLocal: 'This computer does not allow writing or reading there.',
      yaNoExisteLocal: 'The item to copy no longer exists on this computer.',
      sinEspacio: 'There is no space left on this computer’s disk.',
      fallo: 'The operation failed.',
      huellaCambiada:
        'The server fingerprint does not match the one you confirmed: someone might be impersonating the server. Verify it before continuing.',
      huellaSinConfirmar:
        'The server presents a key whose fingerprint is not confirmed. If the connection already had a saved fingerprint, the server now offers another key type: verify it before forgetting the saved one.',
      autenticacion:
        'The server rejected the authentication (or the prompt was canceled). Open the explorer again and type the password, or save it in the connection.',
      inalcanzable: 'Could not reach the server (VPN, network or port?).',
      algoritmos: 'The server does not support this SSH client’s algorithms.',
      sinSftp: 'The server does not have SFTP enabled.',
      noSeAbrio: 'Could not open the SFTP session.',
      conexionPerdida: 'The connection to the server was lost.',
      explorador: 'The explorer was closed.',
      sesionCerrada: 'The SFTP session is not open: reconnect it.',
      yaExiste: (n: string) => `“${n}” already exists.`,
      nombreLocal: (n: string) => `“${n}” cannot be saved on this computer with that name.`,
      copiaCaducada: 'That copy is no longer pending: start it again.',
      carpetaNoVale: 'That folder name is not valid.',
      nombreNoVale: 'That name is not valid.',
      nadaQueBorrar: 'Nothing to delete.',
      nadaQueDescargar: 'Nothing to download.',
      destinoNoVale: 'The destination folder is not valid.',
      soltadoNoVale: 'The dropped items are not files or folders on this computer.',
      existeServidor: (n: string) => `“${n}” already exists on the server.`,
      carpetaServidor: (n: string) => `“${n}” is a folder on the server.`,
      noEsCarpeta: (n: string) => `“${n}” exists on the server and is not a folder.`,
      comillas: (ruta: string) => `“${ruta}”`,
      noExiste: (sobre: string) => `${sobre ? sobre.trim() : 'It'} does not exist.`,
      sinPermiso: (sobre: string) => `The server denies access to${sobre || ' that'}.`,
      noAdmitido: 'The server does not support this operation.',
      noPudo: (sobre: string, detalle: string) =>
        `The server could not complete the operation${sobre ? ` on${sobre}` : ''}${detalle}.`,
      noContestoAbrir: 'The server did not respond when opening SFTP.',
      noHablaSftp: 'The server does not speak SFTP.',
      noContesto: 'The server did not respond in time.',
      inesperado: 'The server replied with something unexpected.',
      noExisteRuta: (ruta: string) => `“${ruta}” does not exist.`,
      noSeAbrioRuta: (ruta: string) => `Could not open “${ruta}”.`
    },
    binarios: {
      windows:
        'The system SSH client (OpenSSH) was not found. Install “OpenSSH Client” from the ' +
        'optional features of the system and try again.',
      linux:
        'The system SSH client was not found at /usr/bin/ssh. Install your distribution’s ' +
        'OpenSSH client package (openssh-client or openssh-clients) and try again.',
      otra: 'The system SSH client was not found at /usr/bin/ssh.'
    },
    prueba: {
      noSeLanzo: 'Could not launch ssh.',
      salio: (codigo: number) => `ssh exited with code ${codigo}.`
    }
  }
)
