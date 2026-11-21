#!/usr/bin/env node
// =============================================================================
// Prueba de la pila de diálogos (`pilaDialogos.ts`), la que decide qué diálogo atiende Esc:
// (node src/renderer/src/comun/test-pila-dialogos.mts)
// Fija que solo la cima atiende, que desapilar la de arriba devuelve la cima a la de abajo,
// los desmontajes en desorden, el id desconocido y la pila vacía, y que dentro de un mismo
// evento el orden de los manejadores no cambia quién es la cima.
// Corre bajo `node` llano: el módulo no tiene React ni DOM.
// =============================================================================

import { apilar, desapilar, esCima, hayDialogos } from './pilaDialogos.ts'

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
const DOCUMENTO_PRINCIPAL = {}
const IDS = ['a', 'b', 'c', 'x', ':r1:', ':r2:']
function limpiar(): void {
  for (const id of IDS) desapilar(id, DOCUMENTO_PRINCIPAL)
}
/** Un evento de mentira: el módulo solo lo usa como clave de identidad. */
function evento(): object {
  return {}
}
/** Las cimas de varios ids, en una cadena legible para la evidencia. */
function cimas(ids: string[], e?: object): string {
  return ids.map((id) => `${id}=${esCima(id, e, DOCUMENTO_PRINCIPAL)}`).join(' ')
}

