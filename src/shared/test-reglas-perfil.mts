#!/usr/bin/env node
// =============================================================================
// Prueba de las reglas del perfil (npm run test:reglas-perfil): el tope, la normalización al guardar
// (saltos, controles, tabuladores, espacios y líneas en blanco) y el aplanado para la línea de arranque
// (marca de salto, saltos seguidos, comillas y controles).
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================

import { MARCA_SALTO, MAX_REGLAS_PERFIL, normalizarReglas, reglasParaAviso } from './reglasPerfil.ts'

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
const j = (v: unknown): string => JSON.stringify(v)
const car = (codigo: number): string => String.fromCharCode(codigo)

function main(): void {
  hr('(1) El tope')
  check('(1a) vale 6000', MAX_REGLAS_PERFIL === 6000, String(MAX_REGLAS_PERFIL))

  hr('(2) normalizarReglas')
  check('(2a) CRLF y CR sueltos pasan a LF', normalizarReglas('uno\r\ndos\rtres') === 'uno\ndos\ntres', j(normalizarReglas('uno\r\ndos\rtres')))
  check('(2b) quita controles salvo el salto y el tabulador', normalizarReglas(`a${car(0)}b${car(7)}c${car(0x1b)}d${car(0x7f)}e${car(0x85)}f\ng`) === 'abcdef\ng', j(normalizarReglas(`a${car(0)}b${car(7)}c\ng`)))
  check('(2c) el tabulador pasa a espacio', normalizarReglas('a\tb') === 'a b', j(normalizarReglas('a\tb')))
  check('(2d) sin espacios al final de línea', normalizarReglas('uno   \ndos \t\ntres') === 'uno\ndos\ntres', j(normalizarReglas('uno   \ndos \t\ntres')))
  check('(2e) sin líneas en blanco al principio ni al final, y las del medio se respetan', normalizarReglas('\n\nuno\n\ndos\n\n') === 'uno\n\ndos', j(normalizarReglas('\n\nuno\n\ndos\n\n')))
  check('(2f) la sangría del principio de una línea se conserva', normalizarReglas('- a\n  - b') === '- a\n  - b', j(normalizarReglas('- a\n  - b')))
  check('(2g) los acentos y la eñe pasan intactos', normalizarReglas('Sube a la rama «año»') === 'Sube a la rama «año»', '')
  check('(2h) en blanco queda vacío', normalizarReglas(' \n\t\n ') === '', j(normalizarReglas(' \n\t\n ')))
  check('(2i) es idempotente', normalizarReglas(normalizarReglas('a  \r\n\r\n b\t')) === normalizarReglas('a  \r\n\r\n b\t'), '')

  hr('(3) reglasParaAviso')
  check('(3a) cada salto de línea es la marca con espacios', reglasParaAviso('uno\ndos') === `uno${MARCA_SALTO}dos` && MARCA_SALTO === ' ¶ ', j(reglasParaAviso('uno\ndos')))
  check('(3b) varios saltos seguidos valen uno', reglasParaAviso('uno\n\n\r\n  \ndos') === 'uno ¶ dos', j(reglasParaAviso('uno\n\n\r\n  \ndos')))
  check('(3c) sin saltos ni marca al principio ni al final', reglasParaAviso('\n\nuno\ndos\n\n') === 'uno ¶ dos', j(reglasParaAviso('\n\nuno\ndos\n\n')))
  const raro = `dice "hola" y ${car(0x201c)}adiós${car(0x201d)}, O${car(0x2019)}Brien, \`ls\`, $HOME`
  const limpio = reglasParaAviso(raro)
  check('(3d) comillas dobles, tipográficas y backticks pasan al apóstrofo recto', !/["`‘-‟]/.test(limpio) && limpio.includes("O'Brien") && limpio.includes("dice 'hola'"), limpio)
  check('(3e) el $ y el apóstrofo recto se conservan', limpio.includes('$HOME'), limpio)
  check('(3f) los controles y el separador de línea de Unicode no parten el texto', reglasParaAviso(`a${car(0)}b${car(0x2028)}c`) === 'a b c', j(reglasParaAviso(`a${car(0)}b${car(0x2028)}c`)))
  check('(3g) en blanco queda vacío', reglasParaAviso(' \n\n \t') === '', j(reglasParaAviso(' \n\n \t')))
  check('(3h) el resultado nunca lleva un salto de línea', !/[\r\n]/.test(reglasParaAviso('a\r\nb\rc\nd')), '')
  check('(3i) un espacio doble dentro de la línea se colapsa', reglasParaAviso('a    b') === 'a b', '')

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === results.length
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
