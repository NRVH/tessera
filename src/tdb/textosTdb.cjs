// =============================================================================
// Los textos de `tdb` que lee una persona o el agente (ayuda, errores, avisos y la salida de
// texto), en español y en inglés. `textosTdb()` elige por `TESSERA_IDIOMA`, que deja el main en
// el entorno: 'en' es inglés y cualquier otra cosa, español. Los valores del `--json` no pasan
// por aquí. Sin dependencias; lo usan los `tdb*.cjs`.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================
'use strict'

const es = {
  // --- tdb.cjs ---
  soloLecturaNoConsulta: (alias, permitidas) =>
    `"${alias}" es de SOLO LECTURA y esa sentencia no es una consulta.\n` + `    Permitidas: ${permitidas}.`,
  faltaArgumento: (nombre) => `Falta el argumento <${nombre}>. Usa 'tdb help'.`,
  argAlias: 'alias',
  argSql: 'SQL',
  argTabla: 'tabla',
  stdinVacio: 'No llegó nada por la entrada estándar.\n' + "    Desde bash:  tdb query <base> --stdin <<'SQL'  …  SQL",
  faltaRutaFile: 'Falta la ruta después de --file.',
  noExisteArchivo: (ruta) => `No existe el archivo "${ruta}".`,
  archivoVacio: (ruta) => `El archivo "${ruta}" está vacío.`,
  sqlExpandido:
    'Tu shell parece haber expandido una variable DENTRO del SQL: la consulta lleva\n' +
    '    incrustada una ruta del sistema. Suele pasar en cmd.exe con un LIKE que\n' +
    '    contiene %algo%, y no daría error: devolvería otras filas.\n' +
    '\n' +
    '    Pásalo por la entrada estándar, que no atraviesa ningún parser:\n' +
    "      tdb query <base> --stdin <<'SQL'  …  SQL",
  comandoDesconocido: (cmd) => `Comando desconocido: "${cmd}". Usa 'tdb help'.`,

  // --- tdbAyuda.cjs ---
  ayudaClaves: (kv) => `
  En ${kv}, query acepta comandos de redis-cli, con sus comillas; varios, uno por
  línea (se ejecutan en orden y se para en el primer error; # empieza un comentario).
  «SELECT <n>» cambia de base para las líneas siguientes.

    tdb query miredis "HGETALL usuario:1"
    tdb query miredis --stdin <<'REDIS'
    SELECT 1
    TYPE "clave con espacios"
    LRANGE cola:tareas 0 9
    REDIS

  tdb schema <alias> ["<patrón>"] lista las claves (un SCAN acotado, nunca KEYS) con su tipo
  y su TTL; no hay tablas, así que describe no aplica. Ahí tdb SOLO LEE, también en
  las conexiones de escritura: pasan los comandos de lectura (GET, HGETALL, SCAN, TYPE…);
  KEYS, CONFIG, FLUSHALL y toda escritura, nunca. Para escribir, la consola de Tessera.
`,
  ayudaDocumentos: (docs) => `
  En ${docs}, query acepta la sintaxis de mongosh, INTERPRETADA (no se ejecuta
  JavaScript): una sentencia por comando, y «use <base>» en la primera línea para otra base.

    tdb query mimongo "db.clientes.find({ nombre: 'Ana' }).sort({ edad: -1 }).limit(5)"

  Con operadores ($gt, $group…), por --stdin: el shell expandiría el $.

    tdb query mimongo --stdin <<'JS'
    use otra
    db.pedidos.aggregate([{ $group: { _id: '$cliente', n: { $sum: 1 } } }])
    JS

  Ahí el solo lectura lo impone tdb: pasan find, aggregate sin $out ni $merge,
  countDocuments, distinct…; la garantía de verdad es un usuario con el rol read.
`,
  ayuda: (limite, sinCandado, documentos, claves) => `
  tdb — consulta las bases de datos configuradas en Tessera (perfil activo)

    tdb ls                          Lista las conexiones montadas en esta sesión
    tdb doctor                      Por qué no funciona (shell, contexto, PATH)
    tdb test <alias>                Comprueba que la conexión responde
    tdb query <alias> "<SQL>"       Ejecuta una consulta (tope ${limite} filas)
    tdb schema <alias>              Tablas y claves foráneas de la base
    tdb describe <alias> <TABLA>    Columnas, tipos, PK y referencias
    tdb sessions <alias>            Sesiones abiertas de tu usuario
    tdb driver ls | install <id>    Clientes de base de datos

  Opciones:
    --json          Salida JSON (para consumo automático)
    --limit N       Cambia el tope de filas de 'query'
    --stdin         El SQL entra por la entrada estándar, no por la línea de comandos
    --file <ruta>   El SQL se lee de un archivo

  SQL LARGO O CON SÍMBOLOS: pásalo por --stdin. En la línea de comandos el SQL
  atraviesa el parser del shell y cada uno lo estropea a su manera (cmd expande
  %VAR%, bash expande $ y comillas). Desde bash, con el delimitador entrecomillado:

    tdb query mibase --stdin <<'SQL'
    SELECT * FROM clientes WHERE nombre LIKE '%García%'
    SQL

  Las conexiones son de SOLO LECTURA salvo que se marquen lo contrario en Tessera:
  el rechazo lo hace el servidor (en una base de archivo, la guardia de Tessera),
  no este comando. ${sinCandado} no tiene ese candado: ahí lo impone tdb, que rechaza
  toda escritura, todo EXEC y toda transacción antes de enviar, y revierte cada lote.
  En ${sinCandado}, GO en su propia línea separa lotes, como en sqlcmd.
${documentos}${claves}`,

  // --- tdbSalida.cjs ---
  sinFilas: '  (sin filas)',
  binario: (n) => `<binario ${n} bytes>`,

  // --- tdbRegistro.cjs (copia de los textos de `mensajesRegistro.ts` del main) ---
  formatoAjeno:
    'Este tdb no reconoce el formato del registro de conexiones (db-connections.json),\n' +
    '    así que no ve ninguna. Puede venir de una versión más nueva de Tessera (actualiza\n' +
    '    para usarlas) o de una edición a mano del archivo; Tessera no lo toca.',
  ilegibleNoJson: 'no es JSON válido',
  ilegibleNoAbre: (codigo) => `no se pudo abrir (${codigo})`,
  respaldoInservible: ', y su copia de respaldo (db-connections.json.bak) tampoco sirve',
  respaldoLegible:
    ', y su copia de respaldo (db-connections.json.bak), aunque se lee, no se usa: la próxima ' +
    'escritura sustituiría el registro sin haber podido guardarlo aparte',
  remedioRoto: 'corrígelo (suele ser una edición a mano: una coma de más, una comilla sin cerrar)',
  remedioInaccesible: 'revisa sus permisos, o si otro programa lo tiene abierto en exclusiva,',
  registroIlegible: (que, copia, remedio) =>
    `Este tdb no puede leer el registro de conexiones (db-connections.json): ${que}${copia}, ` +
    'así que no ve ninguna. Tessera no lo toca para no perder lo que tiene dentro: ' +
    `${remedio} y reinicia Tessera, que lo lee al arrancar.`,

  // --- tdbContexto.cjs ---
  sinContexto:
    'Esta terminal no lleva el contexto de bases de datos de Tessera.\n' +
    '    Suele ser una de estas dos:\n' +
    '      - La terminal se abrió ANTES de montar la base. Pulsa "Recargar" en la\n' +
    '        terminal de abajo, o "Reiniciar" en la cabecera del agente.\n' +
    '      - No es una terminal de Tessera en modo Windows (una consola suelta, o\n' +
    '        un proyecto en modo Docker).\n' +
    '\n' +
    '    Diagnóstico completo:  tdb doctor',

  // --- tdbConexiones.cjs ---
  sinNombre: '(sin nombre)',
  motorDesconocidoNombre: 'desconocido',
  unaDeOtroPerfil: 'una conexión de otro perfil',
  idRepetido: (nombre, otra) =>
    `"${nombre}" comparte su identificador con ${otra}: este tdb no puede distinguirlas\n` +
    '    y usa la primera del registro. Tessera la conserva tal cual; elimínala desde\n' +
    '    Tessera si sobra.',
  motorDesconocido: (nombre, motor) => `"${nombre}" es de un motor (${motor}) que este tdb no conoce: actualiza Tessera`,
  formaDesconocida: (nombre) =>
    `"${nombre}" está guardada de una forma que este tdb no reconoce.\n` +
    '    Puede venir de una versión más nueva de Tessera (actualiza para usarla) o de una\n' +
    '    edición a mano del archivo; Tessera la conserva tal cual.',
  ningunaDisponible: '(ninguna)',
  noHayConexion: (alias, disponibles, otras) =>
    `No hay ninguna conexión llamada "${alias}" en este perfil.\n    Disponibles: ${disponibles}` +
    (otras > 0 ? `\n    (y ${otras} que este tdb no sabe usar: tdb ls)` : ''),

  // --- tdbConectar.cjs ---
  destinoCambiadoEntorno: (alias) =>
    `La conexión "${alias}" cambió desde que se abrió esta terminal (su servidor, puerto,\n` +
    '    base o usuario ya no son los de entonces), así que tdb no le manda la contraseña de\n' +
    '    entonces. Recarga la terminal (o "Reiniciar" en la cabecera del agente) para usarla;\n' +
    '    si sigue igual (db-connections.json se editó a mano con Tessera abierta), reinicia Tessera.',
  destinoCambiadoPuente: (alias) =>
    `La conexión "${alias}" del registro no es la que tiene cargada Tessera (cambió mientras\n` +
    '    tdb la leía, o se editó db-connections.json a mano con Tessera abierta), así que tdb no\n' +
    '    le manda su contraseña. Vuelve a intentarlo; si sigue igual, reinicia Tessera.',
  puenteNoRespondeOpcional: (alias) =>
    `El puente de Tessera no responde, así que tdb no sabe si "${alias}" tiene contraseña.\n` +
    `    Recarga la terminal; si sigue igual, reinicia Tessera.  (tdb doctor)`,
  secretoNoLlego: (alias) =>
    `"${alias}" tiene contraseña guardada, pero no llegó a esta terminal (se guardó después\n` +
    '    de abrirla). Recarga la terminal (o "Reiniciar" en la cabecera del agente) para usarla.',
  puenteNoRespondeObligatorio: (alias) =>
    `El puente de Tessera no responde, así que no hay credenciales para "${alias}".\n` +
    `    La contraseña SÍ está guardada; lo que falla es la conexión con Tessera.\n` +
    `    Recarga la terminal; si sigue igual, reinicia Tessera.  (tdb doctor)`,
  sinContrasena: (alias) =>
    `No hay contraseña para "${alias}" en esta sesión.\n` +
    `    Guárdala con "Editar conexión…" en la vista Bases de datos de Tessera y reabre la terminal.`,
  tunelSinPuente: (alias) =>
    `"${alias}" va por un túnel SSH, y ese túnel lo abre Tessera: esta terminal no llega a ella\n` +
    '    (el puente no responde o no está). Recarga la terminal; si sigue igual, reinicia Tessera.  (tdb doctor)',
  tunelFallo: (alias, detalle) => `No se pudo abrir el túnel SSH de "${alias}": ${detalle}`,
  tunelSinRespuesta: 'Tessera no contestó a tiempo.',

  // --- tdbConsulta.cjs ---
  responde: (alias, ms, modo) => `\n  ✓ ${alias} responde en ${ms} ms (${modo})`,
  avisoTest: (aviso) => `    Aviso: ${aviso}\n`,
  sinDocumentos: '  (sin documentos)',
  documentos: (n, hayMas) =>
    hayMas ? `  ${n} documento(s) (TOPE alcanzado: hay más; usa --limit N para más)\n` : `  ${n} documento(s)\n`,
  filas: (n, tope) => (tope ? `\n  ${n} filas (TOPE alcanzado; usa --limit N para más)\n` : `\n  ${n} fila(s)\n`),
  conjunto: (i, n) => `  Conjunto ${i} de ${n}:\n`,
  salidaServidor: '  Salida del servidor:',

  // --- tdbEsquema.cjs ---
  clavesSinInfo: '\n  No se pueden leer las claves por base (sin permiso para INFO).',
  basesConClaves: '\n  Bases con claves:\n',
  marcaActual: '◄ actual',
  otraBaseClaves: '\n  Para otra base, «SELECT <n>» en la primera línea del query.',
  filtroPatron: (patron) => `, patrón ${patron}`,
  clavesDe: (alias, base, filtro, n, hayMas) => `\n  Claves de ${alias} (base ${base}${filtro}) — ${n}${hayMas ? ' (hay más)' : ''}\n`,
  ningunaClave: (hayMas) => (hayMas ? '  (ninguna en lo recorrido; hay más por recorrer)' : '  (ninguna)'),
  topeScan: (alias) => [
    `\n  TOPE: el SCAN no se recorrió entero. Acota con un patrón (tdb schema ${alias} "usuario:*")`,
    '  o usa --limit N para más.'
  ],
  sinTablasClaves: (etiqueta, alias) =>
    `\n  ${etiqueta} no tiene tablas ni claves foráneas. Para mirar una clave:  tdb query ${alias} "TYPE <clave>"\n`,
  coleccionesDe: (alias, base, n) => `\n  Colecciones de ${alias}${base ? ` (base ${base})` : ''} — ${n}\n`,
  noFijaBase: (alias, actual) => `\n  "${alias}" no fija base: lo de arriba es de "${actual}". Bases a las que llegas:\n`,
  otraBaseDocumentos: (alias) => [
    '\n  Para consultar otra base, «use <BASE>» en la primera línea de la sentencia; y aquí:',
    `    tdb describe ${alias} <BASE>.<COLECCION>`
  ],
  sinForaneasDocumentos: (etiqueta) => [
    `\n  ${etiqueta} no tiene claves foráneas: las referencias entre colecciones`,
    '  son una convención de la aplicación ($lookup).'
  ],
  camposDeColeccion: (alias) => `\n  Campos e índices de una colección:  tdb describe ${alias} <COLECCION>\n`,
  esquemaDe: (alias, n) => `\n  Esquema de ${alias} — ${n} tabla(s)\n`,
  foraneas: (n) => `\n  Claves foráneas (${n}):\n`,
  otraBaseSql: (alias) => [
    '\n  Las tablas de otra base se nombran base.esquema.tabla, también aquí:',
    `    tdb describe ${alias} <BASE>.<ESQUEMA>.<TABLA>`
  ],
  detalleTabla: (alias) => `\n  Detalle de una tabla:  tdb describe ${alias} <TABLA>\n`,
  coleccionNoExiste: (tabla, alias, usuario) =>
    `La colección "${tabla}" no existe en "${alias}"${usuario ? ` o no es visible para ${usuario}` : ''}.`,
  tablaNoVisible: (tabla, usuario) => `La tabla "${tabla}" no existe o no es visible para ${usuario}.`,
  tablaNoExiste: (tabla, alias) => `La tabla "${tabla}" no existe en "${alias}".`,
  muestraDocumentos: '\n  Campos de primer nivel de una MUESTRA de documentos: un campo raro puede no salir.',
  indices: '\n  Índices:\n',
  referencias: '\n  Referencias:\n',
  si: 'sí',
  no: 'no',
  sesionesSql: (usuario, alias) => `\n  Sesiones abiertas de ${usuario} en ${alias}:\n`,
  conexionesClaves: (usuario, alias) => `\n  Conexiones de ${usuario ? usuario : 'default'} en ${alias}:\n`,
  operacionesDocumentos: (usuario, alias) =>
    `\n  Operaciones en curso de ${usuario ? usuario : 'esta conexión (sin usuario)'} en ${alias}:\n`,
  notaSesiones:
    `\n  La de abajo es ESTA consulta y morirá al terminar el comando.\n` +
    `  Tessera no mantiene conexiones abiertas entre invocaciones.\n`,

  // --- tdbLs.cjs ---
  columnasLs: ['ALIAS', 'MOTOR', 'DESTINO', 'USUARIO', 'MODO', 'ENTORNO'],
  destinoMotorDesconocido: 'motor desconocido: actualiza Tessera',
  destinoFormaDesconocida: 'forma no reconocida (ver debajo)',
  destinoIdRepetido: 'id repetido (ver debajo)',
  sinConexionesEspacio: (n) => [
    '\n  El agente de datos no tiene ninguna base montada.',
    `  El perfil tiene ${n}: móntalas con el botón de bases de`,
    '  datos de su cabecera, y marca las que quieras que vea.\n'
  ],
  sinConexionesProyecto: (n) => [
    '\n  Este PROYECTO no tiene ninguna base montada.',
    `  El perfil tiene ${n}: móntalas con el icono de base de`,
    '  datos en la cabecera del agente, y marca las que quieras aquí.\n'
  ],
  sinConexionesPerfil: [
    '\n  No hay conexiones configuradas en este perfil.',
    '  Añádelas en la vista Bases de datos de Tessera (icono de base de datos).\n'
  ],
  ningunaVisible: ['\n  Ninguna conexión visible en esta sesión.', '  Ejecuta  tdb doctor  para ver con qué perfil y ámbito arrancó.\n'],
  entornoProduccion: 'PRODUCCIÓN',
  entornoPruebas: 'pruebas',
  entornoDesarrollo: 'desarrollo',
  modoEscritura: 'escritura',
  modoSoloLectura: 'solo lectura',
  avisoProduccion: (lista) => [`\n  PRODUCCIÓN: ${lista}.`, '  No escribas en ella salvo que el usuario lo pida explícitamente.'],
  unaDeOtroPerfilCorta: 'una de otro perfil',
  conQuien: (nombre, otra) => `${nombre} (con ${otra})`,
  noUsablesPorMotor: (lista) => [
    `\n  Requieren una versión más nueva de Tessera: ${lista}.`,
    '  Este tdb no conoce su motor y no puede consultarlas: actualiza Tessera.'
  ],
  noUsablesPorForma: (lista) => [
    `\n  No se reconoce cómo están guardadas: ${lista}.`,
    '  Pueden venir de una versión más nueva de Tessera (actualiza para usarlas) o de una',
    '  edición a mano del archivo; Tessera las conserva tal cual. Este tdb no puede consultarlas.'
  ],
  noUsablesPorId: (lista) => [
    `\n  Comparten su identificador con otra conexión: ${lista}.`,
    '  Este tdb no puede distinguirlas y usa la primera del registro; Tessera las conserva',
    '  tal cual. Elimina desde Tessera la que sobre.'
  ],

  // --- tdbDoctor.cjs ---
  shellDesconocido: 'desconocido (invocación directa, sin atajo)',
  sinAtajo: '(invocación directa, sin atajo)',
  sinPerfil: '(sin TESSERA_PROFILE)',
  sinRegistro: '(sin TESSERA_DB_REGISTRY)',
  sinDrivers: '(sin TESSERA_DB_DRIVERS)',
  rutaHorneada: '(no definida: el atajo usó su ruta horneada)',
  noExisteConRespaldo: '  <-- NO EXISTE (se usa su copia de respaldo, .bak)',
  noExiste: '  <-- NO EXISTE',
  ambitoSinAcotar: 'sin acotar (ve todas las del perfil)',
  ambitoEspacio: 'acotado al agente de datos',
  ambitoProyecto: 'acotado a este proyecto',
  etiquetas: {
    shell: 'shell',
    ejecutable: 'ejecutable',
    guion: 'guion',
    atajo: 'atajo',
    atajoEnPath: 'atajo en PATH',
    perfil: 'perfil',
    registro: 'registro',
    drivers: 'drivers',
    ambito: 'ámbito',
    puente: 'puente',
    conexiones: 'conexiones',
    secretos: 'secretos'
  },
  enPath: (posicion) => `sí (posición ${posicion})`,
  noEnPath: 'NO',
  estadoPuente: (estado) => estado,
  conexionesVisibles: (visibles, enPerfil) => `${visibles} visibles de ${enPerfil} en el perfil`,
  secretosContados: (puente, entorno) => `${puente} del puente, ${entorno} en el entorno`,
  doctorSinContexto: [
    '  ✗ Esta terminal NO lleva el contexto de Tessera.',
    '    Recarga la terminal (o reinicia el agente) DESPUÉS de montar la base.'
  ],
  doctorRegistroNoExiste: ['  ✗ El registro apunta a un archivo que no existe.', '    Puede que la terminal la abriera otra instalación de Tessera.'],
  doctorPuenteCaido: [
    '  ✗ El puente de Tessera no responde.',
    '    La lista puede estar desactualizada y no habrá contraseñas.',
    '    Recarga la terminal; si sigue, reinicia Tessera.'
  ],
  doctorSinBasesEspacio: '  ! Contexto correcto, pero el agente de datos no tiene ninguna base montada.',
  doctorSinBasesProyecto: '  ! Contexto correcto, pero este proyecto no tiene ninguna base montada.',
  doctorMontalas: '    Móntalas con el icono de base de datos en la cabecera del agente.',
  doctorOtroDestino: (lista) => `Cambiaron desde que Tessera entregó su contraseña: ${lista}. ` + 'tdb no se la manda a su destino actual.',
  doctorRecargaOReinicia: '    Recarga la terminal (o reinicia el agente); si sigue igual, reinicia Tessera.',
  doctorSinContrasena: [
    '  ! Hay conexiones visibles sin contraseña en esta sesión.',
    '    Guárdala con "Editar conexión…" en la vista Bases de datos y recarga la terminal.'
  ],
  doctorFaltaArchivo: (lista) => `No se encuentra el archivo de: ${lista}.`,
  doctorArchivoMovido: '    Se movió, se borró o está en un disco desconectado. tdb test <nombre> dice cuál.',
  doctorTodoBien: '  ✓ Todo en orden. Prueba:  tdb ls',
  doctorRespaldo: (formatoAjeno) =>
    'El registro (db-connections.json) no existe: se usa su copia de respaldo (db-connections.json.bak)' +
    (formatoAjeno ? '.' : ', y Tessera lo recreará en su próxima escritura.'),

  // --- tdbDriver.cjs ---
  columnasDrivers: ['ID', 'NOMBRE', 'MB', 'CUBRE', 'ESTADO'],
  instalado: 'instalado',
  noInstalado: 'no instalado',
  servidorRespondio: (status, texto) => `el servidor respondió ${status} ${texto}`,
  noEsZip: 'lo descargado no es un ZIP',
  descomprimiendo: '  Descomprimiendo…',
  paqueteSinCentinela: (centinela) => `el paquete no contiene ${centinela}`,
  driverDesconocido: (id) => `Driver desconocido: "${id}". Mira los disponibles con: tdb driver ls`,
  yaInstalado: (nombre) => `\n  ${nombre} ya está instalado.\n`,
  sinCarpetaDrivers: (variable) => 'No sé dónde instalar drivers (falta ' + variable + ').',
  dmgLoInstalaTessera: (nombre) =>
    `${nombre} se publica como imagen de disco y lo instala Tessera:\n` +
    `    "Descargar" en "Clientes de base de datos", en el diálogo de la conexión (vista Bases de datos).`,
  descargando: (nombre, mb) => `\n  Descargando ${nombre} (${mb} MB)…`,
  instaladoEn: (nombre, destino) => `\n  ✓ ${nombre} instalado en ${destino}\n`,
  noSeInstalo: (nombre, motivo) =>
    `No se pudo instalar ${nombre}: ${motivo}\n` +
    `    Alternativa: descárgalo a mano y regístralo con "Seleccionar carpeta…" en\n` +
    `    "Clientes de base de datos", en el diálogo de la conexión (vista Bases de datos).`,
  subcomandoDriver: (sub) => `Subcomando de driver desconocido: "${sub}". Usa ls | install.`
}

