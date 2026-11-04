// =============================================================================
// Textos del diálogo de conexión (`DbConexionDialogo`, `DbConexionSecciones`, `DbConexionCampos`,
// `DbConexionTopologia`, `DbConexionTunel`, `DriversLista` y sus hooks): cabecera, campos fijos,
// URI, topología de Redis, túnel, clientes de base de datos y botones del pie. Español e inglés con
// las mismas claves; se leen al usarse, nunca al cargar el módulo. Sin JSX ni DOM.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txConexionDialogo = crearTextos(
  {
    // --- cabecera y fila de nombre ---
    editarConexion: 'Editar conexión',
    nuevaConexion: 'Nueva conexión',
    ayudaNombreAntes: 'Puede usar cualquier nombre: es solo una etiqueta para usted. El agente podrá explorar la conexión con ',
    ayudaNombreDespues: ' sin que usted le proporcione credenciales.',
    nombre: 'Nombre',
    nombreAyuda: '(el nombre con el que identifica la conexión)',
    phAlias: 'DEV-VENTAS',
    motor: 'Motor',
    // --- URI ---
    uriEtiqueta: 'URI de conexión',
    rellenar: 'Rellenar',
    cancelar: 'Cancelar',
    pegarUri: 'Pegar URI…',
    uriRellenada: (fuera: string) =>
      `Campos completados desde la URI. Estas opciones no se guardan y se omitieron: ${fuera}.`,
    // --- credenciales ---
    usuario: 'Usuario',
    contrasena: 'Contraseña',
    sinCambios: '(sin cambios)',
    ocultarContrasena: 'Ocultar contraseña',
    mostrarContrasena: 'Mostrar contraseña',
    // --- entorno, notas, prueba, pie ---
    entorno: 'Entorno',
    notas: 'Notas',
    phNotas: 'Finalidad, responsable de la administración, aspectos que no deben modificarse…',
    probando: 'Probando…',
    confiarYProbar: 'Confiar en el certificado y probar',
    guardarYProbar: 'Guardar y probar',
    probar: 'Probar',
    guardando: 'Guardando…',
    guardar: 'Guardar',
    // --- campos ---
    sinPuertoSrv: 'Con DNS SRV, el puerto no se usa',
    archivo: 'Archivo',
    ningunArchivo: 'Ningún archivo elegido',
    elegir: 'Elegir…',
    crearNueva: 'Crear nueva…',
    crearNuevaTitulo: 'Crear un archivo de base de datos nuevo y vacío',
    // --- clientes ---
    clientesBd: 'Clientes de base de datos',
    oracleNoPublica: 'Oracle ya no ofrece este cliente para descarga directa. Descárguelo manualmente desde su sitio web y seleccione la carpeta.',
    oracleNoPublicaNota: 'Oracle ya no ofrece este cliente para descarga directa; debe descargarse manualmente desde su sitio web.',
    descargarEInstalar: 'Descargar e instalar',
    registrarClienteTitulo: 'Registrar un cliente que ya esté descomprimido en este equipo',
    seleccionarCarpeta: 'Seleccionar carpeta…',
    descomprimiendo: 'Descomprimiendo…',
    instalando: 'Instalando…',
    descargando: (porcentaje: number) => `Descargando… ${porcentaje}%`,
    sinClientes: 'No hay clientes que instalar en este equipo.',
    instalado: 'instalado',
    instaladoTuyo: ' (registrado por usted)',
    descargar: (mb: number) => `Descargar (${mb} MB)`,
    soloOracle: 'Solo hacen falta para Oracle anterior a 12.1.',
    // --- topología de Redis ---
    ayudaSentinel:
      'En Host se indican los sentinels separados por comas (sentinel1:26379, sentinel2:26379); el puerto contiguo se aplica a los que no especifican el suyo. ' +
      'Tessera consulta a los sentinels cuál es el maestro y vuelve a consultarlo tras un failover.',
    ayudaCluster:
      'En Host se indican uno o varios nodos separados por comas (nodo1:6379, nodo2:6379); el resto del cluster se descubre automáticamente. En Cluster solo existe la base 0.',
    modoServidor: 'Un servidor',
    modoSentinel: 'Sentinel (maestro y réplicas)',
    modoCluster: 'Cluster',
    claveNinguna: 'Ninguna',
    claveMisma: 'La misma de la conexión',
    clavePropia: 'Otra',
    conexionA: 'Conexión a',
    maestro: 'Maestro',
    contrasenaSentinels: 'Contraseña de los sentinels',
    laDeLosSentinels: 'La de los sentinels',
    // --- túnel SSH ---
    ayudaTunel:
      'Tessera llega a la base a través de esa conexión SSH: el host y el puerto de arriba son los del servidor de base de datos visto desde el servidor SSH. ' +
      'La huella del servidor SSH debe estar confirmada y su contraseña o clave debe estar guardada.',
    sinTunelTopologia:
      'Sentinel y Cluster no admiten túnel SSH: Tessera se conecta a servidores a los que el túnel no da acceso (el maestro que indican los sentinels y los nodos del cluster). Para usar un túnel, seleccione «Un servidor».',
    tunelSsh: 'Túnel SSH',
    ningunoSinSsh: 'Ninguno (este perfil no tiene conexiones SSH)',
    ningunoDirecta: 'Ninguno (conexión directa)',
    conexionSshInexistente: 'Una conexión SSH que ya no existe'
  },
  {
    editarConexion: 'Edit connection',
    nuevaConexion: 'New connection',
    ayudaNombreAntes: 'Use any name you like; it is just a label for you. The agent can explore it with ',
    ayudaNombreDespues: ' without you sharing any credentials.',
    nombre: 'Name',
    nombreAyuda: '(how you refer to it)',
    phAlias: 'DEV-SALES',
    motor: 'Engine',
    uriEtiqueta: 'Connection URI',
    rellenar: 'Fill in',
    cancelar: 'Cancel',
    pegarUri: 'Paste URI…',
    uriRellenada: (fuera: string) =>
      `Filled in from the URI. These options are not saved and were left out: ${fuera}.`,
    usuario: 'User',
    contrasena: 'Password',
    sinCambios: '(unchanged)',
    ocultarContrasena: 'Hide password',
    mostrarContrasena: 'Show password',
    entorno: 'Environment',
    notas: 'Notes',
    phNotas: 'What it is for, who manages it, what not to touch…',
    probando: 'Testing…',
    confiarYProbar: 'Trust the certificate and test',
    guardarYProbar: 'Save and test',
    probar: 'Test',
    guardando: 'Saving…',
    guardar: 'Save',
    sinPuertoSrv: 'With DNS SRV, the port is not used',
    archivo: 'File',
    ningunArchivo: 'No file chosen',
    elegir: 'Choose…',
    crearNueva: 'Create new…',
    crearNuevaTitulo: 'Create a new, empty database file',
    clientesBd: 'Database clients',
    oracleNoPublica: 'Oracle no longer offers it as a direct download. Download it manually from its website and select its folder.',
    oracleNoPublicaNota: 'Oracle no longer offers it as a direct download; you need to download it manually from its website.',
    descargarEInstalar: 'Download and install',
    registrarClienteTitulo: 'Register a client that is already extracted on this computer',
    seleccionarCarpeta: 'Select folder…',
    descomprimiendo: 'Extracting…',
    instalando: 'Installing…',
    descargando: (porcentaje: number) => `Downloading… ${porcentaje}%`,
    sinClientes: 'No clients to install on this computer.',
    instalado: 'installed',
    instaladoTuyo: ' (yours)',
    descargar: (mb: number) => `Download (${mb} MB)`,
    soloOracle: 'Only needed for Oracle versions earlier than 12.1.',
    ayudaSentinel:
      'In Host, enter the sentinels separated by commas (sentinel1:26379, sentinel2:26379); the Port field applies to any sentinel without its own port. ' +
      'Tessera asks them for the master and asks again after a failover.',
    ayudaCluster:
      'In Host, enter one or more nodes separated by commas (node1:6379, node2:6379); Tessera discovers the rest of the cluster. A cluster only has database 0.',
    modoServidor: 'A single server',
    modoSentinel: 'Sentinel (master and replicas)',
    modoCluster: 'Cluster',
    claveNinguna: 'None',
    claveMisma: 'Same as the connection',
    clavePropia: 'Different',
    conexionA: 'Connect to',
    maestro: 'Master',
    contrasenaSentinels: 'Sentinel password',
    laDeLosSentinels: 'Password for the sentinels',
    ayudaTunel:
      'Tessera reaches the database through this SSH connection: the host and port above are those of the database server as seen from the SSH server. ' +
      'The SSH server’s fingerprint must be confirmed and its password or key saved.',
    sinTunelTopologia:
      'Sentinel and Cluster cannot use an SSH tunnel: Tessera connects to servers the tunnel does not reach (the master reported by the sentinels, the cluster nodes). To use a tunnel, choose “A single server”.',
    tunelSsh: 'SSH tunnel',
    ningunoSinSsh: 'None (this profile has no SSH connections)',
    ningunoDirecta: 'None (direct connection)',
    conexionSshInexistente: 'An SSH connection that no longer exists'
  }
)
