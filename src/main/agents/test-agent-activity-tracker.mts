#!/usr/bin/env node
// =============================================================================
// Prueba del rastreador de actividad (`agentActivity.createActivityTracker`), con reloj y scheduler
// falsos.
// (node src/main/agents/test-agent-activity-tracker.mts)
// Cubre el modelo de turnos: abre el Enter; cierran la marca del transcript, la campana, el
// silencio absoluto o el tope; y una interfaz que repinta sin parar no produce transiciones
// espurias.
// Y `esperandoRespuesta`: se ve con campana, silencio o apertura tardía, no bloquea sin marcas ni
// para siempre, y el foco no cuenta como contestar.
// =============================================================================

import {
  createActivityTracker,
  esSoloRespuestaDeTerminal,
  quitarCadenasControl,
  type ActivityTracker
} from './agentActivity.ts'
import type { AgentActivityState } from '../../shared/agent-terminal-ipc.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Reloj manual: schedule encola, advance(ms) dispara lo vencido, now() lo lee. */
function makeClock(): {
  schedule: (fn: () => void, ms: number) => () => void
  advance: (ms: number) => void
  now: () => number
} {
  let now = 0
  let idc = 0
  let timers: { at: number; fn: () => void; id: number }[] = []
  return {
    schedule(fn, ms) {
      const id = ++idc
      timers.push({ at: now + ms, fn, id })
      return () => {
        timers = timers.filter((t) => t.id !== id)
      }
    },
    advance(ms) {
      now += ms
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)
      for (const t of due) {
        timers = timers.filter((x) => x !== t)
        t.fn()
      }
    },
    now: () => now
  }
}

const TICK = 500
const ECHO = 300
const SILENCE_TICKS = 20
const MAX_TURN_TICKS = 3600
const MAX_SUPPRESS = 3000
const MAX_PAUSE = 8000
const TOLERANCIA = 5000

function setup(): {
  tracker: ActivityTracker
  clock: ReturnType<typeof makeClock>
  changes: AgentActivityState[]
  /** Avanza n ticks del muestreo (uno por llamada: el ticker se reprograma solo). */
  ticks: (n: number) => void
  /** Simula que el usuario escribe `s` (sin Enter). */
  type: (s: string) => void
  /** Simula el envío de un prompt (arma la sesión y abre turno). */
  submit: () => void
  /** Simula `bytes` bytes de salida del pty (con bell opcional). */
  out: (bytes: number, bell?: boolean) => void
  /** Simula una marca de FIN leída del transcript, fechada `at` (por defecto, ahora). */
  cierra: (at?: number) => void
  /** Simula una marca de APERTURA (`tool_use` / `task_started`), fechada `at` (por defecto, ahora). */
  abre: (at?: number) => void
  /** Cada aviso de `alCambiarEspera`, en orden. */
  esperas: boolean[]
} {
  const clock = makeClock()
  const changes: AgentActivityState[] = []
  const esperas: boolean[] = []
  const tracker = createActivityTracker({
    tickMs: TICK,
    windowTicks: 6,
    openBytes: 2000,
    echoGraceMs: ECHO,
    silenceTicks: SILENCE_TICKS,
    maxTurnTicks: MAX_TURN_TICKS,
    maxSuppressMs: MAX_SUPPRESS,
    maxPauseMs: MAX_PAUSE,
    markToleranceMs: TOLERANCIA,
    schedule: clock.schedule,
    now: clock.now,
    onChange: (s) => changes.push(s),
    alCambiarEspera: (e) => esperas.push(e)
  })
  return {
    tracker,
    clock,
    changes,
    ticks: (n) => {
      for (let i = 0; i < n; i++) clock.advance(TICK)
    },
    type: (s) => tracker.onInput(s),
    submit: () => {
      tracker.onInput('\r')
      clock.advance(ECHO) // deja pasar la ventana de eco del Enter
    },
    out: (bytes, bell = false) => tracker.onData('x'.repeat(bytes) + (bell ? '\x07' : '')),
    cierra: (at) => tracker.onTurnMark({ tipo: 'cierra', at: at ?? clock.now() }),
    abre: (at) => tracker.onTurnMark({ tipo: 'abre', at: at ?? clock.now() }),
    esperas
  }
}

