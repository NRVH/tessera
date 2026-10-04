#!/usr/bin/env node
// =============================================================================
// Prueba del latido de los «hace N min» (`reloj.ts`), con temporizadores falsos:
// (node src/renderer/src/comun/test-reloj.mts)
// Fija que pone la hora solo cuando se le pide, que late al ritmo dado con la hora de cada
// tic y que la limpieza para el MISMO intervalo que arrancó.
// =============================================================================

import { latirReloj, type Temporizador } from './reloj.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Un reloj de mentira: la hora la mueve la prueba y los intervalos se disparan a mano. */
function falso(): { t: Temporizador; avanzar: (ms: number) => void; tic: () => void; ritmos: number[]; parados: unknown[] } {
  let hora = 1_000
  let fn: (() => void) | null = null
  const ritmos: number[] = []
  const parados: unknown[] = []
  const t: Temporizador = {
    ahora: () => hora,
    cada: (f, ms) => {
      fn = f
      ritmos.push(ms)
      return 7 as unknown as ReturnType<typeof setInterval>
    },
    parar: (id) => {
      parados.push(id)
      fn = null
    }
  }
  return { t, avanzar: (ms) => (hora += ms), tic: () => fn?.(), ritmos, parados }
}

hr('Poner en hora')
{
  const f = falso()
  const puestos: number[] = []
  latirReloj((ms) => puestos.push(ms), 30_000, true, f.t)
  check('con ponerEnHora, pone la hora al arrancar', JSON.stringify(puestos) === '[1000]', JSON.stringify(puestos))
  const g = falso()
  const otros: number[] = []
  latirReloj((ms) => otros.push(ms), 30_000, false, g.t)
  check('sin ponerEnHora, no toca la hora hasta el primer tic', otros.length === 0, JSON.stringify(otros))
}

hr('Latido y limpieza')
{
  const f = falso()
  const puestos: number[] = []
  const parar = latirReloj((ms) => puestos.push(ms), 30_000, false, f.t)
  check('late al ritmo dado', JSON.stringify(f.ritmos) === '[30000]', JSON.stringify(f.ritmos))
  f.avanzar(30_000)
  f.tic()
  f.avanzar(30_000)
  f.tic()
  check('cada tic pone la hora de ese momento', JSON.stringify(puestos) === '[31000,61000]', JSON.stringify(puestos))
  parar()
  check('la limpieza para el intervalo que arrancó', JSON.stringify(f.parados) === '[7]', JSON.stringify(f.parados))
  f.tic()
  check('parado, ya no pone la hora', puestos.length === 2, String(puestos.length))
}

const total = results.length
const passed = results.filter((x) => x.pass).length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
