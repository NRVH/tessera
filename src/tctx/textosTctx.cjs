// =============================================================================
// Los textos de `tctx` que lee una persona o el agente (ayuda, errores y avisos), en español y en
// inglés. `textosTctx()` elige por `TESSERA_IDIOMA`: 'en' es inglés y cualquier otra cosa, español.
// Sin dependencias: viaja al buzón del contenedor junto a `tctx-container.cjs`.
// Decisiones: docs/decisiones/app/idioma.md, docs/decisiones/agentes/reglas-del-perfil.md,
// docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
'use strict'

const es = {
  delegacionUso: 'Use tctx cuentas; tctx modelos --agente claude-code|codex [--cuenta nombre|auto] [--actualizar]; tctx delegar --agente claude-code|codex [--cuenta nombre|auto] [--modelo <modelo>] [--esfuerzo <nivel>] [--solo-lectura] [--sin-esperar]; tctx tareas; o tctx tarea <id> [--esperar [--max-segundos N] | --cancelar | --continuar [--modelo <modelo>] [--esfuerzo <nivel>] [--sin-esperar]]. Para delegar o continuar, envíe la orden por una tubería (con o sin "-") o con --archivo <ruta>, exclusivamente.',
  sinCuentas: 'Este perfil no tiene cuentas de Docker de Claude Code ni de Codex.',
  comoDelegar: 'Para delegar: tctx delegar --agente claude-code|codex [--cuenta nombre|auto] --archivo <ruta>.',
  estadosCuenta: { lista: 'lista', 'sin-credencial': 'sin credencial', agotada: 'agotada' },
  estadosTarea: { hecha: 'hecha', fallida: 'fallida', cancelada: 'cancelada', 'en-marcha': 'en marcha', interrumpida: 'interrumpida' },
  sinTareas: 'No hay tareas delegadas en este proyecto.',
  haceSegundos: (s) => `iniciada hace ${s} s`,
  comoReanudar: 'Para reanudar una tarea interrumpida: tctx tarea <id> --continuar, con una orden que pida revisar lo que quedó hecho y seguir.',
  tareaInterrumpida: (id) => `La tarea ${id} se interrumpió al apagarse Tessera o el equipo. Revise lo que quedó en el proyecto y reanúdela con tctx tarea ${id} --continuar, o cancélela con --cancelar.`,
  tareaInterrumpidaSinConversacion: 'La tarea se interrumpió antes de iniciar su conversación; lance una nueva con tctx delegar.',
  tareaSigueEnMarcha: (id) => `Se alcanzó el tiempo de espera; la tarea sigue en marcha. Vuelva a esperar con tctx tarea ${id} --esperar.`,
  otrasEscribiendo: (n) => `Hay ${n} ${n === 1 ? 'tarea que puede modificar' : 'tareas que pueden modificar'} este proyecto en este momento; compruebe que no trabajen sobre los mismos archivos.`,
  cabeceraModelos: (agente, cuenta, hora) => `Modelos de ${agente} en la cuenta ${cuenta}${hora ? ` (consultados a las ${hora})` : ''}:`,
  esfuerzosModelo: (lista) => `esfuerzos: ${lista}`,
  sinEsfuerzos: 'no admite niveles',
  modeloPorDefecto: 'predeterminado',
  comoUsarModelo: (agente) => `Para usar uno: tctx delegar --agente ${agente} --modelo <modelo> [--esfuerzo <nivel>]. Sin esas opciones se usa la configuración de la cuenta.`,
  reinicioDesconocido: 'desconocido',
  ventanaCuenta: (etiqueta, porcentaje, reinicio) => `${etiqueta}: ${porcentaje} %; reinicio: ${reinicio}`,
  tareasEnMarcha: (n) => `${n} tareas en marcha`,
  tareaLanzada: (id, agente, cuenta) => `Tarea ${id} · ${agente} · ${cuenta}. Consulte: tctx tarea ${id}. La tarea sigue en Tessera si tctx se interrumpe.`,
  tareaCancelada: (id) => `Tarea ${id} cancelada.`,
  tareaSinPuente: (id) => `Tessera no contesta tras cinco consultas consecutivas. La tarea puede seguir en marcha; consulte: tctx tarea ${id}.`,
  progresoTarea: (id, segundos, actividad) => `Tarea ${id}: ${segundos} s transcurridos${actividad ? ` · ${actividad}` : ''}.`,
  estadoTarea: (agente, cuenta, estado, segundos, inactividad, soloLectura) => `${agente} · ${cuenta} · ${estado} · ${segundos} s transcurridos · última actividad hace ${inactividad} s · ${soloLectura ? 'solo lectura' : 'lectura y escritura'}`,
  falloDelegado: 'El agente delegado falló; revise la actividad y continúe con tctx tarea <id> --continuar.',
  motivosFallo: {
    'sin-credencial': 'La cuenta no tiene la sesión iniciada; el usuario la inicia en Tessera, en Configuración › Agentes, desplegando el agente.',
    'sin-uso': 'La cuenta agotó su uso; consulte tctx cuentas y elija otra cuenta o espere al reinicio.',
    docker: 'Docker se detuvo o no está disponible, y la tarea no pudo seguir. Infórmelo al usuario. Reanúdela con tctx tarea <id> --continuar, que intenta iniciar Docker; si no tiene conversación, lance una nueva con tctx delegar. Si Docker no se inicia, el usuario debe revisarlo.',
    agente: 'El agente terminó con error; revise el detalle y la actividad antes de continuar.',
    'origen-cerrado': 'La sesión de origen se cerró; delegue de nuevo desde una sesión abierta.',
    'cancelada-por-usuario': 'El usuario canceló la tarea; continúela con tctx tarea <id> --continuar si corresponde.',
    actualizacion: 'La tarea se detuvo para actualizar los agentes en Docker; reanúdela con tctx tarea <id> --continuar, pidiéndole que revise lo que quedó hecho; si no tiene conversación, lance una nueva con tctx delegar.'
  },
  rechazosDelegacion: {
    'delegar-desde-docker': () => 'No se puede delegar desde Docker; use una sesión nativa o la terminal de Tessera.',
    'delegar-sin-proyecto': () => 'La sesión no tiene proyecto; abra una terminal del proyecto en Tessera.',
    'agente-no-delegable': () => 'Ese agente no admite delegación; use --agente claude-code o --agente codex.',
    'cuenta-no-existe': (r) => `La cuenta no existe; elija una de las disponibles: ${(r.disponibles || []).join(', ')}. Consulte tctx cuentas.`,
    'cuenta-ambigua': (r) => `El nombre de cuenta es ambiguo: ${(r.candidatos || []).join(', ')}. Indique un nombre único y --agente.`,
    'ninguna-cuenta': (r) => `Ninguna cuenta de ${r.agente || 'ese agente'} tiene uso disponible${r.reinicio ? `; la primera se reinicia a las ${r.reinicio}` : ''}. Consulte tctx cuentas; espere al reinicio o configure una cuenta en Tessera.`,
    'sin-credencial': () => 'La cuenta no tiene la sesión iniciada; el usuario la inicia en Tessera, en Configuración › Agentes, desplegando el agente. Después, reintente.',
    'orden-vacia': () => 'La orden está vacía; envíe una instrucción por la entrada estándar o con --archivo.',
    'orden-larga': (r) => `La orden supera ${r.max} bytes UTF-8; acórtela o use --archivo con un archivo del proyecto.`,
    'archivo-fuera': () => 'El archivo está fuera del proyecto; use --archivo con una ruta dentro del proyecto.',
    'archivo-no-existe': () => 'El archivo no existe o no puede leerse; compruebe la ruta de --archivo dentro del proyecto.',
    'tarea-no-existe': () => 'La tarea no existe en esta sesión; compruebe el id anunciado al delegar y consulte desde la sesión de origen.',
    'tarea-sin-conversacion': () => 'La tarea no tiene conversación para continuar; lance una nueva con tctx delegar.',
    'tarea-cerrandose': () => 'La tarea consta cancelada, pero su proceso aún no ha salido: continuarla ahora escribiría dos veces en la misma conversación. Vuelva a intentarlo más tarde o lance una nueva con tctx delegar.',
    'sin-docker': () => 'Docker no está disponible o no es compatible, y Tessera no pudo resolverlo. Infórmelo al usuario: debe revisar Docker o pedir ayuda para diagnosticarlo.',
    'docker-iniciando': () => 'Docker estaba detenido y Tessera lo está iniciando; vuelva a ejecutar la orden en un momento.',
    'modelo-invalido': () => 'El nombre del modelo no es válido; consulte los disponibles con tctx modelos.',
    'esfuerzo-invalido': () => 'El nivel de esfuerzo no es válido; consulte los disponibles con tctx modelos.',
    'modelo-no-disponible': (r) => `La cuenta no ofrece el modelo "${r.modelo || ''}". Disponibles: ${(r.disponibles || []).join(', ')}. Si acaba de publicarse, use tctx modelos --actualizar.`,
    'esfuerzo-no-admitido': (r) => `${r.modelo ? `El modelo "${r.modelo}"` : 'La cuenta'} no admite el esfuerzo "${r.esfuerzo || ''}". ${(r.admitidos || []).length ? `Admitidos: ${r.admitidos.join(', ')}.` : 'Ese modelo no admite niveles: omita --esfuerzo.'}`,
    'catalogo-no-disponible': () => 'No se pudo leer el catálogo de esa cuenta; compruebe que su sesión siga iniciada y vuelva a intentarlo. Puede delegar sin --modelo ni --esfuerzo.'
  },
  // --- tctxSalida.cjs y tctx.cjs ---
  conPistaDeAyuda: (mensaje) => `${mensaje} La ayuda: tctx help.`,
  falloInesperado: (detalle) => `fallo inesperado: ${detalle}`,

  // --- tctxArgumentos.cjs ---
  subcomandoDesconocido: (sub) => `tctx no tiene el subcomando "${sub}": son reglas, proponer, traspaso, buscar, docs, config, cuentas, modelos, delegar, tarea, tareas y help.`,
  reglasNoLleva: (argumento) => `reglas no lleva "${argumento}".`,
  traspasoNoLleva: (argumento) => `traspaso no lleva "${argumento}".`,
  buscarSinOpcion: (opcion) => `buscar no tiene la opción "${opcion}" (para buscarla como texto, ponla detrás de --).`,
  maxInvalido: (max) => `--max es un número entre 1 y ${max}.`,
  faltaBusqueda: 'Falta qué buscar: tctx buscar <palabras> (todas tienen que estar en el mensaje), o con --exacta para la frase tal cual.',
  busquedaLarga: (max) => `La búsqueda pasa de ${max} caracteres: busca unas pocas palabras clave.`,
  proponerSinOpcion: (opcion) => `proponer no tiene la opción "${opcion}".`,
  faltaValor: (opcion) => `${opcion} necesita un valor.`,
  dosFuentes: 'Da el texto de una sola forma: --archivo, --texto o "-" (la entrada estándar).',
  faltaFuente: 'Falta el texto nuevo entero: tctx proponer --archivo <ruta>, --texto "<texto>" o "-" para leerlo de la entrada estándar.',

  // --- tctxEntrada.cjs ---
  noExisteArchivo: (ruta) => `No se puede leer "${ruta}".`,
  archivoGrande: (kib) => `El archivo pasa de ${kib} KiB: es demasiado grande para proponerlo.`,
  entradaGrande: (kib) => `La entrada pasa de ${kib} KiB: es demasiado grande para proponerla.`,
  entradaSinTuberia: 'No hay nada por la entrada estándar: `-` lee un texto que llega por una tubería (`cat reglas.md | tctx proponer -`). Usa una tubería, `--archivo` o `--texto`.',
  entradaSinFin: (segundos) => `La entrada no terminó en ${segundos} s: ciérrala al acabar el texto o usa \`--archivo\`.`,
  rutaMsys: (ruta) => `No sé a qué carpeta de Windows corresponde "${ruta}": usa una ruta relativa o de Windows (C:\\...).`,

  // --- tctxPuente.cjs y tctxOrdenes.cjs ---
  terminalAjena:
    'Esta terminal no la abrió Tessera (faltan TESSERA_DB_PIPE y TESSERA_DB_SESSION): tctx solo funciona en las terminales y los agentes de Tessera.',
  tesseraNoContesta: 'Tessera no contesta: ¿está abierta? Si lo está, recarga la terminal (o reinicia el agente).',
  sesionNoReconocida: 'Tessera no reconoce esta sesión: recarga la terminal (o reinicia el agente).',
  versionDistinta: 'La Tessera abierta no conoce esta versión de tctx: reiníciala (o actualízala).',
  falloInterno: 'Tessera falló al atender la petición (el detalle está en su registro, logs/db.log).',
  respuestaIncomprensible: 'La respuesta de Tessera no se entiende.',
  sinReglas: 'Este perfil no tiene reglas.',
  sinReglasPerfil: '(Este perfil no tiene reglas propias.)',
  encabezadoGlobales: '## Reglas globales (para los agentes de todos los perfiles)',
  encabezadoPerfil: '## Reglas de este perfil',
  sinPerfil: 'El perfil de esta sesión ya no existe: recarga la terminal.',
  sinTraspaso: 'Esta sesión no tiene ningún traspaso: solo lo tiene la que Tessera abrió para continuar el trabajo de otro agente, mientras sigue abierta.',
  propuestaVacia: 'La propuesta está vacía: manda la versión entera nueva de las reglas.',
  propuestaLarga: (largo, max) => `La propuesta tiene ${largo} caracteres y las reglas admiten ${max} como mucho: acórtala.`,
  propuestaIgual: 'La propuesta es igual a las reglas vigentes: no hay nada que proponer.',
  sinGlobal: 'Este perfil no usa el contexto global: no puede proponer las reglas globales. Proponga las del perfil, sin --global.',
  prevalecePerfil: 'Si una regla del perfil contradice una global, prevalece la del perfil.',
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
  busquedaCortada: 'La búsqueda se cortó al llegar a su tope de lectura: puede haber más en conversaciones más antiguas; precise la búsqueda.',
  soloSuCuenta: (cuenta) =>
    cuenta
      ? `Desde Docker solo se busca en su cuenta (${cuenta}): las conversaciones de las demás cuentas y las nativas no se ven desde aquí.`
      : 'Desde Docker solo se busca en su propia cuenta: las conversaciones de las demás cuentas y las nativas no se ven desde aquí.',
  sinDocumentos: 'Este perfil no tiene documentos: el usuario los añade en Tessera, en Configuración › Agentes › Contexto de los agentes.',
  docNoExiste: 'No hay ningún documento con ese nombre: lista los que hay con `tctx docs`.',
  docAmbiguo: (candidatos) => `Hay varios documentos con ese nombre; pide uno con su carpeta: ${candidatos.join(', ')}.`,
  docGrande: (kib) => `El documento tiene ${kib} KiB y se entregan 256 KiB como mucho: pide al usuario que lo divida.`,
  docNoTexto: 'El documento no es texto en UTF-8: no se puede entregar.',
  docsVacia: 'Las carpetas de documentos del perfil no tienen ningún documento de texto.',
  cabeceraDocs: (n) => `${n === 1 ? '1 documento' : `${n} documentos`} de referencia del perfil:`,
  comoLeerDoc: 'Lee uno con `tctx docs <nombre>`; basta el nombre del archivo si no se repite.',
  docsTruncado: 'La lista se cortó en 500 documentos.',
  carpetasNoDisponibles: (nombres) => `No están en este equipo: ${nombres.join(', ')}.`,
  configNivel: 'Falta --nivel: global (todas las cuentas de Docker de los perfiles que la usan) o perfil (solo las de este perfil).',
  configSinOpcion: (opcion) => `config no tiene la opción "${opcion}": solo --agente, o el subcomando proponer.`,
  configSinAgente: 'No se sabe de qué agente es la configuración: indíquelo con --agente codex o --agente claude-code.',
  configLarga: (kib) => `La propuesta pasa de ${kib} KiB: proponga solo lo que cambia en ese nivel.`,
  configIgual: 'La propuesta es igual al archivo actual de ese nivel: no hay nada que proponer.',
  configSinGlobal: 'Este perfil no usa el contexto global: no puede proponer su configuración. Proponga la del perfil, con --nivel perfil.',
  configSintaxis: (linea, detalle) => (linea ? `La propuesta tiene un error de sintaxis en la línea ${linea}: ${detalle}.` : `La propuesta tiene un error de sintaxis: ${detalle}.`),
  configPropuestaEnviada:
    'Propuesta enviada. El usuario la revisará en Tessera: no se aplica hasta que la acepte, y una nueva para el mismo nivel sustituye a esta.',
  cabeceraConfig: (agente) =>
    `Configuración técnica de ${agente} en Docker, de lo general a lo particular. Al abrir una sesión, los valores de global y del perfil se escriben en la cuenta, fundidos dentro de las tablas; gana el perfil. Las reglas no están aquí: léelas con tctx reglas.`,
  nivelConfig: { global: 'global', perfil: 'perfil', cuenta: 'esta cuenta' },
  archivoVacio: '(vacío)',
  comoProponerConfig:
    'Para cambiar el nivel global o el del perfil: tctx config proponer --nivel global|perfil --archivo <ruta> --motivo "<motivo>". Los archivos de esta cuenta puede editarlos directamente.',

  // --- tctx-container.cjs ---
  sinContextoContenedor: 'Esta terminal no lleva el contexto de Tessera: recarga la terminal (o reinicia el agente).',
  buzonSinMontar: (buzon) => `El puente al host no está montado (${buzon} no existe): recarga la terminal.`,
  buzonNoResponde: 'El puente al host no responde: recarga la terminal; si sigue, reinicia Tessera.',
  puenteSinRespuesta: (s) => `El puente no respondió en ${s} s: comprueba que Tessera sigue abierta y recarga la terminal.`,

  // --- tctxAyuda (tctxOrdenes.cjs) ---
  ayuda: (c, max) => `
  tctx — el contexto que Tessera da a sus agentes (reglas, documentos, configuración), el traspaso entre agentes, la búsqueda en lo hablado y las tareas delegadas

  tctx reglas [--perfil | --global]
      Las reglas vigentes: las globales (de todos los perfiles), si el perfil las usa, y las del perfil,
      cada una con su encabezado; si se contradicen, prevalece la del perfil. Con --perfil o --global,
      solo ese nivel tal cual, para editarlo y proponerlo. Pueden haber cambiado desde que arrancó el agente.

  tctx proponer (--archivo <ruta> | --texto "<texto>" | -) [--motivo "<motivo>"] [--global]
      Propone al usuario la versión ENTERA nueva de las reglas del perfil o, con --global, de las
      globales (${max} caracteres como mucho). Proponga las globales solo para lo que vale en todos los
      perfiles. No cambia nada: queda pendiente hasta que el usuario vea el cambio y lo acepte, lo edite
      o lo descarte. Una propuesta nueva sustituye a la anterior. El texto llega de una de tres formas:
        tctx reglas --perfil > reglas.md (o --global; y se edita el archivo)
        tctx proponer --archivo reglas.md --motivo "me lo pidió dos veces"
        tctx proponer --texto "Una sola regla corta."
        tctx proponer - < reglas.md      (o canalizado: ... | tctx proponer -)
      --archivo es lo más seguro en cualquier shell: el texto no pasa por las comillas.

  tctx traspaso
      El traspaso del trabajo que empezó otro agente en este proyecto, si Tessera abrió esta sesión para
      continuarlo: lo último de su conversación y el estado de git. Solo esta sesión lo tiene.

  tctx buscar <palabras> [--exacta] [--max N]
      Busca en lo que se habló en este proyecto (los mensajes del usuario y de los agentes, de cualquier
      agente y cuenta del perfil; desde Docker, solo en su cuenta). Sin distinguir mayúsculas ni tildes,
      todas las palabras tienen que estar en el mensaje; con --exacta, la frase tal cual. Da las más
      recientes primero (8, o hasta 20 con --max) con un trozo alrededor. No hacen falta comillas:
        tctx buscar migración base de datos
        tctx buscar --exacta no subir a main

  tctx docs [<nombre>]
      Sin nombre, lista los documentos de referencia que el usuario dejó para este perfil; con un nombre,
      imprime ese documento. Basta el nombre del archivo si no se repite en otra carpeta. Si unas reglas
      citan un documento por una ruta que aquí no existe, búsquelo así por su nombre:
        tctx docs
        tctx docs contrato.md

  tctx config [--agente codex|claude-code]
      La configuración técnica del agente en Docker (config.toml o settings.json) por niveles: global
      (todas las cuentas de Docker de los perfiles que la usan), la de este perfil y, en Docker, la de
      esta cuenta. --agente indica cuál desde una terminal o un agente nativo; en Docker se muestra el propio.

  tctx config proponer --nivel global|perfil (--archivo <ruta> | --texto "<texto>" | -) [--motivo "<motivo>"]
      Propone al usuario el archivo de configuración ENTERO nuevo de ese nivel. No cambia nada hasta
      que el usuario lo acepte en Tessera. Se comprueba la sintaxis antes de enviarlo.

  tctx cuentas
      Lista las cuentas de Docker del perfil, su uso y sus reinicios en hora local.

  tctx modelos --agente claude-code|codex [--cuenta nombre|auto] [--actualizar]
      Los modelos y niveles de esfuerzo que anuncia el agente de esa cuenta, consultados en su contenedor.
      El resultado se guarda una hora; --actualizar vuelve a consultarlo.

  tctx delegar --agente claude-code|codex [--cuenta nombre|auto] [--modelo <modelo>] [--esfuerzo <nivel>] [--solo-lectura] [--sin-esperar] [--archivo <ruta>]
      Encarga una tarea a una cuenta de Docker del perfil, que trabaja sobre este proyecto. La orden llega por
      la entrada estándar (con o sin "-") o con --archivo, que Tessera lee del proyecto. Cuenta por omisión:
      auto, la que tiene más uso disponible y menos tareas en marcha. --modelo y --esfuerzo se comprueban
      contra tctx modelos; sin ellos se usa la configuración de la cuenta. Espera el resultado; para tareas
      largas, use --sin-esperar y tctx tarea <id>. La tarea sigue en Tessera si tctx se interrumpe. Con
      --solo-lectura, Claude Code no puede modificar nada; Codex lo recibe como indicación, porque su
      aislamiento no funciona en el contenedor.

  tctx tareas
      Lista las tareas delegadas de este proyecto, con su id y su estado, también las interrumpidas.

  tctx tarea <id> [--esperar [--max-segundos N] | --cancelar | --continuar [--modelo <modelo>] [--esfuerzo <nivel>] [--archivo <ruta>] [--sin-esperar]]
      Consulta una tarea delegada, espera a que termine, la cancela o continúa su conversación. --max-segundos
      devuelve el control antes si la tarea sigue en marcha. --continuar recibe la orden como delegar, conserva
      el modelo y el esfuerzo salvo que indique otros, y espera, salvo con --sin-esperar. También reanuda una
      tarea interrumpida al apagarse Tessera o el equipo, en la misma cuenta y conversación.

  tctx help
      Esta ayuda.

  Códigos de salida:
    0    hecho
    ${c.uso}    uso incorrecto (argumentos, subcomando) o desde WSL
    ${c.puente}    Tessera no contesta o no reconoce esta terminal
    ${c.fallida}    tarea fallida
    ${c.cancelada}    tarea cancelada
    ${c.enMarcha}    tarea en marcha (consulta sin esperar o tiempo de espera alcanzado); --sin-esperar al lanzar devuelve 0
    ${c.interrumpida}    tarea interrumpida al apagarse Tessera o el equipo; se reanuda con --continuar
    ${c.rechazo}    Tessera rechazó la petición: una propuesta de reglas o de configuración no válida (vacía,
         demasiado larga, con la sintaxis rota o igual a la vigente), no hay traspaso, no pudo atender la
         búsqueda, no puede entregar ese documento, o no puede delegar ni atender la tarea pedida (el mensaje
         dice el motivo: desde Docker, sin cuentas o sin Docker disponibles, una orden o un archivo no válidos…)

  En PowerShell, un archivo con "Out-File" sin -Encoding se lee igual (UTF-16); en cmd.exe, las
  %variables% de la línea se expanden antes de llegar a tctx.
`
}

