// =============================================================================
// Los textos de `tctx` que lee una persona o el agente (ayuda, errores y avisos), en español y en
// inglés. `textosTctx()` elige por `TESSERA_IDIOMA`: 'en' es inglés y cualquier otra cosa, español.
// Sin dependencias: viaja al buzón del contenedor junto a `tctx-container.cjs`.
// Decisiones: docs/decisiones/app/idioma.md, docs/decisiones/agentes/reglas-del-perfil.md,
// docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
'use strict'

const es = {
  // --- tctxSalida.cjs y tctx.cjs ---
  conPistaDeAyuda: (mensaje) => `${mensaje} La ayuda: tctx help.`,
  falloInesperado: (detalle) => `fallo inesperado: ${detalle}`,

  // --- tctxArgumentos.cjs ---
  subcomandoDesconocido: (sub) => `tctx no tiene el subcomando «${sub}»: son reglas, proponer, traspaso, buscar y help.`,
  reglasNoLleva: (argumento) => `reglas no lleva «${argumento}».`,
  traspasoNoLleva: (argumento) => `traspaso no lleva «${argumento}».`,
  buscarSinOpcion: (opcion) => `buscar no tiene la opción «${opcion}» (para buscarla como texto, ponla detrás de --).`,
  maxInvalido: (max) => `--max es un número entre 1 y ${max}.`,
  faltaBusqueda: 'Falta qué buscar: tctx buscar <palabras> (todas tienen que estar en el mensaje), o con --exacta para la frase tal cual.',
  busquedaLarga: (max) => `La búsqueda pasa de ${max} caracteres: busca unas pocas palabras clave.`,
  proponerSinOpcion: (opcion) => `proponer no tiene la opción «${opcion}».`,
  faltaValor: (opcion) => `${opcion} necesita un valor.`,
  dosFuentes: 'Da el texto de una sola forma: --archivo, --texto o «-» (la entrada estándar).',
  faltaFuente: 'Falta el texto nuevo entero: tctx proponer --archivo <ruta>, --texto "<texto>" o «-» para leerlo de la entrada estándar.',

  // --- tctxEntrada.cjs ---
  noExisteArchivo: (ruta) => `No se puede leer «${ruta}».`,
  archivoGrande: (kib) => `El archivo pasa de ${kib} KiB: no son unas reglas.`,
  entradaGrande: (kib) => `La entrada pasa de ${kib} KiB: no son unas reglas.`,
  entradaSinTuberia: 'No hay nada por la entrada estándar: `-` lee un texto que llega por una tubería (`cat reglas.md | tctx proponer -`). Usa una tubería, `--archivo` o `--texto`.',
  entradaSinFin: (segundos) => `La entrada no terminó en ${segundos} s: ciérrala al acabar el texto o usa \`--archivo\`.`,
  rutaMsys: (ruta) => `No sé a qué carpeta de Windows corresponde «${ruta}»: usa una ruta relativa o de Windows (C:\\...).`,

  // --- tctxPuente.cjs y tctxOrdenes.cjs ---
  terminalAjena:
    'Esta terminal no la abrió Tessera (faltan TESSERA_DB_PIPE y TESSERA_DB_SESSION): tctx solo funciona en las terminales y los agentes de Tessera.',
  tesseraNoContesta: 'Tessera no contesta: ¿está abierta? Si lo está, recarga la terminal (o reinicia el agente).',
  sesionNoReconocida: 'Tessera no reconoce esta sesión: recarga la terminal (o reinicia el agente).',
  versionDistinta: 'La Tessera abierta no conoce esta versión de tctx: reiníciala (o actualízala).',
  falloInterno: 'Tessera falló al atender la petición (el detalle está en su registro, logs/db.log).',
  respuestaIncomprensible: 'La respuesta de Tessera no se entiende.',
  sinReglas: 'Este perfil no tiene reglas.',
  sinPerfil: 'El perfil de esta sesión ya no existe: recarga la terminal.',
  sinTraspaso: 'Esta sesión no tiene ningún traspaso: solo lo tiene la que Tessera abrió para continuar el trabajo de otro agente, mientras sigue abierta.',
  propuestaVacia: 'La propuesta está vacía: manda la versión entera nueva de las reglas.',
  propuestaLarga: (largo, max) => `La propuesta tiene ${largo} caracteres y las reglas admiten ${max} como mucho: acórtala.`,
  propuestaIgual: 'La propuesta es igual a las reglas vigentes: no hay nada que proponer.',
  motivoLargo: (max) => `El motivo pasa de ${max} caracteres: resúmelo.`,
  peticionInvalida: 'Tessera no entendió la petición.',
  propuestaEnviada:
    'Propuesta enviada. El usuario la revisará en Tessera: no está aprobada hasta que la acepte, y una nueva sustituye a esta.',
  busquedaOcupada: 'Tessera ya está atendiendo otras búsquedas: repite en unos segundos.',
  sinCoincidencias: 'Sin coincidencias en las conversaciones de este proyecto.',
  cabeceraBusqueda: (n) => `${n === 1 ? '1 coincidencia' : `${n} coincidencias`} en las conversaciones de este proyecto, de la más reciente a la más antigua:`,
  cuentaNativa: 'Nativa',
  rolUsuario: 'Usuario',
  rolAgente: 'Agente',
  hayMas: 'Hay más coincidencias: afina la búsqueda (más palabras o --exacta) o pide más con --max.',
  busquedaCortada: 'La búsqueda se cortó al llegar a su tope de lectura: puede haber más en conversaciones más antiguas; afina la búsqueda.',
  soloSuCuenta: (cuenta) =>
    cuenta
      ? `Desde Docker solo se busca en tu cuenta (${cuenta}): las conversaciones de las demás cuentas y las nativas no se ven desde aquí.`
      : 'Desde Docker solo se busca en tu propia cuenta: las conversaciones de las demás cuentas y las nativas no se ven desde aquí.',

  // --- tctx-container.cjs ---
  sinContextoContenedor: 'Esta terminal no lleva el contexto de Tessera: recarga la terminal (o reinicia el agente).',
  buzonSinMontar: (buzon) => `El puente al host no está montado (${buzon} no existe): recarga la terminal.`,
  buzonNoResponde: 'El puente al host no responde: recarga la terminal; si sigue, reinicia Tessera.',
  puenteSinRespuesta: (s) => `El puente no respondió en ${s} s: comprueba que Tessera sigue abierta y recarga la terminal.`,

  // --- tctxAyuda (tctxOrdenes.cjs) ---
  ayuda: (c, max) => `
  tctx — las reglas del perfil de Tessera para sus agentes, el traspaso entre agentes y la búsqueda en lo hablado

  tctx reglas
      Las reglas vigentes del perfil, tal cual. Pueden haber cambiado desde que arrancó el agente.

  tctx proponer (--archivo <ruta> | --texto "<texto>" | -) [--motivo "<motivo>"]
      Propone al usuario la versión ENTERA nueva de las reglas (${max} caracteres como mucho). No
      cambia nada: queda pendiente hasta que el usuario vea el cambio y lo acepte, lo edite o lo
      descarte. Una propuesta nueva sustituye a la anterior. El texto llega de una de tres formas:
        tctx reglas > reglas.md          (y se edita el archivo)
        tctx proponer --archivo reglas.md --motivo "me lo pidió dos veces"
        tctx proponer --texto "Una sola regla corta."
        tctx proponer - < reglas.md      (o canalizado: ... | tctx proponer -)
      --archivo es lo más seguro en cualquier shell: el texto no pasa por las comillas.

  tctx traspaso
      El traspaso del trabajo que empezó otro agente en este proyecto, si Tessera abrió esta sesión para
      continuarlo: lo último de su conversación y el estado de git. Solo esta sesión lo tiene.

  tctx buscar <palabras> [--exacta] [--max N]
      Busca en lo que se habló en este proyecto (los mensajes del usuario y de los agentes, de cualquier
      agente y cuenta del perfil; desde Docker, solo en tu cuenta). Sin distinguir mayúsculas ni tildes,
      todas las palabras tienen que estar en el mensaje; con --exacta, la frase tal cual. Da las más
      recientes primero (8, o hasta 20 con --max) con un trozo alrededor. No hacen falta comillas:
        tctx buscar migración base de datos
        tctx buscar --exacta no subir a main

  tctx help
      Esta ayuda.

  Códigos de salida:
    0    hecho
    ${c.uso}    uso incorrecto (argumentos, subcomando) o desde WSL
    ${c.puente}    Tessera no contesta o no reconoce esta terminal
    ${c.rechazo}    Tessera rechazó la propuesta (vacía, demasiado larga o igual a las vigentes), no hay traspaso
         o no pudo atender la búsqueda

  En PowerShell, un archivo con «Out-File» sin -Encoding se lee igual (UTF-16); en cmd.exe, las
  %variables% de tu línea se expanden antes de llegar a tctx.
`
}

