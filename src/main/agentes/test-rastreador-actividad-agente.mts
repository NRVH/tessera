#!/usr/bin/env node
// =============================================================================
// Prueba del rastreador de actividad (`actividadAgente.crearRastreadorActividad`), con reloj y scheduler
// falsos.
// (node src/main/agentes/test-rastreador-actividad-agente.mts)
// Cubre el modelo de turnos: abre el Enter; cierran la marca del transcript, la campana, el
// silencio absoluto o el tope; y una interfaz que repinta sin parar no produce transiciones
// espurias.
// Y `esperandoRespuesta`: se ve con campana, silencio o apertura tardía, no bloquea sin marcas ni
// para siempre, y el foco no cuenta como contestar.
// =============================================================================

import {
  crearRastreadorActividad,
  esSoloRespuestaDeTerminal,
  quitarCadenasControl,
  type RastreadorActividad
} from './actividadAgente.ts'
import type { EstadoActividadAgente, MotivoEsperaAgente } from '../../shared/agent-terminal-ipc.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Reloj manual: schedule encola, advance(ms) dispara lo vencido, now() lo lee. */
function crearRelojPrueba(): {
  programar: (fn: () => void, ms: number) => () => void
  advance: (ms: number) => void
  ahora: () => number
} {
  let ahora = 0
  let idc = 0
  let temporizadores: { en: number; fn: () => void; id: number }[] = []
  return {
    programar(fn, ms) {
      const id = ++idc
      temporizadores.push({ en: ahora + ms, fn, id })
      return () => {
        temporizadores = temporizadores.filter((t) => t.id !== id)
      }
    },
    advance(ms) {
      ahora += ms
      const due = temporizadores.filter((t) => t.en <= ahora).sort((a, b) => a.en - b.en)
      for (const t of due) {
        temporizadores = temporizadores.filter((x) => x !== t)
        t.fn()
      }
    },
    ahora: () => ahora
  }
}

const TICK = 500
const ECHO = 300
const TICKS_SILENCIO = 20
const MAX_TICKS_TURNO = 3600
const MAX_SUPRESION = 3000
const MAX_PAUSA = 8000
const TOLERANCIA = 5000

function setup(informaSinSonda?: string): {
  rastreador: RastreadorActividad
  reloj: ReturnType<typeof crearRelojPrueba>
  cambios: EstadoActividadAgente[]
  /** Avanza n ticks del muestreo (uno por llamada: el ticker se reprograma solo). */
  ticks: (n: number) => void
  /** Simula que el usuario escribe `s` (sin Enter). */
  teclear: (s: string) => void
  /** Simula el envío de un prompt (arma la sesión y abre turno). */
  enviar: () => void
  /** Simula `bytes` bytes de salida del pty (con bell opcional). */
  emitirSalida: (bytes: number, campana?: boolean) => void
  /** Simula una marca de FIN leída del transcript, fechada `at` (por defecto, ahora). */
  cierra: (en?: number) => void
  /** Simula una marca de APERTURA (`tool_use` / `task_started`), fechada `at` (por defecto, ahora). */
  abre: (en?: number) => void
  /** Cada aviso de `alCambiarEspera`, en orden. */
  esperas: boolean[]
  /** El motivo de cada `onChange` (null salvo en 'blocked'). */
  motivos: (MotivoEsperaAgente | null)[]
  /** Cuándo se contestó cada sonda del protocolo de estado. */
  sondas: number[]
  /** El agente informa su estado: un OSC 7501 con ese cuerpo. */
  informa: (cuerpo: string) => void
} {
  const reloj = crearRelojPrueba()
  const cambios: EstadoActividadAgente[] = []
  const motivos: (MotivoEsperaAgente | null)[] = []
  const sondas: number[] = []
  const esperas: boolean[] = []
  const rastreador = crearRastreadorActividad({
    tickMs: TICK,
    ticksVentana: 6,
    bytesApertura: 2000,
    graciaEcoMs: ECHO,
    ticksSilencio: TICKS_SILENCIO,
    maxTicksTurno: MAX_TICKS_TURNO,
    maxCongelacionMs: MAX_SUPRESION,
    maxPausaMs: MAX_PAUSA,
    toleranciaMarcaMs: TOLERANCIA,
    programar: reloj.programar,
    ahora: reloj.ahora,
    onCambio: (s, m) => {
      cambios.push(s)
      motivos.push(m ?? null)
    },
    alCambiarEspera: (e) => esperas.push(e),
    responderSonda: () => sondas.push(reloj.ahora()),
    ...(informaSinSonda !== undefined ? { informaSinSonda } : {})
  })
  return {
    rastreador,
    reloj,
    cambios,
    ticks: (n) => {
      for (let i = 0; i < n; i++) reloj.advance(TICK)
    },
    teclear: (s) => rastreador.onEntrada(s),
    enviar: () => {
      rastreador.onEntrada('\r')
      reloj.advance(ECHO) // deja pasar la ventana de eco del Enter
    },
    emitirSalida: (bytes, campana = false) => rastreador.onDatos('x'.repeat(bytes) + (campana ? '\x07' : '')),
    cierra: (en) => rastreador.onMarcaTurno({ tipo: 'cierra', en: en ?? reloj.ahora() }),
    abre: (en) => rastreador.onMarcaTurno({ tipo: 'abre', en: en ?? reloj.ahora() }),
    esperas,
    motivos,
    sondas,
    informa: (cuerpo) => rastreador.onDatos(`\x1b]7501;${cuerpo}\x07`)
  }
}

