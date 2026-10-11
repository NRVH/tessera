#!/usr/bin/env node
// =============================================================================
// Prueba de `volcadosPuro.ts` (npm run test:volcados): qué volcados de caída son nuevos desde la
// última revisión, cuáles se borran para conservar solo los más recientes, que la marca de
// revisión no retrocede y que solo se graban en las alpha con su ajuste (`opcionExperimentalActiva`).
// =============================================================================

import { decidirVolcados, VOLCADOS_CONSERVADOS } from './volcadosPuro.ts'
import { opcionExperimentalActiva, registroSaludActivo } from '../../shared/salud.ts'

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  if (pass) passed++
  else failed++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const v = (n: number): { ruta: string; mtimeMs: number } => ({ ruta: `d${n}.dmp`, mtimeMs: n * 1000 })
const rutas = (l: { ruta: string }[]): string => l.map((x) => x.ruta).join(',')

hr('(1) Nuevos')
{
  const d = decidirVolcados([v(3), v(1), v(2)], 1500)
  check('(1a) solo los posteriores a la revisión, del más antiguo al más reciente', rutas(d.nuevos) === 'd2.dmp,d3.dmp', rutas(d.nuevos))
  check('(1b) la revisión avanza hasta el más reciente', d.revisadoHasta === 3000, String(d.revisadoHasta))
  const otra = decidirVolcados([v(3), v(1), v(2)], d.revisadoHasta)
  check('(1c) NEGATIVO: revisados ya, ninguno nuevo (no se anotan dos veces)', otra.nuevos.length === 0, rutas(otra.nuevos))
  const primera = decidirVolcados([v(1)], 0)
  check('(1d) la primera vez, todos son nuevos', rutas(primera.nuevos) === 'd1.dmp', rutas(primera.nuevos))
}

hr('(2) Tope')
{
  const lista = Array.from({ length: VOLCADOS_CONSERVADOS + 3 }, (_, i) => v(i + 1))
  const d = decidirVolcados(lista, 0)
  check('(2a) por encima del tope se borran los más antiguos', rutas(d.borrar) === 'd1.dmp,d2.dmp,d3.dmp', rutas(d.borrar))
  check('(2b) NEGATIVO: por debajo del tope no se borra nada', decidirVolcados([v(1), v(2)], 0).borrar.length === 0, '')
  const vacio = decidirVolcados([], 5000)
  check('(2c) sin volcados, la revisión no retrocede', vacio.revisadoHasta === 5000 && vacio.nuevos.length === 0, String(vacio.revisadoHasta))
  check('(2d) un tope negativo se trata como cero, no como «borra de más»', decidirVolcados([v(1), v(2)], 0, -1).borrar.length === 2, '')
}

hr('(3) Solo en alpha')
{
  const activa = opcionExperimentalActiva
  check('(3a) una alpha con el ajuste encendido graba volcados', activa('0.76.2-alpha.3', true), '')
  check('(3b) NEGATIVO: una alpha con el ajuste apagado no', !activa('0.76.2-alpha.3', false), '')
  check('(3c) NEGATIVO: una pública no, aunque el ajuste esté encendido', !activa('0.76.1', true), '')
  check('(3d) NEGATIVO: otra prerelease tampoco', !activa('0.77.0-beta.1', true), '')
  check('(3e) el arnés de pruebas sustituye a la alpha', activa('0.76.1', true, true), '')
  check('(3f) NEGATIVO: pero no al ajuste: forzado y apagado, no', !activa('0.76.1', false, true), '')
  check('(3g) el registro de salud sigue la misma regla', registroSaludActivo('0.76.2-alpha.3', true) && !registroSaludActivo('0.76.1', true), '')
}

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
