#!/usr/bin/env node
// =============================================================================
// Prueba del lanzador de Linux (npm run test:lanzador-linux): el guion se ejecuta de verdad con
// `sh`, con un `tessera-bin` falso que escribe sus argumentos y con los interruptores del núcleo
// sustituidos por archivos de la prueba. Sin sandbox SOLO con los espacios de nombres restringidos
// o apagados y `chrome-sandbox` sin SUID; los argumentos llegan siempre intactos. Necesita `sh`
// (en Windows, el de Git Bash); sin él, NO APLICA.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BINARIO_REAL, guionLanzador } from './lanzadorLinux.mjs'

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

const hayShell = spawnSync('sh', ['-c', 'exit 0']).status === 0
if (!hayShell) {
  console.log('[NO APLICA] no hay `sh` en este sistema')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'tessera-lanzador-'))
const restringido = join(dir, 'restringido')
const clonar = join(dir, 'clonar')
const maximo = join(dir, 'maximo')
const lanzador = join(dir, 'tessera')
writeFileSync(lanzador, guionLanzador({ restringidoAppArmor: restringido, clonarSinPrivilegios: clonar, maximoEspaciosUsuario: maximo }))
chmodSync(lanzador, 0o755)
writeFileSync(join(dir, BINARIO_REAL), '#!/bin/sh\nfor a in "$@"; do printf "[%s]" "$a"; done\n')
chmodSync(join(dir, BINARIO_REAL), 0o755)

/** Lanza con los interruptores dados (null = no existe el archivo) y devuelve lo que recibió el binario. */
function lanzar(r: string | null, c: string | null, args: string[], m: string | null = null): string {
  rmSync(restringido, { force: true })
  rmSync(clonar, { force: true })
  rmSync(maximo, { force: true })
  if (r !== null) writeFileSync(restringido, `${r}\n`)
  if (c !== null) writeFileSync(clonar, `${c}\n`)
  if (m !== null) writeFileSync(maximo, `${m}\n`)
  return spawnSync('sh', [lanzador, ...args], { encoding: 'utf8' }).stdout
}

try {
  hr('(1) Con sandbox donde se puede crear')
  check('(1a) sin los archivos del núcleo (otro Linux): sandbox', lanzar(null, null, ['a']) === '[a]', lanzar(null, null, ['a']))
  check('(1b) AppArmor sin restringir: sandbox', lanzar('0', '1', ['a']) === '[a]', lanzar('0', '1', ['a']))

  hr('(2) Sin sandbox solo donde no se puede (y chrome-sandbox sin SUID)')
  check('(2a) AppArmor restringe: --no-sandbox', lanzar('1', '1', ['a']) === '[--no-sandbox][a]', lanzar('1', '1', ['a']))
  check('(2b) espacios de nombres apagados: --no-sandbox', lanzar(null, '0', ['a']) === '[--no-sandbox][a]', lanzar(null, '0', ['a']))
  check('(2c) tope de espacios de usuario a 0: --no-sandbox', lanzar(null, null, ['a'], '0') === '[--no-sandbox][a]', lanzar(null, null, ['a'], '0'))
  check('(2d) NEGATIVO: con tope, pero no a 0: sandbox', lanzar('0', '1', ['a'], '63429') === '[a]', lanzar('0', '1', ['a'], '63429'))

  hr('(3) Los argumentos llegan intactos')
  // Solo fuera de Windows: allí el `sh` de Git Bash vuelve a partir la línea de órdenes y las
  // comillas se pierden antes de llegar al guion.
  if (process.platform === 'win32') {
    console.log('  [NO APLICA] (3a) en Windows los argumentos no llegan intactos ni siquiera a `sh`')
  } else {
    const raros = ['/home/ana/mi proyecto', '--flag=$HOME', "comilla'simple", '']
    const esperado = raros.map((a) => `[${a}]`).join('')
    check('(3a) espacios, $, comillas y vacíos', lanzar('0', '1', raros) === esperado, lanzar('0', '1', raros))
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
