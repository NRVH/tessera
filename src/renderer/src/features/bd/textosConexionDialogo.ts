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
    ayudaNombreAntes: 'Llámala como quieras: el nombre es solo tuyo. El agente podrá explorarla con ',
    ayudaNombreDespues: ' sin que le dictes credenciales.',
    nombre: 'Nombre',
    nombreAyuda: '(el que uses para referirte a ella)',
    phAlias: 'DEV-VENTAS',
    motor: 'Motor',
    // --- URI ---
    uriEtiqueta: 'URI de conexión',
    rellenar: 'Rellenar',
    cancelar: 'Cancelar',
    pegarUri: 'Pegar URI…',
    uriRellenada: (fuera: string) =>
      `Rellenado desde la URI. Estas opciones no se guardan y se dejaron fuera: ${fuera}.`,
    // --- credenciales ---
    usuario: 'Usuario',
    contrasena: 'Contraseña',
    sinCambios: '(sin cambios)',
    ocultarContrasena: 'Ocultar contraseña',
    mostrarContrasena: 'Mostrar contraseña',
    // --- entorno, notas, prueba, pie ---
    entorno: 'Entorno',
    notas: 'Notas',
    phNotas: 'Para qué es, quién la administra, qué no tocar…',
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
    crearNuevaTitulo: 'Crea un archivo de base de datos nuevo y vacío',
    // --- clientes ---
    clientesBd: 'Clientes de base de datos',
    oracleNoPublica: 'Oracle ya no lo publica para descarga directa: bájalo a mano desde su web y señala la carpeta.',
    oracleNoPublicaNota: 'Oracle ya no lo publica para descarga directa; hay que bajarlo a mano desde su web.',
    descargarEInstalar: 'Descargar e instalar',
    registrarClienteTitulo: 'Registrar un cliente que ya tengas descomprimido en este equipo',
    seleccionarCarpeta: 'Seleccionar carpeta…',
    descomprimiendo: 'Descomprimiendo…',
    instalando: 'Instalando…',
    descargando: (porcentaje: number) => `Descargando… ${porcentaje}%`,
    sinClientes: 'No hay clientes que instalar en este equipo.',
    instalado: 'instalado',
    instaladoTuyo: ' (tuyo)',
    descargar: (mb: number) => `Descargar (${mb} MB)`,
    soloOracle: 'Solo hacen falta para Oracle anterior a 12.1.',
    // --- topología de Redis ---
    ayudaSentinel:
      'En Host van los sentinels separados por comas (sentinel1:26379, sentinel2:26379); el puerto de al lado vale para los que no lo digan. ' +
      'Tessera les pregunta por el maestro y, tras un failover, vuelve a preguntar.',
    ayudaCluster:
      'En Host van uno o varios nodos separados por comas (nodo1:6379, nodo2:6379); el resto del cluster se descubre. En Cluster solo existe la base 0.',
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
      'La huella del servidor SSH tiene que estar confirmada y su contraseña o clave, guardada.',
    sinTunelTopologia:
      'Sentinel y Cluster no van por túnel SSH: Tessera se conecta a servidores que el túnel no lleva (el maestro que den los sentinels, los nodos del cluster). Para usar un túnel, elige «Un servidor».',
    tunelSsh: 'Túnel SSH',
    ningunoSinSsh: 'Ninguno (este perfil no tiene conexiones SSH)',
    ningunoDirecta: 'Ninguno (conexión directa)',
    conexionSshInexistente: 'Una conexión SSH que ya no existe'
  },
  {
    editarConexion: 'Edit connection',
    nuevaConexion: 'New connection',
    ayudaNombreAntes: 'Call it whatever you like: the name is only yours. The agent will be able to explore it with ',
    ayudaNombreDespues: ' without you handing over credentials.',
    nombre: 'Name',
    nombreAyuda: '(the one you use to refer to it)',
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
    crearNuevaTitulo: 'Creates a new, empty database file',
    clientesBd: 'Database clients',
    oracleNoPublica: 'Oracle no longer publishes it for direct download: download it manually from their website and point to the folder.',
    oracleNoPublicaNota: 'Oracle no longer publishes it for direct download; it has to be downloaded manually from their website.',
    descargarEInstalar: 'Download and install',
    registrarClienteTitulo: 'Register a client you already have unzipped on this computer',
    seleccionarCarpeta: 'Select folder…',
    descomprimiendo: 'Unzipping…',
    instalando: 'Installing…',
    descargando: (porcentaje: number) => `Downloading… ${porcentaje}%`,
    sinClientes: 'There are no clients to install on this computer.',
    instalado: 'installed',
    instaladoTuyo: ' (yours)',
    descargar: (mb: number) => `Download (${mb} MB)`,
    soloOracle: 'They are only needed for Oracle earlier than 12.1.',
    ayudaSentinel:
      'In Host go the sentinels separated by commas (sentinel1:26379, sentinel2:26379); the port next to it applies to those that do not give one. ' +
      'Tessera asks them for the master and, after a failover, asks again.',
    ayudaCluster:
      'In Host go one or more nodes separated by commas (node1:6379, node2:6379); the rest of the cluster is discovered. In Cluster only database 0 exists.',
    modoServidor: 'A single server',
    modoSentinel: 'Sentinel (master and replicas)',
    modoCluster: 'Cluster',
    claveNinguna: 'None',
    claveMisma: 'Same as the connection',
    clavePropia: 'Another one',
    conexionA: 'Connect to',
    maestro: 'Master',
    contrasenaSentinels: 'Sentinels password',
    laDeLosSentinels: 'The sentinels’ own',
    ayudaTunel:
      'Tessera reaches the database through that SSH connection: the host and port above are those of the database server as seen from the SSH server. ' +
      'The SSH server fingerprint must be confirmed and its password or key saved.',
    sinTunelTopologia:
      'Sentinel and Cluster do not go through an SSH tunnel: Tessera connects to servers that the tunnel does not carry (the master the sentinels report, the cluster nodes). To use a tunnel, choose “A single server”.',
    tunelSsh: 'SSH tunnel',
    ningunoSinSsh: 'None (this profile has no SSH connections)',
    ningunoDirecta: 'None (direct connection)',
    conexionSshInexistente: 'An SSH connection that no longer exists'
  }
)
