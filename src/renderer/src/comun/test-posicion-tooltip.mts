#!/usr/bin/env node
// =============================================================================
// Prueba de dónde va el tooltip de la app (`posicionTooltip.ts`; npm run test:posicion-tooltip):
// centrado debajo, encima si abajo no cabe, y nunca fuera de la ventana, tampoco en una ventana
// más pequeña que el propio tooltip.
// =============================================================================

import { MARGEN, SEPARACION, posicionTooltip } from './posicionTooltip.ts'

function hr(title: string): void {
  console.log(`\n=== ${title} ===`)
}
const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${pass ? '' : `\n         ${evidence}`}`)
}
const j = (v: unknown): string => JSON.stringify(v)
const V = { width: 1000, height: 600 }
const T = { width: 120, height: 24 }

hr('Posición')
{
  const p = posicionTooltip({ left: 500, top: 100, width: 24, height: 24 }, T, V)
  check('(1) centrado debajo del ancla', p.top === 124 + SEPARACION && p.left === 452, j(p))
  const abajo = posicionTooltip({ left: 500, top: 580, width: 24, height: 16 }, T, V)
  check('(2) sin sitio debajo, encima', abajo.top === 580 - SEPARACION - 24, j(abajo))
  const izq = posicionTooltip({ left: 0, top: 100, width: 20, height: 20 }, T, V)
  const der = posicionTooltip({ left: 990, top: 100, width: 10, height: 20 }, T, V)
  check('(3) pegado a un borde, no se sale por los lados', izq.left === MARGEN && der.left === V.width - MARGEN - T.width, j([izq, der]))
  const enano = posicionTooltip({ left: 10, top: 10, width: 20, height: 20 }, { width: 120, height: 40 }, { width: 300, height: 60 })
  check('(4) ventana diminuta: sin sitio ni arriba ni abajo, dentro por arriba', enano.top >= MARGEN && enano.top + 40 <= 60, j(enano))
}

const allPass = results.every((r) => r.pass)
console.log(`\nVEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
