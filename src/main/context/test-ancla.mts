#!/usr/bin/env node
// =============================================================================
// Prueba del ancla de conversación y del detector de línea enviada (npm run test:ancla). Puro: sin
// disco ni red.
// Fija qué chat mide el anillo: sin ancla gana el último evento; un chat nuevo anclado gana al
// viejo reanudado; cambiar de chat dentro del TUI re-ancla; un ancla a un chat inexistente vuelve a
// la heurística.
// Cubre también los estados 'esperando' y 'dudosa', la tolerancia de reloj, el registro (`touch`,
// `pin`, `onCambio`) y el reconocimiento de /clear y /resume.
// =============================================================================

import {
  claveAncla,
  crearRegistroAnclas,
  elegirVivo,
  TOLERANCIA_EVENTO_MS,
  type Ancla,
  type CandidatoMedido
} from './anclaConversacion.ts'
import { crearDetectorEnvio, esCambioDeConversacion } from '../agents/lineaEnviada.ts'

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}
function hr(title: string): void {
  console.log(`\n=== ${title} ===`)
}

/** Candidato de prueba: id, último evento (epoch ms) y mtime. */
function cand(sessionId: string, lastEventAt: number, mtimeMs = lastEventAt): CandidatoMedido {
  return { sessionId, lastEventAt, mtimeMs }
}

const T = 1_800_000_000_000 // epoch base cualquiera, legible en los mensajes

function anclada(sessionId: string, marcaEnvio = 0): Ancla {
  return { estado: { tipo: 'anclada', sessionId, desde: T, fuente: 'resume' }, marcaEnvio, refs: 1 }
}