function main(): void {
  hr('Pila de diálogos: quién es la cima')

  limpiar()
  check(
    '(1) pila vacía: nadie es la cima, con y sin evento',
    !esCima('a', undefined, DOCUMENTO_PRINCIPAL) && !esCima('a', evento(), DOCUMENTO_PRINCIPAL),
    cimas(['a', 'b'])
  )
  desapilar('a', DOCUMENTO_PRINCIPAL)
  check('(1b) desapilar con la pila vacía no rompe', !esCima('a', undefined, DOCUMENTO_PRINCIPAL), cimas(['a']))

  apilar('a', DOCUMENTO_PRINCIPAL)
  check('(2) un solo diálogo es la cima', esCima('a', undefined, DOCUMENTO_PRINCIPAL) && !esCima('b', undefined, DOCUMENTO_PRINCIPAL), cimas(['a', 'b']))
  limpiar()

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  apilar('c', DOCUMENTO_PRINCIPAL)
  check(
    '(3) solo la cima atiende',
    esCima('c', undefined, DOCUMENTO_PRINCIPAL) && !esCima('b', undefined, DOCUMENTO_PRINCIPAL) && !esCima('a', undefined, DOCUMENTO_PRINCIPAL),
    cimas(['a', 'b', 'c'])
  )
  limpiar()

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  desapilar('b', DOCUMENTO_PRINCIPAL)
  check(
    '(4) desapilar la de arriba devuelve la cima a la de abajo',
    esCima('a', undefined, DOCUMENTO_PRINCIPAL) && !esCima('b', undefined, DOCUMENTO_PRINCIPAL),
    cimas(['a', 'b'])
  )
  limpiar()

  hr('Desmontajes en desorden e ids raros')

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  apilar('c', DOCUMENTO_PRINCIPAL)
  desapilar('a', DOCUMENTO_PRINCIPAL)
  check(
    '(5a) quitar la de abajo no mueve la cima',
    esCima('c', undefined, DOCUMENTO_PRINCIPAL) && !esCima('b', undefined, DOCUMENTO_PRINCIPAL) && !esCima('a', undefined, DOCUMENTO_PRINCIPAL),
    cimas(['a', 'b', 'c'])
  )
  desapilar('c', DOCUMENTO_PRINCIPAL)
  check('(5b) y al quitar la cima, sube la que quedaba', esCima('b', undefined, DOCUMENTO_PRINCIPAL), cimas(['a', 'b', 'c']))
  limpiar()

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  apilar('c', DOCUMENTO_PRINCIPAL)
  desapilar('b', DOCUMENTO_PRINCIPAL)
  check('(5c) quitar la del medio no mueve la cima', esCima('c', undefined, DOCUMENTO_PRINCIPAL) && !esCima('b', undefined, DOCUMENTO_PRINCIPAL), cimas(['a', 'b', 'c']))
  desapilar('c', DOCUMENTO_PRINCIPAL)
  check('(5d) y al quitar la cima, sube la de abajo', esCima('a', undefined, DOCUMENTO_PRINCIPAL) && !esCima('b', undefined, DOCUMENTO_PRINCIPAL), cimas(['a', 'b', 'c']))
  limpiar()

  apilar('a', DOCUMENTO_PRINCIPAL)
  desapilar('x', DOCUMENTO_PRINCIPAL)
  check(
    '(6) un id desconocido no rompe: se ignora y la cima sigue siendo la misma',
    esCima('a', undefined, DOCUMENTO_PRINCIPAL) && !esCima('x', undefined, DOCUMENTO_PRINCIPAL) && !esCima('x', evento(), DOCUMENTO_PRINCIPAL),
    cimas(['a', 'x'])
  )
  limpiar()

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  apilar('a', DOCUMENTO_PRINCIPAL)
  check('(7a) apilar dos veces el mismo id lo sube a la cima', esCima('a', undefined, DOCUMENTO_PRINCIPAL) && !esCima('b', undefined, DOCUMENTO_PRINCIPAL), cimas(['a', 'b']))
  desapilar('a', DOCUMENTO_PRINCIPAL)
  check('(7b) y no queda duplicado: al quitarlo sube b', esCima('b', undefined, DOCUMENTO_PRINCIPAL) && !esCima('a', undefined, DOCUMENTO_PRINCIPAL), cimas(['a', 'b']))
  desapilar('b', DOCUMENTO_PRINCIPAL)
  check('(7c) y la pila queda vacía', !esCima('a', undefined, DOCUMENTO_PRINCIPAL) && !esCima('b', undefined, DOCUMENTO_PRINCIPAL), cimas(['a', 'b']))
  limpiar()

  for (let i = 0; i < 1000; i++) {
    apilar('x', DOCUMENTO_PRINCIPAL)
    desapilar('x', DOCUMENTO_PRINCIPAL)
  }
  apilar('a', DOCUMENTO_PRINCIPAL)
  check('(8) montar y desmontar muchas veces no deja residuos', esCima('a', undefined, DOCUMENTO_PRINCIPAL) && !esCima('x', undefined, DOCUMENTO_PRINCIPAL), cimas(['a', 'x']))
  limpiar()

  apilar(':r1:', DOCUMENTO_PRINCIPAL)
  apilar(':r2:', DOCUMENTO_PRINCIPAL)
  check('(9) los ids con la forma de `useId` valen', esCima(':r2:', undefined, DOCUMENTO_PRINCIPAL) && !esCima(':r1:', undefined, DOCUMENTO_PRINCIPAL), cimas([':r1:', ':r2:']))
  limpiar()

  hr('Un mismo evento: el orden de los manejadores no cambia la cima')

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  const bEraCima = esCima('b', undefined, DOCUMENTO_PRINCIPAL)
  desapilar('b', DOCUMENTO_PRINCIPAL)
  const aEsCimaDespues = esCima('a', undefined, DOCUMENTO_PRINCIPAL)
  check(
    '(10) sin evento la respuesta es en vivo: el desmontaje intermedio la cambia',
    bEraCima && aEsCimaDespues,
    `b=${bEraCima}, tras desapilar b: a=${aEsCimaDespues} (por eso useDialogo pasa el evento)`
  )
  limpiar()

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  const e1 = evento()
  const debajoPrimero = esCima('a', e1, DOCUMENTO_PRINCIPAL)
  const encimaDespues = esCima('b', e1, DOCUMENTO_PRINCIPAL)
  check(
    '(11) con el de debajo escuchando primero: solo atiende el de encima',
    !debajoPrimero && encimaDespues,
    `a=${debajoPrimero} b=${encimaDespues}`
  )
  limpiar()

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  const e2 = evento()
  const encimaPrimero = esCima('b', e2, DOCUMENTO_PRINCIPAL)
  desapilar('b', DOCUMENTO_PRINCIPAL)
  const debajoDespues = esCima('a', e2, DOCUMENTO_PRINCIPAL)
  check(
    '(12) con el de encima escuchando primero y desmontándose en medio: el de debajo NO atiende ese Esc',
    encimaPrimero && !debajoDespues,
    `b=${encimaPrimero}, tras desmontar b: a=${debajoDespues}`
  )
  const siguienteEsc = evento()
  check('(12b) pero el Esc siguiente (otro evento) sí llega a a', esCima('a', siguienteEsc, DOCUMENTO_PRINCIPAL), cimas(['a'], siguienteEsc))
  limpiar()

  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  const e3 = evento()
  esCima('b', e3, DOCUMENTO_PRINCIPAL)
  const mismoEvento = cimas(['a', 'b'], e3)
  check(
    '(13) consultar de nuevo el mismo evento da lo mismo',
    mismoEvento === 'a=false b=true' && cimas(['a', 'b'], e3) === mismoEvento,
    mismoEvento
  )
  limpiar()

  const e4 = evento()
  const conLaPilaVacia = esCima('a', e4, DOCUMENTO_PRINCIPAL)
  apilar('a', DOCUMENTO_PRINCIPAL)
  check(
    '(14) un diálogo que nace en mitad del evento no atiende ese Esc, pero sí el siguiente',
    !conLaPilaVacia && !esCima('a', e4, DOCUMENTO_PRINCIPAL) && esCima('a', evento(), DOCUMENTO_PRINCIPAL),
    `con la pila vacía a=${conLaPilaVacia}; ya montado y mismo evento a=${esCima('a', e4, DOCUMENTO_PRINCIPAL)}`
  )
  limpiar()

  const e5 = evento()
  apilar('a', DOCUMENTO_PRINCIPAL)
  apilar('b', DOCUMENTO_PRINCIPAL)
  esCima('b', e5, DOCUMENTO_PRINCIPAL)
  desapilar('b', DOCUMENTO_PRINCIPAL)
  const e6 = evento()
  check(
    '(15) un evento nuevo ve la pila de ahora, no la del anterior',
    esCima('a', e6, DOCUMENTO_PRINCIPAL) && !esCima('b', e6, DOCUMENTO_PRINCIPAL),
    cimas(['a', 'b'], e6)
  )
  limpiar()

  hr('Pilas independientes por documento')

  const docPrincipal = {}
  const docHija = {}
  apilar('a', docPrincipal)
  apilar('b', docHija)
  check(
    '(16) cada documento tiene su propia cima y no bloquea al otro',
    esCima('a', undefined, docPrincipal) &&
      !esCima('b', undefined, docPrincipal) &&
      esCima('b', undefined, docHija) &&
      !esCima('a', undefined, docHija) &&
      hayDialogos(docPrincipal) &&
      hayDialogos(docHija),
    `principal(a=${esCima('a', undefined, docPrincipal)}) hija(b=${esCima('b', undefined, docHija)})`
  )
  const escHija = evento()
  check(
    '(17) un Esc en la hija cierra solo su cima sin tocar la principal',
    esCima('b', escHija, docHija) && !esCima('a', escHija, docHija),
    `escHija: b=${esCima('b', escHija, docHija)}`
  )
  desapilar('b', docHija)
  check(
    '(18) al vaciar la hija la principal conserva su diálogo',
    !hayDialogos(docHija) && hayDialogos(docPrincipal) && esCima('a', undefined, docPrincipal),
    `hayHija=${hayDialogos(docHija)} hayPrincipal=${hayDialogos(docPrincipal)}`
  )
  desapilar('a', docPrincipal)

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