// (1) SIN submit no hay trabajo: un chorro de salida en una sesión que nunca ha
//     recibido un prompt (repintados, banners, resúmenes) NO enciende nada.
{
  const { rastreador, ticks, emitirSalida, cambios } = setup()
  emitirSalida(5000)
  ticks(4)
  check(
    '(1) sin prompt del usuario => nunca working',
    rastreador.estado() === 'idle' && cambios.length === 0,
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (2) Turno normal v3: el Enter abre AL INSTANTE y la marca del transcript cierra.
{
  const { rastreador, ticks, emitirSalida, enviar, cierra, cambios } = setup()
  enviar()
  check(
    '(2a) el Enter abre el turno al instante, sin esperar al caudal',
    rastreador.estado() === 'working' && cambios.join(',') === 'working',
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
  for (let i = 0; i < 15; i++) {
    emitirSalida(1000)
    ticks(1)
  }
  cierra()
  check(
    '(2b) la marca del transcript cierra con aviso (done), sin esperar a ningún tick',
    rastreador.estado() === 'idle' && cambios.join(',') === 'working,done',
    `changes=[${cambios.join(',')}]`
  )
}

// (3) TECLEAR no arma ni abre: sin Enter, ni el eco ni el repintado de la caja de
//     entrada pueden encender el indicador.
{
  const { rastreador, ticks, teclear, emitirSalida, cambios } = setup()
  for (let i = 0; i < 10; i++) {
    teclear('a')
    emitirSalida(900) // la TUI repinta la caja de entrada en cada tecla
    ticks(1)
  }
  check(
    '(3) escribir sin enviar NO abre turno',
    rastreador.estado() === 'idle' && cambios.length === 0,
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (4) Escribir un follow-up MIENTRAS trabaja no le cierra el turno.
{
  const { rastreador, reloj, teclear, enviar } = setup()
  enviar()
  for (let i = 0; i < 30; i++) {
    teclear('b')
    reloj.advance(100)
  }
  check('(4) teclear durante el turno no lo cierra', rastreador.estado() === 'working', `state=${rastreador.estado()}`)
}

// (5) EL CASO QUE MOTIVA LA V3: interfaz que repinta SIN PARAR durante un minuto, con
//     un caudal que en la v2 cruzaba el umbral de cierre arriba y abajo. Antes eso
//     producía un `working -> done -> working` interminable (el parpadeo con Codex);
//     ahora no hay ni una transición de más, porque el silencio es de CERO bytes.
{
  const { rastreador, ticks, emitirSalida, enviar, cambios } = setup()
  enviar()
  cambios.length = 0
  for (let i = 0; i < 120; i++) {
    emitirSalida(i % 3 === 0 ? 300 : 40) // repintado irregular alrededor del viejo umbral
    ticks(1)
  }
  check(
    '(5) 60 s de repintado sostenido => CERO transiciones espurias (fin del parpadeo)',
    rastreador.estado() === 'working' && cambios.length === 0,
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (6) El BELL cierra con AVISO aunque sea corto: es la señal de "necesito tu
//     aprobación", que NO escribe fin de turno en ningún transcript.
{
  const { rastreador, ticks, emitirSalida, enviar, cambios } = setup()
  enviar()
  emitirSalida(500, true)
  ticks(1)
  check(
    '(6) bell => done aunque el turno sea corto (cubre "espero tu aprobación")',
    rastreador.estado() === 'idle' && cambios.join(',') === 'working,done',
    `changes=[${cambios.join(',')}]`
  )
}

// (7) MARCA ANTERIOR AL ENVÍO: al reanudar una conversación, el transcript ya trae el
//     `task_complete` del turno de la sesión pasada. Leerlo no puede cerrar el turno
//     que acabas de abrir.
{
  const { rastreador, reloj, enviar, cierra, cambios } = setup()
  reloj.advance(120_000)
  const vieja = reloj.ahora() - 60_000 // marca de hace un minuto, ya en el fichero
  enviar()
  cierra(vieja)
  check(
    '(7) una marca anterior a tu envío se ignora (transcript reanudado)',
    rastreador.estado() === 'working' && cambios.join(',') === 'working',
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (7b) …pero una marca dentro de la tolerancia SÍ vale: la fecha el contenedor y el
//      envío el host, y un par de segundos de desfase no pueden invalidarla.
{
  const { rastreador, enviar, reloj, cierra, cambios } = setup()
  enviar()
  const casi = reloj.ahora() - 3000
  cierra(casi)
  check(
    '(7b) una marca 3 s anterior al envío entra por tolerancia de reloj',
    rastreador.estado() === 'idle' && cambios.join(',') === 'working,done',
    `changes=[${cambios.join(',')}]`
  )
}

// (8) SUPRESIÓN (arranque / redibujado por resize): la salida provocada por la app no
//     abre turno, aunque la sesión esté armada.
{
  const { rastreador, ticks, emitirSalida, cambios } = setup()
  rastreador.congelar(2500)
  emitirSalida(9000)
  ticks(3)
  check(
    '(8) el ruido de arranque/resize no abre turno',
    rastreador.estado() === 'idle' && cambios.length === 0,
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (8b) ARRASTRAR EL SEPARADOR no deja el indicador pegado. El `ResizeObserver` del pane
//      reprograma un `suppress` por fotograma, así que la detección pasa el arrastre
//      entero congelada; pero congelado significa "lo que llega no es trabajo", no "no
//      podemos ver": si además NO llega nada, el agente está callado y el turno cierra.
{
  const { rastreador, reloj, enviar, cambios } = setup()
  enviar()
  cambios.length = 0
  for (let i = 0; i < TICKS_SILENCIO + 2; i++) {
    rastreador.congelar(600) // un resize por tick, como al arrastrar
    reloj.advance(TICK)
  }
  // El cierre es SILENCIOSO porque el agente no llegó a producir nada (ver el caso 19):
  // lo que se comprueba aquí es que la congelación no impide cerrarlo.
  check(
    '(8b) arrastrar el separador con el agente callado no impide cerrar el turno',
    rastreador.estado() === 'idle' && cambios.join(',') === 'idle',
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (8c) …y si durante ese arrastre el agente SÍ está emitiendo, el turno sigue abierto:
//      el silencio es de bytes, no de atención.
{
  const { rastreador, reloj, emitirSalida, enviar } = setup()
  enviar()
  for (let i = 0; i < TICKS_SILENCIO + 2; i++) {
    rastreador.congelar(600)
    emitirSalida(500) // el CLI repinta por SIGWINCH… y además sigue trabajando
    reloj.advance(TICK)
  }
  check(
    '(8c) con salida durante el arrastre, el turno NO se cierra',
    rastreador.estado() === 'working',
    `state=${rastreador.estado()}`
  )
}

// (9) finish(): cerrar/hibernar/morir la sesión apaga el indicador en SILENCIO.
{
  const { rastreador, ticks, emitirSalida, enviar, cambios } = setup()
  enviar()
  for (let i = 0; i < 8; i++) {
    emitirSalida(1000)
    ticks(1)
  }
  rastreador.terminar()
  check(
    '(9) finish cierra el turno sin avisar (idle)',
    rastreador.estado() === 'idle' && cambios[cambios.length - 1] === 'idle',
    `changes=[${cambios.join(',')}]`
  )
}

// (10) Tras cerrar un turno, el siguiente Enter abre otro.
{
  const { rastreador, enviar, cierra, cambios } = setup()
  enviar()
  cierra()
  enviar()
  check(
    '(10) un segundo turno reabre normalmente',
    rastreador.estado() === 'working' && cambios.join(',') === 'working,done,working',
    `changes=[${cambios.join(',')}]`
  )
}

// (11) El BELL que llega MIENTRAS tecleas NO se pierde: se atiende antes de la guarda
//      de congelación (si no, el turno solo podía cerrarse por silencio).
{
  const { rastreador, reloj, ticks, teclear, emitirSalida, enviar, cambios } = setup()
  enviar()
  teclear('s')
  reloj.advance(50)
  emitirSalida(400, true)
  reloj.advance(ECHO)
  ticks(1)
  check(
    '(11) bell durante la congelación por tecleo => cierra con aviso',
    rastreador.estado() === 'idle' && cambios.join(',') === 'working,done',
    `changes=[${cambios.join(',')}]`
  )
}

// (11b) Y la MARCA del transcript, igual: llega justo cuando estás escribiendo lo
//       siguiente, así que tampoco puede quedarse fuera por la ventana de eco.
{
  const { rastreador, reloj, teclear, enviar, cierra, cambios } = setup()
  enviar()
  teclear('s')
  reloj.advance(50)
  cierra()
  check(
    '(11b) la marca del transcript durante la congelación tampoco se pierde',
    rastreador.estado() === 'idle' && cambios.join(',') === 'working,done',
    `changes=[${cambios.join(',')}]`
  )
}

// (12) finish() DESARMA: tras cerrar/hibernar/recargar, el volcado del CLI relanzado
//      (que con --resume reproduce la conversación entera) NO puede pasar por trabajo.
{
  const { rastreador, ticks, emitirSalida, enviar, cambios } = setup()
  enviar()
  emitirSalida(1000)
  ticks(2)
  rastreador.terminar()
  cambios.length = 0
  emitirSalida(9000)
  ticks(12)
  check(
    '(12) tras finish la sesión queda DESARMADA (el volcado no abre turno)',
    rastreador.estado() === 'idle' && cambios.length === 0,
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (13) PEGAR un bloque multilínea no es enviarlo: el bracketed paste lleva \r dentro,
//      pero el prompt sigue sin mandarse, así que no debe armar ni abrir.
{
  const { rastreador, ticks, emitirSalida, cambios } = setup()
  rastreador.onEntrada('\x1b[200~línea 1\rlínea 2\rlínea 3\x1b[201~')
  ticks(1)
  emitirSalida(5000)
  ticks(3)
  check(
    '(13) pegado multilínea NO arma la sesión',
    rastreador.estado() === 'idle' && cambios.length === 0,
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (14) CONTRAPRESIÓN: con el pty en pausa no llegan bytes aunque el agente trabaje; la
//      pausa no puede leerse como fin de turno.
{
  const { rastreador, ticks, emitirSalida, enviar } = setup()
  enviar()
  rastreador.fijarPausado(true)
  ticks(10) // 5 s: el xterm drena mientras el agente sigue trabajando
  check('(14) la pausa por contrapresión no cierra el turno', rastreador.estado() === 'working', `state=${rastreador.estado()}`)
  rastreador.fijarPausado(false)
  emitirSalida(1000)
  ticks(1)
  check('(14b) al reanudar sigue el mismo turno', rastreador.estado() === 'working', `state=${rastreador.estado()}`)
}

// (14c) …pero una pausa que NUNCA se levanta tiene tope. Pasa de verdad: xterm solo
//       despausa desde el callback de su `write`, y ese callback no llega si la
//       terminal se resetea con datos pendientes (reanudar, nueva conversación,
//       cambiar de cuenta). Sin tope, el indicador se quedaba encendido para siempre.
{
  const { rastreador, ticks, enviar, cambios } = setup()
  enviar()
  cambios.length = 0
  rastreador.fijarPausado(true)
  ticks(60) // 30 s: muy por encima del tope de pausa (8 s) + el silencio (10 s)
  // Silencioso por lo mismo que (8b): no hubo salida que atribuir.
  check(
    '(14c) una pausa colgada deja de congelar y el turno acaba cerrándose',
    rastreador.estado() === 'idle' && cambios.join(',') === 'idle',
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (15) SILENCIO ABSOLUTO: sin marca ni campana (CLI viejo que no escribe marcadores),
//      diez segundos sin UN SOLO byte cierran el turno con aviso.
{
  const { rastreador, ticks, emitirSalida, enviar, cambios } = setup()
  enviar()
  // Salida de un turno REAL: por encima del umbral que distingue trabajo de un repintado.
  for (let i = 0; i < 3; i++) {
    emitirSalida(1000)
    ticks(1)
  }
  check('(15a) mientras hay salida, el turno sigue abierto', rastreador.estado() === 'working', `state=${rastreador.estado()}`)
  ticks(TICKS_SILENCIO + 1)
  check(
    '(15b) sin marcador, el silencio absoluto cierra con aviso (degradación digna)',
    rastreador.estado() === 'idle' && cambios.join(',') === 'working,done',
    `changes=[${cambios.join(',')}]`
  )
}

// (16) Respuesta MUY corta con campana en una sesión ya cerrada: avisa igual, con un
//      'done' suelto.
{
  const { rastreador, ticks, emitirSalida, enviar, cierra, cambios } = setup()
  enviar()
  cierra()
  cambios.length = 0
  emitirSalida(300, true)
  ticks(2)
  check(
    '(16) campana sin turno abierto => done suelto',
    cambios.join(',') === 'done' && rastreador.estado() === 'idle',
    `changes=[${cambios.join(',')}] state=${rastreador.estado()}`
  )
}

// (16c) FOLLOW-UP RÁPIDO: contestas dos segundos después de que el agente terminara.
//       La marca del turno anterior sigue siendo la última del fichero y cae DENTRO del
//       margen de reloj, así que la guarda por fecha de envío no basta: hace falta que
//       la marca sea posterior al último cierre. Si no, el turno nuevo se cerraba solo.
{
  const { rastreador, reloj, enviar, cierra, cambios } = setup()
  reloj.advance(100_000)
  enviar()
  const finDelPrimero = reloj.ahora() + 30_000
  reloj.advance(30_000)
  cierra(finDelPrimero) // el agente termina
  reloj.advance(2_000) // …y contestas enseguida
  enviar()
  cambios.length = 0
  cierra(finDelPrimero) // el vigilante relee y encuentra la MISMA marca
  check(
    '(16c) tras un follow-up rápido, la marca del turno anterior no cierra el nuevo',
    rastreador.estado() === 'working' && cambios.length === 0,
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (16b) LA MISMA marca de cierre, entregada muchas veces. Pasa siempre: el vigilante
//       relee la cola del transcript en CADA escritura, y el CLI sigue tocando el
//       fichero después de terminar. Sin la guarda, cada relectura emitía otro 'done'
//       y el panel volvía a parpadear.
{
  const { rastreador, enviar, cierra, cambios } = setup()
  enviar()
  cierra()
  cambios.length = 0
  for (let i = 0; i < 5; i++) cierra()
  check(
    '(16b) releer la misma marca de cierre no vuelve a avisar',
    cambios.length === 0 && rastreador.estado() === 'idle',
    `changes=[${cambios.join(',')}]`
  )
}

// (17) …pero una campana en una sesión DESARMADA (nunca le escribiste, o murió y se
//      relanzó) no avisa de nada.
{
  const { ticks, emitirSalida, cambios } = setup()
  emitirSalida(300, true)
  ticks(2)
  check('(17) campana sin prompt previo => silencio', cambios.length === 0, `changes=[${cambios.join(',')}]`)
}

// (18) TOPE ABSOLUTO de duración: pase lo que pase el indicador se apaga, y lo hace en
//      SILENCIO (a esas alturas no sabemos si terminó, así que no se fabrica un aviso).
{
  const { rastreador, ticks, emitirSalida, enviar, cambios } = setup()
  enviar()
  cambios.length = 0
  // Salida constante durante media hora larga: ni silencio, ni marca, ni campana.
  for (let i = 0; i < MAX_TICKS_TURNO + 5; i++) {
    emitirSalida(100)
    ticks(1)
  }
  check(
    '(18) el tope de duración apaga el indicador SIN fabricar un aviso',
    rastreador.estado() === 'idle' && cambios.join(',') === 'idle',
    `state=${rastreador.estado()} changes=[${cambios.join(',')}]`
  )
}

// (19) NO TODO ENTER ES UN PROMPT. Dentro del TUI se pulsa Enter para elegir en un menú
//      (`/model`), para aprobar una herramienta o sobre una línea vacía. Todos abren
//      turno —eso es lo que da el indicador instantáneo— pero ninguno es trabajo, y el
//      repintado que provocan cae dentro de la ventana de eco, así que no se atribuye.
//      Sin la guarda de `bytesTurno`, cada uno fabricaba un verde "listo por revisar"
//      diez segundos después: un aviso de algo que nunca pasó, en la señal que todo
//      este rediseño existe para volver fiable.
{
  const { rastreador, reloj, ticks, teclear, emitirSalida, cambios } = setup()
  teclear('\r') // Enter de menú: SIN dejar pasar la ventana de eco
  emitirSalida(4000) // la TUI repinta la pantalla entera al cerrar el menú…
  reloj.advance(ECHO)
  ticks(TICKS_SILENCIO + 2) // …y después, nada
  check(
    '(19) un Enter que no es un prompt NO fabrica un aviso (cierre silencioso)',
    rastreador.estado() === 'idle' && cambios.join(',') === 'working,idle',
    `changes=[${cambios.join(',')}]`
  )
}

// (19b) …y el mismo Enter, si detrás viene trabajo de verdad, sí avisa.
{
  const { rastreador, ticks, emitirSalida, enviar, cambios } = setup()
  enviar()
  for (let i = 0; i < 5; i++) {
    emitirSalida(1000)
    ticks(1)
  }
  ticks(TICKS_SILENCIO + 1)
  check(
    '(19b) el mismo camino, con trabajo real detrás, sí avisa',
    rastreador.estado() === 'idle' && cambios.join(',') === 'working,done',
    `changes=[${cambios.join(',')}]`
  )
}

// (20) ¿ESPERA TU RESPUESTA? Un diálogo de permiso: el agente pide una herramienta (el
//      transcript escribe una APERTURA) y se para a preguntarte. La campana cierra el
//      turno del rastreador —no trabaja, y el indicador tiene razón—, pero el `^C` de un
//      reinicio cancelaría el diálogo: `esperandoRespuesta` tiene que decirlo.
/** Turno con salida, apertura en disco y la campana del diálogo. Reloj lejos del 0. */
function dialogoConCampana(s: ReturnType<typeof setup>): void {
  s.reloj.advance(100_000)
  s.enviar()
  s.emitirSalida(3000)
  s.ticks(1)
  s.abre() // `tool_use`: pide permiso
  s.emitirSalida(200, true) // …y toca la campana
  s.ticks(1)
}
const espera = (t: RastreadorActividad): string => `state=${t.estado()} esperandoRespuesta=${t.esperandoRespuesta()}`
{
  const s = setup()
  dialogoConCampana(s)
  check(
    '(20a) apertura en disco + campana => idle, pero ESPERA TU RESPUESTA (y se avisa)',
    s.rastreador.estado() === 'idle' && s.rastreador.esperandoRespuesta() && s.esperas.join() === 'true',
    `${espera(s.rastreador)} avisos=[${s.esperas.join()}]`
  )
  s.teclear('\x1b[O') // el foco se va al pulsar el botón de actualizar…
  s.teclear('\x1b[I') // …y vuelve
  s.teclear('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\') // una respuesta de color de xterm
  s.teclear('\x1b[<64;10;5M') // la rueda, para leer el diálogo
  check(
    '(20b) el foco, las respuestas de xterm y la rueda NO contestan: sigue esperando',
    s.rastreador.esperandoRespuesta() && s.esperas.join() === 'true',
    `${espera(s.rastreador)} avisos=[${s.esperas.join()}]`
  )
  s.teclear('y') // Codex: aprobar con una tecla, sin Enter
  check(
    '(20c) una tecla tuya la apaga (y se avisa del cambio)',
    !s.rastreador.esperandoRespuesta() && s.esperas.join() === 'true,false',
    `${espera(s.rastreador)} avisos=[${s.esperas.join()}]`
  )
}
{
  const s = setup()
  dialogoConCampana(s)
  s.reloj.advance(4_000)
  s.cierra() // el CLI escribe el fin (contestaste en otro sitio, o era el final del turno)
  check('(20d) un \'cierra\' tardío la apaga', !s.rastreador.esperandoRespuesta() && s.esperas.join() === 'true,false', `${espera(s.rastreador)} avisos=[${s.esperas.join()}]`)
}
{
  const s = setup()
  dialogoConCampana(s)
  s.enviar() // Enter: contestas y el agente sigue
  const trasIntro = s.rastreador.esperandoRespuesta()
  s.emitirSalida(3000)
  s.ticks(1)
  s.cierra()
  check(
    '(20e) un turno nuevo la apaga, y un turno que cierra el CLI no la vuelve a encender',
    !trasIntro && !s.rastreador.esperandoRespuesta() && s.rastreador.estado() === 'idle',
    `trasIntro=${trasIntro} ${espera(s.rastreador)}`
  )
}
{
  const s = setup()
  dialogoConCampana(s)
  s.rastreador.terminar() // se relanza la sesión
  check('(20f) finish la apaga (el diálogo muere con el proceso)', !s.rastreador.esperandoRespuesta() && s.esperas.join() === 'true,false', `${espera(s.rastreador)} avisos=[${s.esperas.join()}]`)
}
{
  // Codex quizá no toca campana: basta el silencio del diálogo, que no repinta.
  const { rastreador, reloj, ticks, emitirSalida, enviar, abre } = setup()
  reloj.advance(100_000)
  enviar()
  emitirSalida(3000)
  ticks(1)
  abre()
  ticks(TICKS_SILENCIO + 1)
  check('(20g) apertura en disco + diez segundos de silencio => espera tu respuesta', rastreador.estado() === 'idle' && rastreador.esperandoRespuesta(), espera(rastreador))
}
{
  // La apertura se lee DESPUÉS de la campana (el vigilante llega tarde): cuenta igual.
  const { rastreador, reloj, ticks, emitirSalida, enviar, abre } = setup()
  reloj.advance(100_000)
  enviar()
  emitirSalida(3000)
  ticks(1)
  emitirSalida(200, true)
  ticks(1)
  const antes = rastreador.esperandoRespuesta()
  abre(reloj.ahora() - 1_000)
  check('(20h) una apertura leída después de la campana la enciende', !antes && rastreador.esperandoRespuesta(), `antes=${antes} ${espera(rastreador)}`)
}

// (21) …y NO bloquea de más.
{
  const { rastreador, reloj, ticks, emitirSalida, enviar, esperas } = setup()
  reloj.advance(100_000)
  enviar()
  emitirSalida(3000)
  ticks(1)
  emitirSalida(200, true)
  ticks(1)
  check('(21a) sin marcas en disco (CLI que no las escribe, sin vigilante) => nunca', !rastreador.esperandoRespuesta() && esperas.length === 0, espera(rastreador))
}
{
  // Conversación REANUDADA: su transcript acaba en una apertura huérfana de ayer.
  const { rastreador, reloj, ticks, emitirSalida, enviar, abre } = setup()
  reloj.advance(100_000)
  enviar()
  abre(reloj.ahora() - TOLERANCIA - 60_000)
  emitirSalida(3000)
  ticks(1)
  emitirSalida(200, true)
  ticks(1)
  check('(21b) una apertura anterior a tu envío (fuera del margen) no es un diálogo de este turno', !rastreador.esperandoRespuesta(), espera(rastreador))
}
{
  // El CLI cerró el turno con una marca SIN FECHA: es un fin, no un diálogo.
  const { rastreador, reloj, ticks, emitirSalida, enviar, abre } = setup()
  reloj.advance(100_000)
  enviar()
  emitirSalida(3000)
  ticks(1)
  abre()
  rastreador.onMarcaTurno({ tipo: 'cierra', en: 0 })
  check('(21c) un turno cerrado por marca (aunque venga sin fechar) no espera nada', rastreador.estado() === 'idle' && !rastreador.esperandoRespuesta(), espera(rastreador))
}
{
  // Turno normal cerrado por el CLI, y DESPUÉS llega la apertura de otra sesión del
  // mismo proyecto (el vigilante reparte por nombre de proyecto).
  const { rastreador, reloj, ticks, emitirSalida, enviar, abre, cierra } = setup()
  reloj.advance(100_000)
  enviar()
  emitirSalida(3000)
  ticks(1)
  cierra()
  reloj.advance(2_000)
  abre()
  check('(21d) tras un fin dicho por el CLI, una apertura ajena no la enciende', !rastreador.esperandoRespuesta(), espera(rastreador))
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

// (22) El agente INFORMA su estado (OSC 7501): desde su primer aviso, manda él y la deducción calla.
{
  const { rastreador, ticks, emitirSalida, enviar, cierra, cambios, motivos, sondas, informa, reloj } = setup()
  emitirSalida(10, false)
  rastreador.onDatos('\x1b]7501;?\x07\x1b[c')
  check('(22a) la sonda se contesta en el acto, una vez', sondas.length === 1 && sondas[0] === reloj.ahora(), `sondas=${sondas.join()}`)
  informa('state=idle:app=claude-code')
  check('(22b) el idle del arranque no avisa de nada', cambios.length === 0 && rastreador.estado() === 'idle', `changes=[${cambios.join(',')}]`)
  enviar()
  check('(22c) informado, el Enter no abre: lo dirá el agente', cambios.length === 0 && rastreador.estado() === 'idle', `changes=[${cambios.join(',')}]`)
  informa('state=working:app=claude-code')
  informa('state=working:app=claude-code:msg=' + Buffer.from('Paso 1').toString('base64'))
  check('(22d) working abre; repetido (con otro paso) no vuelve a avisar', cambios.join(',') === 'working' && rastreador.estado() === 'working', `changes=[${cambios.join(',')}]`)
  ticks(TICKS_SILENCIO * 3)
  emitirSalida(100, true)
  ticks(2)
  cierra()
  check('(22e) ni el silencio, ni una campana, ni la marca del transcript lo cierran', cambios.join(',') === 'working' && rastreador.estado() === 'working', `changes=[${cambios.join(',')}]`)
  informa('state=blocked:app=claude-code:kind=question')
  check(
    '(22f) blocked: cierra el turno, avisa con su motivo y espera tu respuesta',
    cambios.join(',') === 'working,blocked' && motivos[1] === 'question' && rastreador.estado() === 'blocked' && rastreador.motivoEspera() === 'question' && rastreador.esperandoRespuesta(),
    `changes=[${cambios.join(',')}] motivos=${motivos.join()} state=${rastreador.estado()}`
  )
  informa('state=blocked:app=claude-code:kind=question')
  informa('state=blocked:id=sub:kind=permission')
  check('(22g) el mismo blocked repetido y el aviso de un hijo no cambian nada', cambios.length === 2, `changes=[${cambios.join(',')}]`)
  informa('state=working:app=claude-code')
  informa('state=done:app=claude-code')
  check('(22h) contestada, vuelve a trabajar y done avisa de un fin real', cambios.join(',') === 'working,blocked,working,done' && !rastreador.esperandoRespuesta(), `changes=[${cambios.join(',')}]`)
  informa('state=done:app=claude-code')
  informa('state=idle:app=claude-code')
  check('(22i) un done repetido y el idle siguiente no avisan', cambios.length === 4, `changes=[${cambios.join(',')}]`)
  informa('state=working')
  informa('state=blocked:kind=permission')
  informa('state=idle')
  check('(22j) una espera cancelada (Esc) se apaga sin avisar «terminó»', cambios.slice(4).join(',') === 'working,blocked,idle', `changes=[${cambios.join(',')}]`)
  informa('state=working')
  informa('state=clear')
  check('(22k) clear (al salir) cierra en silencio', cambios.slice(7).join(',') === 'working,idle' && rastreador.estado() === 'idle', `changes=[${cambios.join(',')}]`)
}
{
  const { rastreador, enviar, cambios, informa, sondas } = setup()
  informa('?')
  informa('state=working')
  informa('state=blocked:kind=permission')
  rastreador.terminar()
  check('(22l) relanzar con una espera abierta la apaga', cambios.join(',') === 'working,blocked,idle' && !rastreador.esperandoRespuesta(), `changes=[${cambios.join(',')}]`)
  // El proceso viejo aún escribe su despedida tras `finish`: no es del nuevo.
  informa('state=clear')
  enviar()
  check('(22m) y el proceso nuevo, hasta que informe, se deduce: el Enter abre (la despedida del viejo no cuenta)', rastreador.estado() === 'working', `state=${rastreador.estado()}`)
  informa('?')
  check('(22m2) el proceso nuevo vuelve a preguntar y se le contesta', sondas.length === 2, `sondas=${sondas.length}`)
}
{
  // Un aviso o una sonda que salen en lo que el agente enseña (un archivo, un log) no son suyos.
  const { rastreador, enviar, cambios, informa, sondas } = setup()
  informa('state=idle')
  enviar()
  check('(22p) un aviso sin sonda contestada se ignora: sigue la deducción', rastreador.estado() === 'working' && cambios.join(',') === 'working', `changes=[${cambios.join(',')}]`)
  informa('?')
  informa('?')
  check('(22q) la sonda se contesta una sola vez por proceso', sondas.length === 1, `sondas=${sondas.length}`)
}
{
  // Codex informa sin preguntar: sus avisos cuentan, pero solo los que dicen ser él.
  const { rastreador, enviar, cambios, motivos, informa, sondas } = setup('codex')
  informa('state=idle')
  informa('state=working:app=claude-code')
  enviar()
  check('(22u) sin sonda, un aviso sin app o de otro programa sigue ignorándose', rastreador.estado() === 'working' && cambios.join(',') === 'working', `changes=[${cambios.join(',')}]`)
  informa('state=blocked:app=codex:kind=permission')
  check(
    '(22v) el de Codex cuenta sin sonda: blocked espera tu respuesta con su motivo',
    cambios.join(',') === 'working,blocked' && motivos[1] === 'permission' && rastreador.esperandoRespuesta() && sondas.length === 0,
    `changes=[${cambios.join(',')}] motivos=${motivos.join()} sondas=${sondas.length}`
  )
  informa('state=working:app=codex')
  informa('state=done:app=codex')
  check('(22w) y manda él: vuelve a trabajar y done avisa del fin', cambios.join(',') === 'working,blocked,working,done' && rastreador.estado() === 'idle', `changes=[${cambios.join(',')}]`)
}
{
  // Informado, el tope cuenta desde el último 'working': colgado sin avisar, el punto se apaga.
  const { rastreador, ticks, cambios, informa, emitirSalida } = setup()
  informa('?')
  informa('state=working')
  for (let i = 0; i < 4; i++) {
    ticks(MAX_TICKS_TURNO / 2)
    emitirSalida(10)
    informa('state=working')
  }
  check('(22r) un trabajo largo que sigue avisando no se corta por el tope', rastreador.estado() === 'working' && cambios.join(',') === 'working', `changes=[${cambios.join(',')}]`)
  ticks(MAX_TICKS_TURNO + 1)
  check('(22s) sin un aviso en todo el tope, cierra en silencio', rastreador.estado() === 'idle' && cambios.join(',') === 'working,idle', `changes=[${cambios.join(',')}]`)
  informa('state=working')
  check('(22t) y si vuelve a avisar, vuelve a trabajar', rastreador.estado() === 'working', `state=${rastreador.estado()}`)
}
{
  // Sin avisos (un agente que no informa), el BEL que cierra un título no es la campana.
  const { rastreador, ticks, enviar, cambios } = setup()
  enviar()
  rastreador.onDatos('\x1b]0;✳ Claude Code\x07' + 'x'.repeat(50))
  ticks(2)
  check('(22n) el BEL de un OSC no cierra el turno deducido', rastreador.estado() === 'working' && cambios.join(',') === 'working', `changes=[${cambios.join(',')}]`)
  rastreador.onDatos('\x07')
  ticks(1)
  check('(22o) una campana suelta sí', cambios.join(',') === 'working,done', `changes=[${cambios.join(',')}]`)
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(60))
console.log(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
