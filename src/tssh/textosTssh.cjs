// =============================================================================
// Los textos de `tssh` que lee una persona o el agente (ayuda, errores, avisos y `doctor`), en
// español y en inglés. `textosTssh()` elige por `TESSERA_IDIOMA`: 'en' es inglés y cualquier otra
// cosa, español. Sin dependencias: viaja al buzón del contenedor junto a `tssh-container.cjs`.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================
'use strict'

const es = {
  // --- tsshSalida.cjs y tssh.cjs ---
  conPistaDeAyuda: (mensaje) => `${mensaje} La ayuda: tssh help.`,
  falloInesperado: (detalle) => `fallo inesperado: ${detalle}`,

  // --- tsshArgumentos.cjs ---
  timeoutInvalido: (max) => `--timeout necesita un número de segundos mayor que 0 y de ${max} como mucho.`,
  faltaAlias: (ejemplo) => `Falta el alias de la conexión: ${ejemplo}.`,
  aliasLargo: 'El alias es demasiado largo.',
  ejemploRun: 'tssh run <alias> -- <orden>',
  ejemploDoctor: 'tssh doctor <alias>',
  faltaAliasAntesDeGuiones: 'Falta el alias antes de «--»: tssh run <alias> -- <orden>.',
  runSinOpcion: (opcion) => `run no tiene la opción «${opcion}».`,
  faltaOrden: 'Falta la orden: tssh run <alias> -- <orden>.',
  cpSinOpcion: (opcion) => `cp no tiene la opción «${opcion}».`,
  cpOrigenYDestino: 'cp necesita un origen y un destino: tssh cp [-r] <origen> <destino>.',
  lsNoLleva: (argumento) => `ls no lleva «${argumento}».`,
  doctorUnAlias: 'doctor lleva como mucho un alias (entre comillas si tiene espacios).',
  doctorSinOpcion: (opcion) => `doctor no tiene la opción «${opcion}».`,
  subcomandoDesconocido: (sub) => `tssh no tiene el subcomando «${sub}»: son ls, run, cp, doctor y help.`,

  // --- tsshRutas.cjs ---
  rutaMsysDesconocida: (texto) =>
    `No sé a qué carpeta de Windows corresponde «${texto}»: usa una ruta de Windows (C:\\...) o una relativa a la carpeta actual.`,
  dosLadosRemotos: 'Los dos lados son remotos: copia primero a este equipo y después al otro.',
  ningunLadoRemoto: 'Ninguno de los dos lados es remoto: uno tiene que ser <alias>:<ruta>.',

  // --- tsshPuente.cjs ---
  terminalAjena:
    'Esta terminal no la abrió Tessera (faltan TESSERA_DB_PIPE y TESSERA_DB_SESSION): tssh solo funciona en las terminales y los agentes nativos de Tessera.',
  tesseraNoContesta: 'Tessera no contesta: ¿está abierta? Si lo está, recarga la terminal (o reinicia el agente).',
  sesionNoReconocida: 'Tessera no reconoce esta sesión: recarga la terminal (o reinicia el agente).',
  versionDistinta: 'La Tessera abierta no conoce esta versión de tssh: reiníciala (o actualízala).',
  falloInterno: 'Tessera falló al atender la petición (el detalle está en su registro, logs/db.log).',

  // --- tsshOrdenes.cjs ---
  metodos: { contrasena: 'contraseña', clave: 'archivo de clave', sistema: 'claves del sistema' },
  huellaSinConfirmar: 'huella sin confirmar',
  sinFraseGuardada: 'sin la frase guardada',
  sinContrasenaGuardada: 'sin contraseña guardada',
  secretoIlegibleAqui: 'secreto ilegible aquí',
  lista: 'lista',
  excluidas: (n) => {
    if (n === 1) return '(1 conexión más de este perfil no está disponible para los agentes)'
    return n > 1 ? `(${n} conexiones más de este perfil no están disponibles para los agentes)` : ''
  },
  noPuedeLeerConexiones: (aviso) => `Tessera no puede leer ahora las conexiones SSH de este perfil: ${aviso}`,
  sinConexiones: 'Este perfil no tiene ninguna conexión SSH disponible para los agentes.',
  sinGrupo: 'Sin grupo',
  columnasLs: ['ALIAS', 'GRUPO', 'DESTINO', 'MÉTODO', 'ESTADO'],
  noPudoPreparar: 'Tessera no pudo preparar la conexión.',
  topeAgotado: (s) => `se agotó el tope de ${s} s y se cortó la conexión.`,
  noSePudoLanzar: (programa, motivo) => `no se pudo lanzar ${programa}: ${motivo}.`,
  motivoDesconocido: 'motivo desconocido',
  aliasConEspacios: ' Si el alias lleva espacios, ponlo entre comillas.',

  // --- tsshDoctor.cjs ---
  shellDesconocido: 'desconocido (invocación directa, sin atajo)',
  sinAtajo: '(invocación directa, sin atajo)',
  etiquetas: {
    entrega: 'entrega',
    shell: 'shell',
    ejecutable: 'ejecutable',
    guion: 'guion',
    atajo: 'atajo',
    atajoEnPath: 'atajo en PATH',
    conexion: 'conexión',
    huella: 'huella',
    credencial: 'credencial',
    estado: 'estado',
    prueba: 'prueba',
    puente: 'puente',
    perfil: 'perfil',
    clienteSsh: 'cliente SSH',
    contrasenas: 'contraseñas',
    conexiones: 'conexiones'
  },
  entregaContenedor: 'contenedor de Docker, por el buzón del puente (ssh corre en este equipo)',
  enPath: (posicion) => `sí (posición ${posicion})`,
  noEnPath: 'NO',
  clienteNoEncontrado: 'NO ENCONTRADO',
  clienteDeGit: 'el de Git (no se encontró el del sistema)',
  clienteDelSistema: 'el del sistema',
  sinScp: ' (sin scp: tssh cp no funcionará)',
  claveSinFrase: 'la clave no tiene frase',
  clavesDelSistema: 'claves del sistema',
  fraseGuardada: 'frase guardada',
  contrasenaGuardada: 'contraseña guardada',
  guardadaIlegible: 'guardada, pero ilegible en este equipo',
  noGuardada: 'NO GUARDADA',
  conecta: (ms) => `conecta (${ms} ms)`,
  pruebaSinRespuesta: (s) => `sin respuesta en ${s} s`,
  pruebaFalla: (codigo) => `falla (código ${codigo})`,
  todoBienRun: (alias) => `Todo en orden. Prueba:  tssh run ${alias} -- uptime`,
  equipoNoContesta: 'El equipo no contesta: comprueba con el usuario la red o la VPN.',
  sshNoEntro: 'ssh no pudo entrar; el usuario puede pulsar «Probar» en la conexión para ver el motivo.',
  noHayAlias: (alias) => `No hay ninguna conexión disponible llamada «${alias}».`,
  huellaConfirmada: 'confirmada',
  huellaPorConfirmar: 'SIN CONFIRMAR',
  puenteNoResponde: 'no responde',
  puenteResponde: 'responde',
  contrasenasSi: 'Tessera puede darlas',
  contrasenasNo: 'falta el programa de contraseñas de Tessera',
  conexionesDisponibles: (n, excluidas) =>
    `${n} disponibles para los agentes${excluidas ? `, ${excluidas} más que no lo están` : ''}`,
  sinClienteSsh: 'No se encontró el cliente SSH del sistema: tssh no puede conectar.',
  todoBienLs: 'Todo en orden. Prueba:  tssh ls',
  todoBienSinConexiones: 'Todo en orden, pero este perfil no tiene ninguna conexión disponible para los agentes.',

  // --- tssh-container.cjs ---
  sinContextoContenedor: 'Esta terminal no lleva el contexto de Tessera: recarga la terminal (o reinicia el agente).',
  buzonSinMontar: (buzon) => `El puente al host no está montado (${buzon} no existe): recarga la terminal.`,
  buzonNoResponde: 'El puente al host no responde: recarga la terminal; si sigue, reinicia Tessera.',
  cpTopeMiB: (mib) => `En modo Docker, tssh cp mueve como mucho ${mib} MiB por vez: copia por partes.`,
  cpTopeArchivos: (n) => `En modo Docker, tssh cp mueve como mucho ${n} archivos por vez: copia por partes.`,
  noExisteLocal: (local) => `No existe «${local}».`,
  copiaEntera: (local) => `No se puede copiar «${local}» entero: elige una carpeta concreta.`,
  niArchivoNiCarpeta: (local) => `«${local}» no es un archivo ni una carpeta.`,
  esCarpeta: (local) => `«${local}» es una carpeta: usa tssh cp -r.`,
  respuestaIncomprensible: 'La respuesta de Tessera no se entiende.',
  entradaGrande: (mib) => `La entrada supera los ${mib} MiB que admite el puente al host.`,
  puenteSinRespuesta: (s) => `El puente no respondió en ${s} s: comprueba que Tessera sigue abierta y recarga la terminal.`,

  // --- tsshAyuda.cjs ---
  ayuda: (c) => `
  tssh — las conexiones SSH del perfil de Tessera, para ti y para los agentes

  tssh ls [--json]
      Las conexiones que el usuario dejó disponibles para los agentes, con su destino, su
      método y si están listas (la huella confirmada y, si la piden, la contraseña guardada).
      Las demás no se nombran: solo cuántas son.

  tssh run <alias> [--timeout S] [--stdin] -- <orden>
      Ejecuta la orden en el equipo, sin terminal, con su salida en vivo, y sale con su código.
      Sin --stdin la orden no recibe entrada; con --stdin recibe la de tssh:
        tssh run web -- uptime
        tssh run "nas casa" -- df -h /
        tssh run web --stdin -- 'cat > /tmp/nota.txt' < nota.txt
      --timeout S corta la conexión a los S segundos (sale con ${c.tope}). Sin él, no hay tope.

  tssh cp [-r] <origen> <destino>
      Copia con scp entre este equipo y una conexión. El lado remoto es <alias>:<ruta> (una ruta
      relativa, o vacía, es desde la carpeta del usuario remoto); -r copia carpetas:
        tssh cp informe.txt web:/tmp/
        tssh cp -r "nas casa:/var/log/nginx" ./logs
      En Windows, una letra de unidad (C:\\…) es siempre local.

  tssh doctor [alias]
      Diagnostica: el atajo, el puente con Tessera, el cliente SSH y, con un alias, la conexión y
      una prueba real.

  tssh help
      Esta ayuda.

  Si el alias lleva espacios, ponlo entre comillas; sus comillas pueden escribirse rectas.
  tssh nunca pide ni enseña contraseñas: las pone Tessera. Solo conecta con equipos cuya huella
  ya aceptó una persona desde la terminal de Tessera (o con «Probar»).

  Códigos de salida. Si la orden o la copia llegan a correr, el código es el suyo, y 255 si ssh
  no pudo conectar o entrar (tssh dice por qué). Los de tssh salen antes de conectar:
    ${c.uso}    uso incorrecto (argumentos, subcomando) o desde WSL
    ${c.puente}    Tessera no contesta o no reconoce esta terminal
    ${c.alias}    no hay ninguna conexión disponible con ese alias
    ${c.huella}    la huella del servidor no está confirmada, o cambió
    ${c.noUsable}    la conexión no se puede usar ahora (falta su contraseña, la copia de su
         clave o el cliente SSH)
    ${c.tope}  se agotó --timeout

  En PowerShell, un -- sin comillas no llega a tssh: lo entiende igual (tras el alias, la orden
  empieza en la primera palabra que no es una opción de tssh); escribe '--' si la orden empieza
  por --stdin o --timeout. La salida es texto: para binarios, tssh cp. En cmd.exe, las
  %variables% de tu línea se expanden antes de llegar a tssh.
`
}

