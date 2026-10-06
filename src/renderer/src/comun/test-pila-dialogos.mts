#!/usr/bin/env node
// =============================================================================
// Prueba de la pila de diálogos (`pilaDialogos.ts`), la que decide qué diálogo atiende Esc:
// (node src/renderer/src/comun/test-pila-dialogos.mts)
// Fija que solo la cima atiende, que desapilar la de arriba devuelve la cima a la de abajo,
// los desmontajes en desorden, el id desconocido y la pila vacía, y que dentro de un mismo
// evento el orden de los manejadores no cambia quién es la cima.
// Corre bajo `node` llano: el módulo no tiene React ni DOM.
// =============================================================================

import { apilar, desapilar, esCima } from './pilaDialogos.ts'

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

// ---------------------------------------------------------------------------
// Ayudas: la pila es de módulo, así que cada escenario deja los ids usados fuera de ella.
// ---------------------------------------------------------------------------
const IDS = ['a', 'b', 'c', 'x', ':r1:', ':r2:']
function limpiar(): void {
  for (const id of IDS) desapilar(id)
}
/** Un evento de mentira: el módulo solo lo usa como clave de identidad. */
function evento(): object {
  return {}
}
/** Las cimas de varios ids, en una cadena legible para la evidencia. */
function cimas(ids: string[], e?: object): string {
  return ids.map((id) => `${id}=${esCima(id, e)}`).join(' ')
}

function main(): void {
  hr('Pila de diálogos: quién es la cima')

  limpiar()
  check(
    '(1) pila vacía: nadie es la cima, con y sin evento',
    !esCima('a') && !esCima('a', evento()),
    cimas(['a', 'b'])
  )
  desapilar('a')
  check('(1b) desapilar con la pila vacía no rompe', !esCima('a'), cimas(['a']))

  apilar('a')
  check('(2) un solo diálogo es la cima', esCima('a') && !esCima('b'), cimas(['a', 'b']))
  limpiar()

  apilar('a')
  apilar('b')
  apilar('c')
  check(
    '(3) solo la cima atiende',
    esCima('c') && !esCima('b') && !esCima('a'),
    cimas(['a', 'b', 'c'])
  )
  limpiar()

  apilar('a')
  apilar('b')
  desapilar('b')
  check(
    '(4) desapilar la de arriba devuelve la cima a la de abajo',
    esCima('a') && !esCima('b'),
    cimas(['a', 'b'])
  )
  limpiar()

  hr('Desmontajes en desorden e ids raros')

  apilar('a')
  apilar('b')
  apilar('c')
  desapilar('a')
  check(
    '(5a) quitar la de abajo no mueve la cima',
    esCima('c') && !esCima('b') && !esCima('a'),
    cimas(['a', 'b', 'c'])
  )
  desapilar('c')
  check('(5b) y al quitar la cima, sube la que quedaba', esCima('b'), cimas(['a', 'b', 'c']))
  limpiar()

  apilar('a')
  apilar('b')
  apilar('c')
  desapilar('b')
  check('(5c) quitar la del medio no mueve la cima', esCima('c') && !esCima('b'), cimas(['a', 'b', 'c']))
  desapilar('c')
  check('(5d) y al quitar la cima, sube la de abajo', esCima('a') && !esCima('b'), cimas(['a', 'b', 'c']))
  limpiar()

  apilar('a')
  desapilar('x')
  check(
    '(6) un id desconocido no rompe: se ignora y la cima sigue siendo la misma',
    esCima('a') && !esCima('x') && !esCima('x', evento()),
    cimas(['a', 'x'])
  )
  limpiar()

  apilar('a')
  apilar('b')
  apilar('a')
  check('(7a) apilar dos veces el mismo id lo sube a la cima', esCima('a') && !esCima('b'), cimas(['a', 'b']))
  desapilar('a')
  check('(7b) y no queda duplicado: al quitarlo sube b', esCima('b') && !esCima('a'), cimas(['a', 'b']))
  desapilar('b')
  check('(7c) y la pila queda vacía', !esCima('a') && !esCima('b'), cimas(['a', 'b']))
  limpiar()

  for (let i = 0; i < 1000; i++) {
    apilar('x')
    desapilar('x')
  }
  apilar('a')
  check('(8) montar y desmontar muchas veces no deja residuos', esCima('a') && !esCima('x'), cimas(['a', 'x']))
  limpiar()

  apilar(':r1:')
  apilar(':r2:')
  check('(9) los ids con la forma de `useId` valen', esCima(':r2:') && !esCima(':r1:'), cimas([':r1:', ':r2:']))
  limpiar()

  hr('Un mismo evento: el orden de los manejadores no cambia la cima')

  apilar('a')
  apilar('b')
  const bEraCima = esCima('b')
  desapilar('b')
  const aEsCimaDespues = esCima('a')
  check(
    '(10) sin evento la respuesta es en vivo: el desmontaje intermedio la cambia',
    bEraCima && aEsCimaDespues,
    `b=${bEraCima}, tras desapilar b: a=${aEsCimaDespues} (por eso useDialogo pasa el evento)`
  )
  limpiar()

  apilar('a')
  apilar('b')
  const e1 = evento()
  const debajoPrimero = esCima('a', e1)
  const encimaDespues = esCima('b', e1)
  check(
    '(11) con el de debajo escuchando primero: solo atiende el de encima',
    !debajoPrimero && encimaDespues,
    `a=${debajoPrimero} b=${encimaDespues}`
  )
  limpiar()

  apilar('a')
  apilar('b')
  const e2 = evento()
  const encimaPrimero = esCima('b', e2)
  desapilar('b')
  const debajoDespues = esCima('a', e2)
  check(
    '(12) con el de encima escuchando primero y desmontándose en medio: el de debajo NO atiende ese Esc',
    encimaPrimero && !debajoDespues,
    `b=${encimaPrimero}, tras desmontar b: a=${debajoDespues}`
  )
  const siguienteEsc = evento()
  check('(12b) pero el Esc siguiente (otro evento) sí llega a a', esCima('a', siguienteEsc), cimas(['a'], siguienteEsc))
  limpiar()

  apilar('a')
  apilar('b')
  const e3 = evento()
  esCima('b', e3)
  const mismoEvento = cimas(['a', 'b'], e3)
  check(
    '(13) consultar de nuevo el mismo evento da lo mismo',
    mismoEvento === 'a=false b=true' && cimas(['a', 'b'], e3) === mismoEvento,
    mismoEvento
  )
  limpiar()

  const e4 = evento()
  const conLaPilaVacia = esCima('a', e4)
  apilar('a')
  check(
    '(14) un diálogo que nace en mitad del evento no atiende ese Esc, pero sí el siguiente',
    !conLaPilaVacia && !esCima('a', e4) && esCima('a', evento()),
    `con la pila vacía a=${conLaPilaVacia}; ya montado y mismo evento a=${esCima('a', e4)}`
  )
  limpiar()

  const e5 = evento()
  apilar('a')
  apilar('b')
  esCima('b', e5)
  desapilar('b')
  const e6 = evento()
  check(
    '(15) un evento nuevo ve la pila de ahora, no la del anterior',
    esCima('a', e6) && !esCima('b', e6),
    cimas(['a', 'b'], e6)
  )
  limpiar()

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
