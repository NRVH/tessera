#!/usr/bin/env node
// =============================================================================
// Prueba de ColaConcurrencia (npm run test:cola-concurrencia): la cola que impide
// que el explorador lance cientos de `listDir` a la vez y sature el canal IPC.
// Cubre: nunca más de `tope` en vuelo; no se pierde trabajo; una tarea que falla
// libera su plaza; `cancelarPendientes` tira las en cola y deja terminar las en
// vuelo (con CanceladaError / esCancelada); un tope de 0 o negativo es un error.
// =============================================================================

import { ColaConcurrencia, CanceladaError, esCancelada } from './colaConcurrencia.ts'

let pasadas = 0
let total = 0
function hr(t: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(t)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasadas++
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}`)
  console.log(`        ${evidence}`)
}
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
hr('(1)+(2) el tope se respeta y no se pierde trabajo')
{
  const TOPE = 4
  const TAREAS = 50
  const cola = new ColaConcurrencia(TOPE)
  let vivas = 0
  let pico = 0
  let hechas = 0
  const ps: Array<Promise<number>> = []
  for (let i = 0; i < TAREAS; i++) {
    ps.push(
      cola.correr(async () => {
        vivas++
        if (vivas > pico) pico = vivas
        await esperar(5)
        vivas--
        hechas++
        return i
      })
    )
  }
  const res = await Promise.all(ps)
  check(
    `nunca más de ${TOPE} en vuelo con ${TAREAS} tareas`,
    pico <= TOPE,
    `pico observado = ${pico}`
  )
  check('el tope se llegó a usar entero (no se quedó corto)', pico === TOPE, `pico = ${pico}`)
  check(
    'las 50 tareas se ejecutaron y devolvieron su valor en orden',
    hechas === TAREAS && res.length === TAREAS && res[0] === 0 && res[49] === 49,
    `hechas=${hechas}, res[0]=${res[0]}, res[49]=${res[49]}`
  )
  check('la cola queda vacía al terminar', cola.enCola === 0 && cola.enVuelo === 0, `enCola=${cola.enCola}, enVuelo=${cola.enVuelo}`)
}

// ---------------------------------------------------------------------------
hr('(3) una tarea que FALLA libera su plaza')
{
  const cola = new ColaConcurrencia(2)
  const fallos: unknown[] = []
  const ps = [
    cola.correr(async () => { throw new Error('boom') }).catch((e: unknown) => { fallos.push(e); return -1 }),
    cola.correr(async () => { throw new Error('boom') }).catch((e: unknown) => { fallos.push(e); return -1 }),
    cola.correr(async () => 7),
    cola.correr(async () => 8)
  ]
  const res = await Promise.all(ps)
  check(
    'tras dos fallos, las siguientes SÍ corren (la plaza se liberó)',
    res[2] === 7 && res[3] === 8,
    `res = [${res.join(', ')}]`
  )
  check('los fallos se propagan a quien llamó', fallos.length === 2, `${fallos.length} fallos`)
}

// ---------------------------------------------------------------------------
hr('(4)+(5) cancelarPendientes tira lo EN COLA y deja lo EN VUELO')
{
  const cola = new ColaConcurrencia(2)
  let ejecutadas = 0
  const ps: Array<Promise<string>> = []
  for (let i = 0; i < 10; i++) {
    ps.push(
      cola.correr(async () => {
        ejecutadas++
        await esperar(30)
        return 'ok'
      }).catch((e: unknown) => (esCancelada(e) ? 'cancelada' : 'otro-error'))
    )
  }
  // Deja que arranquen solo las 2 que caben.
  await esperar(5)
  const enVueloAntes = cola.enVuelo
  const tiradas = cola.cancelarPendientes()
  const res = await Promise.all(ps)
  const oks = res.filter((r) => r === 'ok').length
  const canceladas = res.filter((r) => r === 'cancelada').length

  check(
    'solo arrancaron las que cabían en el tope',
    enVueloAntes === 2 && ejecutadas === 2,
    `enVuelo=${enVueloAntes}, ejecutadas=${ejecutadas}`
  )
  check('cancelarPendientes devuelve cuántas tiró', tiradas === 8, `tiradas=${tiradas}`)
  check(
    'las EN VUELO terminan bien y las EN COLA salen canceladas',
    oks === 2 && canceladas === 8,
    `ok=${oks}, canceladas=${canceladas}`
  )
  check(
    'las canceladas NUNCA llegaron a ejecutarse',
    ejecutadas === 2,
    `ejecutadas en total = ${ejecutadas} (no 10)`
  )
  check(
    'el error de cancelación es reconocible',
    esCancelada(new CanceladaError()) && !esCancelada(new Error('x')),
    'esCancelada() distingue'
  )
}

// ---------------------------------------------------------------------------
hr('(6) el tope se valida')
{
  let lanzo = false
  try {
    new ColaConcurrencia(0)
  } catch {
    lanzo = true
  }
  check('tope 0 es un error, no un no-op silencioso', lanzo, 'lanzó')
}

// ---------------------------------------------------------------------------
hr('(7) una tarea que revienta EN SÍNCRONO no envenena la cola')
{
  // El caso real: `fn` no es async y revienta ANTES de devolver promesa (un
  // `window.tessera.*` cuyo puente ya no existe, un execFile con argv inválido).
  // Sin try/catch, la plaza quedaba ocupada para siempre y la excepción salía por
  // el ejecutor de la promesa de OTRA tarea.
  const cola = new ColaConcurrencia(2)
  const revienta = (): Promise<number> => {
    throw new Error('boom')
  }

  const fallos: string[] = []
  const rotas = [cola.correr(revienta), cola.correr(revienta), cola.correr(revienta)]
  for (const p of rotas) p.catch((e: unknown) => fallos.push(e instanceof Error ? e.message : 'x'))
  await Promise.allSettled(rotas)

  check(
    'el fallo síncrono lo recibe SU propia promesa',
    fallos.length === 3 && fallos.every((m) => m === 'boom'),
    `fallos=${JSON.stringify(fallos)}`
  )
  check(
    'no quedan plazas ocupadas por las que reventaron',
    cola.enVuelo === 0 && cola.enCola === 0,
    `enVuelo=${cola.enVuelo}, enCola=${cola.enCola}`
  )

  // Y lo que de verdad importa: la cola SIGUE SIRVIENDO después. Con la fuga, tras
  // `tope` fallos aceptaba trabajo y no ejecutaba nada nunca más.
  const despues = await cola.correr(async () => 42)
  check('la cola sigue viva tras los fallos síncronos', despues === 42, `devolvió ${despues}`)
}

hr('RESULTADO (PASS/FAIL)')
const allPass = pasadas === total
console.log(`VEREDICTO: ${pasadas}/${total} PASS${allPass ? ' — TODO PASS' : ' — HAY FALLOS'}`)
process.exit(allPass ? 0 : 1)
