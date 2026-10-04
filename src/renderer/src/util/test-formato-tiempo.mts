#!/usr/bin/env node
// =============================================================================
// Prueba del formato de tiempos relativos (npm run test:formato-tiempo).
//
// Depende de `formatoTiempo.ts`, puro. Fija que no hay rama para el pasado (lo peor que sale es
// 'ahora'), que no aparece "en 0 min" (los últimos segundos dicen "en menos de 1 min") y el
// redondeo hacia abajo, que es una decisión de producto: nunca anunciar más tiempo del que hay.
// =============================================================================

import { formatoAntiguedad, formatoReinicio } from './formatoTiempo.ts'

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

const MIN = 60_000
const H = 3_600_000

function main(): void {
  hr('Cuenta atrás hasta el reinicio')

  const cortos = [formatoReinicio(25_000), formatoReinicio(1), formatoReinicio(59_999)]
  check(
    '(a) por debajo del minuto NUNCA sale "en 0 min"',
    cortos.every((s) => s === 'en menos de 1 min'),
    `25s=${cortos[0]} 1ms=${cortos[1]} 59.9s=${cortos[2]}`
  )

  // El "ya" que nunca llegaba. No se comprueba `!== 'ya'`: el tipo de retorno de
  // `formatoReinicio` ya no contiene ese literal, así que TypeScript rechaza la
  // comparación como imposible —una garantía mejor que la del test—.
  const pasado = [formatoReinicio(0), formatoReinicio(-5 * MIN)]
  check(
    '(b) con la fecha ya pasada NUNCA sale "ya"',
    pasado.every((s) => s === 'ahora'),
    `0=${pasado[0]} -5min=${pasado[1]}`
  )

  check(
    '(c) minutos y horas se redondean HACIA ABAJO (nunca prometer más tiempo del que hay)',
    formatoReinicio(90 * MIN) === 'en 1 h 30 min' &&
      formatoReinicio(59 * MIN + 59_000) === 'en 59 min' &&
      formatoReinicio(2 * H - 1) === 'en 1 h 59 min',
    `90min=${formatoReinicio(90 * MIN)} 59m59s=${formatoReinicio(59 * MIN + 59_000)} 2h-1ms=${formatoReinicio(2 * H - 1)}`
  )

  // La ventana de sesión dura 5 h, así que "en 1 h" para cualquier cosa entre 60 y
  // 119 minutos era hasta 59 min de imprecisión en el dato que decide si parar.
  check(
    '(c2) por debajo de un día se dan las DOS unidades, y los minutos en punto se omiten',
    formatoReinicio(84 * MIN) === 'en 1 h 24 min' &&
      formatoReinicio(2 * H) === 'en 2 h' &&
      formatoReinicio(4 * H + 59 * MIN) === 'en 4 h 59 min',
    `84min=${formatoReinicio(84 * MIN)} 2h=${formatoReinicio(2 * H)} 4h59=${formatoReinicio(4 * H + 59 * MIN)}`
  )

  // El corte de los días sigue en 48 h y no en 24: con 24 aparecería un "en 1 días"
  // que nunca se ha podido ver (mínimo 2), mal escrito además.
  check(
    '(c3) nunca se pinta "en 1 días"',
    formatoReinicio(25 * H) === 'en 25 h' && formatoReinicio(47 * H + 59 * MIN) === 'en 47 h',
    `25h=${formatoReinicio(25 * H)} 47h59=${formatoReinicio(47 * H + 59 * MIN)}`
  )

  check(
    '(d) a partir de 48 h se habla en días',
    formatoReinicio(47 * H) === 'en 47 h' && formatoReinicio(49 * H) === 'en 2 días',
    `47h=${formatoReinicio(47 * H)} 49h=${formatoReinicio(49 * H)}`
  )

  hr('Antigüedad de un dato')

  const T = 1_800_000_000_000
  check(
    '(e) el "ahora" es un PARÁMETRO: sin eso la función no se puede probar',
    formatoAntiguedad(T, T + 30_000) === 'ahora mismo' &&
      formatoAntiguedad(T, T + 5 * MIN) === 'hace 5 min' &&
      formatoAntiguedad(T, T + 3 * H) === 'hace 3 h' &&
      formatoAntiguedad(T, T + 50 * H) === 'hace 2 días',
    `30s=${formatoAntiguedad(T, T + 30_000)} 5min=${formatoAntiguedad(T, T + 5 * MIN)} 3h=${formatoAntiguedad(T, T + 3 * H)} 50h=${formatoAntiguedad(T, T + 50 * H)}`
  )

  check(
    '(f) tampoco hace parecer un dato más viejo de lo que es',
    formatoAntiguedad(T, T + 119 * MIN) === 'hace 1 h',
    `119min=${formatoAntiguedad(T, T + 119 * MIN)}`
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
