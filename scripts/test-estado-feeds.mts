#!/usr/bin/env node
// =============================================================================
// Prueba de `baseDelFeed` de `estado-feeds.mjs` (`npm run test:estado-feeds`): sin `--feed` ni
// variable mira GitHub, `--feed <url>` quita la barra final, y `--feed` sin valor lanza en vez
// de tomar la opción siguiente por URL.
// Decisiones: docs/decisiones/despliegue/releases-de-github.md
// =============================================================================

import { FEED_GITHUB, baseDelFeed } from './estado-feeds.mjs'

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

function lanza(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

function main(): void {
  hr('baseDelFeed')
  check('sin --feed ni variable: GitHub', baseDelFeed(['node', 'x'], {}) === FEED_GITHUB, baseDelFeed(['node', 'x'], {}))
  check('--feed <url> sin barra final', baseDelFeed(['node', 'x', '--feed', 'http://h/f/'], {}) === 'http://h/f',
    baseDelFeed(['node', 'x', '--feed', 'http://h/f/'], {}))
  check('--feed al final, sin valor, lanza', lanza(() => baseDelFeed(['node', 'x', '--feed'], {})), 'lanza')
  check('--feed seguido de otra opción lanza (no la toma por URL)',
    lanza(() => baseDelFeed(['node', 'x', '--feed', '--estricto'], {})), 'lanza')

  hr('RESUMEN')
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
