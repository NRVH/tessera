// =============================================================================
// Textos de los errores al leer una URI de conexión, sus opciones y la topología de Redis: lo que
// se ve en el formulario cuando se pega o se teclea algo que no vale. Español e inglés juntos; se
// leen al usarse. Solo depende de i18n (lo usan el main, el renderer y los `test-*.mts`).
// =============================================================================
import { crearTextos } from './i18n.ts'

export const txUri = crearTextos(
  {
    opciones: {
      faltaClave: (trozo: string) => `Falta la clave en "${trozo}" (clave=valor).`,
      sinValor: (clave: string) => `La opción "${clave}" no lleva valor (clave=valor).`,
      cifrado: (clave: string) => `El cifrado no va en las opciones ("${clave}"): utilice las casillas de TLS de la conexión.`,
      credenciales: (clave: string) => `Usuario y contraseña van en sus campos, no en las opciones ("${clave}").`,
      noAdmitida: (clave: string, admitidas: string) => `"${clave}" no es una opción admitida. Se admiten: ${admitidas}.`,
      repetida: (clave: string) => `La opción "${clave}" está repetida.`,
      porcientoValor: (clave: string) =>
        `El valor de "${clave}" contiene un % que no forma parte de un carácter codificado: escríbalo como %25.`,
      booleana: (clave: string) => `"${clave}" vale true o false.`,
      entera: (clave: string) => `"${clave}" es un número entero.`,
      sinInterrogacion: 'Sin el "?" del principio: solo clave=valor&clave=valor.',
      sinEspacios: 'Las opciones no llevan espacios ni "#".',
      authSource: 'La base de autenticación (authSource) va en su campo, no en las opciones.',
      tlsContradice: 'tls y ssl dicen cosas distintas en la URI.',
      srvDirecta: 'Una URI mongodb+srv no admite directConnection=true.',
      variosHosts: 'Con varios hosts no son válidas las opciones directConnection=true ni loadBalanced=true: quítelas o deje un solo host.',
      sslModeMysql: (valor: string, admitidos: string) => `ssl-mode "${valor}" no es válido. Se admiten: ${admitidos}.`,
      boolMysql: (clave: string) => `${clave} tiene que ser true o false.`,
      sslModePostgres: (modo: string, admitidos: string) => `sslmode "${modo}" no es válido. Se admiten: ${admitidos}.`
    },
    uri: {
      porcientoUsuario: 'El usuario contiene un % que no forma parte de un carácter codificado: escríbalo como %25.',
      porcientoPassword: 'La contraseña contiene un % que no forma parte de un carácter codificado: escríbalo como %25.',
      faltaHost: 'Falta el host de la URI.',
      empezarPor: (esperados: string) => `La URI debe empezar por ${esperados}.`,
      oSeparador: ' o ',
      porcientoBase: 'La base de datos contiene un % que no forma parte de un carácter codificado.',
      faltaCorchete: (crudo: string) => `Falta el "]" de la dirección IPv6 "${crudo}".`,
      sobra: (tras: string) => `Sobra "${tras}" detrás de la dirección IPv6.`,
      hostInvalido: (crudo: string) => `El host "${crudo}" no es válido.`,
      socketLocal: 'Tessera no se conecta por un socket local: indique un host y un puerto.',
      puertoInvalido: (puerto: string) => `El puerto "${puerto}" no es válido (1-65535).`,
      srvUnHost: 'Una URI mongodb+srv lleva un solo nombre de host.',
      srvSinPuerto: 'Una URI mongodb+srv no lleva puerto: lo dan los registros DNS del host.',
      variosHostsServidor: 'La URI contiene varios hosts, pero la conexión es a un único servidor: indique solo el host de ese servidor.',
      variosHostsRedis:
        'La URI contiene varios hosts, pero la conexión es a un único servidor: para Sentinel o Cluster, seleccione el modo en "Conexión a" y escriba los servidores en Host, separados por comas.',
      rutaBaseRedis: (invalida: string) => `En la ruta de la URI va el número de la base (/0, /1…). ${invalida}`
    },
    redis: {
      base: (max: number, v: string) => `La base de datos es un número entero de 0 a ${max} (si se deja vacía, es la 0): "${v}" no lo es.`,
      servidorInvalido: (texto: string) => `"${texto}" no es un servidor válido (host o host:puerto).`,
      puertoServidor: (texto: string) => `El puerto de "${texto}" no es válido: debe ser un número de 1 a 65535.`,
      demasiados: (max: number) => `Hay más de ${max} servidores: bastan unos pocos, porque el resto se descubre automáticamente.`,
      topologiaInvalida: 'La topología (Sentinel o Cluster) no es válida.',
      sinTunel: (nombre: string) =>
        `${nombre} no va por túnel SSH: el cliente se conecta a servidores a los que el túnel no da acceso. Quite el túnel o seleccione "Un servidor".`,
      clusterBase: 'En Cluster solo existe la base de datos 0: deje el campo vacío.',
      maestro: 'El nombre del maestro no es válido (no puede contener espacios).',
      faltaServidor: 'Falta al menos un servidor.',
      variosServidores: 'Hay varios servidores: seleccione Sentinel o Cluster, o deje uno solo.',
      faltaMaestro: 'Falta el nombre del maestro que supervisan los sentinels.',
      secretoIlegible:
        'La contraseña guardada no se puede leer en este equipo: vuelva a escribir la contraseña (y la de los sentinels, si la tienen) para cambiar cómo se conecta.'
    }
  },
  {
    opciones: {
      faltaClave: (trozo: string) => `The key is missing in "${trozo}" (key=value).`,
      sinValor: (clave: string) => `The option "${clave}" has no value (key=value).`,
      cifrado: (clave: string) => `Encryption is not set in the options ("${clave}"): use the connection’s TLS check boxes.`,
      credenciales: (clave: string) => `User and password go in their own fields, not in the options ("${clave}").`,
      noAdmitida: (clave: string, admitidas: string) => `"${clave}" is not a supported option. Supported: ${admitidas}.`,
      repetida: (clave: string) => `The option "${clave}" is repeated.`,
      porcientoValor: (clave: string) =>
        `The value of "${clave}" has a % that is not part of an encoded character: write it as %25.`,
      booleana: (clave: string) => `"${clave}" must be true or false.`,
      entera: (clave: string) => `"${clave}" must be an integer.`,
      sinInterrogacion: 'Omit the leading "?": use only key=value&key=value.',
      sinEspacios: 'Options cannot contain spaces or "#".',
      authSource: 'The authentication database (authSource) goes in its own field, not in the options.',
      tlsContradice: 'tls and ssl have conflicting values in the URI.',
      srvDirecta: 'A mongodb+srv URI does not support directConnection=true.',
      variosHosts: 'With several hosts, directConnection=true and loadBalanced=true are not valid: remove them or keep a single host.',
      sslModeMysql: (valor: string, admitidos: string) => `ssl-mode "${valor}" is not valid. Supported: ${admitidos}.`,
      boolMysql: (clave: string) => `${clave} must be true or false.`,
      sslModePostgres: (modo: string, admitidos: string) => `sslmode "${modo}" is not valid. Supported: ${admitidos}.`
    },
    uri: {
      porcientoUsuario: 'The user has a % that is not part of an encoded character: write it as %25.',
      porcientoPassword: 'The password has a % that is not part of an encoded character: write it as %25.',
      faltaHost: 'The URI is missing the host.',
      empezarPor: (esperados: string) => `The URI must start with ${esperados}.`,
      oSeparador: ' or ',
      porcientoBase: 'The database has a % that is not part of an encoded character.',
      faltaCorchete: (crudo: string) => `The "]" of the IPv6 address "${crudo}" is missing.`,
      sobra: (tras: string) => `There is an extra "${tras}" after the IPv6 address.`,
      hostInvalido: (crudo: string) => `The host "${crudo}" is not valid.`,
      socketLocal: 'Tessera does not connect through a local socket: enter a host and a port.',
      puertoInvalido: (puerto: string) => `The port "${puerto}" is not valid (1-65535).`,
      srvUnHost: 'A mongodb+srv URI has a single host name.',
      srvSinPuerto: 'A mongodb+srv URI has no port: the host’s DNS records provide it.',
      variosHostsServidor: 'The URI has several hosts, but this connection is to a single server: enter only that server’s host.',
      variosHostsRedis:
        'The URI has several hosts, but this connection is to a single server: for Sentinel or Cluster, choose the mode in "Connect to" and enter the servers in Host, separated by commas.',
      rutaBaseRedis: (invalida: string) => `The URI path holds the database number (/0, /1…). ${invalida}`
    },
    redis: {
      base: (max: number, v: string) => `The database is an integer from 0 to ${max} (empty means 0): "${v}" is not.`,
      servidorInvalido: (texto: string) => `"${texto}" is not a valid server (host or host:port).`,
      puertoServidor: (texto: string) => `The port of "${texto}" is not valid: it must be a number from 1 to 65535.`,
      demasiados: (max: number) => `That is more than ${max} servers: a few are enough, and the rest are discovered automatically.`,
      topologiaInvalida: 'The topology (Sentinel or Cluster) is not valid.',
      sinTunel: (nombre: string) =>
        `${nombre} cannot use an SSH tunnel: the client connects to servers the tunnel does not forward to. Remove the tunnel or choose "One server".`,
      clusterBase: 'Cluster only has database 0: leave the database empty.',
      maestro: 'The master name is not valid (no spaces).',
      faltaServidor: 'Enter at least one server.',
      variosServidores: 'There are several servers: choose Sentinel or Cluster, or keep just one.',
      faltaMaestro: 'Enter the name of the master that the sentinels monitor.',
      secretoIlegible:
        'The saved password cannot be read on this computer: type the password again (and the sentinels’, if they have one) to change how it connects.'
    }
  }
)