function main(): void {
  hr('Elección del chat vivo')

  // (a) Sin ancla: el de siempre.
  const sinAncla = elegirVivo([cand('A', T + 5_000), cand('C', T + 1_000)], null)
  check(
    '(a) sin ancla gana el del último evento (comportamiento de siempre)',
    sinAncla.indice === 0 && sinAncla.anclaje === 'heuristica',
    `indice=${sinAncla.indice} anclaje=${sinAncla.anclaje}`
  )

  // (b) EL BUG: el chat nuevo (C) está anclado y vacío; el viejo (A) fue reanudado y
  // tiene el evento más reciente. Debe ganar C.
  const cands = [cand('A', T + 60_000), cand('C', T + 1_000)]
  const bug = elegirVivo(cands, anclada('C'))
  check(
    '(b) EL BUG: con el chat nuevo anclado, el reanudado NO se lo lleva',
    bug.indice === 1 && bug.anclaje === 'sesion',
    `elegido=${cands[bug.indice]?.sessionId} (A tenía el evento más reciente)`
  )

  // (c) /resume dentro del TUI: enviaste algo y el que se movió después fue B.
  const cambio = [cand('C', T + 1_000), cand('B', T + 61_000)]
  const reanclado = elegirVivo(cambio, anclada('C', T + 60_000))
  check(
    '(c) te cambias de chat en el TUI: se re-ancla al que recibió tu envío',
    reanclado.indice === 1 && reanclado.aprender === 'B',
    `elegido=${cambio[reanclado.indice]?.sessionId} aprender=${reanclado.aprender}`
  )

  // (d) El anclado SÍ recibió el envío: no se va a ningún lado aunque otro sea mayor.
  const fiel = [cand('C', T + 61_000), cand('B', T + 62_000)]
  const quieto = elegirVivo(fiel, anclada('C', T + 60_000))
  check(
    '(d) si el anclado recibió tu envío, no se salta a otro más reciente',
    quieto.indice === 0 && quieto.aprender === undefined,
    `elegido=${fiel[quieto.indice]?.sessionId} aprender=${quieto.aprender}`
  )

  // (e) Ancla a un id que no está entre los candidatos.
  const huerfana = elegirVivo([cand('A', T + 5_000), cand('B', T + 9_000)], anclada('Z'))
  check(
    '(e) ancla a un chat inexistente -> vuelve la heurística',
    huerfana.indice === 1 && huerfana.anclaje === 'heuristica',
    `indice=${huerfana.indice} anclaje=${huerfana.anclaje}`
  )

  // (f) 'esperando' sin ningún evento posterior al arranque.
  const esperando: Ancla = {
    estado: { tipo: 'esperando', desde: T + 100_000 },
    marcaEnvio: 0,
    refs: 1
  }
  const nada = elegirVivo([cand('A', T + 5_000)], esperando)
  check(
    "(f) sesión nueva sin eventos -> nada que medir (no se retrocede al anterior)",
    nada.indice === -1 && nada.anclaje === 'esperando',
    `indice=${nada.indice} anclaje=${nada.anclaje}`
  )

  // (f2) …y en cuanto uno recibe un evento posterior, se aprende.
  const aparece = elegirVivo([cand('A', T + 5_000), cand('N', T + 100_500)], esperando)
  check(
    '(f2) el primero que escribe tras arrancar la sesión se convierte en el ancla',
    aparece.indice === 1 && aparece.aprender === 'N',
    `aprender=${aparece.aprender}`
  )

  // (g) 'dudosa': acabas de teclear /resume y todavía no hay evidencia.
  const dudosa: Ancla = {
    estado: { tipo: 'dudosa', desde: T + 100_000 },
    marcaEnvio: T + 100_000,
    refs: 1
  }
  const enDuda = elegirVivo([cand('A', T + 5_000), cand('B', T + 9_000)], dudosa)
  check(
    '(g) tras un /resume sin evidencia manda la heurística, no un guion',
    enDuda.indice === 1 && enDuda.anclaje === 'heuristica',
    `indice=${enDuda.indice} anclaje=${enDuda.anclaje}`
  )

  hr('Tolerancia de reloj (contenedor vs host)')

  // (h) Evento 3 s ANTES del envío: entra por tolerancia. 30 s antes: no.
  const cerca = elegirVivo(
    [cand('C', T + 1_000), cand('B', T + 57_000)],
    anclada('C', T + 60_000),
    TOLERANCIA_EVENTO_MS
  )
  const lejos = elegirVivo(
    [cand('C', T + 1_000), cand('B', T + 30_000)],
    anclada('C', T + 60_000),
    TOLERANCIA_EVENTO_MS
  )
  check(
    '(h) un evento 3 s anterior al envío cuenta como evidencia; uno de 30 s antes no',
    cerca.indice === 1 && lejos.indice === 0,
    `cerca=${cerca.indice} lejos=${lejos.indice} (tolerancia=${TOLERANCIA_EVENTO_MS}ms)`
  )

  hr('Registro de anclas')

  let reloj = T
  const reg = crearRegistroAnclas(() => reloj)
  const clave = claveAncla('claude-code', 'C:\\base', 'tessera')
  let avisos = 0
  reg.onCambio(() => avisos++)

  reg.pin(clave, 'A')
  reloj += 10_000
  reg.touch(clave)
  const trasTouch = reg.get(clave)
  check(
    '(i) `touch` fija la marca de envío sin tocar el ancla ni avisar',
    trasTouch?.estado.tipo === 'anclada' &&
      trasTouch.estado.sessionId === 'A' &&
      trasTouch.marcaEnvio === T + 10_000 &&
      avisos === 1,
    `estado=${trasTouch?.estado.tipo} marcaEnvio=+${(trasTouch?.marcaEnvio ?? 0) - T} avisos=${avisos}`
  )

  reg.pin(clave, 'A') // mismo id: no debe avisar otra vez
  check(
    '(i2) re-anclar al MISMO chat no avisa (no tiraría caché para nada)',
    avisos === 1,
    `avisos=${avisos}`
  )

  reg.pin(clave, 'B')
  check(
    '(i3) `pin` NO hereda la marca de envío: era de la sesión anterior',
    reg.get(clave)?.marcaEnvio === 0 && avisos === 2,
    `marcaEnvio=${reg.get(clave)?.marcaEnvio} avisos=${avisos}`
  )

  reg.release(clave)
  check(
    '(i4) al cerrar la sesión el ancla desaparece y vuelve la heurística',
    reg.get(clave) === null && avisos === 3,
    `get=${reg.get(clave)} avisos=${avisos}`
  )

  reg.dudar(clave) // sin sesión no hay nada que dudar
  check(
    '(i5) `dudar` sin sesión abierta es un no-op',
    reg.get(clave) === null && avisos === 3,
    `get=${reg.get(clave)} avisos=${avisos}`
  )

  // (i6) DOS SESIONES EN LA MISMA CLAVE. Pasa de verdad: la clave no puede llevar el
  // perfil —el lector solo conoce (agente, carpeta, proyecto)— y en modo Windows todos
  // los perfiles comparten `~/.claude`. Dos perfiles con un proyecto que se llame igual
  // caen en la misma clave, y sin contar referencias el cierre de uno soltaba el ancla
  // que el otro seguía usando: su anillo se volvía heurístico en silencio.
  const compartida = claveAncla('claude-code', 'C:\\home\\.claude', 'api')
  reg.retain(compartida)
  reg.pin(compartida, 'chat-A')
  reg.retain(compartida) // segunda sesión, mismo proyecto, otro perfil
  reg.release(compartida) // cierra la primera
  const trasUna = reg.get(compartida)
  check(
    '(i6) con dos sesiones en la misma clave, cerrar una NO suelta el ancla de la otra',
    trasUna !== null && trasUna.estado.tipo === 'anclada' && trasUna.refs === 1,
    `ancla=${trasUna?.estado.tipo} refs=${trasUna?.refs}`
  )
  reg.release(compartida) // cierra la segunda
  check(
    '(i7) …y con la última sí desaparece',
    reg.get(compartida) === null,
    `get=${reg.get(compartida)}`
  )

  hr('Detección de la línea enviada')

  // (j) /clear escrito de una vez.
  const d1 = crearDetectorEnvio()
  const l1 = d1.alEscribir('/clear\r')
  check(
    '(j) `/clear` + Enter se reconoce como cambio de conversación',
    l1 === '/clear' && esCambioDeConversacion(l1),
    `linea=${JSON.stringify(l1)}`
  )

  // (j2) Escrito tecla a tecla, con una corrección y una flecha por medio.
  const d2 = crearDetectorEnvio()
  for (const ch of '/resumee') d2.alEscribir(ch)
  d2.alEscribir('\x7f') // borra la 'e' de más
  d2.alEscribir('\x1b[D') // flecha izquierda: no es texto
  const l2 = d2.alEscribir('\r')
  check(
    '(j2) sobrevive al retroceso y a las flechas del selector',
    l2 === '/resume' && esCambioDeConversacion(l2),
    `linea=${JSON.stringify(l2)}`
  )

  // (j3) Un PEGADO multilínea no es un envío.
  const d3 = crearDetectorEnvio()
  const l3 = d3.alEscribir('\x1b[200~/clear\nsegunda linea\n\x1b[201~')
  check(
    '(j3) un pegado multilínea no cuenta como envío (ni aunque diga /clear)',
    l3 === null,
    `linea=${JSON.stringify(l3)}`
  )

  // (j4) Un prompt normal no es un cambio de conversación; `/compact` tampoco.
  const d4 = crearDetectorEnvio()
  const l4 = d4.alEscribir('arregla el bug del anillo\r')
  const l5 = crearDetectorEnvio().alEscribir('/compact\r')
  check(
    '(j4) un prompt normal y `/compact` NO cambian de conversación',
    l4 !== null && !esCambioDeConversacion(l4) && l5 === '/compact' && !esCambioDeConversacion(l5),
    `prompt=${JSON.stringify(l4)} compact=${JSON.stringify(l5)}`
  )

  // (j5) Ctrl+U borra lo escrito: lo enviado después ya no es el comando.
  const d5 = crearDetectorEnvio()
  d5.alEscribir('/clear')
  d5.alEscribir('\x15')
  const l6 = d5.alEscribir('hola\r')
  check(
    '(j5) Ctrl+U vacía la línea: lo que se envía es lo que quedó',
    l6 === 'hola' && !esCambioDeConversacion(l6),
    `linea=${JSON.stringify(l6)}`
  )

  console.log('')
  const failed = results.filter((r) => !r.pass)
  if (failed.length) {
    console.log(`RESULTADO: ${failed.length} de ${results.length} comprobaciones FALLARON`)
    process.exit(1)
  }
  console.log(`RESULTADO: ${results.length} comprobaciones OK`)
}

main()
