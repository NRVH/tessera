#!/usr/bin/env node
// =============================================================================
// Prueba del registro de salud (npm run test:salud): qué versiones son alpha, cuándo se
// graba (alpha Y ajuste encendido) y cuándo rota el archivo.
// Importa solo `salud.ts`, que no depende de nada.
// =============================================================================

import { debeRotar, esVersionAlpha, registroSaludActivo, TOPE_ARCHIVO_BYTES } from './salud.ts'

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

function main(): void {
  hr('(1) esVersionAlpha')
  const alpha = ['0.76.2-alpha.3', '1.0.0-alpha', '0.76.2-alpha.12', '0.76.2-alpha.1+build5']
  const noAlpha = ['0.76.2', '1.0.0', '0.76.2-beta.1', '0.76.2-rc.1', '', 'alpha', '0.76-alpha.1', 'v0.76.2-alpha.1', '0.76.2-xalpha.1']
  for (const v of alpha) check(`«${v}» es alpha`, esVersionAlpha(v), String(esVersionAlpha(v)))
  for (const v of noAlpha) check(`«${v}» NO es alpha`, !esVersionAlpha(v), String(esVersionAlpha(v)))

  hr('(2) registroSaludActivo: alpha Y ajuste')
  check('alpha + ajuste encendido -> graba', registroSaludActivo('0.76.2-alpha.3', true), 'true')
  check('alpha + ajuste apagado -> no graba', !registroSaludActivo('0.76.2-alpha.3', false), 'false')
  check('pública + ajuste encendido -> no graba', !registroSaludActivo('0.76.2', true), 'false')
  check('pública + ajuste apagado -> no graba', !registroSaludActivo('0.76.2', false), 'false')

  hr('(3) debeRotar')
  check('el tope por defecto es 5 MB', TOPE_ARCHIVO_BYTES === 5 * 1024 * 1024, String(TOPE_ARCHIVO_BYTES))
  check('por debajo del tope no rota', !debeRotar(TOPE_ARCHIVO_BYTES - 1), 'false')
  check('en el tope rota', debeRotar(TOPE_ARCHIVO_BYTES), 'true')
  check('con tope propio', debeRotar(10, 10) && !debeRotar(9, 10), 'ok')

  hr('RESULTADO (PASS/FAIL)')
  const ok = results.filter((r) => r.pass).length
  console.log(`VEREDICTO: ${ok}/${results.length} PASS`)
  process.exit(ok === results.length ? 0 : 1)
}

main()
