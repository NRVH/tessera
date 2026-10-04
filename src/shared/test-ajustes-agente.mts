#!/usr/bin/env node
// =============================================================================
// Prueba del ajuste «Hibernar el agente inactivo tras» (npm run test:ajustes-agente): la
// lista y su orden, el saneado de lo persistido, el paso a milisegundos y el umbral de
// pruebas, que acorta pero nunca enciende.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import {
  AGENTE_INACTIVIDAD_MIN_POR_DEFECTO,
  AGENTE_INACTIVIDAD_NUNCA,
  AGENTE_INACTIVIDAD_OPCIONES,
  AGENTE_INACTIVIDAD_PRUEBAS_SUELO_MS,
  AYUDA_INACTIVIDAD_AGENTE,
  inactividadAgenteMs,
  normalizarInactividadAgenteMin,
  umbralEfectivoMs,
  umbralPruebasDe
} from './ajustesAgente.ts'

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

hr('1. La lista del selector')
{
  const mins = AGENTE_INACTIVIDAD_OPCIONES.map((o) => o.min)
  check('(1a) 5, 10, 15, 30, 60 y Nunca al final', JSON.stringify(mins) === '[5,10,15,30,60,0]', JSON.stringify(mins))
  check(
    '(1b) el valor por defecto está en la lista y es 5',
    AGENTE_INACTIVIDAD_MIN_POR_DEFECTO === 5 && mins.includes(AGENTE_INACTIVIDAD_MIN_POR_DEFECTO),
    String(AGENTE_INACTIVIDAD_MIN_POR_DEFECTO)
  )
  const ultima = AGENTE_INACTIVIDAD_OPCIONES[AGENTE_INACTIVIDAD_OPCIONES.length - 1]
  check('(1c) «Nunca» se guarda como 0', ultima.etiqueta === 'Nunca' && ultima.min === AGENTE_INACTIVIDAD_NUNCA, JSON.stringify(ultima))
}

hr('2. Saneado de lo persistido')
{
  const conservados = [5, 10, 15, 30, 60, 0].map((v) => normalizarInactividadAgenteMin(v))
  check('(2a) los valores de la lista se conservan', JSON.stringify(conservados) === '[5,10,15,30,60,0]', JSON.stringify(conservados))
  const basura: unknown[] = [7, '5', NaN, -5, null, undefined, {}, 5.5, Infinity]
  const saneados = basura.map((v) => normalizarInactividadAgenteMin(v))
  check('(2b) cualquier otra cosa, o la ausencia, da 5', saneados.every((v) => v === 5), JSON.stringify(saneados))
}

hr('3. Milisegundos')
{
  check('(3a) 5 minutos son 300 000 ms', inactividadAgenteMs(5) === 300_000, String(inactividadAgenteMs(5)))
  check('(3b) «Nunca» da null', inactividadAgenteMs(0) === null, String(inactividadAgenteMs(0)))
  check('(3c) la basura cae al valor por defecto, no a «Nunca»', inactividadAgenteMs('x') === 300_000, String(inactividadAgenteMs('x')))
}

hr('4. Umbral de pruebas')
{
  check('(4a) un entero dentro del rango vale', umbralPruebasDe('3000') === 3000, String(umbralPruebasDe('3000')))
  const fuera = [undefined, '', 'abc', '2999', '3600001', '-5', '3000.5', '1e4']
  const res = fuera.map((t) => umbralPruebasDe(t))
  check('(4b) ausente, texto, por debajo del suelo o por encima de una hora: null', res.every((r) => r === null), JSON.stringify(res))
  check('(4c) el suelo no baja de 3 s', AGENTE_INACTIVIDAD_PRUEBAS_SUELO_MS === 3000, String(AGENTE_INACTIVIDAD_PRUEBAS_SUELO_MS))
  check('(4d) sustituye a los minutos', umbralEfectivoMs(5, 3000) === 3000, String(umbralEfectivoMs(5, 3000)))
  check('(4e) sin él, mandan los minutos', umbralEfectivoMs(10, null) === 600_000, String(umbralEfectivoMs(10, null)))
  check('(4f) «Nunca» gana SIEMPRE: el umbral de pruebas no enciende nada', umbralEfectivoMs(0, 3000) === null, String(umbralEfectivoMs(0, 3000)))
  check('(4g) `nunca` (la suite lo usa para apagarla) se reconoce, con o sin espacios', umbralPruebasDe('nunca') === 'nunca' && umbralPruebasDe(' nunca ') === 'nunca', String(umbralPruebasDe('nunca')))
  check('(4h) y apaga la función aunque el ajuste diga 5 minutos', umbralEfectivoMs(5, 'nunca') === null, String(umbralEfectivoMs(5, 'nunca')))
}

hr('5. La ayuda dice solo lo que se garantiza')
{
  check(
    '(5a) nombra el segundo plano, las terminales y el modo nativo',
    /segundo plano/.test(AYUDA_INACTIVIDAD_AGENTE) && /terminales/.test(AYUDA_INACTIVIDAD_AGENTE) && /nativo/.test(AYUDA_INACTIVIDAD_AGENTE),
    AYUDA_INACTIVIDAD_AGENTE.slice(0, 60)
  )
  check('(5b) no promete «nunca» ni «la misma conversación»', !/[Nn]unca se cierra|misma conversación/.test(AYUDA_INACTIVIDAD_AGENTE), 'sin promesas absolutas')
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