const en = {
  delegacionUso: 'Use tctx cuentas; tctx modelos --agente claude-code|codex [--cuenta name|auto] [--actualizar]; tctx delegar --agente claude-code|codex [--cuenta name|auto] [--modelo <model>] [--esfuerzo <level>] [--solo-lectura] [--sin-esperar]; tctx tareas; or tctx tarea <id> [--esperar [--max-segundos N] | --cancelar | --continuar [--modelo <model>] [--esfuerzo <level>] [--sin-esperar]]. To delegate or continue, send the instruction through a pipe (with or without "-") or --archivo <path>, exclusively.',
  sinCuentas: 'This profile has no Claude Code or Codex Docker accounts.',
  comoDelegar: 'To delegate: tctx delegar --agente claude-code|codex [--cuenta name|auto] --archivo <path>.',
  estadosCuenta: { lista: 'ready', 'sin-credencial': 'no credentials', agotada: 'exhausted' },
  estadosTarea: { hecha: 'done', fallida: 'failed', cancelada: 'cancelled', 'en-marcha': 'running', interrumpida: 'interrupted' },
  sinTareas: 'There are no delegated tasks in this project.',
  haceSegundos: (s) => `started ${s} s ago`,
  comoReanudar: 'To resume an interrupted task: tctx tarea <id> --continuar, with an instruction asking it to review what was done and continue.',
  tareaInterrumpida: (id) => `Task ${id} was interrupted when Tessera or the computer shut down. Review what remains in the project and resume it with tctx tarea ${id} --continuar, or cancel it with --cancelar.`,
  tareaInterrumpidaSinConversacion: 'The task was interrupted before its conversation started; launch a new one with tctx delegar.',
  tareaSigueEnMarcha: (id) => `The wait time was reached; the task is still running. Wait again with tctx tarea ${id} --esperar.`,
  otrasEscribiendo: (n) => `${n} ${n === 1 ? 'task that can modify this project is' : 'tasks that can modify this project are'} currently running; make sure they do not work on the same files.`,
  cabeceraModelos: (agente, cuenta, hora) => `${agente} models in the ${cuenta} account${hora ? ` (checked at ${hora})` : ''}:`,
  esfuerzosModelo: (lista) => `efforts: ${lista}`,
  sinEsfuerzos: 'levels not supported',
  modeloPorDefecto: 'default',
  comoUsarModelo: (agente) => `To use one: tctx delegar --agente ${agente} --modelo <model> [--esfuerzo <level>]. Without those options, the account’s configuration applies.`,
  reinicioDesconocido: 'unknown',
  ventanaCuenta: (etiqueta, porcentaje, reinicio) => `${etiqueta}: ${porcentaje} %; reset: ${reinicio}`,
  tareasEnMarcha: (n) => `${n} running tasks`,
  tareaLanzada: (id, agente, cuenta) => `Task ${id} · ${agente} · ${cuenta}. Check: tctx tarea ${id}. The task stays in Tessera if tctx is interrupted.`,
  tareaCancelada: (id) => `Task ${id} cancelled.`,
  tareaSinPuente: (id) => `Tessera did not respond to five consecutive queries. The task may still be running; check: tctx tarea ${id}.`,
  progresoTarea: (id, segundos, actividad) => `Task ${id}: ${segundos} s elapsed${actividad ? ` · ${actividad}` : ''}.`,
  estadoTarea: (agente, cuenta, estado, segundos, inactividad, soloLectura) => `${agente} · ${cuenta} · ${estado} · ${segundos} s elapsed · last activity ${inactividad} s ago · ${soloLectura ? 'read only' : 'read and write'}`,
  falloDelegado: 'The delegated agent failed; review the activity and continue with tctx tarea <id> --continuar.',
  motivosFallo: {
    'sin-credencial': 'The account is not signed in; the user signs in from Tessera, in Settings › Agents, by expanding the agent.',
    'sin-uso': 'The account exhausted its usage; check tctx cuentas and choose another account or wait for the reset.',
    docker: 'Docker stopped or is unavailable, and the task could not continue. Tell the user. Resume it with tctx tarea <id> --continuar, which tries to start Docker; if it has no conversation, launch a new one with tctx delegar. If Docker does not start, the user must check it.',
    agente: 'The agent exited with an error; review the details and activity before continuing.',
    'origen-cerrado': 'The originating session closed; delegate again from an open session.',
    'cancelada-por-usuario': 'The user cancelled the task; continue with tctx tarea <id> --continuar if appropriate.',
    actualizacion: 'The task was stopped to update the agents in Docker; resume it with tctx tarea <id> --continuar, asking it to review what was done; if it has no conversation, launch a new one with tctx delegar.'
  },
  rechazosDelegacion: {
    'delegar-desde-docker': () => 'Cannot delegate from Docker; use a native session or the Tessera terminal.',
    'delegar-sin-proyecto': () => 'The session has no project; open a project terminal in Tessera.',
    'agente-no-delegable': () => 'That agent does not support delegation; use --agente claude-code or --agente codex.',
    'cuenta-no-existe': (r) => `The account does not exist; choose an available account: ${(r.disponibles || []).join(', ')}. Check tctx cuentas.`,
    'cuenta-ambigua': (r) => `The account name is ambiguous: ${(r.candidatos || []).join(', ')}. Specify a unique name and --agente.`,
    'ninguna-cuenta': (r) => `No ${r.agente || 'requested agent'} account has usage available${r.reinicio ? `; the first resets at ${r.reinicio}` : ''}. Check tctx cuentas; wait for the reset or configure an account in Tessera.`,
    'sin-credencial': () => 'The account is not signed in; the user signs in from Tessera, in Settings › Agents, by expanding the agent. Then retry.',
    'orden-vacia': () => 'The instruction is empty; send an instruction through standard input or --archivo.',
    'orden-larga': (r) => `The instruction exceeds ${r.max} UTF-8 bytes; shorten it or use --archivo with a project file.`,
    'archivo-fuera': () => 'The file is outside the project; use --archivo with a path inside the project.',
    'archivo-no-existe': () => 'The file does not exist or cannot be read; check the --archivo path inside the project.',
    'tarea-no-existe': () => 'The task does not exist in this session; check the id announced when delegating and query from the originating session.',
    'tarea-sin-conversacion': () => 'The task has no conversation to continue; launch a new one with tctx delegar.',
    'tarea-cerrandose': () => 'The task is canceled, but its process has not exited yet: continuing it now would write twice to the same conversation. Try again later or launch a new one with tctx delegar.',
    'sin-docker': () => 'Docker is unavailable or not compatible, and Tessera could not resolve it. Tell the user: they must check Docker or ask for help diagnosing it.',
    'docker-iniciando': () => 'Docker was stopped and Tessera is starting it; run the command again in a moment.',
    'modelo-invalido': () => 'The model name is not valid; check the available ones with tctx modelos.',
    'esfuerzo-invalido': () => 'The effort level is not valid; check the available ones with tctx modelos.',
    'modelo-no-disponible': (r) => `The account does not offer the model "${r.modelo || ''}". Available: ${(r.disponibles || []).join(', ')}. If it was just released, use tctx modelos --actualizar.`,
    'esfuerzo-no-admitido': (r) => `${r.modelo ? `The model "${r.modelo}"` : 'The account'} does not support the effort "${r.esfuerzo || ''}". ${(r.admitidos || []).length ? `Supported: ${r.admitidos.join(', ')}.` : 'That model does not support levels: omit --esfuerzo.'}`,
    'catalogo-no-disponible': () => 'The catalog of that account could not be read; check that it is still signed in and try again. You can delegate without --modelo or --esfuerzo.'
  },
  conPistaDeAyuda: (mensaje) => `${mensaje} Help: tctx help.`,
  falloInesperado: (detalle) => `unexpected failure: ${detalle}`,

  subcomandoDesconocido: (sub) => `tctx has no subcommand "${sub}": valid subcommands are reglas, proponer, traspaso, buscar, docs, config, cuentas, modelos, delegar, tarea, tareas and help.`,
  reglasNoLleva: (argumento) => `reglas does not take "${argumento}".`,
  traspasoNoLleva: (argumento) => `traspaso does not take "${argumento}".`,
  buscarSinOpcion: (opcion) => `buscar has no option "${opcion}" (to search for it as text, put it after --).`,
  maxInvalido: (max) => `--max must be a number between 1 and ${max}.`,
  faltaBusqueda: 'Missing search terms: tctx buscar <words> (the message must contain all of them), or --exacta for the exact phrase.',
  busquedaLarga: (max) => `The search is longer than ${max} characters: search for a few keywords.`,
  proponerSinOpcion: (opcion) => `proponer has no option "${opcion}".`,
  faltaValor: (opcion) => `${opcion} requires a value.`,
  dosFuentes: 'Provide the text in only one way: --archivo, --texto or "-" (standard input).',
  faltaFuente: 'Missing the complete new text: tctx proponer --archivo <path>, --texto "<text>" or "-" to read it from standard input.',

  noExisteArchivo: (ruta) => `"${ruta}" cannot be read.`,
  archivoGrande: (kib) => `The file is larger than ${kib} KiB: it is too large to propose.`,
  entradaGrande: (kib) => `The input is larger than ${kib} KiB: it is too large to propose.`,
  entradaSinTuberia: 'There is nothing on standard input: `-` reads text from a pipe (`cat rules.md | tctx proponer -`). Use a pipe, `--archivo` or `--texto`.',
  entradaSinFin: (segundos) => `The input did not end within ${segundos} s: close it when the text is complete or use \`--archivo\`.`,
  rutaMsys: (ruta) => `Cannot tell which Windows folder "${ruta}" is: use a relative path or a Windows path (C:\\...).`,

  terminalAjena:
    'This terminal was not opened by Tessera (TESSERA_DB_PIPE and TESSERA_DB_SESSION are missing): tctx only works in Tessera terminals and agents.',
  tesseraNoContesta: 'Tessera is not responding: is it open? If it is, restart the terminal (or restart the agent).',
  sesionNoReconocida: 'Tessera does not recognize this session: restart the terminal (or restart the agent).',
  versionDistinta: 'The running Tessera does not support this version of tctx: restart it (or update it).',
  falloInterno: 'Tessera failed while handling the request (the details are in its log, logs/db.log).',
  respuestaIncomprensible: 'Tessera returned a response that cannot be interpreted.',
  sinReglas: 'This profile has no rules.',
  sinReglasPerfil: '(This profile has no rules of its own.)',
  encabezadoGlobales: '## Global rules (for the agents of every profile)',
  encabezadoPerfil: '## Rules of this profile',
  sinPerfil: 'The profile of this session no longer exists: restart the terminal.',
  sinTraspaso: 'This session has no handoff: only a session that Tessera opened to continue another agent’s work has one, while it stays open.',
  propuestaVacia: 'The proposal is empty: send the whole new version of the rules.',
  propuestaLarga: (largo, max) => `The proposal has ${largo} characters and the rules allow at most ${max}: shorten it.`,
  propuestaIgual: 'The proposal is the same as the current rules: there is nothing to propose.',
  sinGlobal: 'This profile does not use the global context: it cannot propose the global rules. Propose the profile rules, without --global.',
  prevalecePerfil: 'If a profile rule contradicts a global one, the profile rule prevails.',
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
  sinDocumentos: 'This profile has no documents: the user adds them in Tessera, under Settings › Agents › Agent context.',
  docNoExiste: 'There is no document with that name: list the available ones with `tctx docs`.',
  docAmbiguo: (candidatos) => `Several documents have that name; request one with its folder: ${candidatos.join(', ')}.`,
  docGrande: (kib) => `The document is ${kib} KiB and at most 256 KiB are delivered: ask the user to split it.`,
  docNoTexto: 'The document is not UTF-8 text: it cannot be delivered.',
  docsVacia: 'The profile document folders contain no text documents.',
  cabeceraDocs: (n) => `${n === 1 ? '1 reference document' : `${n} reference documents`} in this profile:`,
  comoLeerDoc: 'Read one with `tctx docs <name>`; the file name is enough if it is not repeated.',
  docsTruncado: 'The list stopped at 500 documents.',
  carpetasNoDisponibles: (nombres) => `Not available on this computer: ${nombres.join(', ')}.`,
  configNivel: 'Missing --nivel: global (every Docker account of the profiles that use it) or perfil (only this profile’s).',
  configSinOpcion: (opcion) => `config has no option "${opcion}": only --agente, or the proponer subcommand.`,
  configSinAgente: 'It is not known which agent the configuration is for: specify it with --agente codex or --agente claude-code.',
  configLarga: (kib) => `The proposal is larger than ${kib} KiB: propose only what changes at that level.`,
  configIgual: 'The proposal is the same as the current file at that level: there is nothing to propose.',
  configSinGlobal: 'This profile does not use the global context: it cannot propose its configuration. Propose the profile’s, with --nivel perfil.',
  configSintaxis: (linea, detalle) => (linea ? `The proposal has a syntax error on line ${linea}: ${detalle}.` : `The proposal has a syntax error: ${detalle}.`),
  configPropuestaEnviada:
    'Proposal sent. The user will review it in Tessera: it does not apply until they accept it, and a new one for the same level replaces this one.',
  cabeceraConfig: (agente) =>
    `${agente} technical configuration in Docker, from general to specific. When a session opens, the values of global and the profile are written into the account, merged within tables; the profile wins. The rules are not here: read them with tctx reglas.`,
  nivelConfig: { global: 'global', perfil: 'profile', cuenta: 'this account' },
  archivoVacio: '(empty)',
  comoProponerConfig:
    'To change the global or the profile level: tctx config proponer --nivel global|perfil --archivo <path> --motivo "<reason>". You can edit this account’s files directly.',

  sinContextoContenedor: 'This terminal does not have the Tessera context: restart the terminal (or restart the agent).',
  buzonSinMontar: (buzon) => `The bridge to the host is not mounted (${buzon} does not exist): restart the terminal.`,
  buzonNoResponde: 'The bridge to the host is not responding: restart the terminal; if the problem persists, restart Tessera.',
  puenteSinRespuesta: (s) => `The bridge did not respond within ${s} s: check that Tessera is still open and restart the terminal.`,

  ayuda: (c, max) => `
  tctx — the context Tessera gives its agents (rules, documents, configuration), the handoff between agents, the search in past conversations and delegated tasks

  tctx reglas [--perfil | --global]
      Shows the current rules: the global ones (for every profile), if the profile uses them, and the
      profile’s, each with its heading; if they contradict, the profile rule prevails. With --perfil or
      --global, only that level as it is, to edit and propose it. They might have changed since the agent started.

  tctx proponer (--archivo <path> | --texto "<text>" | -) [--motivo "<reason>"] [--global]
      Proposes to the user the COMPLETE new version of the profile rules or, with --global, of the global
      ones (at most ${max} characters). Propose global rules only for what applies to every profile. It
      changes nothing: it stays pending until the user reviews the change and accepts it, edits it or
      discards it. A new proposal replaces the previous one. Provide the text in one of three ways:
        tctx reglas --perfil > rules.md  (or --global; then edit the file)
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

  tctx docs [<name>]
      Without a name, lists the reference documents the user left for this profile; with a name, prints
      that document. The file name is enough if no other folder repeats it. If some rules cite a document
      by a path that does not exist here, look it up by its name this way:
        tctx docs
        tctx docs contract.md

  tctx config [--agente codex|claude-code]
      The agent’s technical Docker configuration (config.toml or settings.json) by level: global (every
      Docker account of the profiles that use it), this profile’s and, in Docker, this account’s.
      --agente selects which one from a terminal or a native agent; in Docker, its own is shown.

  tctx config proponer --nivel global|perfil (--archivo <path> | --texto "<text>" | -) [--motivo "<reason>"]
      Proposes to the user the COMPLETE new configuration file for that level. Nothing changes until the
      user accepts it in Tessera. The syntax is checked before it is sent.

  tctx cuentas
      Lists the profile’s Docker accounts, their usage and their resets in local time.

  tctx modelos --agente claude-code|codex [--cuenta name|auto] [--actualizar]
      The models and effort levels announced by that account’s agent, checked inside its container. The
      result is kept for one hour; --actualizar checks again.

  tctx delegar --agente claude-code|codex [--cuenta name|auto] [--modelo <model>] [--esfuerzo <level>] [--solo-lectura] [--sin-esperar] [--archivo <path>]
      Assigns a task to one of the profile’s Docker accounts, which works on this project. The instruction
      arrives through standard input (with or without "-") or with --archivo, which Tessera reads from the
      project. Default account: auto, the one with the most usage available and the fewest running tasks.
      --modelo and --esfuerzo are checked against tctx modelos; without them, the account’s configuration
      applies. Waits for the result; for long tasks, use --sin-esperar and tctx tarea <id>. The task continues
      in Tessera if tctx is interrupted. With --solo-lectura, Claude Code cannot modify anything; Codex
      receives it as an instruction, because its isolation does not work inside the container.

  tctx tareas
      Lists this project’s delegated tasks, with their identifier and state, including interrupted ones.

  tctx tarea <id> [--esperar [--max-segundos N] | --cancelar | --continuar [--modelo <model>] [--esfuerzo <level>] [--archivo <path>] [--sin-esperar]]
      Shows a delegated task, waits for it to finish, cancels it or continues its conversation. --max-segundos
      returns control earlier if the task is still running. --continuar takes the instruction like delegar,
      keeps the model and effort unless others are given, and waits, unless --sin-esperar is set. It also
      resumes a task interrupted when Tessera or the computer shut down, in the same account and conversation.

  tctx help
      Shows this help.

  Exit codes:
    0    done
    ${c.uso}    wrong usage (arguments, subcommand) or run from WSL
    ${c.puente}    Tessera is not responding or does not recognize this terminal
    ${c.fallida}    failed task
    ${c.cancelada}    cancelled task
    ${c.enMarcha}    running task (query without waiting or wait time reached); launching with --sin-esperar returns 0
    ${c.interrumpida}    task interrupted when Tessera or the computer shut down; resume it with --continuar
    ${c.rechazo}    Tessera rejected the request: an invalid rules or configuration proposal (empty, too long,
         with broken syntax or the same as the current one), there is no handoff, it could not handle the
         search, it cannot deliver that document, or it cannot delegate or handle the requested task (the
         message gives the reason: from Docker, no accounts or no Docker available, an invalid instruction or file…)

  In PowerShell, a file written with "Out-File" without -Encoding is still read correctly (UTF-16); in
  cmd.exe, %variables% in your command line are expanded before they reach tctx.
`
}

/** Los textos del idioma de esta invocación: inglés solo con `TESSERA_IDIOMA=en`. */
function textosTctx() {
  return process.env.TESSERA_IDIOMA === 'en' ? en : es
}

module.exports = { textosTctx, es, en }