const en = {
  conPistaDeAyuda: (mensaje) => `${mensaje} Help: tssh help.`,
  falloInesperado: (detalle) => `unexpected failure: ${detalle}`,

  timeoutInvalido: (max) => `--timeout needs a number of seconds greater than 0 and at most ${max}.`,
  faltaAlias: (ejemplo) => `Missing the connection alias: ${ejemplo}.`,
  aliasLargo: 'The alias is too long.',
  ejemploRun: 'tssh run <alias> -- <command>',
  ejemploDoctor: 'tssh doctor <alias>',
  faltaAliasAntesDeGuiones: 'Missing the alias before “--”: tssh run <alias> -- <command>.',
  runSinOpcion: (opcion) => `run has no option “${opcion}”.`,
  faltaOrden: 'Missing the command: tssh run <alias> -- <command>.',
  cpSinOpcion: (opcion) => `cp has no option “${opcion}”.`,
  cpOrigenYDestino: 'cp needs a source and a destination: tssh cp [-r] <source> <destination>.',
  lsNoLleva: (argumento) => `ls does not take “${argumento}”.`,
  doctorUnAlias: 'doctor takes at most one alias (quoted if it has spaces).',
  doctorSinOpcion: (opcion) => `doctor has no option “${opcion}”.`,
  subcomandoDesconocido: (sub) => `tssh has no subcommand “${sub}”: they are ls, run, cp, doctor and help.`,

  rutaMsysDesconocida: (texto) =>
    `I do not know which Windows folder “${texto}” is: use a Windows path (C:\\...) or one relative to the current folder.`,
  dosLadosRemotos: 'Both sides are remote: copy to this computer first and then to the other one.',
  ningunLadoRemoto: 'Neither side is remote: one of them has to be <alias>:<path>.',

  terminalAjena:
    'This terminal was not opened by Tessera (TESSERA_DB_PIPE and TESSERA_DB_SESSION are missing): tssh only works in Tessera terminals and native agents.',
  tesseraNoContesta: 'Tessera is not answering: is it open? If it is, reload the terminal (or restart the agent).',
  sesionNoReconocida: 'Tessera does not recognize this session: reload the terminal (or restart the agent).',
  versionDistinta: 'The open Tessera does not know this version of tssh: restart it (or update it).',
  falloInterno: 'Tessera failed while handling the request (the details are in its log, logs/db.log).',

  metodos: { contrasena: 'password', clave: 'key file', sistema: 'system keys' },
  huellaSinConfirmar: 'fingerprint not confirmed',
  sinFraseGuardada: 'passphrase not saved',
  sinContrasenaGuardada: 'password not saved',
  secretoIlegibleAqui: 'secret unreadable here',
  lista: 'ready',
  excluidas: (n) => {
    if (n === 1) return '(1 more connection of this profile is not available to agents)'
    return n > 1 ? `(${n} more connections of this profile are not available to agents)` : ''
  },
  noPuedeLeerConexiones: (aviso) => `Tessera cannot read the SSH connections of this profile right now: ${aviso}`,
  sinConexiones: 'This profile has no SSH connection available to agents.',
  sinGrupo: 'No group',
  columnasLs: ['ALIAS', 'GROUP', 'TARGET', 'METHOD', 'STATUS'],
  noPudoPreparar: 'Tessera could not prepare the connection.',
  topeAgotado: (s) => `the ${s} s limit ran out and the connection was cut.`,
  noSePudoLanzar: (programa, motivo) => `could not launch ${programa}: ${motivo}.`,
  motivoDesconocido: 'unknown reason',
  aliasConEspacios: ' If the alias has spaces, put it in quotes.',

  shellDesconocido: 'unknown (direct invocation, no shortcut)',
  sinAtajo: '(direct invocation, no shortcut)',
  etiquetas: {
    entrega: 'delivery',
    shell: 'shell',
    ejecutable: 'executable',
    guion: 'script',
    atajo: 'shortcut',
    atajoEnPath: 'in PATH',
    conexion: 'connection',
    huella: 'fingerprint',
    credencial: 'credential',
    estado: 'status',
    prueba: 'test',
    puente: 'bridge',
    perfil: 'profile',
    clienteSsh: 'SSH client',
    contrasenas: 'passwords',
    conexiones: 'connections'
  },
  entregaContenedor: 'Docker container, through the bridge mailbox (ssh runs on this computer)',
  enPath: (posicion) => `yes (position ${posicion})`,
  noEnPath: 'NO',
  clienteNoEncontrado: 'NOT FOUND',
  clienteDeGit: "Git's (the system one was not found)",
  clienteDelSistema: 'the system one',
  sinScp: ' (no scp: tssh cp will not work)',
  claveSinFrase: 'the key has no passphrase',
  clavesDelSistema: 'system keys',
  fraseGuardada: 'passphrase saved',
  contrasenaGuardada: 'password saved',
  guardadaIlegible: 'saved, but unreadable on this computer',
  noGuardada: 'NOT SAVED',
  conecta: (ms) => `connects (${ms} ms)`,
  pruebaSinRespuesta: (s) => `no response in ${s} s`,
  pruebaFalla: (codigo) => `fails (code ${codigo})`,
  todoBienRun: (alias) => `All good. Try:  tssh run ${alias} -- uptime`,
  equipoNoContesta: 'The computer is not answering: check the network or the VPN with the user.',
  sshNoEntro: 'ssh could not log in; the user can press “Test” on the connection to see why.',
  noHayAlias: (alias) => `There is no available connection named “${alias}”.`,
  huellaConfirmada: 'confirmed',
  huellaPorConfirmar: 'NOT CONFIRMED',
  puenteNoResponde: 'not responding',
  puenteResponde: 'responding',
  contrasenasSi: 'Tessera can provide them',
  contrasenasNo: "Tessera's password program is missing",
  conexionesDisponibles: (n, excluidas) =>
    `${n} available to agents${excluidas ? `, ${excluidas} more that are not` : ''}`,
  sinClienteSsh: 'The system SSH client was not found: tssh cannot connect.',
  todoBienLs: 'All good. Try:  tssh ls',
  todoBienSinConexiones: 'All good, but this profile has no connection available to agents.',

  sinContextoContenedor: 'This terminal does not carry the Tessera context: reload the terminal (or restart the agent).',
  buzonSinMontar: (buzon) => `The bridge to the host is not mounted (${buzon} does not exist): reload the terminal.`,
  buzonNoResponde: 'The bridge to the host is not responding: reload the terminal; if it persists, restart Tessera.',
  cpTopeMiB: (mib) => `In Docker mode, tssh cp moves at most ${mib} MiB at a time: copy in parts.`,
  cpTopeArchivos: (n) => `In Docker mode, tssh cp moves at most ${n} files at a time: copy in parts.`,
  noExisteLocal: (local) => `“${local}” does not exist.`,
  copiaEntera: (local) => `“${local}” cannot be copied whole: choose a specific folder.`,
  niArchivoNiCarpeta: (local) => `“${local}” is neither a file nor a folder.`,
  esCarpeta: (local) => `“${local}” is a folder: use tssh cp -r.`,
  respuestaIncomprensible: 'The response from Tessera cannot be understood.',
  entradaGrande: (mib) => `The input exceeds the ${mib} MiB the bridge to the host accepts.`,
  puenteSinRespuesta: (s) => `The bridge did not respond within ${s} s: check that Tessera is still open and reload the terminal.`,

  ayuda: (c) => `
  tssh — the SSH connections of the Tessera profile, for you and for agents

  tssh ls [--json]
      The connections the user made available to agents, with their target, their
      method and whether they are ready (fingerprint confirmed and, if they need it, password saved).
      The others are not named: only how many there are.

  tssh run <alias> [--timeout S] [--stdin] -- <command>
      Runs the command on the computer, without a terminal, with its output live, and exits with its code.
      Without --stdin the command gets no input; with --stdin it gets tssh's:
        tssh run web -- uptime
        tssh run "home nas" -- df -h /
        tssh run web --stdin -- 'cat > /tmp/note.txt' < note.txt
      --timeout S cuts the connection after S seconds (exits with ${c.tope}). Without it, there is no limit.

  tssh cp [-r] <source> <destination>
      Copies with scp between this computer and a connection. The remote side is <alias>:<path> (a
      relative or empty path starts at the remote user's home folder); -r copies folders:
        tssh cp report.txt web:/tmp/
        tssh cp -r "home nas:/var/log/nginx" ./logs
      On Windows, a drive letter (C:\\…) is always local.

  tssh doctor [alias]
      Diagnoses: the shortcut, the bridge with Tessera, the SSH client and, with an alias, the
      connection and a real test.

  tssh help
      This help.

  If the alias has spaces, put it in quotes; its quotes can be typed straight.
  tssh never asks for or shows passwords: Tessera provides them. It only connects to computers whose
  fingerprint a person already accepted from the Tessera terminal (or with “Test”).

  Exit codes. If the command or the copy gets to run, the code is its own, and 255 if ssh
  could not connect or log in (tssh says why). tssh's own codes come before connecting:
    ${c.uso}    wrong usage (arguments, subcommand) or from WSL
    ${c.puente}    Tessera is not answering or does not recognize this terminal
    ${c.alias}    there is no available connection with that alias
    ${c.huella}    the server fingerprint is not confirmed, or it changed
    ${c.noUsable}    the connection cannot be used now (its password, the copy of its
         key or the SSH client is missing)
    ${c.tope}  --timeout ran out

  In PowerShell, an unquoted -- does not reach tssh: it understands it anyway (after the alias,
  the command starts at the first word that is not a tssh option); type '--' if the command
  starts with --stdin or --timeout. The output is text: for binaries, tssh cp. In cmd.exe, the
  %variables% in your line are expanded before reaching tssh.
`
}

/** Los textos del idioma de esta invocación: inglés solo con `TESSERA_IDIOMA=en`. */
function textosTssh() {
  return process.env.TESSERA_IDIOMA === 'en' ? en : es
}

module.exports = { textosTssh, es, en }
