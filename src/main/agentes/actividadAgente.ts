// =============================================================================
// Rastreador de actividad de un pty de agente: dice si el CLI trabaja, te espera o está quieto y
// cuándo terminó un turno. Si el agente informa su estado (OSC 7501, `estadoPrograma.ts`), manda
// eso y nada más. Si no, se deduce: abrir lo decide el Enter del usuario; cerrar, por este orden,
// la marca del transcript (`VigilanteTurno`), el BEL, el silencio absoluto y un tope de duración.
// Scheduler y reloj se inyectan. Lo usa la terminal del agente.
// Decisiones: docs/decisiones/agentes/turnos-actividad-del-agente.md,
// docs/decisiones/agentes/turnos-estado-informado.md
// =============================================================================
import type { EstadoActividadAgente, MotivoEsperaAgente } from '../../shared/agent-terminal-ipc'
import { crearLectorPrograma, type AvisoPrograma, type EstadoInformado, type LectorPrograma } from './estadoPrograma.ts'

/**
 * Bracketed paste: el terminal envuelve lo pegado entre estos marcadores para que el CLI lo
 * trate como texto y no ejecute cada línea.
 */
const INICIO_PEGADO = '\x1b[200~'
const FIN_PEGADO = '\x1b[201~'

/**
 * Quita el contenido pegado de un chunk de entrada: un bloque multilínea pegado lleva `\r`
 * dentro sin que el usuario haya enviado nada. Un pegado sin cerrar (partido entre dos chunks)
 * descarta el resto, que es lo prudente.
 */
export function quitarPegados(datos: string): string {
  let salida = ''
  let i = 0
  for (;;) {
    const iniciar = datos.indexOf(INICIO_PEGADO, i)
    if (iniciar < 0) return salida + datos.slice(i)
    salida += datos.slice(i, iniciar)
    const fin = datos.indexOf(FIN_PEGADO, iniciar + INICIO_PEGADO.length)
    if (fin < 0) return salida
    i = fin + FIN_PEGADO.length
  }
}

/**
 * ¿Este trozo de stdin contiene un envío (Enter fuera de un pegado)? Lo usa también el ancla de
 * conversación para fechar el último prompt; lo delicado es el recorte del pegado.
 */
export function esEnvio(datos: string): boolean {
  const tecleado = quitarPegados(datos)
  return tecleado.includes('\r') || tecleado.includes('\n')
}

/**
 * Cadenas de control: OSC (`ESC ]`), DCS (`ESC P`), APC (`ESC _`), PM (`ESC ^`) y SOS (`ESC X`),
 * terminadas en BEL o en ST (`ESC \`), o sin terminar si el trozo se acaba. Nadie las teclea:
 * son las respuestas de xterm a lo que el CLI pregunta al arrancar. El cuerpo se para antes de
 * cualquier ESC, así que no se come un `ESC [201~` que cierre un pegado.
 */
// eslint-disable-next-line no-control-regex -- casar ESC y BEL es justo su trabajo
const CADENA_CONTROL = /\x1b[\]P_^X][^\x07\x1b]*(?:\x07|\x1b\\)?/g

/**
 * Quita las cadenas de control de un trozo de stdin. La comparten este rastreador y el detector
 * de la línea enviada: dos copias de un recorte así divergen sin que nada falle. Un Alt+] o
 * Alt+P tecleado solo tampoco era texto y así no se traga lo que se teclee después.
 */
export function quitarCadenasControl(datos: string): string {
  return datos.includes('\x1b') ? datos.replace(CADENA_CONTROL, '') : datos
}

/**
 * Las respuestas automáticas de xterm que llegan como secuencias CSI: foco (`ESC [I`, `ESC [O`),
 * posición del cursor, atributos del terminal, DECRPM e informes de ratón SGR.
 */
