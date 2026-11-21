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
    tituloSoloLecturaAgentes: 'Solo lectura para los agentes: tdb no escribe en esta conexión (usted sí puede escribir)',
    ayudaQuien:
      'Los agentes (Claude Code, Codex), que consultan mediante tdb, solo pueden leer esta conexión. Usted no tiene ' +
      'esa limitación: desde el explorador puede editar, insertar, borrar y confirmar como siempre. ',
    ayudaClasificador:
      'tdb rechaza las escrituras de los agentes y deshace cualquiera que se cuele. En este motor, Tessera impone ' +
      'el modo de solo lectura; para una garantía real, use un usuario con db_datareader.',
    ayudaListaBlanca: (garantia: string) =>
      `tdb solo permite a los agentes las operaciones de lectura. En este motor, Tessera impone el modo de solo lectura; para una garantía real, use ${garantia}.`,
    ayudaUsuarioClave:
      'tdb rechaza las escrituras de los agentes y el servidor abre sus transacciones en solo lectura. La única ' +
      'garantía real es asignarles un usuario de base de datos con permisos de lectura.',
    ayudaArchivo:
      'tdb abre el archivo en modo de solo lectura y rechaza las escrituras de los agentes. Mientras haya una transacción abierta, ' +
      'otras aplicaciones que usan el archivo pueden no poder escribir en él.',
    garantiaDocumentos: 'un usuario con el rol read',
    garantiaClaves: 'un usuario ACL que solo pueda leer (+@read)',
    garantiaSql: 'un usuario con permisos de lectura',
    sinEntorno: 'Sin entorno',
    ayudaEntornoNinguno: 'Sin marcas ni confirmaciones.',
    ayudaEntornoDesarrollo: 'Marca verde en el árbol, en las pestañas de esta conexión y en la barra de sus consolas.',
    ayudaEntornoPruebas: 'Marca ámbar en el árbol, en las pestañas de esta conexión y en la barra de sus consolas.',
    ayudaEntornoProduccion:
      'Marca roja, y Tessera pide confirmación antes de cada escritura (DML, DDL, PL/SQL y COMMIT, y al enviar los cambios de la rejilla). Las consolas nuevas de esta conexión se inician en transacción manual.',
    // --- presentación por motor ---
    host: 'Host',
    puerto: 'Puerto',
    baseDeDatos: 'Base de datos',
    autenticacionSql: (producto: string) => `Usuario de ${producto}`,
    autenticacionNtlm: 'Cuenta de dominio (NTLM)',
    ayudaInstancia:
      'Si se indica una instancia con nombre, no se usa el puerto: lo resuelve el servicio SQL Browser del servidor (UDP 1434). Sin instancia, se usa la instancia predeterminada en el puerto indicado.',
    confiarCertificado: 'Confiar en el certificado del servidor',
    ayudaCifrado:
      'El certificado se verifica contra las autoridades de confianza de este equipo. Si el servidor usa uno propio (autofirmado), active "Confiar en el certificado del servidor": la conexión se cifra igualmente, pero no se comprueba la identidad del servidor.',
    ayudaBaseDocumentos:
      'Si no se indica una base, el árbol muestra todas las que el usuario puede leer. Usuario y contraseña son opcionales: sin ellos, la conexión se establece sin autenticación.',
    ayudaBaseClaves:
      'Base con la que se abre la conexión (0 si el campo queda vacío); el árbol muestra todas. Usuario y contraseña son opcionales, y la contraseña puede indicarse sin usuario.',
    ayudaHostMongo:
      'Un servidor o, sin DNS SRV, los miembros de un replica set separados por comas (h1,h2:27018). El puerto indicado se aplica a los miembros que no especifican el suyo.',
    ayudaSrv:
      'Para Atlas y los clústeres que publican sus miembros en DNS: el host es el nombre del clúster, el puerto no se usa y la conexión se cifra salvo que se desactive el cifrado.',
    ayudaOpcionesUri:
      'Opciones que irían después del "?" de la URI (clave=valor&clave=valor). El cifrado, las credenciales y la base de autenticación no se incluyen aquí: se indican en sus propios campos.',
    ayudaAuthSource:
      'Base de datos donde se creó el usuario (authSource). Si queda vacío, se usa la base de datos indicada arriba, igual que en mongosh. Un usuario creado en "admin" requiere "admin" aquí si se indica otra base.',
    uriMongoEjemplo: 'mongodb://usuario:clave@host:27017/base?authSource=admin',
    uriMongoAyuda: 'Se rellenan host, puerto, usuario, contraseña, base, SRV, cifrado y opciones. La URI no se guarda: solo sus campos.',
    uriRedisEjemplo: 'redis://usuario:clave@host:6379/0',
    uriRedisAyuda:
      'Se rellenan host, puerto, usuario, contraseña, base y cifrado (rediss:// cifra). La URI no se guarda, solo sus campos; lo que va después del "?" se omite.',
    uriPostgresEjemplo: 'postgres://usuario:clave@host:5432/base?sslmode=require',
    uriPostgresAyuda:
      'Se rellenan host, puerto, usuario, contraseña, base y cifrado (sslmode: require, prefer y allow cifran sin verificar el certificado; verify-ca y verify-full lo verifican; si se omite o es disable, no se cifra). La URI no se guarda, solo sus campos; el resto de las opciones se omite.',
    uriMysqlEjemplo: 'mysql://usuario:clave@host:3306/base?ssl-mode=REQUIRED',
    uriMysqlAyuda:
      'Se rellenan host, puerto, usuario, contraseña, base y cifrado (ssl-mode: REQUIRED y PREFERRED cifran sin verificar el certificado; VERIFY_CA y VERIFY_IDENTITY lo verifican; si se omite o es DISABLED, no se cifra). También se admite mariadb://. La URI no se guarda, solo sus campos; el resto de las opciones se omite.',
    ayudaBaseMysql: 'Base en la que se inicia la sesión. Si no se indica, el árbol muestra igualmente todas las que el usuario puede ver.',
    opcional: 'opcional',
    ayudaCifradoOracle:
      'La conexión usa TCPS: el puerto suele ser otro (2484, no 1521). El certificado se verifica siempre contra las autoridades de confianza de este equipo; si el servidor usa uno propio, instale la autoridad de certificación correspondiente en el sistema. No está disponible con bases de datos anteriores a la versión 12.1.',
    cifrarTcps: 'Cifrar la conexión (TCPS)',
    cifrarSsl: 'Cifrar la conexión (SSL)',
    cifrarTls: 'Cifrar la conexión (TLS)',
    cifrar: 'Cifrar la conexión',
    ayudaServiceNameSid: 'Indique Service Name o SID, no ambos. Las bases 11g antiguas suelen usar SID.',
    phBaseOpcionalTodas: 'opcional; si queda vacío, se muestran todas',
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
    tituloSoloLecturaAgentes: 'Read-only for agents: tdb does not write to this connection (you still can)',
    ayudaQuien:
      'Agents (Claude Code, Codex) query through tdb and can only read this connection. You are not ' +
      'restricted: in the explorer you can edit, insert, delete, and commit as usual. ',
    ayudaClasificador:
      'tdb rejects their writes and undoes anything that slips through. Tessera enforces read-only here; for a ' +
      'real guarantee, use a user with db_datareader.',
    ayudaListaBlanca: (garantia: string) =>
      `tdb only allows read operations. Tessera enforces read-only here; for a real guarantee, use ${garantia}.`,
    ayudaUsuarioClave:
      'tdb rejects their writes, and the server opens their transactions as read-only. The only real guarantee is ' +
      'a database user with read-only permissions.',
    ayudaArchivo:
      'tdb opens the file read-only and rejects their writes. While a transaction is open, ' +
      'other applications that use the file may not be able to write to it.',
    garantiaDocumentos: 'a user with the read role',
    garantiaClaves: 'an ACL user that can only read (+@read)',
    garantiaSql: 'a user with read permissions',
    sinEntorno: 'No environment',
    ayudaEntornoNinguno: 'No marks or confirmations.',
    ayudaEntornoDesarrollo: 'Green mark in the tree, on this connection’s tabs, and in its consoles’ toolbar.',
    ayudaEntornoPruebas: 'Amber mark in the tree, on this connection’s tabs, and in its consoles’ toolbar.',
    ayudaEntornoProduccion:
      'Red mark, and Tessera asks for confirmation before every write (DML, DDL, PL/SQL, and COMMIT, and when submitting grid changes). New consoles on this connection start in manual transaction mode.',
    host: 'Host',
    puerto: 'Port',
    baseDeDatos: 'Database',
    autenticacionSql: (producto: string) => `${producto} user`,
    autenticacionNtlm: 'Domain account (NTLM)',
    ayudaInstancia:
      'With a named instance, the port is not used: the server’s SQL Browser service resolves it (UDP 1434). Without one, Tessera connects to the default instance on the port.',
    confiarCertificado: 'Trust the server certificate',
    ayudaCifrado:
      'The certificate is verified against your computer’s trusted authorities. If the server uses its own (self-signed), select "Trust the server certificate": the connection is still encrypted, but the server’s identity is not verified.',
    ayudaBaseDocumentos:
      'Without a database, the tree shows every database the user can read. User and password are optional; without them, Tessera connects without authentication.',
    ayudaBaseClaves:
      'The database the connection opens with (0 if empty); the tree shows all of them. User and password are optional, and a password works without a user.',
    ayudaHostMongo:
      'A single server or, without DNS SRV, the members of a replica set separated by commas (h1,h2:27018); the port applies to members without their own.',
    ayudaSrv:
      'For Atlas and clusters that publish their members in DNS: the host is the cluster name, the port is not used, and the connection is encrypted unless you turn off encryption.',
    ayudaOpcionesUri:
      'What would go after the "?" in the URI (key=value&key=value). Encryption, credentials, and the authentication database go in their own fields.',
    ayudaAuthSource:
      'The database where the user was created (authSource). If empty, the database above is used, as in mongosh. A user created in "admin" needs "admin" here if you enter a different database.',
    uriMongoEjemplo: 'mongodb://user:password@host:27017/database?authSource=admin',
    uriMongoAyuda: 'Fills in host, port, user, password, database, SRV, encryption, and options. The URI is not saved, only its fields.',
    uriRedisEjemplo: 'redis://user:password@host:6379/0',
    uriRedisAyuda:
      'Fills in host, port, user, password, database, and encryption (rediss:// encrypts). The URI is not saved, only its fields; anything after the "?" is ignored.',
    uriPostgresEjemplo: 'postgres://user:password@host:5432/database?sslmode=require',
    uriPostgresAyuda:
      'Fills in host, port, user, password, database, and encryption (sslmode: require, prefer, and allow encrypt without verifying the certificate; verify-ca and verify-full verify it; omitted or disable means no encryption). The URI is not saved, only its fields; other options are ignored.',
    uriMysqlEjemplo: 'mysql://user:password@host:3306/database?ssl-mode=REQUIRED',
    uriMysqlAyuda:
      'Fills in host, port, user, password, database, and encryption (ssl-mode: REQUIRED and PREFERRED encrypt without verifying the certificate; VERIFY_CA and VERIFY_IDENTITY verify it; omitted or DISABLED means no encryption). mariadb:// also works. The URI is not saved, only its fields; other options are ignored.',
    ayudaBaseMysql: 'The database the session starts in. Without it, the tree still shows every database the user can see.',
    opcional: 'optional',
    ayudaCifradoOracle:
      'Connects over TCPS: the port is usually different (2484, not 1521). The certificate is always verified against your computer’s trusted authorities; if the server uses its own, install its certificate authority on the system. Not available for databases earlier than 12.1.',
    cifrarTcps: 'Encrypt the connection (TCPS)',
    cifrarSsl: 'Encrypt the connection (SSL)',
    cifrarTls: 'Encrypt the connection (TLS)',
    cifrar: 'Encrypt the connection',
    ayudaServiceNameSid: 'Service Name or SID, not both. Legacy 11g databases usually use a SID.',
    phBaseOpcionalTodas: 'optional; leave empty for all',
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
