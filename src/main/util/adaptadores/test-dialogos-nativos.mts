#!/usr/bin/env node
// =============================================================================
// Prueba del cableado de `dialogosNativos.ts` (npm run test:dialogos-nativos): tras un
// `showSaveDialog` o `showOpenDialog` aceptado se RECUERDA la carpeta del archivo elegido, y tras
// uno cancelado no. `carpetaDialogo.ts` ya prueba la memoria; esto prueba que el envoltorio la
// llama. `electron` se sustituye por un doble con un resolver-hook; `userData` es un temporal.
// =============================================================================

import { register } from 'node:module'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const electronStub =
  'export const dialog = {' +
  ' showSaveDialog: async () => globalThis.__respuestaDialogo,' +
  ' showOpenDialog: async () => globalThis.__respuestaDialogo };' +
  'export const app = { getPath: () => globalThis.__userDataPrueba };'
const resolveHook = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronStub)});
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') return { url: ELECTRON_STUB, shortCircuit: true };
  return next(spec, ctx)
}`
register('data:text/javascript,' + encodeURIComponent(resolveHook))

const g = globalThis as Record<string, unknown>
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'tessera-dialogos-')))
g.__userDataPrueba = path.join(tmp, 'userData')
mkdirSync(g.__userDataPrueba as string)
const carpeta = path.join(tmp, 'destino')
mkdirSync(carpeta)

const { guardarConDialogo, elegirConDialogo } = await import('./dialogosNativos.ts')
const { memoriaCarpetasEn } = await import('../carpetaDialogo.ts')

let pasadas = 0
let total = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) pasadas++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${evidence}`)
}

try {
  // Una memoria NUEVA sobre el mismo archivo: solo ve lo que de verdad se escribió.
  const recordada = (d: Parameters<typeof guardarConDialogo>[0]): Promise<string> =>
    memoriaCarpetasEn(g.__userDataPrueba as string).inicial(d)

  hr('1. Guardar como: aceptado recuerda, cancelado no')
  g.__respuestaDialogo = { canceled: true, filePath: path.join(carpeta, 'x.txt') }
  await guardarConDialogo('guardar-como', 'x.txt', {})
  check('1a', (await recordada('guardar-como')) === homedir(), 'cancelado: no se recuerda nada (queda el home)')

  g.__respuestaDialogo = { canceled: false, filePath: path.join(carpeta, 'x.txt') }
  await guardarConDialogo('guardar-como', 'x.txt', {})
  check('1b', (await recordada('guardar-como')) === carpeta, `aceptado: recuerda ${carpeta}`)

  hr('2. Abrir: aceptado recuerda, cancelado no')
  g.__respuestaDialogo = { canceled: true, filePaths: [carpeta] }
  await elegirConDialogo('java', {})
  check('2a', (await recordada('java')) === homedir(), 'cancelado: no se recuerda nada')

  g.__respuestaDialogo = { canceled: false, filePaths: [path.join(carpeta, 'bin')] }
  await elegirConDialogo('java', {})
  check('2b', (await recordada('java')) === carpeta, 'aceptado: recuerda la carpeta de lo elegido')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nVEREDICTO: ${pasadas}/${total} PASS`)
process.exit(pasadas === total ? 0 : 1)
