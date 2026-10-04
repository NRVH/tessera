#!/usr/bin/env node
// =============================================================================
// Prueba del formato del uso de cuenta del pie del agente (npm run test:formato-uso): el
// nombre largo y el corto de cada ventana, el tramo de la escalera de anchos, el porcentaje y el color.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================

import { etiquetaCortaUso, etiquetaLargaUso, formatoPorcentaje, tramoVentanas, varNivelUso } from './formatoUso.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

hr('1. El nombre largo de cada ventana')
{
  const casos: Array<[string, string]> = [
    ['5h', 'Sesión (5 h)'],
    ['7d', 'Semanal (7 días)'],
    ['Fable 7d', 'Semanal Fable'],
    ['Opus 7d', 'Semanal Opus'],
    ['Cowork 5h', 'Sesión Cowork'],
    // Lo que no se conoce se enseña tal cual: un límite nuevo no puede desaparecer.
    ['Monthly', 'Monthly'],
    ['Individual limit 30d', 'Individual limit 30d'],
    ['30d', '30d'],
    ['?', '?']
  ]
  for (const [corta, larga] of casos) {
    check(`(1) «${corta}» → «${larga}»`, etiquetaLargaUso(corta) === larga, etiquetaLargaUso(corta))
  }
}

hr('1b. La etiqueta corta de la línea compacta')
{
  const casos: Array<[string, string]> = [
    ['5h', '5h'],
    ['7d', '7d'],
    ['Fable 7d', 'F'],
    ['opus 7d', 'O'],
    // La de sesión de un modelo conserva el «5h»: sola, «C» se leería como una semanal.
    ['Cowork 5h', 'C 5h'],
    ['Monthly', 'Monthly'],
    ['Individual limit 30d', 'Individual limit 30d'],
    ['Dos palabras 7d', 'Dos palabras 7d']
  ]
  for (const [larga, corta] of casos) {
    check(`(1b) «${larga}» → «${corta}»`, etiquetaCortaUso(larga) === corta, etiquetaCortaUso(larga))
  }
}

hr('2. El tramo de la escalera de anchos')
{
  const tramos = [0, 1, 2, 3, 4, 5, 9].map((n) => tramoVentanas(n)).join(',')
  check('(2a) hasta dos ventanas, tres, y cuatro o más', tramos === '2,2,2,3,4,4,4', tramos)
}

hr('3. Porcentaje y color')
{
  const pct = [0, 0.4, 1, 16.4, 16.5, 100].map(formatoPorcentaje).join(' ')
  check('(3a) sin decimales, y «<1%» cuando hay consumo por debajo de uno', pct === '0% <1% 1% 16% 17% 100%', pct)
  const nivel = [0, 74.9, 75, 89.9, 90, 100].map(varNivelUso).join(' ')
  check('(3b) verde, ámbar desde 75 y rojo desde 90', nivel === '--green --green --yellow --yellow --red --red', nivel)
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