// eslint-disable-next-line no-control-regex -- casar ESC es justo su trabajo
const RESPUESTA_TERMINAL = /\x1b\[(?:[IO]|\d+;\d+R|[?>=][\d;]*c|\??[\d;]*\$y|<[\d;]*[Mm])/g

/**
 * ¿Este trozo de stdin es solo ruido del terminal, sin una tecla del usuario? Decide si el trozo
 * contesta a un diálogo (ver `esperandoRespuesta`): cambiar el foco o mover la rueda no es
 * contestar. Un trozo vacío tampoco lo es.
 */
export function esSoloRespuestaDeTerminal(datos: string): boolean {
  return quitarCadenasControl(datos).replace(RESPUESTA_TERMINAL, '').length === 0
}

/** Ajustes del rastreador: umbrales en ticks o bytes, topes en ms y las dependencias inyectadas. */
export interface OpcionesRastreadorActividad {
  /** Resolución del muestreo: cada cuánto se evalúa la ventana deslizante. */
  tickMs: number
  /** Nº de ticks que abarca la ventana (ventana = tickMs * ticksVentana). */
  ticksVentana: number
  /** Bytes en la ventana para abrir turno de respaldo (el camino normal es el Enter). */
  bytesApertura: number
  /** Congelación tras cada tecla: la salida de ese rato es eco, no trabajo. */
  graciaEcoMs: number
  /** Ticks sin un solo byte de salida tras los que se cierra el turno (red de seguridad). */
  ticksSilencio: number
  /** Tope absoluto de un turno, en ticks: pase lo que pase, se cierra (en silencio). */
  maxTicksTurno: number
  /** Tope de la congelación por `suppress`, en ms: no puede reprogramarse sin fin. */
  maxCongelacionMs: number
  /** Tope de la congelación por contrapresión, en ms: un `fijarPausado(true)` no se eterniza. */
  maxPausaMs: number
  /**
   * Margen para aceptar una marca de transcript como propia del turno en curso: la marca la
   * fecha el agente (dentro del contenedor) y el envío el main, son dos relojes.
   */
  toleranciaMarcaMs: number
  /** Se llama en cada transición: 'working' al abrir, 'done'/'idle' al cerrar y 'blocked' (con su motivo) al esperarte. */
  onCambio: (estado: EstadoActividadAgente, motivo?: MotivoEsperaAgente | null) => void
  /** Contesta a la sonda del protocolo de estado (escribe en el pty): sin respuesta, el agente no informa. */
  responderSonda?: () => void
  /**
   * El `app` de un agente que informa sin preguntar antes (la especificación lo permite): sus avisos
   * cuentan sin sonda, pero solo los que dicen ser él. Sin esto, solo cuentan tras contestar la sonda.
   */
  informaSinSonda?: string
  /** Programa `fn` para dentro de `ms` y devuelve un cancelador (setTimeout en producción). */
  programar: (fn: () => void, ms: number) => () => void
  /** Reloj inyectable; en producción, `Date.now`. */
  ahora?: () => number
  /** Se llama solo cuando cambia `esperandoRespuesta()`, para quien lo enseña fuera. */
  alCambiarEspera?: (esperando: boolean) => void
}

/** Lo que un rastreador expone a la terminal del agente. */
export interface RastreadorActividad {
  /** Alimenta un chunk de salida del pty (solo suma caudal; no decide nada). */
  onDatos: (trozo: string) => void
  /** Alimenta la entrada del usuario: un Enter arma la sesión y toda tecla abre la ventana de eco. */
  onEntrada: (datos: string) => void
  /** Alimenta una marca de turno leída del transcript: la señal buena de fin de turno. */
  onMarcaTurno: (marca: { tipo: 'abre' | 'cierra'; en: number }) => void
  /**
   * Congela la detección durante `ms`: la salida que llegue se ignora y la ventana no rueda.
   * Es el ruido de la propia app (volcado al arrancar, repintado por resize). Reprogramable.
   */
  congelar: (ms: number) => void
  /** Contrapresión: con el pty en pausa no llegan bytes aunque el agente trabaje, así que se congela. */
  fijarPausado: (pausado: boolean) => void
  /**
   * Reinicia la sesión a su estado inicial: cierra el turno en silencio ('idle'), vacía la
   * ventana, desarma y para el muestreo. Se llama al cerrar, hibernar, recargar o morir.
   */
  terminar: () => void
  /** Estado actual: 'blocked' solo si el agente informa que te espera. */
  estado: () => 'working' | 'idle' | 'blocked'
  /** Con 'blocked', qué espera (si lo dice). */
  motivoEspera: () => MotivoEsperaAgente | null
  /**
   * ¿El agente está parado esperando una respuesta? Si informa su estado, es su 'blocked'. Si no,
   * se deduce: turno cerrado sin marca de fin y con una apertura del transcript sin cierre detrás
   * (sin marcas, false).
   */
  esperandoRespuesta: () => boolean
  /** Cancela cualquier temporizador pendiente (al cerrar la sesión). */
  dispose: () => void
}

/** Estado mutable de un rastreador: el mismo objeto lo reciben todas las funciones, nunca copias. */
interface Estado {
  readonly opts: OpcionesRastreadorActividad
  readonly ahora: () => number
  /** El usuario ya envió al menos un prompt: a partir de aquí puede haber trabajo. */
  estaArmado: boolean
  /** Turno abierto (el agente está trabajando ahora mismo). */
  turnoAbierto: boolean
  /** Ticks que lleva el turno abierto (solo para el tope absoluto). */
  ticksTurno: number
  /** Ticks seguidos sin un solo byte de salida (red de seguridad de cierre). */
  ticksEnSilencio: number
  /**
   * Bytes atribuibles del turno en curso. Decide si su fin por silencio merece aviso: no todo
   * Enter es un prompt (elegir en un menú, aprobar una herramienta) y esos también abren turno;
   * sin este contador cada uno fabricaría un 'done' falso.
   */
  bytesTurno: number
  /** Llegó un BEL: el CLI avisa que terminó o reclama al usuario. Cierra en el próximo tick. */
  campanaPendiente: boolean
  /** Estado publicado (espejo de turnoAbierto, para estado()). */
  estadoActual: 'working' | 'idle'
  /** Epoch ms del último envío del usuario; fecha el turno para poder fechar su fin. */
  ultimoEnvioEn: number
  /**
   * Último cierre, en dos relojes que no se pueden mezclar: `cierreMarcaEn` es la fecha de la
   * marca que cerró (reloj del agente, se compara sin margen con las marcas nuevas) y
   * `cierreLocalEn` la hora del main cuando cerró la campana, el silencio o el tope (cruzar
   * relojes exige margen).
   */
  cierreMarcaEn: number
  cierreLocalEn: number
  /** Fecha de la última apertura y del último cierre que dice el transcript, en el reloj del agente. */
  ultimaAperturaEn: number
  ultimoCierreEn: number
  /** El último cierre no lo dijo el transcript: lo decidieron la campana, el silencio o el tope. */
  cierreSinMarca: boolean
  /** Último valor avisado por `alCambiarEspera` (solo se avisa de los cambios). */
  esperaAvisada: boolean
  /** Bytes por tick ya cerrado (longitud <= ticksVentana). */
  ventana: number[]
  /** Bytes atribuibles acumulados en el tick en curso. */
  cur: number
  /** Bytes del tick en curso vengan de donde vengan: solo decide si el agente calla. */
  bytesTick: number
  cancelarMuestreo: (() => void) | null
  cancelarEco: (() => void) | null
  cancelarCongelacion: (() => void) | null
  cancelarPausa: (() => void) | null
  ecoActivo: boolean
  estaCongelado: boolean
  flujoPausado: boolean
  /** Epoch ms en que empezó la congelación por `suppress` (para acotarla). */
  inicioCongelacion: number
  /** Separa del flujo los avisos de estado del agente, su sonda y las campanas de verdad. */
  readonly lector: LectorPrograma
  /**
   * El último estado que informó el agente de su registro raíz; `null` mientras no haya informado
   * ninguno. Con un aviso, el agente manda y la deducción (Enter, BEL, silencio, marcas, tope) calla.
   */
  informado: Exclude<EstadoInformado, 'clear'> | null
  /** Qué espera, mientras informa 'blocked'. */
  motivo: MotivoEsperaAgente | null
  /** Ya se contestó la sonda de este proceso: solo desde ahí cuentan sus avisos. */
  sondaContestada: boolean
}

/**
 * Crea un rastreador. Arranca en 'idle' y desarmado: hasta que el usuario no envíe su primer
 * prompt, ninguna salida puede marcar trabajo. No emite en la construcción.
 */
export function crearRastreadorActividad(opts: OpcionesRastreadorActividad): RastreadorActividad {
  const r: Estado = {
    opts,
    ahora: opts.ahora ?? Date.now,
    estaArmado: false,
    turnoAbierto: false,
    ticksTurno: 0,
    ticksEnSilencio: 0,
    bytesTurno: 0,
    campanaPendiente: false,
    estadoActual: 'idle',
    ultimoEnvioEn: 0,
    cierreMarcaEn: 0,
    cierreLocalEn: 0,
    ultimaAperturaEn: 0,
    ultimoCierreEn: 0,
    cierreSinMarca: false,
    esperaAvisada: false,
    ventana: [],
    cur: 0,
    bytesTick: 0,
    cancelarMuestreo: null,
    cancelarEco: null,
    cancelarCongelacion: null,
    cancelarPausa: null,
    ecoActivo: false,
    estaCongelado: false,
    flujoPausado: false,
    inicioCongelacion: 0,
    lector: crearLectorPrograma(),
    informado: null,
    motivo: null,
    sondaContestada: false
  }
  return {
    onDatos: (trozo) => alDatos(r, trozo),
    onEntrada: (datos) => alEntrada(r, datos),
    onMarcaTurno: (marca) => alMarcaTurno(r, marca),
    congelar: (ms) => congelar(r, ms),
    fijarPausado: (pausado) => fijarPausado(r, pausado),
    terminar: () => terminar(r),
    estado: () => (r.informado === 'blocked' ? 'blocked' : r.estadoActual),
    motivoEspera: () => (r.informado === 'blocked' ? r.motivo : null),
    esperandoRespuesta: () => esperando(r),
    dispose: () => dispose(r)
  }
}

/**
 * Congelada = eco de tecleo, ruido de la app o pty en pausa: la salida de ese rato no se
 * atribuye al agente, aunque sí se ve (ver `tick`).
 */
function frozen(r: Estado): boolean {
  return r.ecoActivo || r.estaCongelado || r.flujoPausado
}

function iniciarTurno(r: Estado): void {
  r.turnoAbierto = true
  r.ticksTurno = 0
  r.ticksEnSilencio = 0
  r.bytesTurno = 0
  r.campanaPendiente = false
  r.cierreSinMarca = false
  r.estadoActual = 'working'
  r.opts.onCambio('working')
}

/**
 * Cierra el turno. `real` = su fin es noticia (el CLI dijo que terminó, tocó la campana o se
 * agotó el silencio): emite 'done', que la UI convierte en "listo por revisar"; si no, 'idle'
 * silencioso. En ambos casos vacía la ventana: reabrir exige caudal nuevo. `marca` es la marca
 * del transcript que lo cierra, o null si lo cierra otra cosa; una marca sin fechar
 * (`at === 0`) también es un fin dicho por el CLI.
 */
function terminarTurno(r: Estado, real: boolean, marca: { en: number } | null = null): void {
  cerrarEstado(r, marca)
  r.opts.onCambio(real ? 'done' : 'idle')
}

/** Deja el turno cerrado sin avisar de nada: lo avisa quien llama. */
function cerrarEstado(r: Estado, marca: { en: number } | null): void {
  const marcaEn = marca?.en ?? 0
  r.turnoAbierto = false
  r.ticksTurno = 0
  r.ticksEnSilencio = 0
  r.campanaPendiente = false
  r.ventana = []
  r.cur = 0
  // Se apunta cuándo se cerró, en el reloj que corresponda, para descartar la marca de este
  // mismo turno cuando el vigilante vuelva a leerla.
  if (marcaEn > 0) r.cierreMarcaEn = Math.max(r.cierreMarcaEn, marcaEn)
  else r.cierreLocalEn = Math.max(r.cierreLocalEn, r.ahora())
  r.cierreSinMarca = marca === null
  r.estadoActual = 'idle'
}

/**
 * La pregunta de `esperandoRespuesta`. La última condición cruza relojes (la apertura la fecha
 * el agente y el envío el main), así que lleva el mismo margen que las marcas de cierre: sin
 * ella, la apertura huérfana con la que acaba el transcript de una conversación reanudada
 * pasaría por un diálogo de este turno. `ultimoEnvioEn` no puede valer 0: un cierre sin marca
 * exige un turno, y un turno exige un Enter desde el último `terminar`.
 */
function esperando(r: Estado): boolean {
  if (r.informado !== null) return r.informado === 'blocked'
  return (
    !r.turnoAbierto &&
    r.cierreSinMarca &&
    r.ultimaAperturaEn > r.ultimoCierreEn &&
    r.ultimaAperturaEn >= r.ultimoEnvioEn - r.opts.toleranciaMarcaMs
  )
}

/**
 * Avisa si `esperandoRespuesta` cambió. Se llama al final de cada entrada pública y no dentro
 * de `terminarTurno`: `terminar` cierra el turno y luego lo limpia, y avisar entre medias publicaría un
 * «espera tu respuesta» de una sesión que se está relanzando.
 */
function avisarEspera(r: Estado): void {
  const ahora = esperando(r)
  if (ahora === r.esperaAvisada) return
  r.esperaAvisada = ahora
  r.opts.alCambiarEspera?.(ahora)
}

function detenerMuestreo(r: Estado): void {
  if (r.cancelarMuestreo) {
    r.cancelarMuestreo()
    r.cancelarMuestreo = null
  }
}

function asegurarMuestreo(r: Estado): void {
  if (r.cancelarMuestreo) return
  r.cancelarMuestreo = r.opts.programar(() => tick(r), r.opts.tickMs)
}

function tick(r: Estado): void {
  r.cancelarMuestreo = null
  /** ¿Llegó algo por el pty en este tick, se atribuyera o no? */
  const huboSalida = r.bytesTick > 0
  r.bytesTick = 0

  if (r.turnoAbierto) {
    // El tiempo del turno corre siempre: el tope absoluto no puede esquivarse tecleando ni
    // arrastrando el separador.
    r.ticksTurno++
    // El silencio cuenta mientras se teclea o se redimensiona (lo que se ve no es trabajo del
    // agente, y si no llega nada está callado); con contrapresión no, porque el pty está en
    // pausa y la falta de bytes no dice nada del agente.
    if (!r.flujoPausado) r.ticksEnSilencio = huboSalida ? 0 : r.ticksEnSilencio + 1
  }

  // La ventana de caudal (solo alimenta la apertura de respaldo) no rueda con la detección
  // congelada: esos bytes no son atribuibles.
  if (!frozen(r)) {
    r.ventana.push(r.cur)
    r.cur = 0
    if (r.ventana.length > r.opts.ticksVentana) r.ventana.shift()
  }
  // Si el agente informa, ni el silencio cierra ni el caudal abre: lo dice él. Solo queda el tope,
  // contado desde su último 'working': un agente colgado que no avisa no deja el punto encendido.
  if (r.informado === null) deducirPorTick(r)
  else if (r.turnoAbierto && r.ticksTurno >= r.opts.maxTicksTurno) terminarTurno(r, false)
  avisarEspera(r)

  // Sin turno, sin nada que medir y sin congelación que levantar: apaga el muestreo hasta el
  // próximo chunk (las congelaciones lo reavivan al expirar).
  if (!r.turnoAbierto && !frozen(r) && r.ventana.every((b) => b === 0)) return
  asegurarMuestreo(r)
}

/** Sin avisos del agente: cierra el turno abierto o, si no hay, lo abre por caudal. */
function deducirPorTick(r: Estado): void {
  if (r.turnoAbierto) cerrarPorTick(r)
  // Apertura de respaldo: rescata el caso raro de un envío que `quitarPegados` no ve como tal.
  else if (!frozen(r) && r.estaArmado && r.ventana.reduce((a, b) => a + b, 0) >= r.opts.bytesApertura) iniciarTurno(r)
}

/**
 * Decide el cierre de un turno abierto en cada tick: por campana (el único fin que el
 * transcript no escribe), por silencio absoluto o por el tope de duración.
 */
function cerrarPorTick(r: Estado): void {
  if (r.campanaPendiente) {
    terminarTurno(r, true)
  } else if (r.ticksEnSilencio >= r.opts.ticksSilencio) {
    // Red de seguridad, no el camino normal. Exige silencio absoluto y no un caudal bajo un
    // umbral: cualquier repintado reinicia la cuenta, mientras que un umbral sobre una magnitud
    // continua oscila. Solo avisa si el turno llegó a producir trabajo (ver `bytesTurno`).
    terminarTurno(r, r.bytesTurno >= r.opts.bytesApertura)
  } else if (r.ticksTurno >= r.opts.maxTicksTurno) {
    // Nada puede dejar el indicador encendido para siempre; cierra en silencio porque no se
    // sabe si terminó y no se fabrica un aviso que nadie ha confirmado.
    terminarTurno(r, false)
  }
}

function alDatos(r: Estado, trozo: string): void {
  // Lo que dice el agente se atiende antes de cualquier guarda: son señales explícitas, y llegan
  // cuando el usuario suele estar tecleando (ventana de eco) o acaba de cambiar de pestaña.
  const lectura = r.lector.leer(trozo)
  // Una sola respuesta por proceso, y solo desde ella cuentan sus avisos: una sonda o un aviso que
  // salgan en lo que el agente enseña (un archivo, una salida) no pueden apagar la deducción ni
  // escribirle a ciegas, y los del proceso que muere tras `finish` no caen sobre el nuevo.
  if (lectura.sonda && !r.sondaContestada) {
    r.sondaContestada = true
    r.opts.responderSonda?.()
  }
  for (const aviso of lectura.avisos) {
    if (r.sondaContestada || (r.opts.informaSinSonda !== undefined && aviso.app === r.opts.informaSinSonda)) aplicarAviso(r, aviso)
  }
  if (lectura.avisos.length > 0) avisarEspera(r)
  // Solo una campana suelta: el BEL que cierra un OSC (un título, un aviso) no lo es.
  if (lectura.campanas > 0 && r.informado === null) {
    if (r.turnoAbierto) {
      r.campanaPendiente = true // se cierra en el próximo tick, con aviso
    } else if (r.estaArmado) {
      // Sin turno abierto: una respuesta tan breve que no llegó a abrirlo. La campana es
      // intencionada, así que basta ella sola.
      r.opts.onCambio('done')
    }
  }
  // Desarmado (aún no se ha enviado nada): nada de lo que salga puede ser trabajo.
  if (!r.estaArmado) return
  // «Ha llegado algo» se apunta siempre: distingue «el agente está callado» de «estamos
  // mirando para otro lado».
  r.bytesTick += trozo.length
  // Ruido de arranque, redibujado, eco o pty en pausa: no suma caudal atribuible.
  if (frozen(r)) return
  r.cur += trozo.length
  r.bytesTurno += trozo.length
  asegurarMuestreo(r)
}

/**
 * Un aviso del agente sobre su registro raíz: desde el primero, el estado es el que él dice. Los de
 * un hijo (`id`) no se miran: el raíz ya resume el programa entero. Solo se avisa de los cambios: el
 * agente repite 'working' con cada paso que da.
 */
function aplicarAviso(r: Estado, aviso: AvisoPrograma): void {
  if (aviso.id !== null) return
  const antes = r.informado
  const motivoAntes = r.motivo
  const estado = aviso.estado === 'clear' ? 'idle' : aviso.estado
  const motivo = estado === 'blocked' ? aviso.motivo : null
  r.informado = estado
  r.motivo = motivo
  if (estado === 'working') {
    // Un turno abierto por la deducción antes del primer aviso se queda como está. Cada paso
    // reinicia el tope: lo que cuenta es cuánto lleva sin decir nada, no cuánto dura el turno.
    if (!r.turnoAbierto) iniciarTurno(r)
    r.ticksTurno = 0
    // El muestreo cuenta el tope; sin un Enter de por medio (un `/loop`, una tarea de fondo) nadie lo arrancó.
    asegurarMuestreo(r)
    return
  }
  if (estado === antes && motivo === motivoAntes) return
  const abierto = r.turnoAbierto
  if (abierto) cerrarEstado(r, null)
  if (estado === 'blocked') {
    r.opts.onCambio('blocked', motivo)
    return
  }
  // Un aviso de cierre solo es noticia si cierra algo: el 'idle' del arranque o el 'done' repetido no.
  if (abierto || antes === 'working' || antes === 'blocked') r.opts.onCambio(estado === 'idle' ? 'idle' : 'done')
}

function alEntrada(r: Estado, datos: string): void {
  // Cualquier tecla del usuario contesta (o descarta) el diálogo que esperaba; el ruido del
  // terminal no (el foco que se va al pulsar el botón de actualizar).
  if (!esSoloRespuestaDeTerminal(datos)) r.cierreSinMarca = false
  // Enter = prompt enviado (lo pegado se descarta antes). El turno se abre aquí y no al superar
  // un umbral de bytes: esperar al caudal añadía hasta tres segundos de retraso al indicador. Si
  // el agente informa, no: un Enter en una línea vacía o en un menú no es trabajo, y él lo dirá.
  if (esEnvio(datos)) {
    r.estaArmado = true
    r.ultimoEnvioEn = r.ahora()
    if (!r.turnoAbierto && r.informado === null) iniciarTurno(r)
  }
  // Cualquier tecla congela la detección un momento: lo que salga es el eco de la caja de entrada.
  r.ecoActivo = true
  if (r.cancelarEco) r.cancelarEco()
  r.cancelarEco = r.opts.programar(() => {
    r.cancelarEco = null
    r.ecoActivo = false
    asegurarMuestreo(r)
  }, r.opts.graciaEcoMs)
  asegurarMuestreo(r)
  avisarEspera(r)
}

/**
 * Marca leída del transcript: la señal buena, así que actúa al instante y se atiende antes de
 * la guarda de congelación, igual que el BEL.
 */
function alMarcaTurno(r: Estado, marca: { tipo: 'abre' | 'cierra'; en: number }): void {
  // Para `esperandoRespuesta` se apunta toda marca fechada, antes de las guardas de cierre:
  // aquí interesa qué dice el disco del último turno. Las relecturas no cambian nada (`max`).
  if (marca.en > 0) {
    if (marca.tipo === 'abre') r.ultimaAperturaEn = Math.max(r.ultimaAperturaEn, marca.en)
    else r.ultimoCierreEn = Math.max(r.ultimoCierreEn, marca.en)
  }
  cerrarConMarca(r, marca)
  avisarEspera(r)
}

function cerrarConMarca(r: Estado, marca: { tipo: 'abre' | 'cierra'; en: number }): void {
  // Solo con turno abierto: el vigilante relee la cola del transcript en cada escritura, así que
  // la misma marca de cierre llega una y otra vez y sin esta guarda emitiría otro 'done' cada vez.
  // Si el agente informa, su aviso ya cerró: la marca llega después y no dice nada nuevo.
  if (!r.turnoAbierto || marca.tipo !== 'cierra' || r.informado !== null) return
  if (marca.en > 0) {
    // Del turno anterior, por dos vías: más vieja que el envío (menos el margen de reloj: al
    // reanudar, el transcript ya trae el cierre de la sesión pasada) o no posterior al último
    // cierre (si se contesta enseguida, la marca del turno que acaba de terminar cae dentro del
    // margen y cerraría el nuevo en el acto).
    if (r.ultimoEnvioEn > 0 && marca.en < r.ultimoEnvioEn - r.opts.toleranciaMarcaMs) return
    // Mismo reloj que la marca anterior: comparación exacta.
    if (marca.en <= r.cierreMarcaEn) return
    // Reloj del main: con margen, o el desfase contenedor/host tiraría marcas buenas.
    if (marca.en + r.opts.toleranciaMarcaMs <= r.cierreLocalEn) return
  }
  // Con `at === 0` (línea sin fechar) se acepta: no hay con qué descartarla.
  terminarTurno(r, true, marca)
}

function congelar(r: Estado, ms: number): void {
  const ahora = r.ahora()
  // Tope absoluto: se reprograma en cada resize y el pane dispara uno por fotograma al arrastrar
  // el separador; sin tope, arrastrar un minuto congelaría la detección un minuto.
  if (!r.estaCongelado) r.inicioCongelacion = ahora
  const restante = Math.min(ms, Math.max(0, r.inicioCongelacion + r.opts.maxCongelacionMs - ahora))
  r.estaCongelado = true
  if (r.cancelarCongelacion) r.cancelarCongelacion()
  if (restante <= 0) {
    r.estaCongelado = false
    r.cancelarCongelacion = null
    return
  }
  r.cancelarCongelacion = r.opts.programar(() => {
    r.cancelarCongelacion = null
    r.estaCongelado = false
    asegurarMuestreo(r)
  }, restante)
}

function fijarPausado(r: Estado, pausado: boolean): void {
  r.flujoPausado = pausado
  if (r.cancelarPausa) {
    r.cancelarPausa()
    r.cancelarPausa = null
  }
  if (!pausado) {
    asegurarMuestreo(r)
    return
  }
  // Última red del `paused` colgado: xterm solo despausa desde el callback de su `write`, que
  // no llega si la terminal se destruye con datos pendientes. Impide que una pausa perdida
  // congele el indicador para siempre.
  r.cancelarPausa = r.opts.programar(() => {
    r.cancelarPausa = null
    r.flujoPausado = false
    asegurarMuestreo(r)
  }, r.opts.maxPausaMs)
}

function terminar(r: Estado): void {
  if (r.turnoAbierto) terminarTurno(r, false)
  // La espera muere con el proceso: se apaga sin avisar de nada.
  else if (r.informado === 'blocked') r.opts.onCambio('idle')
  // El proceso relanzado vuelve a preguntar si se le entiende: hasta que informe, se deduce.
  r.informado = null
  r.motivo = null
  r.sondaContestada = false
  r.lector.reiniciar()
  // Reinicio completo: el proceso del agente muere aquí. Desarmar impide que el volcado del CLI
  // relanzado (con --resume reproduce la conversación entera) se cuente como trabajo nuevo.
  r.estaArmado = false
  r.ventana = []
  r.cur = 0
  r.campanaPendiente = false
  r.ultimoEnvioEn = 0
  r.cierreMarcaEn = 0
  r.cierreLocalEn = 0
  // El diálogo muere con el proceso: el transcript que reproduzca al reanudar es historia.
  r.ultimaAperturaEn = 0
  r.ultimoCierreEn = 0
  r.cierreSinMarca = false
  detenerMuestreo(r)
  avisarEspera(r)
}

function dispose(r: Estado): void {
  detenerMuestreo(r)
  for (const cancelar of [r.cancelarEco, r.cancelarCongelacion, r.cancelarPausa]) cancelar?.()
  r.cancelarEco = null
  r.cancelarCongelacion = null
  r.cancelarPausa = null
}

/**
 * Rastreador que no deduce nada: el de un agente MANUAL, del que Tessera no sabe leer los turnos.
 * Siempre 'idle': sin punto de «trabajando» ni aviso de fin.
 */
export function crearRastreadorInerte(): RastreadorActividad {
  const nada = (): void => {}
  return {
    onDatos: nada,
    onEntrada: nada,
    onMarcaTurno: nada,
    congelar: nada,
    fijarPausado: nada,
    terminar: nada,
    estado: () => 'idle',
    motivoEspera: () => null,
    esperandoRespuesta: () => false,
    dispose: nada
  }
}

/** Scheduler de producción: envuelve setTimeout/clearTimeout de Node/Electron. */
export function realScheduler(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms)
  return () => clearTimeout(t)
}
