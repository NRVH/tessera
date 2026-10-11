#!/usr/bin/env node
// =============================================================================
// Prueba de `almacenSeguro` (npm run test:almacen-seguro): cuándo cuenta como disponible el almacén
// de secretos en cada plataforma (en Linux, `basic_text` y `unknown` NO protegen aunque
// `safeStorage` diga que puede cifrar) y que el remedio solo aparece en Linux.
// =============================================================================

import { cifradoProtege, remedioSinAlmacen } from './almacenSeguro.ts'

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

hr('(1) Windows y macOS: basta con que el cifrado esté disponible')
check('(1a) Windows disponible', cifradoProtege('windows', true, null), 'true')
check('(1b) macOS disponible', cifradoProtege('mac', true, null), 'true')
check('(1c) macOS no disponible', !cifradoProtege('mac', false, null), 'false')

hr('(2) Linux: decide el backend')
for (const b of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
  check(`(2) ${b} protege`, cifradoProtege('linux', true, b), b)
}
check('(2e) basic_text NO protege aunque diga que cifra', !cifradoProtege('linux', true, 'basic_text'), 'basic_text')
check('(2f) unknown NO protege', !cifradoProtege('linux', true, 'unknown'), 'unknown')
check('(2g) sin backend NO protege', !cifradoProtege('linux', true, null), 'null')
check('(2h) un llavero sin cifrado disponible tampoco', !cifradoProtege('linux', false, 'gnome_libsecret'), 'false')

hr('(3) El remedio solo existe en Linux')
check('(3a) Windows sin remedio', remedioSinAlmacen('windows') === '', JSON.stringify(remedioSinAlmacen('windows')))
check('(3b) macOS sin remedio', remedioSinAlmacen('mac') === '', JSON.stringify(remedioSinAlmacen('mac')))
const r = remedioSinAlmacen('linux')
check('(3c) Linux nombra los dos llaveros y empieza por espacio', r.startsWith(' ') && r.includes('GNOME Keyring') && r.includes('KWallet'), r)

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