// (1) SIN submit no hay trabajo: un chorro de salida en una sesión que nunca ha
//     recibido un prompt (repintados, banners, resúmenes) NO enciende nada.
{
  const { tracker, ticks, out, changes } = setup()
  out(5000)
  ticks(4)
  check(
    '(1) sin prompt del usuario => nunca working',
    tracker.state() === 'idle' && changes.length === 0,
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (2) Turno normal v3: el Enter abre AL INSTANTE y la marca del transcript cierra.
{
  const { tracker, ticks, out, submit, cierra, changes } = setup()
  submit()
  check(
    '(2a) el Enter abre el turno al instante, sin esperar al caudal',
    tracker.state() === 'working' && changes.join(',') === 'working',
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
  for (let i = 0; i < 15; i++) {
    out(1000)
    ticks(1)
  }
  cierra()
  check(
    '(2b) la marca del transcript cierra con aviso (done), sin esperar a ningún tick',
    tracker.state() === 'idle' && changes.join(',') === 'working,done',
    `changes=[${changes.join(',')}]`
  )
}

// (3) TECLEAR no arma ni abre: sin Enter, ni el eco ni el repintado de la caja de
//     entrada pueden encender el indicador.
{
  const { tracker, ticks, type, out, changes } = setup()
  for (let i = 0; i < 10; i++) {
    type('a')
    out(900) // la TUI repinta la caja de entrada en cada tecla
    ticks(1)
  }
  check(
    '(3) escribir sin enviar NO abre turno',
    tracker.state() === 'idle' && changes.length === 0,
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (4) Escribir un follow-up MIENTRAS trabaja no le cierra el turno.
{
  const { tracker, clock, type, submit } = setup()
  submit()
  for (let i = 0; i < 30; i++) {
    type('b')
    clock.advance(100)
  }
  check('(4) teclear durante el turno no lo cierra', tracker.state() === 'working', `state=${tracker.state()}`)
}

// (5) EL CASO QUE MOTIVA LA V3: interfaz que repinta SIN PARAR durante un minuto, con
//     un caudal que en la v2 cruzaba el umbral de cierre arriba y abajo. Antes eso
//     producía un `working -> done -> working` interminable (el parpadeo con Codex);
//     ahora no hay ni una transición de más, porque el silencio es de CERO bytes.
{
  const { tracker, ticks, out, submit, changes } = setup()
  submit()
  changes.length = 0
  for (let i = 0; i < 120; i++) {
    out(i % 3 === 0 ? 300 : 40) // repintado irregular alrededor del viejo umbral
    ticks(1)
  }
  check(
    '(5) 60 s de repintado sostenido => CERO transiciones espurias (fin del parpadeo)',
    tracker.state() === 'working' && changes.length === 0,
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (6) El BELL cierra con AVISO aunque sea corto: es la señal de "necesito tu
//     aprobación", que NO escribe fin de turno en ningún transcript.
{
  const { tracker, ticks, out, submit, changes } = setup()
  submit()
  out(500, true)
  ticks(1)
  check(
    '(6) bell => done aunque el turno sea corto (cubre "espero tu aprobación")',
    tracker.state() === 'idle' && changes.join(',') === 'working,done',
    `changes=[${changes.join(',')}]`
  )
}

// (7) MARCA ANTERIOR AL ENVÍO: al reanudar una conversación, el transcript ya trae el
//     `task_complete` del turno de la sesión pasada. Leerlo no puede cerrar el turno
//     que acabas de abrir.
{
  const { tracker, clock, submit, cierra, changes } = setup()
  clock.advance(120_000)
  const vieja = clock.now() - 60_000 // marca de hace un minuto, ya en el fichero
  submit()
  cierra(vieja)
  check(
    '(7) una marca anterior a tu envío se ignora (transcript reanudado)',
    tracker.state() === 'working' && changes.join(',') === 'working',
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (7b) …pero una marca dentro de la tolerancia SÍ vale: la fecha el contenedor y el
//      envío el host, y un par de segundos de desfase no pueden invalidarla.
{
  const { tracker, submit, clock, cierra, changes } = setup()
  submit()
  const casi = clock.now() - 3000
  cierra(casi)
  check(
    '(7b) una marca 3 s anterior al envío entra por tolerancia de reloj',
    tracker.state() === 'idle' && changes.join(',') === 'working,done',
    `changes=[${changes.join(',')}]`
  )
}

// (8) SUPRESIÓN (arranque / redibujado por resize): la salida provocada por la app no
//     abre turno, aunque la sesión esté armada.
{
  const { tracker, ticks, out, changes } = setup()
  tracker.suppress(2500)
  out(9000)
  ticks(3)
  check(
    '(8) el ruido de arranque/resize no abre turno',
    tracker.state() === 'idle' && changes.length === 0,
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (8b) ARRASTRAR EL SEPARADOR no deja el indicador pegado. El `ResizeObserver` del pane
//      reprograma un `suppress` por fotograma, así que la detección pasa el arrastre
//      entero congelada; pero congelado significa "lo que llega no es trabajo", no "no
//      podemos ver": si además NO llega nada, el agente está callado y el turno cierra.
{
  const { tracker, clock, submit, changes } = setup()
  submit()
  changes.length = 0
  for (let i = 0; i < SILENCE_TICKS + 2; i++) {
    tracker.suppress(600) // un resize por tick, como al arrastrar
    clock.advance(TICK)
  }
  // El cierre es SILENCIOSO porque el agente no llegó a producir nada (ver el caso 19):
  // lo que se comprueba aquí es que la congelación no impide cerrarlo.
  check(
    '(8b) arrastrar el separador con el agente callado no impide cerrar el turno',
    tracker.state() === 'idle' && changes.join(',') === 'idle',
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (8c) …y si durante ese arrastre el agente SÍ está emitiendo, el turno sigue abierto:
//      el silencio es de bytes, no de atención.
{
  const { tracker, clock, out, submit } = setup()
  submit()
  for (let i = 0; i < SILENCE_TICKS + 2; i++) {
    tracker.suppress(600)
    out(500) // el CLI repinta por SIGWINCH… y además sigue trabajando
    clock.advance(TICK)
  }
  check(
    '(8c) con salida durante el arrastre, el turno NO se cierra',
    tracker.state() === 'working',
    `state=${tracker.state()}`
  )
}

// (9) finish(): cerrar/hibernar/morir la sesión apaga el indicador en SILENCIO.
{
  const { tracker, ticks, out, submit, changes } = setup()
  submit()
  for (let i = 0; i < 8; i++) {
    out(1000)
    ticks(1)
  }
  tracker.finish()
  check(
    '(9) finish cierra el turno sin avisar (idle)',
    tracker.state() === 'idle' && changes[changes.length - 1] === 'idle',
    `changes=[${changes.join(',')}]`
  )
}

// (10) Tras cerrar un turno, el siguiente Enter abre otro.
{
  const { tracker, submit, cierra, changes } = setup()
  submit()
  cierra()
  submit()
  check(
    '(10) un segundo turno reabre normalmente',
    tracker.state() === 'working' && changes.join(',') === 'working,done,working',
    `changes=[${changes.join(',')}]`
  )
}

// (11) El BELL que llega MIENTRAS tecleas NO se pierde: se atiende antes de la guarda
//      de congelación (si no, el turno solo podía cerrarse por silencio).
{
  const { tracker, clock, ticks, type, out, submit, changes } = setup()
  submit()
  type('s')
  clock.advance(50)
  out(400, true)
  clock.advance(ECHO)
  ticks(1)
  check(
    '(11) bell durante la congelación por tecleo => cierra con aviso',
    tracker.state() === 'idle' && changes.join(',') === 'working,done',
    `changes=[${changes.join(',')}]`
  )
}

// (11b) Y la MARCA del transcript, igual: llega justo cuando estás escribiendo lo
//       siguiente, así que tampoco puede quedarse fuera por la ventana de eco.
{
  const { tracker, clock, type, submit, cierra, changes } = setup()
  submit()
  type('s')
  clock.advance(50)
  cierra()
  check(
    '(11b) la marca del transcript durante la congelación tampoco se pierde',
    tracker.state() === 'idle' && changes.join(',') === 'working,done',
    `changes=[${changes.join(',')}]`
  )
}

// (12) finish() DESARMA: tras cerrar/hibernar/recargar, el volcado del CLI relanzado
//      (que con --resume reproduce la conversación entera) NO puede pasar por trabajo.
{
  const { tracker, ticks, out, submit, changes } = setup()
  submit()
  out(1000)
  ticks(2)
  tracker.finish()
  changes.length = 0
  out(9000)
  ticks(12)
  check(
    '(12) tras finish la sesión queda DESARMADA (el volcado no abre turno)',
    tracker.state() === 'idle' && changes.length === 0,
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (13) PEGAR un bloque multilínea no es enviarlo: el bracketed paste lleva \r dentro,
//      pero el prompt sigue sin mandarse, así que no debe armar ni abrir.
{
  const { tracker, ticks, out, changes } = setup()
  tracker.onInput('\x1b[200~línea 1\rlínea 2\rlínea 3\x1b[201~')
  ticks(1)
  out(5000)
  ticks(3)
  check(
    '(13) pegado multilínea NO arma la sesión',
    tracker.state() === 'idle' && changes.length === 0,
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (14) CONTRAPRESIÓN: con el pty en pausa no llegan bytes aunque el agente trabaje; la
//      pausa no puede leerse como fin de turno.
{
  const { tracker, ticks, out, submit } = setup()
  submit()
  tracker.setPaused(true)
  ticks(10) // 5 s: el xterm drena mientras el agente sigue trabajando
  check('(14) la pausa por contrapresión no cierra el turno', tracker.state() === 'working', `state=${tracker.state()}`)
  tracker.setPaused(false)
  out(1000)
  ticks(1)
  check('(14b) al reanudar sigue el mismo turno', tracker.state() === 'working', `state=${tracker.state()}`)
}

// (14c) …pero una pausa que NUNCA se levanta tiene tope. Pasa de verdad: xterm solo
//       despausa desde el callback de su `write`, y ese callback no llega si la
//       terminal se resetea con datos pendientes (reanudar, nueva conversación,
//       cambiar de cuenta). Sin tope, el indicador se quedaba encendido para siempre.
{
  const { tracker, ticks, submit, changes } = setup()
  submit()
  changes.length = 0
  tracker.setPaused(true)
  ticks(60) // 30 s: muy por encima del tope de pausa (8 s) + el silencio (10 s)
  // Silencioso por lo mismo que (8b): no hubo salida que atribuir.
  check(
    '(14c) una pausa colgada deja de congelar y el turno acaba cerrándose',
    tracker.state() === 'idle' && changes.join(',') === 'idle',
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (15) SILENCIO ABSOLUTO: sin marca ni campana (CLI viejo que no escribe marcadores),
//      diez segundos sin UN SOLO byte cierran el turno con aviso.
{
  const { tracker, ticks, out, submit, changes } = setup()
  submit()
  // Salida de un turno REAL: por encima del umbral que distingue trabajo de un repintado.
  for (let i = 0; i < 3; i++) {
    out(1000)
    ticks(1)
  }
  check('(15a) mientras hay salida, el turno sigue abierto', tracker.state() === 'working', `state=${tracker.state()}`)
  ticks(SILENCE_TICKS + 1)
  check(
    '(15b) sin marcador, el silencio absoluto cierra con aviso (degradación digna)',
    tracker.state() === 'idle' && changes.join(',') === 'working,done',
    `changes=[${changes.join(',')}]`
  )
}

// (16) Respuesta MUY corta con campana en una sesión ya cerrada: avisa igual, con un
//      'done' suelto.
{
  const { tracker, ticks, out, submit, cierra, changes } = setup()
  submit()
  cierra()
  changes.length = 0
  out(300, true)
  ticks(2)
  check(
    '(16) campana sin turno abierto => done suelto',
    changes.join(',') === 'done' && tracker.state() === 'idle',
    `changes=[${changes.join(',')}] state=${tracker.state()}`
  )
}

// (16c) FOLLOW-UP RÁPIDO: contestas dos segundos después de que el agente terminara.
//       La marca del turno anterior sigue siendo la última del fichero y cae DENTRO del
//       margen de reloj, así que la guarda por fecha de envío no basta: hace falta que
//       la marca sea posterior al último cierre. Si no, el turno nuevo se cerraba solo.
{
  const { tracker, clock, submit, cierra, changes } = setup()
  clock.advance(100_000)
  submit()
  const finDelPrimero = clock.now() + 30_000
  clock.advance(30_000)
  cierra(finDelPrimero) // el agente termina
  clock.advance(2_000) // …y contestas enseguida
  submit()
  changes.length = 0
  cierra(finDelPrimero) // el vigilante relee y encuentra la MISMA marca
  check(
    '(16c) tras un follow-up rápido, la marca del turno anterior no cierra el nuevo',
    tracker.state() === 'working' && changes.length === 0,
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (16b) LA MISMA marca de cierre, entregada muchas veces. Pasa siempre: el vigilante
//       relee la cola del transcript en CADA escritura, y el CLI sigue tocando el
//       fichero después de terminar. Sin la guarda, cada relectura emitía otro 'done'
//       y el panel volvía a parpadear.
{
  const { tracker, submit, cierra, changes } = setup()
  submit()
  cierra()
  changes.length = 0
  for (let i = 0; i < 5; i++) cierra()
  check(
    '(16b) releer la misma marca de cierre no vuelve a avisar',
    changes.length === 0 && tracker.state() === 'idle',
    `changes=[${changes.join(',')}]`
  )
}

// (17) …pero una campana en una sesión DESARMADA (nunca le escribiste, o murió y se
//      relanzó) no avisa de nada.
{
  const { ticks, out, changes } = setup()
  out(300, true)
  ticks(2)
  check('(17) campana sin prompt previo => silencio', changes.length === 0, `changes=[${changes.join(',')}]`)
}

// (18) TOPE ABSOLUTO de duración: pase lo que pase el indicador se apaga, y lo hace en
//      SILENCIO (a esas alturas no sabemos si terminó, así que no se fabrica un aviso).
{
  const { tracker, ticks, out, submit, changes } = setup()
  submit()
  changes.length = 0
  // Salida constante durante media hora larga: ni silencio, ni marca, ni campana.
  for (let i = 0; i < MAX_TURN_TICKS + 5; i++) {
    out(100)
    ticks(1)
  }
  check(
    '(18) el tope de duración apaga el indicador SIN fabricar un aviso',
    tracker.state() === 'idle' && changes.join(',') === 'idle',
    `state=${tracker.state()} changes=[${changes.join(',')}]`
  )
}

// (19) NO TODO ENTER ES UN PROMPT. Dentro del TUI se pulsa Enter para elegir en un menú
//      (`/model`), para aprobar una herramienta o sobre una línea vacía. Todos abren
//      turno —eso es lo que da el indicador instantáneo— pero ninguno es trabajo, y el
//      repintado que provocan cae dentro de la ventana de eco, así que no se atribuye.
//      Sin la guarda de `turnBytes`, cada uno fabricaba un verde "listo por revisar"
//      diez segundos después: un aviso de algo que nunca pasó, en la señal que todo
//      este rediseño existe para volver fiable.
{
  const { tracker, clock, ticks, type, out, changes } = setup()
  type('\r') // Enter de menú: SIN dejar pasar la ventana de eco
  out(4000) // la TUI repinta la pantalla entera al cerrar el menú…
  clock.advance(ECHO)
  ticks(SILENCE_TICKS + 2) // …y después, nada
  check(
    '(19) un Enter que no es un prompt NO fabrica un aviso (cierre silencioso)',
    tracker.state() === 'idle' && changes.join(',') === 'working,idle',
    `changes=[${changes.join(',')}]`
  )
}

// (19b) …y el mismo Enter, si detrás viene trabajo de verdad, sí avisa.
{
  const { tracker, ticks, out, submit, changes } = setup()
  submit()
  for (let i = 0; i < 5; i++) {
    out(1000)
    ticks(1)
  }
  ticks(SILENCE_TICKS + 1)
  check(
    '(19b) el mismo camino, con trabajo real detrás, sí avisa',
    tracker.state() === 'idle' && changes.join(',') === 'working,done',
    `changes=[${changes.join(',')}]`
  )
}

// (20) ¿ESPERA TU RESPUESTA? Un diálogo de permiso: el agente pide una herramienta (el
//      transcript escribe una APERTURA) y se para a preguntarte. La campana cierra el
//      turno del rastreador —no trabaja, y el indicador tiene razón—, pero el `^C` de un
//      reinicio cancelaría el diálogo: `esperandoRespuesta` tiene que decirlo.
/** Turno con salida, apertura en disco y la campana del diálogo. Reloj lejos del 0. */
function dialogoConCampana(s: ReturnType<typeof setup>): void {
  s.clock.advance(100_000)
  s.submit()
  s.out(3000)
  s.ticks(1)
  s.abre() // `tool_use`: pide permiso
  s.out(200, true) // …y toca la campana
  s.ticks(1)
}
const espera = (t: ActivityTracker): string => `state=${t.state()} esperandoRespuesta=${t.esperandoRespuesta()}`
{
  const s = setup()
  dialogoConCampana(s)
  check(
    '(20a) apertura en disco + campana => idle, pero ESPERA TU RESPUESTA (y se avisa)',
    s.tracker.state() === 'idle' && s.tracker.esperandoRespuesta() && s.esperas.join() === 'true',
    `${espera(s.tracker)} avisos=[${s.esperas.join()}]`
  )
  s.type('\x1b[O') // el foco se va al pulsar el botón de actualizar…
  s.type('\x1b[I') // …y vuelve
  s.type('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\') // una respuesta de color de xterm
  s.type('\x1b[<64;10;5M') // la rueda, para leer el diálogo
  check(
    '(20b) el foco, las respuestas de xterm y la rueda NO contestan: sigue esperando',
    s.tracker.esperandoRespuesta() && s.esperas.join() === 'true',
    `${espera(s.tracker)} avisos=[${s.esperas.join()}]`
  )
  s.type('y') // Codex: aprobar con una tecla, sin Enter
  check(
    '(20c) una tecla tuya la apaga (y se avisa del cambio)',
    !s.tracker.esperandoRespuesta() && s.esperas.join() === 'true,false',
    `${espera(s.tracker)} avisos=[${s.esperas.join()}]`
  )
}
{
  const s = setup()
  dialogoConCampana(s)
  s.clock.advance(4_000)
  s.cierra() // el CLI escribe el fin (contestaste en otro sitio, o era el final del turno)
  check('(20d) un \'cierra\' tardío la apaga', !s.tracker.esperandoRespuesta() && s.esperas.join() === 'true,false', `${espera(s.tracker)} avisos=[${s.esperas.join()}]`)
}
{
  const s = setup()
  dialogoConCampana(s)
  s.submit() // Enter: contestas y el agente sigue
  const trasEnter = s.tracker.esperandoRespuesta()
  s.out(3000)
  s.ticks(1)
  s.cierra()
  check(
    '(20e) un turno nuevo la apaga, y un turno que cierra el CLI no la vuelve a encender',
    !trasEnter && !s.tracker.esperandoRespuesta() && s.tracker.state() === 'idle',
    `trasEnter=${trasEnter} ${espera(s.tracker)}`
  )
}
{
  const s = setup()
  dialogoConCampana(s)
  s.tracker.finish() // se relanza la sesión
  check('(20f) finish la apaga (el diálogo muere con el proceso)', !s.tracker.esperandoRespuesta() && s.esperas.join() === 'true,false', `${espera(s.tracker)} avisos=[${s.esperas.join()}]`)
}
{
  // Codex quizá no toca campana: basta el silencio del diálogo, que no repinta.
  const { tracker, clock, ticks, out, submit, abre } = setup()
  clock.advance(100_000)
  submit()
  out(3000)
  ticks(1)
  abre()
  ticks(SILENCE_TICKS + 1)
  check('(20g) apertura en disco + diez segundos de silencio => espera tu respuesta', tracker.state() === 'idle' && tracker.esperandoRespuesta(), espera(tracker))
}
{
  // La apertura se lee DESPUÉS de la campana (el vigilante llega tarde): cuenta igual.
  const { tracker, clock, ticks, out, submit, abre } = setup()
  clock.advance(100_000)
  submit()
  out(3000)
  ticks(1)
  out(200, true)
  ticks(1)
  const antes = tracker.esperandoRespuesta()
  abre(clock.now() - 1_000)
  check('(20h) una apertura leída después de la campana la enciende', !antes && tracker.esperandoRespuesta(), `antes=${antes} ${espera(tracker)}`)
}

// (21) …y NO bloquea de más.
{
  const { tracker, clock, ticks, out, submit, esperas } = setup()
  clock.advance(100_000)
  submit()
  out(3000)
  ticks(1)
  out(200, true)
  ticks(1)
  check('(21a) sin marcas en disco (CLI que no las escribe, sin vigilante) => nunca', !tracker.esperandoRespuesta() && esperas.length === 0, espera(tracker))
}
{
  // Conversación REANUDADA: su transcript acaba en una apertura huérfana de ayer.
  const { tracker, clock, ticks, out, submit, abre } = setup()
  clock.advance(100_000)
  submit()
  abre(clock.now() - TOLERANCIA - 60_000)
  out(3000)
  ticks(1)
  out(200, true)
  ticks(1)
  check('(21b) una apertura anterior a tu envío (fuera del margen) no es un diálogo de este turno', !tracker.esperandoRespuesta(), espera(tracker))
}
{
  // El CLI cerró el turno con una marca SIN FECHA: es un fin, no un diálogo.
  const { tracker, clock, ticks, out, submit, abre } = setup()
  clock.advance(100_000)
  submit()
  out(3000)
  ticks(1)
  abre()
  tracker.onTurnMark({ tipo: 'cierra', at: 0 })
  check('(21c) un turno cerrado por marca (aunque venga sin fechar) no espera nada', tracker.state() === 'idle' && !tracker.esperandoRespuesta(), espera(tracker))
}
{
  // Turno normal cerrado por el CLI, y DESPUÉS llega la apertura de otra sesión del
  // mismo proyecto (el vigilante reparte por nombre de proyecto).
  const { tracker, clock, ticks, out, submit, abre, cierra } = setup()
  clock.advance(100_000)
  submit()
  out(3000)
  ticks(1)
  cierra()
  clock.advance(2_000)
  abre()
  check('(21d) tras un fin dicho por el CLI, una apertura ajena no la enciende', !tracker.esperandoRespuesta(), espera(tracker))
}
{
  const a = esSoloRespuestaDeTerminal
  const ruido = ['\x1b[I', '\x1b[O', '\x1b[12;40R', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[?2004;1$y', '\x1b[<0;10;5M', '\x1b]11;rgb:0000/0000/0000\x07', '\x1bP1$r0m\x1b\\', '']
  const teclas = ['y', '\r', '\x1b', '\x1b[A', '\x03', '\x1b[I' + 'y', `\x1b[200~pegado\x1b[201~`]
  check(
    '(21e) ruido del terminal vs. teclas: foco, CPR, DA, DECRPM, ratón SGR, OSC y DCS no son tecla; letra, Enter, Esc, flecha, ^C y pegado sí',
    ruido.every((x) => a(x)) && teclas.every((x) => !a(x)),
    `ruido=${ruido.map((x) => a(x)).join()} teclas=${teclas.map((x) => a(x)).join()}`
  )
  const sinOsc = quitarCadenasControl('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\/clear\x1b]10;?\x07\r')
  check('(21f) quitarCadenasControl deja lo tecleado intacto', sinOsc === '/clear\r', JSON.stringify(sinOsc))
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(60))
console.log(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
