#!/usr/bin/env node
// =============================================================================
// Prueba de `scripts/parchearMinimoMac.mjs` (`npm run test:parchear-minimo-mac`): el
// manifiesto sale con UN `minimumSystemVersion` en Darwin sacado del Info.plist, sin tocar el
// resto; si el plist no trae la clave o trae un macOS irreconocible, LANZA; y la ruta del plist
// es la del .app de arm64 que deja electron-builder.
// =============================================================================

import { join } from 'node:path'
import { parchearManifiestoMac, rutaPlistMac } from './parchearMinimoMac.mjs'

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

const plistCon = (version: string): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '\t<key>CFBundleName</key>',
    '\t<string>Tessera</string>',
    '\t<key>LSMinimumSystemVersion</key>',
    `\t<string>${version}</string>`,
    '</dict></plist>'
  ].join('\n')

const yml = [
  'version: 0.71.0',
  'files:',
  '  - url: Tessera-0.71.0-arm64.zip',
  '    sha512: abc',
  '    size: 1',
  'path: Tessera-0.71.0-arm64.zip',
  'sha512: abc',
  "releaseDate: '2026-10-04T00:00:00.000Z'",
  ''
].join('\n')

const cuantas = (t: string): number => (t.match(/^minimumSystemVersion:/gm) ?? []).length

function main(): void {
  hr('1. parchearManifiestoMac')
  const r = parchearManifiestoMac(plistCon('12.0'), yml)
  check('(1a) macOS 12.0 -> Darwin 21.0.0', r.macos === '12.0' && r.darwin === '21.0.0', `${r.macos} -> ${r.darwin}`)
  check(
    '(1b) el manifiesto lleva UNA clave de primer nivel y conserva el resto',
    cuantas(r.yml) === 1 && /^minimumSystemVersion: 21\.0\.0$/m.test(r.yml) && r.yml.startsWith(yml.trimEnd()),
    JSON.stringify(r.yml.slice(yml.trimEnd().length))
  )
  const otra = parchearManifiestoMac(plistCon('26.0'), r.yml)
  check(
    '(1c) parchear dos veces sustituye, no duplica',
    cuantas(otra.yml) === 1 && /^minimumSystemVersion: 25\.0\.0$/m.test(otra.yml),
    JSON.stringify(otra.yml.slice(yml.trimEnd().length))
  )
  const sinClave = plistCon('12.0').replace(/\t<key>LSMinimumSystemVersion<\/key>\n\t<string>12\.0<\/string>\n/, '')
  check('(1d) un plist sin LSMinimumSystemVersion lanza', lanza(() => parchearManifiestoMac(sinClave, yml)), 'lanza')
  check('(1e) un macOS irreconocible lanza', lanza(() => parchearManifiestoMac(plistCon('10.15'), yml)), 'lanza')

  hr('2. rutaPlistMac')
  const ruta = rutaPlistMac('dist')
  check(
    '(2) apunta al Info.plist del .app de arm64',
    ruta === join('dist', 'mac-arm64', 'Tessera.app', 'Contents', 'Info.plist'),
    ruta
  )

  hr('RESUMEN')
  for (const x of results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}`)
    console.log(`      -> ${x.evidence}`)
  }
  const passed = results.filter((x) => x.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
