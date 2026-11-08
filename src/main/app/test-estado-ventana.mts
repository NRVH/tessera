#!/usr/bin/env node
// =============================================================================
// Prueba del estado recordado de la ventana principal (node src/main/app/test-estado-ventana.mts).
// Cubre la validación de lo leído del disco y el encaje en los monitores de ahora: monitor que ya
// no está, ventana parcialmente fuera, disposición con coordenadas negativas y maximizada.
// Corre bajo `node` llano: el módulo no usa Electron.
// =============================================================================

import {
  ALTO_MINIMO_VENTANA,
  ANCHO_MINIMO_VENTANA,
  encajarEnPantallas,
  normalizarEstadoVentana,
  type EstadoVentana,
  type PantallaVisible
} from './estadoVentana.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const j = (v: unknown): string => JSON.stringify(v)
const principal: PantallaVisible = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const izquierda: PantallaVisible = { workArea: { x: -1280, y: 0, width: 1280, height: 984 } }
const base: EstadoVentana = { x: 100, y: 80, width: 1200, height: 800, maximizada: false }

function main(): void {
  hr('normalizarEstadoVentana')
  for (const basura of [null, undefined, 42, 'x', [], {}, { x: 1, y: 1, width: 1000 }]) {
    check(`basura ${j(basura)}`, normalizarEstadoVentana(basura) === null, 'null')
  }
  check(
    'números no finitos o de texto',
    normalizarEstadoVentana({ x: NaN, y: 0, width: 1000, height: 700 }) === null &&
      normalizarEstadoVentana({ x: 0, y: 0, width: Infinity, height: 700 }) === null &&
      normalizarEstadoVentana({ x: '0', y: 0, width: 1000, height: 700 }) === null,
    'null'
  )
  const valido = normalizarEstadoVentana({ x: 10.4, y: -20, width: 1300, height: 900, maximizada: true })
  check('válido, redondeado y maximizada', j(valido) === j({ x: 10, y: -20, width: 1300, height: 900, maximizada: true }), j(valido))
  const sinFlag = normalizarEstadoVentana({ x: 0, y: 0, width: 1300, height: 900, maximizada: 'si' })
  check('maximizada que no es true vale false', sinFlag?.maximizada === false, j(sinFlag))
  const diminuto = normalizarEstadoVentana({ x: 0, y: 0, width: 10, height: 5 })
  check(
    'tamaños acotados al mínimo',
    diminuto?.width === ANCHO_MINIMO_VENTANA && diminuto?.height === ALTO_MINIMO_VENTANA,
    j(diminuto)
  )

  hr('encajarEnPantallas')
  check('cabe en el monitor: igual', j(encajarEnPantallas(base, [principal])) === j(base), 'sin cambios')
  check(
    'monitor que ya no existe: null',
    encajarEnPantallas({ ...base, x: 2500 }, [principal]) === null,
    'null'
  )
  check('sin monitores: null', encajarEnPantallas(base, []) === null, 'null')
  check(
    'asomando menos de 100 px: null',
    encajarEnPantallas({ ...base, x: 1850 }, [principal]) === null,
    'null'
  )
  const parcial = encajarEnPantallas({ x: 1000, y: 700, width: 1200, height: 800, maximizada: false }, [principal])
  check(
    'parcialmente fuera: recortado al monitor',
    j(parcial) === j({ x: 720, y: 240, width: 1200, height: 800, maximizada: false }),
    j(parcial)
  )
  const enorme = encajarEnPantallas({ x: 0, y: 0, width: 4000, height: 3000, maximizada: false }, [principal])
  check(
    'más grande que el monitor: se reduce',
    j(enorme) === j({ x: 0, y: 0, width: 1920, height: 1040, maximizada: false }),
    j(enorme)
  )
  const dos = [izquierda, principal]
  const enIzquierda = { x: -1200, y: 50, width: 1000, height: 700, maximizada: false }
  check('monitor con x negativa: igual', j(encajarEnPantallas(enIzquierda, dos)) === j(enIzquierda), 'sin cambios')
  check('monitor con x negativa desconectado: null', encajarEnPantallas(enIzquierda, [principal]) === null, 'null')
  const entre = encajarEnPantallas({ x: -400, y: 0, width: 1200, height: 800, maximizada: false }, dos)
  check(
    'a caballo entre dos: se queda en el que más ve',
    entre !== null && entre.x === 0 && entre.width === 1200,
    j(entre)
  )
  const maxi = encajarEnPantallas({ ...base, maximizada: true }, [principal])
  check('maximizada se conserva', maxi?.maximizada === true, j(maxi))
  const maxiRecortada = encajarEnPantallas({ x: 1000, y: 700, width: 1200, height: 800, maximizada: true }, [principal])
  check('maximizada se conserva al recortar', maxiRecortada?.maximizada === true, j(maxiRecortada))

  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
