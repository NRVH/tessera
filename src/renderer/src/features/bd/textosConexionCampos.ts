// =============================================================================
// Textos del formulario de conexión que salen de los módulos puros `camposConexion*`: la casilla de
// solo lectura y su ayuda por motor, el entorno, las etiquetas, los placeholders y las ayudas de cada
// campo por motor, los ejemplos de URI y la frase de los clientes. Español e inglés con las mismas
// claves; se leen al usarse, nunca al cargar el módulo. Sin JSX ni DOM.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txConexionCampos = crearTextos(
  {
    // --- solo lectura y entorno ---
    etiquetaSoloLectura: 'Solo lectura para los agentes (recomendado)',
    tituloSoloLecturaAgentes: 'Solo lectura para los agentes: tdb no escribe en esta conexión (tú sí puedes)',
    ayudaQuien:
      'Los agentes (Claude Code, Codex), que consultan por tdb, solo pueden leer esta conexión; tú no quedas ' +
      'limitado: desde el explorador editas, insertas, borras y confirmas como siempre. ',
    ayudaClasificador:
      'tdb rechaza sus escrituras y deshace lo que se cuele: aquí el solo lectura lo impone Tessera; para ' +
      'garantía, un usuario con db_datareader.',
    ayudaListaBlanca: (garantia: string) =>
      `tdb solo les deja pasar las operaciones de lectura: aquí el solo lectura lo impone Tessera; para garantía, ${garantia}.`,
    ayudaUsuarioClave:
      'tdb rechaza sus escrituras y el servidor abre sus transacciones en solo lectura. La garantía de ' +
      'verdad sigue siendo darles un usuario de base de datos con permisos de lectura.',
    ayudaArchivo:
      'tdb abre el archivo en solo lectura y rechaza sus escrituras. Mientras una transacción esté abierta, ' +
      'las demás aplicaciones que usan el archivo pueden no poder escribir en él.',
    garantiaDocumentos: 'un usuario con el rol read',
    garantiaClaves: 'un usuario ACL que solo pueda leer (+@read)',
    garantiaSql: 'un usuario con permisos de lectura',
    sinEntorno: 'Sin entorno',
    ayudaEntornoNinguno: 'Sin marcas ni confirmaciones.',
    ayudaEntornoDesarrollo: 'Marca verde en el árbol, en las pestañas de esta conexión y en la barra de sus consolas.',
    ayudaEntornoPruebas: 'Marca ámbar en el árbol, en las pestañas de esta conexión y en la barra de sus consolas.',
    ayudaEntornoProduccion:
      'Marca roja, y Tessera pide confirmación antes de cada escritura (DML, DDL, PL/SQL y COMMIT, y al enviar los cambios de la rejilla). Sus consolas nuevas arrancan en Tx Manual.',
    // --- presentación por motor ---
    host: 'Host',
    puerto: 'Puerto',
    baseDeDatos: 'Base de datos',
    autenticacionSql: (producto: string) => `Usuario de ${producto}`,
    autenticacionNtlm: 'Cuenta de dominio (NTLM)',
    ayudaInstancia:
      'Con instancia con nombre, el puerto no se usa: lo resuelve el servicio SQL Browser del servidor (UDP 1434). Sin ella, la instancia por defecto en el puerto.',
    confiarCertificado: 'Confiar en el certificado del servidor',
    ayudaCifrado:
      'El certificado se verifica contra las autoridades de confianza de tu equipo. Si el servidor usa uno propio (autofirmado), marca «Confiar en el certificado del servidor»: se cifra igual, pero sin comprobar quién es el servidor.',
    ayudaBaseDocumentos:
      'Sin base, el árbol enseña todas las que el usuario puede leer. Usuario y contraseña son opcionales: sin ellos se conecta sin autenticar.',
    ayudaBaseClaves:
      'La base con la que se abre la conexión (0 si va vacía); el árbol enseña todas. Usuario y contraseña son opcionales, y la contraseña vale sin usuario.',
    ayudaHostMongo:
      'Un servidor o, sin DNS SRV, los miembros de un replica set separados por comas (h1,h2:27018): el puerto vale para los que no llevan el suyo.',
    ayudaSrv:
      'Para Atlas y los clústeres que publican sus miembros en DNS: el host es el nombre del clúster, el puerto no se usa y la conexión se cifra salvo que desmarques el cifrado.',
    ayudaOpcionesUri:
      'Lo que iría detrás del «?» de la URI (clave=valor&clave=valor). El cifrado, las credenciales y la base de autenticación no: van en sus campos.',
    ayudaAuthSource:
      'Dónde se creó el usuario (authSource). Vacío: la base de datos de arriba, como mongosh. Un usuario de «admin» necesita «admin» aquí si escribes otra base.',
    uriMongoEjemplo: 'mongodb://usuario:clave@host:27017/base?authSource=admin',
    uriMongoAyuda: 'Rellena host, puerto, usuario, contraseña, base, SRV, cifrado y opciones. La URI no se guarda: solo sus campos.',
    uriRedisEjemplo: 'redis://usuario:clave@host:6379/0',
    uriRedisAyuda:
      'Rellena host, puerto, usuario, contraseña, base y cifrado (rediss:// cifra). La URI no se guarda: solo sus campos; lo de detrás del «?» se deja fuera.',
    uriPostgresEjemplo: 'postgres://usuario:clave@host:5432/base?sslmode=require',
    uriPostgresAyuda:
      'Rellena host, puerto, usuario, contraseña, base y cifrado (sslmode: require, prefer y allow cifran sin verificar el certificado; verify-ca y verify-full lo verifican; sin él o disable, sin cifrar). La URI no se guarda: solo sus campos; el resto de opciones se deja fuera.',
    uriMysqlEjemplo: 'mysql://usuario:clave@host:3306/base?ssl-mode=REQUIRED',
    uriMysqlAyuda:
      'Rellena host, puerto, usuario, contraseña, base y cifrado (ssl-mode: REQUIRED y PREFERRED cifran sin verificar el certificado; VERIFY_CA y VERIFY_IDENTITY lo verifican; sin él o DISABLED, sin cifrar). Vale también mariadb://. La URI no se guarda: solo sus campos; el resto de opciones se deja fuera.',
    ayudaBaseMysql: 'La base en la que abre la sesión. Sin ella, el árbol enseña igual todas las que el usuario puede ver.',
    opcional: 'opcional',
    ayudaCifradoOracle:
      'Conecta por TCPS: el puerto suele ser otro (2484, no 1521). El certificado se verifica siempre contra las autoridades de confianza de tu equipo; si el servidor usa uno propio, instala su autoridad en el sistema. No disponible con bases anteriores a 12.1.',
    cifrarTcps: 'Cifrar la conexión (TCPS)',
    cifrarSsl: 'Cifrar la conexión (SSL)',
    cifrarTls: 'Cifrar la conexión (TLS)',
    cifrar: 'Cifrar la conexión',
    ayudaServiceNameSid: 'Service Name o SID, no los dos. Las 11g heredadas suelen ir por SID.',
    phBaseOpcionalTodas: 'opcional: sin ella, todas',
    instancia: 'Instancia',
    autenticacion: 'Autenticación',
    dominio: 'Dominio',
    phDominio: 'EMPRESA',
    srvEtiqueta: 'DNS SRV (mongodb+srv)',
    baseAutenticacion: 'Base de autenticación',
    phAuthSource: 'opcional: admin',
    opcionesUri: 'Opciones de la URI',
    phOpcionesUri: 'opcional: replicaSet=rs0',
    baseNumero: 'Base (número)',
    phBaseMiBase: 'mi_base',
    // --- clientes ---
    noNecesita: 'no necesita',
    noNecesitan: 'no necesitan',
    ninguno: 'ninguno.',
    unirNombres: (nombres: readonly string[]) =>
      nombres.length <= 1 ? nombres.join('') : nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1]
  },
  {
    etiquetaSoloLectura: 'Read-only for agents (recommended)',
    tituloSoloLecturaAgentes: 'Read-only for agents: tdb does not write to this connection (you can)',
    ayudaQuien:
      'Agents (Claude Code, Codex), which query through tdb, can only read this connection; you are not ' +
      'limited: from the explorer you edit, insert, delete and commit as usual. ',
    ayudaClasificador:
      'tdb rejects their writes and undoes anything that slips through: here read-only is enforced by Tessera; for a ' +
      'real guarantee, use a user with db_datareader.',
    ayudaListaBlanca: (garantia: string) =>
      `tdb only lets read operations through: here read-only is enforced by Tessera; for a real guarantee, use ${garantia}.`,
    ayudaUsuarioClave:
      'tdb rejects their writes and the server opens their transactions as read-only. The real guarantee is still ' +
      'to give them a database user with read permissions.',
    ayudaArchivo:
      'tdb opens the file read-only and rejects their writes. While a transaction is open, ' +
      'other applications that use the file may not be able to write to it.',
    garantiaDocumentos: 'a user with the read role',
    garantiaClaves: 'an ACL user that can only read (+@read)',
    garantiaSql: 'a user with read permissions',
    sinEntorno: 'No environment',
    ayudaEntornoNinguno: 'No marks or confirmations.',
    ayudaEntornoDesarrollo: 'Green mark in the tree, in this connection’s tabs and in its consoles’ bar.',
    ayudaEntornoPruebas: 'Amber mark in the tree, in this connection’s tabs and in its consoles’ bar.',
    ayudaEntornoProduccion:
      'Red mark, and Tessera asks for confirmation before every write (DML, DDL, PL/SQL and COMMIT, and when submitting grid changes). Its new consoles start in Manual Tx.',
    host: 'Host',
    puerto: 'Port',
    baseDeDatos: 'Database',
    autenticacionSql: (producto: string) => `${producto} user`,
    autenticacionNtlm: 'Domain account (NTLM)',
    ayudaInstancia:
      'With a named instance, the port is not used: the server’s SQL Browser service resolves it (UDP 1434). Without one, the default instance on the port.',
    confiarCertificado: 'Trust the server certificate',
    ayudaCifrado:
      'The certificate is verified against your computer’s trusted authorities. If the server uses its own (self-signed), check “Trust the server certificate”: it is still encrypted, but without verifying who the server is.',
    ayudaBaseDocumentos:
      'Without a database, the tree shows all the ones the user can read. User and password are optional: without them it connects without authenticating.',
    ayudaBaseClaves:
      'The database the connection opens with (0 if empty); the tree shows all of them. User and password are optional, and the password works without a user.',
    ayudaHostMongo:
      'One server or, without DNS SRV, the members of a replica set separated by commas (h1,h2:27018): the port applies to those that do not carry their own.',
    ayudaSrv:
      'For Atlas and clusters that publish their members in DNS: the host is the cluster name, the port is not used and the connection is encrypted unless you clear encryption.',
    ayudaOpcionesUri:
      'What would go after the “?” of the URI (key=value&key=value). Encryption, credentials and the authentication database do not: they go in their own fields.',
    ayudaAuthSource:
      'Where the user was created (authSource). Empty: the database above, like mongosh. A user from “admin” needs “admin” here if you enter another database.',
    uriMongoEjemplo: 'mongodb://user:password@host:27017/database?authSource=admin',
    uriMongoAyuda: 'Fills in host, port, user, password, database, SRV, encryption and options. The URI is not saved: only its fields.',
    uriRedisEjemplo: 'redis://user:password@host:6379/0',
    uriRedisAyuda:
      'Fills in host, port, user, password, database and encryption (rediss:// encrypts). The URI is not saved: only its fields; what comes after the “?” is left out.',
    uriPostgresEjemplo: 'postgres://user:password@host:5432/database?sslmode=require',
    uriPostgresAyuda:
      'Fills in host, port, user, password, database and encryption (sslmode: require, prefer and allow encrypt without verifying the certificate; verify-ca and verify-full verify it; without it or disable, unencrypted). The URI is not saved: only its fields; the other options are left out.',
    uriMysqlEjemplo: 'mysql://user:password@host:3306/database?ssl-mode=REQUIRED',
    uriMysqlAyuda:
      'Fills in host, port, user, password, database and encryption (ssl-mode: REQUIRED and PREFERRED encrypt without verifying the certificate; VERIFY_CA and VERIFY_IDENTITY verify it; without it or DISABLED, unencrypted). mariadb:// also works. The URI is not saved: only its fields; the other options are left out.',
    ayudaBaseMysql: 'The database the session opens in. Without it, the tree still shows all the ones the user can see.',
    opcional: 'optional',
    ayudaCifradoOracle:
      'Connects over TCPS: the port is usually different (2484, not 1521). The certificate is always verified against your computer’s trusted authorities; if the server uses its own, install its authority on the system. Not available with databases earlier than 12.1.',
    cifrarTcps: 'Encrypt the connection (TCPS)',
    cifrarSsl: 'Encrypt the connection (SSL)',
    cifrarTls: 'Encrypt the connection (TLS)',
    cifrar: 'Encrypt the connection',
    ayudaServiceNameSid: 'Service Name or SID, not both. Legacy 11g databases usually go by SID.',
    phBaseOpcionalTodas: 'optional: without it, all',
    instancia: 'Instance',
    autenticacion: 'Authentication',
    dominio: 'Domain',
    phDominio: 'COMPANY',
    srvEtiqueta: 'DNS SRV (mongodb+srv)',
    baseAutenticacion: 'Authentication database',
    phAuthSource: 'optional: admin',
    opcionesUri: 'URI options',
    phOpcionesUri: 'optional: replicaSet=rs0',
    baseNumero: 'Database (number)',
    phBaseMiBase: 'my_database',
    noNecesita: 'does not need',
    noNecesitan: 'do not need',
    ninguno: 'any.',
    unirNombres: (nombres: readonly string[]) =>
      nombres.length <= 1 ? nombres.join('') : nombres.slice(0, -1).join(', ') + ' and ' + nombres[nombres.length - 1]
  }
)