const en = {
  conPistaDeAyuda: (mensaje) => `${mensaje} Help: tctx help.`,
  falloInesperado: (detalle) => `unexpected failure: ${detalle}`,

  subcomandoDesconocido: (sub) => `tctx has no subcommand “${sub}”: valid subcommands are reglas, proponer, traspaso, buscar and help.`,
  reglasNoLleva: (argumento) => `reglas does not take “${argumento}”.`,
  traspasoNoLleva: (argumento) => `traspaso does not take “${argumento}”.`,
  buscarSinOpcion: (opcion) => `buscar has no option “${opcion}” (to search for it as text, put it after --).`,
  maxInvalido: (max) => `--max must be a number between 1 and ${max}.`,
  faltaBusqueda: 'Missing search terms: tctx buscar <words> (the message must contain all of them), or --exacta for the exact phrase.',
  busquedaLarga: (max) => `The search is longer than ${max} characters: search for a few keywords.`,
  proponerSinOpcion: (opcion) => `proponer has no option “${opcion}”.`,
  faltaValor: (opcion) => `${opcion} requires a value.`,
  dosFuentes: 'Provide the text in only one way: --archivo, --texto or “-” (standard input).',
  faltaFuente: 'Missing the complete new text: tctx proponer --archivo <path>, --texto "<text>" or “-” to read it from standard input.',

  noExisteArchivo: (ruta) => `“${ruta}” cannot be read.`,
  archivoGrande: (kib) => `The file is larger than ${kib} KiB: that is too large for rules.`,
  entradaGrande: (kib) => `The input is larger than ${kib} KiB: that is too large for rules.`,
  entradaSinTuberia: 'There is nothing on standard input: `-` reads text from a pipe (`cat rules.md | tctx proponer -`). Use a pipe, `--archivo` or `--texto`.',
  entradaSinFin: (segundos) => `The input did not end within ${segundos} s: close it when the text is complete or use \`--archivo\`.`,
  rutaMsys: (ruta) => `Cannot tell which Windows folder “${ruta}” is: use a relative path or a Windows path (C:\\...).`,

  terminalAjena:
    'This terminal was not opened by Tessera (TESSERA_DB_PIPE and TESSERA_DB_SESSION are missing): tctx only works in Tessera terminals and agents.',
  tesseraNoContesta: 'Tessera is not responding: is it open? If it is, reload the terminal (or restart the agent).',
  sesionNoReconocida: 'Tessera does not recognize this session: reload the terminal (or restart the agent).',
  versionDistinta: 'The running Tessera does not support this version of tctx: restart it (or update it).',
  falloInterno: 'Tessera failed while handling the request (the details are in its log, logs/db.log).',
  respuestaIncomprensible: 'Tessera returned a response that cannot be interpreted.',
  sinReglas: 'This profile has no rules.',
  sinPerfil: 'The profile of this session no longer exists: reload the terminal.',
  sinTraspaso: 'This session has no handoff: only a session that Tessera opened to continue another agent’s work has one, while it stays open.',
  propuestaVacia: 'The proposal is empty: send the whole new version of the rules.',
  propuestaLarga: (largo, max) => `The proposal has ${largo} characters and the rules allow at most ${max}: shorten it.`,
  propuestaIgual: 'The proposal is the same as the current rules: there is nothing to propose.',
  motivoLargo: (max) => `The reason is longer than ${max} characters: summarize it.`,
  peticionInvalida: 'Tessera did not understand the request.',
  propuestaEnviada:
    'Proposal sent. The user will review it in Tessera: it is not approved until they accept it, and a new one replaces this one.',
  busquedaOcupada: 'Tessera is already handling other searches: try again in a few seconds.',
  sinCoincidencias: 'No matches in the conversations of this project.',
  cabeceraBusqueda: (n) => `${n === 1 ? '1 match' : `${n} matches`} in the conversations of this project, from newest to oldest:`,
  cuentaNativa: 'Native',
  rolUsuario: 'User',
  rolAgente: 'Agent',
  hayMas: 'There are more matches: refine the search (more words or --exacta) or request more with --max.',
  busquedaCortada: 'The search stopped at its reading limit: older conversations might have more matches; refine the search.',
  soloSuCuenta: (cuenta) =>
    cuenta
      ? `From Docker, only your account is searched (${cuenta}): conversations from other accounts and native ones are not visible from here.`
      : 'From Docker, only your own account is searched: conversations from other accounts and native ones are not visible from here.',

  sinContextoContenedor: 'This terminal does not have the Tessera context: reload the terminal (or restart the agent).',
  buzonSinMontar: (buzon) => `The bridge to the host is not mounted (${buzon} does not exist): reload the terminal.`,
  buzonNoResponde: 'The bridge to the host is not responding: reload the terminal; if the problem persists, restart Tessera.',
  puenteSinRespuesta: (s) => `The bridge did not respond within ${s} s: check that Tessera is still open and reload the terminal.`,

  ayuda: (c, max) => `
  tctx — the Tessera profile rules for its agents, the handoff between agents and the search in past conversations

  tctx reglas
      Shows the current profile rules, as they are. They might have changed since the agent started.

  tctx proponer (--archivo <path> | --texto "<text>" | -) [--motivo "<reason>"]
      Proposes to the user the COMPLETE new version of the rules (at most ${max} characters). It
      changes nothing: it stays pending until the user reviews the change and accepts it, edits it or
      discards it. A new proposal replaces the previous one. Provide the text in one of three ways:
        tctx reglas > rules.md           (then edit the file)
        tctx proponer --archivo rules.md --motivo "they asked for it twice"
        tctx proponer --texto "A single short rule."
        tctx proponer - < rules.md       (or piped: ... | tctx proponer -)
      --archivo is the safest option in any shell: the text does not go through quoting.

  tctx traspaso
      Shows the handoff of the work another agent started in this project, if Tessera opened this session
      to continue it: the latest part of its conversation and the Git status. Only this session has it.

  tctx buscar <words> [--exacta] [--max N]
      Searches past conversations in this project (messages from the user and the agents, from any agent
      and account in the profile; from Docker, only your account). Ignoring case and accents, the message
      must contain all the words; with --exacta, the exact phrase. Shows the most recent first (8, or
      up to 20 with --max) with an excerpt around each match. No quotes needed:
        tctx buscar database migration
        tctx buscar --exacta do not push to main

  tctx help
      Shows this help.

  Exit codes:
    0    done
    ${c.uso}    wrong usage (arguments, subcommand) or run from WSL
    ${c.puente}    Tessera is not responding or does not recognize this terminal
    ${c.rechazo}    Tessera rejected the proposal (empty, too long or the same as the current rules), there is no
         handoff or it could not handle the search

  In PowerShell, a file written with “Out-File” without -Encoding is still read correctly (UTF-16); in
  cmd.exe, %variables% in your command line are expanded before they reach tctx.
`
}

/** Los textos del idioma de esta invocación: inglés solo con `TESSERA_IDIOMA=en`. */
function textosTctx() {
  return process.env.TESSERA_IDIOMA === 'en' ? en : es
}

module.exports = { textosTctx, es, en }
