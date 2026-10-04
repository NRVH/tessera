#!/usr/bin/env node
// =============================================================================
// Prueba de `scripts/sistemaMinimo.mjs` (`npm run test:sistema-minimo`): `macosMinimoDelPlist`
// saca el mínimo de un Info.plist con el espaciado que sea (o `null`); `darwinDeMacos` da
// 11–15 → +9 y 26+ → −1 siempre en semver, y LANZA ante un macOS no reconocible;
// `conSistemaMinimo` añade la clave si no está y la sustituye si ya estaba, sin tocar el resto;
// y `sistemaMinimoDelManifiesto` solo da por buena una clave de primer nivel en Darwin.
// =============================================================================

import {
  conSistemaMinimo,
  darwinDeMacos,
  macosMinimoDelPlist,
  sistemaMinimoDelManifiesto
} from './sistemaMinimo.mjs'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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
  hr('1. macosMinimoDelPlist')
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '\t<key>CFBundleName</key>',
    '\t<string>Tessera</string>',
    '\t<key>LSMinimumSystemVersion</key>',
    '\t<string>12.0</string>',
    '</dict></plist>'
  ].join('\n')
  check('(1a) lo lee con salto de línea y tabulador entre clave y valor', macosMinimoDelPlist(plist) === '12.0', String(macosMinimoDelPlist(plist)))
  const sinClave = plist.replace(/\t<key>LSMinimumSystemVersion<\/key>\n\t<string>12\.0<\/string>\n/, '')
  check('(1b) sin la clave, null', macosMinimoDelPlist(sinClave) === null, String(macosMinimoDelPlist(sinClave)))

  hr('2. darwinDeMacos')
  const tabla: Array<[string, string]> = [
    ['11.0', '20.0.0'],
    ['12.0', '21.0.0'],
    ['13', '22.0.0'],
    ['15.4', '24.0.0'],
    ['26.0', '25.0.0'],
    ['27', '26.0.0']
  ]
  for (const [macos, darwin] of tabla) {
    const r = darwinDeMacos(macos)
    check(`(2) macOS ${macos} -> Darwin ${darwin}`, r === darwin, r)
  }
  check('(2) macOS 10.15 no es un mínimo que valga: lanza', lanza(() => darwinDeMacos('10.15')), 'lanza')
  check('(2) basura: lanza', lanza(() => darwinDeMacos('abc')), 'lanza')

  hr('3. conSistemaMinimo')
  const yml = [
    'version: 0.59.0',
    'files:',
    '  - url: Tessera-0.59.0-arm64.zip',
    '    sha512: abc',
    '    size: 1',
    'path: Tessera-0.59.0-arm64.zip',
    'sha512: abc',
    "releaseDate: '2026-09-11T00:00:00.000Z'",
    ''
  ].join('\n')
  const una = conSistemaMinimo(yml, '21.0.0')
  const cuantas = (t: string): number => (t.match(/^minimumSystemVersion:/gm) ?? []).length
  check(
    '(3a) la añade una vez, en primer nivel, sin tocar el resto',
    cuantas(una) === 1 && /^minimumSystemVersion: 21\.0\.0$/m.test(una) && una.startsWith(yml.trimEnd()),
    JSON.stringify(una.slice(yml.trimEnd().length))
  )
  check('(3b) el manifiesto sigue acabando en salto de línea', una.endsWith('\n'), JSON.stringify(una.slice(-24)))
  const dos = conSistemaMinimo(una, '22.0.0')
  check(
    '(3c) si ya estaba, la SUSTITUYE (no quedan dos)',
    cuantas(dos) === 1 && /^minimumSystemVersion: 22\.0\.0$/m.test(dos),
    JSON.stringify(dos.slice(yml.trimEnd().length))
  )

  hr('4. sistemaMinimoDelManifiesto')
  check('(4a) lo lee de un manifiesto parcheado', sistemaMinimoDelManifiesto(una) === '21.0.0', String(sistemaMinimoDelManifiesto(una)))
  check('(4b) sin la clave, null', sistemaMinimoDelManifiesto(yml) === null, String(sistemaMinimoDelManifiesto(yml)))
  check(
    '(4c) tolera comillas',
    sistemaMinimoDelManifiesto(`${yml}minimumSystemVersion: '21.0.0'\n`) === '21.0.0',
    String(sistemaMinimoDelManifiesto(`${yml}minimumSystemVersion: '21.0.0'\n`))
  )
  check(
    '(4d) una versión de macOS sin traducir («12.0») cuenta como ausente',
    sistemaMinimoDelManifiesto(`${yml}minimumSystemVersion: 12.0\n`) === null,
    String(sistemaMinimoDelManifiesto(`${yml}minimumSystemVersion: 12.0\n`))
  )
  check(
    '(4e) una clave anidada no cuenta: solo la de primer nivel',
    sistemaMinimoDelManifiesto(`${yml}files2:\n  minimumSystemVersion: 21.0.0\n`) === null,
    'null'
  )

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