/** Los estados del puente de `ctx.puente` (valores internos) tal como se leen en inglés. */
const PUENTE_EN = {
  vivo: 'alive',
  'no responde': 'not responding',
  'sin puente': 'no bridge',
  'esperado pero sin datos en el entorno': 'expected, but missing from the environment'
}

const en = {
  soloLecturaNoConsulta: (alias, permitidas) =>
    `"${alias}" is READ-ONLY and that statement is not a query.\n` + `    Allowed: ${permitidas}.`,
  faltaArgumento: (nombre) => `Missing argument <${nombre}>. See 'tdb help'.`,
  argAlias: 'alias',
  argSql: 'SQL',
  argTabla: 'table',
  stdinVacio: 'Nothing arrived on standard input.\n' + "    From bash:  tdb query <db> --stdin <<'SQL'  …  SQL",
  faltaRutaFile: 'Missing the path after --file.',
  noExisteArchivo: (ruta) => `The file "${ruta}" does not exist.`,
  archivoVacio: (ruta) => `The file "${ruta}" is empty.`,
  sqlExpandido:
    'Your shell seems to have expanded a variable INSIDE the SQL: the query has a\n' +
    '    system path embedded in it. It usually happens in cmd.exe with a LIKE that\n' +
    '    contains %something%, and it would not fail: it would return other rows.\n' +
    '\n' +
    '    Pass it through standard input, which goes through no parser:\n' +
    "      tdb query <db> --stdin <<'SQL'  …  SQL",
  comandoDesconocido: (cmd) => `Unknown command: "${cmd}". See 'tdb help'.`,

  ayudaClaves: (kv) => `
  In ${kv}, query accepts redis-cli commands, with their quotes; several, one per
  line (they run in order and stop at the first error; # starts a comment).
  “SELECT <n>” switches the database for the following lines.

    tdb query myredis "HGETALL user:1"
    tdb query myredis --stdin <<'REDIS'
    SELECT 1
    TYPE "key with spaces"
    LRANGE queue:tasks 0 9
    REDIS

  tdb schema <alias> ["<pattern>"] lists the keys (a bounded SCAN, never KEYS) with their
  type and TTL; there are no tables, so describe does not apply. There tdb ONLY READS, also
  on write connections: read commands pass (GET, HGETALL, SCAN, TYPE…);
  KEYS, CONFIG, FLUSHALL and any write, never. To write, use the Tessera console.
`,
  ayudaDocumentos: (docs) => `
  In ${docs}, query accepts mongosh syntax, INTERPRETED (no JavaScript is run):
  one statement per command, and “use <db>” on the first line for another database.

    tdb query mymongo "db.customers.find({ name: 'Ana' }).sort({ age: -1 }).limit(5)"

  With operators ($gt, $group…), use --stdin: the shell would expand the $.

    tdb query mymongo --stdin <<'JS'
    use other
    db.orders.aggregate([{ $group: { _id: '$customer', n: { $sum: 1 } } }])
    JS

  There tdb enforces read-only: find, aggregate without $out or $merge,
  countDocuments, distinct… pass; the real guarantee is a user with the read role.
`,
  ayuda: (limite, sinCandado, documentos, claves) => `
  tdb — query the databases configured in Tessera (active profile)

    tdb ls                          List the connections mounted in this session
    tdb doctor                      Why it does not work (shell, context, PATH)
    tdb test <alias>                Check that the connection responds
    tdb query <alias> "<SQL>"       Run a query (limit ${limite} rows)
    tdb schema <alias>              Tables and foreign keys of the database
    tdb describe <alias> <TABLE>    Columns, types, PK and references
    tdb sessions <alias>            Open sessions of your user
    tdb driver ls | install <id>    Database clients

  Options:
    --json          JSON output (for automated use)
    --limit N       Change the row limit of 'query'
    --stdin         Read the SQL from standard input, not from the command line
    --file <path>   Read the SQL from a file

  LONG SQL OR SQL WITH SYMBOLS: pass it with --stdin. On the command line the SQL
  goes through the shell's parser and each one mangles it its own way (cmd expands
  %VAR%, bash expands $ and quotes). From bash, with the delimiter quoted:

    tdb query mydb --stdin <<'SQL'
    SELECT * FROM customers WHERE name LIKE '%García%'
    SQL

  Connections are READ-ONLY unless marked otherwise in Tessera: the server does the
  rejecting (in a file database, Tessera's guard), not this command. ${sinCandado} has
  no such lock: there tdb enforces it, rejecting every write, every EXEC and every
  transaction before sending, and rolling back each batch.
  In ${sinCandado}, GO on its own line separates batches, as in sqlcmd.
${documentos}${claves}`,

  sinFilas: '  (no rows)',
  binario: (n) => `<binary ${n} bytes>`,

  formatoAjeno:
    'This tdb does not recognize the format of the connections registry (db-connections.json),\n' +
    '    so it sees none of them. It may come from a newer version of Tessera (update\n' +
    '    to use them) or from a hand edit of the file; Tessera does not touch it.',
  ilegibleNoJson: 'it is not valid JSON',
  ilegibleNoAbre: (codigo) => `it could not be opened (${codigo})`,
  respaldoInservible: ', and its backup copy (db-connections.json.bak) is not usable either',
  respaldoLegible:
    ', and its backup copy (db-connections.json.bak), although readable, is not used: the next ' +
    'write would replace the registry without having been able to save it aside',
  remedioRoto: 'fix it (it is usually a hand edit: an extra comma, an unclosed quote)',
  remedioInaccesible: 'check its permissions, or whether another program has it open exclusively,',
  registroIlegible: (que, copia, remedio) =>
    `This tdb cannot read the connections registry (db-connections.json): ${que}${copia}, ` +
    'so it sees none of them. Tessera does not touch it so as not to lose what is inside: ' +
    `${remedio} and restart Tessera, which reads it at startup.`,

  sinContexto:
    'This terminal does not carry the Tessera database context.\n' +
    '    It is usually one of these two:\n' +
    '      - The terminal was opened BEFORE mounting the database. Press "Reload" on the\n' +
    '        bottom terminal, or "Restart" in the agent header.\n' +
    '      - It is not a Tessera terminal in native mode (a standalone console, or\n' +
    '        a project in Docker mode).\n' +
    '\n' +
    '    Full diagnosis:  tdb doctor',

  sinNombre: '(unnamed)',
  motorDesconocidoNombre: 'unknown',
  unaDeOtroPerfil: 'a connection from another profile',
  idRepetido: (nombre, otra) =>
    `"${nombre}" shares its identifier with ${otra}: this tdb cannot tell them apart\n` +
    '    and uses the first one in the registry. Tessera keeps it as is; delete it from\n' +
    '    Tessera if it is not needed.',
  motorDesconocido: (nombre, motor) => `"${nombre}" uses an engine (${motor}) this tdb does not know: update Tessera`,
  formaDesconocida: (nombre) =>
    `"${nombre}" is saved in a form this tdb does not recognize.\n` +
    '    It may come from a newer version of Tessera (update to use it) or from a\n' +
    '    hand edit of the file; Tessera keeps it as is.',
  ningunaDisponible: '(none)',
  noHayConexion: (alias, disponibles, otras) =>
    `There is no connection named "${alias}" in this profile.\n    Available: ${disponibles}` +
    (otras > 0 ? `\n    (and ${otras} this tdb cannot use: tdb ls)` : ''),

  destinoCambiadoEntorno: (alias) =>
    `The connection "${alias}" changed since this terminal was opened (its server, port,\n` +
    '    database or user are no longer the same), so tdb does not send it the password from\n' +
    '    back then. Reload the terminal (or "Restart" in the agent header) to use it;\n' +
    '    if it stays the same (db-connections.json was edited by hand with Tessera open), restart Tessera.',
  destinoCambiadoPuente: (alias) =>
    `The connection "${alias}" in the registry is not the one Tessera has loaded (it changed while\n` +
    '    tdb was reading it, or db-connections.json was edited by hand with Tessera open), so tdb\n' +
    '    does not send it its password. Try again; if it stays the same, restart Tessera.',
  puenteNoRespondeOpcional: (alias) =>
    `The Tessera bridge is not responding, so tdb does not know whether "${alias}" has a password.\n` +
    `    Reload the terminal; if it stays the same, restart Tessera.  (tdb doctor)`,
  secretoNoLlego: (alias) =>
    `"${alias}" has a saved password, but it did not reach this terminal (it was saved after\n` +
    '    opening it). Reload the terminal (or "Restart" in the agent header) to use it.',
  puenteNoRespondeObligatorio: (alias) =>
    `The Tessera bridge is not responding, so there are no credentials for "${alias}".\n` +
    `    The password IS saved; what fails is the connection with Tessera.\n` +
    `    Reload the terminal; if it stays the same, restart Tessera.  (tdb doctor)`,
  sinContrasena: (alias) =>
    `There is no password for "${alias}" in this session.\n` +
    `    Save it with "Edit connection…" in the Tessera Databases view and reopen the terminal.`,
  tunelSinPuente: (alias) =>
    `"${alias}" goes through an SSH tunnel, and Tessera opens that tunnel: this terminal cannot reach it\n` +
    '    (the bridge is not responding or is missing). Reload the terminal; if it stays the same, restart Tessera.  (tdb doctor)',
  tunelFallo: (alias, detalle) => `Could not open the SSH tunnel of "${alias}": ${detalle}`,
  tunelSinRespuesta: 'Tessera did not answer in time.',

  responde: (alias, ms, modo) => `\n  ✓ ${alias} responds in ${ms} ms (${modo})`,
  avisoTest: (aviso) => `    Warning: ${aviso}\n`,
  sinDocumentos: '  (no documents)',
  documentos: (n, hayMas) => {
    const nombre = n === 1 ? 'document' : 'documents'
    return hayMas ? `  ${n} ${nombre} (LIMIT reached: there are more; use --limit N for more)\n` : `  ${n} ${nombre}\n`
  },
  filas: (n, tope) =>
    tope ? `\n  ${n} rows (LIMIT reached; use --limit N for more)\n` : `\n  ${n} row${n === 1 ? '' : 's'}\n`,
  conjunto: (i, n) => `  Result set ${i} of ${n}:\n`,
  salidaServidor: '  Server output:',

  clavesSinInfo: '\n  Cannot read the keys per database (no permission for INFO).',
  basesConClaves: '\n  Databases with keys:\n',
  marcaActual: '◄ current',
  otraBaseClaves: '\n  For another database, “SELECT <n>” on the first line of the query.',
  filtroPatron: (patron) => `, pattern ${patron}`,
  clavesDe: (alias, base, filtro, n, hayMas) => `\n  Keys of ${alias} (database ${base}${filtro}) — ${n}${hayMas ? ' (there are more)' : ''}\n`,
  ningunaClave: (hayMas) => (hayMas ? '  (none in what was scanned; there is more to scan)' : '  (none)'),
  topeScan: (alias) => [
    `\n  LIMIT: the SCAN was not completed. Narrow it with a pattern (tdb schema ${alias} "user:*")`,
    '  or use --limit N for more.'
  ],
  sinTablasClaves: (etiqueta, alias) =>
    `\n  ${etiqueta} has no tables or foreign keys. To look at a key:  tdb query ${alias} "TYPE <key>"\n`,
  coleccionesDe: (alias, base, n) => `\n  Collections of ${alias}${base ? ` (database ${base})` : ''} — ${n}\n`,
  noFijaBase: (alias, actual) => `\n  "${alias}" does not set a database: the above is from "${actual}". Databases you can reach:\n`,
  otraBaseDocumentos: (alias) => [
    '\n  To query another database, “use <DATABASE>” on the first line of the statement; and here:',
    `    tdb describe ${alias} <DATABASE>.<COLLECTION>`
  ],
  sinForaneasDocumentos: (etiqueta) => [
    `\n  ${etiqueta} has no foreign keys: references between collections`,
    '  are an application convention ($lookup).'
  ],
  camposDeColeccion: (alias) => `\n  Fields and indexes of a collection:  tdb describe ${alias} <COLLECTION>\n`,
  esquemaDe: (alias, n) => `\n  Schema of ${alias} — ${n} table${n === 1 ? '' : 's'}\n`,
  foraneas: (n) => `\n  Foreign keys (${n}):\n`,
  otraBaseSql: (alias) => [
    '\n  Tables in another database are named database.schema.table, here too:',
    `    tdb describe ${alias} <DATABASE>.<SCHEMA>.<TABLE>`
  ],
  detalleTabla: (alias) => `\n  Details of a table:  tdb describe ${alias} <TABLE>\n`,
  coleccionNoExiste: (tabla, alias, usuario) =>
    `The collection "${tabla}" does not exist in "${alias}"${usuario ? ` or is not visible to ${usuario}` : ''}.`,
  tablaNoVisible: (tabla, usuario) => `The table "${tabla}" does not exist or is not visible to ${usuario}.`,
  tablaNoExiste: (tabla, alias) => `The table "${tabla}" does not exist in "${alias}".`,
  muestraDocumentos: '\n  Top-level fields from a SAMPLE of documents: a rare field may not show up.',
  indices: '\n  Indexes:\n',
  referencias: '\n  References:\n',
  si: 'yes',
  no: 'no',
  sesionesSql: (usuario, alias) => `\n  Open sessions of ${usuario} on ${alias}:\n`,
  conexionesClaves: (usuario, alias) => `\n  Connections of ${usuario ? usuario : 'default'} on ${alias}:\n`,
  operacionesDocumentos: (usuario, alias) =>
    `\n  Operations in progress of ${usuario ? usuario : 'this connection (no user)'} on ${alias}:\n`,
  notaSesiones:
    `\n  The one at the bottom is THIS query and will end when the command finishes.\n` +
    `  Tessera does not keep connections open between invocations.\n`,

  columnasLs: ['ALIAS', 'ENGINE', 'TARGET', 'USER', 'MODE', 'ENVIRONMENT'],
  destinoMotorDesconocido: 'unknown engine: update Tessera',
  destinoFormaDesconocida: 'unrecognized form (see below)',
  destinoIdRepetido: 'repeated id (see below)',
  sinConexionesEspacio: (n) => [
    '\n  The data agent has no database mounted.',
    `  The profile has ${n}: mount them with the databases button`,
    '  in its header, and check the ones you want it to see.\n'
  ],
  sinConexionesProyecto: (n) => [
    '\n  This PROJECT has no database mounted.',
    `  The profile has ${n}: mount them with the database icon`,
    '  in the agent header, and check the ones you want here.\n'
  ],
  sinConexionesPerfil: [
    '\n  There are no connections configured in this profile.',
    '  Add them in the Tessera Databases view (database icon).\n'
  ],
  ningunaVisible: ['\n  No connection is visible in this session.', '  Run  tdb doctor  to see which profile and scope it started with.\n'],
  entornoProduccion: 'PRODUCTION',
  entornoPruebas: 'testing',
  entornoDesarrollo: 'development',
  modoEscritura: 'write',
  modoSoloLectura: 'read-only',
  avisoProduccion: (lista) => [`\n  PRODUCTION: ${lista}.`, '  Do not write to it unless the user explicitly asks for it.'],
  unaDeOtroPerfilCorta: 'one from another profile',
  conQuien: (nombre, otra) => `${nombre} (with ${otra})`,
  noUsablesPorMotor: (lista) => [
    `\n  They need a newer version of Tessera: ${lista}.`,
    '  This tdb does not know their engine and cannot query them: update Tessera.'
  ],
  noUsablesPorForma: (lista) => [
    `\n  How they are saved is not recognized: ${lista}.`,
    '  They may come from a newer version of Tessera (update to use them) or from a',
    '  hand edit of the file; Tessera keeps them as is. This tdb cannot query them.'
  ],
  noUsablesPorId: (lista) => [
    `\n  They share their identifier with another connection: ${lista}.`,
    '  This tdb cannot tell them apart and uses the first one in the registry; Tessera keeps',
    '  them as is. Delete the one that is not needed from Tessera.'
  ],

  shellDesconocido: 'unknown (direct invocation, no shortcut)',
  sinAtajo: '(direct invocation, no shortcut)',
  sinPerfil: '(no TESSERA_PROFILE)',
  sinRegistro: '(no TESSERA_DB_REGISTRY)',
  sinDrivers: '(no TESSERA_DB_DRIVERS)',
  rutaHorneada: '(not set: the shortcut used its built-in path)',
  noExisteConRespaldo: '  <-- DOES NOT EXIST (its backup copy, .bak, is used)',
  noExiste: '  <-- DOES NOT EXIST',
  ambitoSinAcotar: 'not narrowed (sees all of the profile)',
  ambitoEspacio: 'narrowed to the data agent',
  ambitoProyecto: 'narrowed to this project',
  etiquetas: {
    shell: 'shell',
    ejecutable: 'executable',
    guion: 'script',
    atajo: 'shortcut',
    atajoEnPath: 'in PATH',
    perfil: 'profile',
    registro: 'registry',
    drivers: 'drivers',
    ambito: 'scope',
    puente: 'bridge',
    conexiones: 'connections',
    secretos: 'secrets'
  },
  enPath: (posicion) => `yes (position ${posicion})`,
  noEnPath: 'NO',
  estadoPuente: (estado) => PUENTE_EN[estado] || estado,
  conexionesVisibles: (visibles, enPerfil) => `${visibles} visible of ${enPerfil} in the profile`,
  secretosContados: (puente, entorno) => `${puente} from the bridge, ${entorno} in the environment`,
  doctorSinContexto: [
    '  ✗ This terminal does NOT carry the Tessera context.',
    '    Reload the terminal (or restart the agent) AFTER mounting the database.'
  ],
  doctorRegistroNoExiste: ['  ✗ The registry points to a file that does not exist.', '    The terminal may have been opened by another Tessera installation.'],
  doctorPuenteCaido: [
    '  ✗ The Tessera bridge is not responding.',
    '    The list may be out of date and there will be no passwords.',
    '    Reload the terminal; if it persists, restart Tessera.'
  ],
  doctorSinBasesEspacio: '  ! Context is correct, but the data agent has no database mounted.',
  doctorSinBasesProyecto: '  ! Context is correct, but this project has no database mounted.',
  doctorMontalas: '    Mount them with the database icon in the agent header.',
  doctorOtroDestino: (lista) => `They changed since Tessera delivered their password: ${lista}. ` + 'tdb does not send it to their current target.',
  doctorRecargaOReinicia: '    Reload the terminal (or restart the agent); if it stays the same, restart Tessera.',
  doctorSinContrasena: [
    '  ! There are visible connections without a password in this session.',
    '    Save it with "Edit connection…" in the Databases view and reload the terminal.'
  ],
  doctorFaltaArchivo: (lista) => `The file of these cannot be found: ${lista}.`,
  doctorArchivoMovido: '    It was moved, deleted or is on a disconnected drive. tdb test <name> says which one.',
  doctorTodoBien: '  ✓ All good. Try:  tdb ls',
  doctorRespaldo: (formatoAjeno) =>
    'The registry (db-connections.json) does not exist: its backup copy (db-connections.json.bak) is used' +
    (formatoAjeno ? '.' : ', and Tessera will recreate it on its next write.'),

  columnasDrivers: ['ID', 'NAME', 'MB', 'COVERS', 'STATUS'],
  instalado: 'installed',
  noInstalado: 'not installed',
  servidorRespondio: (status, texto) => `the server responded ${status} ${texto}`,
  noEsZip: 'the download is not a ZIP',
  descomprimiendo: '  Unpacking…',
  paqueteSinCentinela: (centinela) => `the package does not contain ${centinela}`,
  driverDesconocido: (id) => `Unknown driver: "${id}". See the available ones with: tdb driver ls`,
  yaInstalado: (nombre) => `\n  ${nombre} is already installed.\n`,
  sinCarpetaDrivers: (variable) => 'I do not know where to install drivers (missing ' + variable + ').',
  dmgLoInstalaTessera: (nombre) =>
    `${nombre} is published as a disk image and Tessera installs it:\n` +
    `    "Download" in "Database clients", in the connection dialog (Databases view).`,
  descargando: (nombre, mb) => `\n  Downloading ${nombre} (${mb} MB)…`,
  instaladoEn: (nombre, destino) => `\n  ✓ ${nombre} installed in ${destino}\n`,
  noSeInstalo: (nombre, motivo) =>
    `Could not install ${nombre}: ${motivo}\n` +
    `    Alternative: download it by hand and register it with "Select folder…" in\n` +
    `    "Database clients", in the connection dialog (Databases view).`,
  subcomandoDriver: (sub) => `Unknown driver subcommand: "${sub}". Use ls | install.`
}

/** Los textos del idioma de esta invocación: inglés solo con `TESSERA_IDIOMA=en`. */
function textosTdb() {
  return process.env.TESSERA_IDIOMA === 'en' ? en : es
}

module.exports = { textosTdb, es, en }
