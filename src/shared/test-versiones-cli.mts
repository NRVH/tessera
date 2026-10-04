#!/usr/bin/env node
// =============================================================================
// Prueba de versionesCli (npm run test:versiones-cli): con qué decide el botón de
// actualizar agentes si hay algo que instalar, qué sesiones van atrasadas y qué
// versión entra en una orden de npm. Cubre extraerVersion con salidas reales,
// esVersionExacta (semver estricto), compararVersiones (y que lanza ante lo no
// exacto), hayVersionNueva solo hacia arriba y sesionAtrasada.
// =============================================================================

import {
  compararVersiones,
  esVersionExacta,
  extraerVersion,
  hayVersionNueva,
  sesionAtrasada
} from './versionesCli.ts'

let pasadas = 0
let total = 0
function hr(t: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(t)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasadas++
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}`)
  console.log(`        ${evidence}`)
}

// ---------------------------------------------------------------------------
hr('(1) extraerVersion con salidas reales')
{
  const casos: Array<[string | null, string | null]> = [
    ['codex-cli 0.156.0', '0.156.0'],
    ['codex-cli 0.156.0\r\n', '0.156.0'],
    ['2.1.281 (Claude Code)', '2.1.281'],
    ['codex-cli 0.155.0-alpha.16.4', '0.155.0-alpha.16.4'],
    ['__INI__\n2.1.281 (Claude Code)\n__FIN__', '2.1.281'],
    ["codex : El término 'codex' no se reconoce", null],
    ['', null],
    [null, null],
    ['versión 2.1', null]
  ]
  for (const [entrada, esperado] of casos) {
    const r = extraerVersion(entrada)
    check(`extraerVersion(${JSON.stringify(entrada)})`, r === esperado, `-> ${JSON.stringify(r)}`)
  }
}

// ---------------------------------------------------------------------------
hr('(2) esVersionExacta: la puerta antes de construir una orden')
{
  const buenas = ['0.156.1', '2.1.281', '0.155.0-alpha.16.4', '1.0.0-rc.1', '10.20.30']
  const malas = [
    'latest',
    '^0.156.1',
    '~2.1.0',
    '>=1.0.0',
    'v1.2.3',
    '1.2',
    '01.2.3',
    '1.2.3+build.5',
    '1.2.3 && calc',
    '1.2.3;rm -rf /',
    'https://evil.example/codex.tgz',
    '1.2.3-',
    '',
    '9'.repeat(70) + '.1.1'
  ]
  for (const v of buenas) check(`acepta ${v}`, esVersionExacta(v), 'semver estricto')
  for (const v of malas) check(`rechaza ${JSON.stringify(v)}`, !esVersionExacta(v), 'no puede ir a npm')
  check('rechaza null/undefined', !esVersionExacta(null) && !esVersionExacta(undefined), 'sin valor')
}

// ---------------------------------------------------------------------------
hr('(3) compararVersiones')
{
  const casos: Array<[string, string, number]> = [
    ['0.156.1', '0.156.0', 1],
    ['0.156.0', '0.156.1', -1],
    ['2.1.281', '2.1.281', 0],
    ['2.1.281', '2.1.273', 1],
    ['0.200.0', '0.156.9', 1],
    ['1.0.0', '0.999.999', 1],
    ['0.155.0-alpha.16.4', '0.155.0', -1],
    ['0.155.0', '0.155.0-alpha.16.4', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
    ['1.0.0-alpha.beta', '1.0.0-beta', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-rc.1', '1.0.0', -1]
  ]
  for (const [a, b, esperado] of casos) {
    const r = compararVersiones(a, b)
    check(`compararVersiones(${a}, ${b}) = ${esperado}`, r === esperado, `-> ${r}`)
  }
}

// ---------------------------------------------------------------------------
hr('(4) hayVersionNueva: sólo «mayor que»')
{
  check('0.156.0 -> 0.156.1: sí', hayVersionNueva('0.156.0', '0.156.1'), 'Codex de hoy')
  check('iguales: no', !hayVersionNueva('2.1.281', '2.1.281'), 'al día')
  check(
    'instalada POR DELANTE del canal stable: no',
    !hayVersionNueva('2.1.281', '2.1.273'),
    'si no, reinstalaría una versión más vieja en cada pulsación'
  )
  check('instalada desconocida: no', !hayVersionNueva(null, '0.156.1'), 'CLI no instalado o sonda rota')
  check('última desconocida: no', !hayVersionNueva('0.156.0', null), 'sin red')
  check('última no exacta: no', !hayVersionNueva('0.156.0', 'latest'), 'basura del registro')
}

// ---------------------------------------------------------------------------
hr('(5) sesionAtrasada')
{
  check('lanzada 2.1.280, instalada 2.1.281: sí', sesionAtrasada('2.1.280', '2.1.281'), 'Claude se actualizó solo')
  check('iguales: no', !sesionAtrasada('2.1.281', '2.1.281'), 'al día')
  check('lanzada desconocida: no', !sesionAtrasada(null, '2.1.281'), 'una sonda rota no enciende el punto')
  check('instalada desconocida: no', !sesionAtrasada('2.1.281', null), 'CLI desinstalado')
  check('lanzada POR DELANTE: no', !sesionAtrasada('2.1.281', '2.1.280'), 'bajada manual: no es «atrasada»')
}

// ---------------------------------------------------------------------------
hr('(6) compararVersiones lanza con entradas no exactas')
{
  let lanzo = false
  try {
    compararVersiones('latest', '1.0.0')
  } catch {
    lanzo = true
  }
  check('latest vs 1.0.0 lanza', lanzo, 'comparar basura es un error, no un empate')
}

console.log(`\nVEREDICTO: ${pasadas}/${total} PASS`)
process.exit(pasadas === total ? 0 : 1)
