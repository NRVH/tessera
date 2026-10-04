#!/usr/bin/env node
// =============================================================================
// Prueba de los nombres propios de conversaciones (`conversationTitles.ts`), sobre un archivo
// temporal.
// (node src/main/conversations/test-titles.mts)
// Poner y leer, vaciar restablece, recorte y tope (sin partir emojis), sobrevivir a un reinicio (instancia nueva sobre
// el mismo archivo), JSON corrupto sin lanzar y claves independientes por agente.
// =============================================================================

import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { crearTitulosConversacion, type TitulosConversacion } from './conversationTitles.ts'

let passed = 0
let failed = 0

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-convtitles-')))
const titlesFile = path.join(tmp, 'conversation-titles.json')

/** Instancia FRESCA sobre el mismo archivo (mapa en memoria vacío) = "reiniciar la app". */
function loadStore(): TitulosConversacion {
  return crearTitulosConversacion(titlesFile)
}

/** Contenido del JSON persistido (o null si no existe). */
function readFile(): Record<string, string> | null {
  if (!existsSync(titlesFile)) return null
  return JSON.parse(readFileSync(titlesFile, 'utf-8'))
}

const ID = '3f2a1b4c-0000-4000-8000-abcdefabcdef'

try {
  hr('1. Poner y leer un nombre; se persiste en disco')

  let store = loadStore()
  check('1a', store.getCustomTitle('claude-code', ID) === undefined, 'sin renombrar -> undefined')

  await store.setCustomTitle('claude-code', ID, 'Refactor del panel de git')
  check(
    '1b',
    store.getCustomTitle('claude-code', ID) === 'Refactor del panel de git',
    `leído en memoria -> "${store.getCustomTitle('claude-code', ID)}"`
  )
  check(
    '1c',
    readFile()?.[`claude-code:${ID}`] === 'Refactor del panel de git',
    `persistido en conversation-titles.json -> ${JSON.stringify(readFile())}`
  )

  hr('2. Vaciar el nombre lo RESTABLECE (borra la clave, no guarda "")')

  await store.setCustomTitle('claude-code', ID, '')
  check('2a', store.getCustomTitle('claude-code', ID) === undefined, 'tras vaciar -> undefined')
  check('2b', !(`claude-code:${ID}` in (readFile() ?? {})), `la clave desaparece del JSON -> ${JSON.stringify(readFile())}`)

  await store.setCustomTitle('claude-code', ID, 'Otra vez')
  await store.setCustomTitle('claude-code', ID, null) // null también restablece
  check('2c', store.getCustomTitle('claude-code', ID) === undefined, 'null también restablece')

  hr('3. Recorte de espacios y tope de longitud')

  await store.setCustomTitle('claude-code', ID, '   con espacios   ')
  check('3a', store.getCustomTitle('claude-code', ID) === 'con espacios', `recorta -> "${store.getCustomTitle('claude-code', ID)}"`)

  await store.setCustomTitle('claude-code', ID, 'x'.repeat(500))
  check('3b', store.getCustomTitle('claude-code', ID)?.length === 120, `acota a 120 -> len=${store.getCustomTitle('claude-code', ID)?.length}`)

  // El tope cae en mitad de un emoji (par sustituto) y de una familia unida con ZWJ: el corte
  // va por caracteres visibles, así que ni queda medio emoji («�») ni se parte la familia.
  const familia = '👨‍👩‍👧'
  await store.setCustomTitle('claude-code', ID, 'a'.repeat(119) + '😀😀')
  const conEmoji = store.getCustomTitle('claude-code', ID) ?? ''
  await store.setCustomTitle('claude-code', ID, 'b'.repeat(119) + familia + 'cola')
  const conFamilia = store.getCustomTitle('claude-code', ID) ?? ''
  check(
    '3d',
    conEmoji === 'a'.repeat(119) + '😀' && conFamilia === 'b'.repeat(119) + familia,
    `emoji entero -> ${JSON.stringify(conEmoji.slice(-3))} · familia entera -> ${conFamilia.endsWith(familia)}`
  )

  // Solo espacios = vacío -> restablece, no guarda una cadena de espacios.
  await store.setCustomTitle('claude-code', ID, '     ')
  check('3c', store.getCustomTitle('claude-code', ID) === undefined, 'solo espacios equivale a vaciar')

  hr('4. Sobrevive a un reinicio de la app')

  await store.setCustomTitle('claude-code', ID, 'Nombre persistente')
  store = loadStore() // instancia nueva: mapa en memoria vacío, resiembra del disco
  check(
    '4a',
    store.getCustomTitle('claude-code', ID) === 'Nombre persistente',
    `tras "reiniciar" -> "${store.getCustomTitle('claude-code', ID)}"`
  )

  hr('5. Claves independientes por agente')

  await store.setCustomTitle('codex', ID, 'El mismo id, otro agente')
  check(
    '5a',
    store.getCustomTitle('claude-code', ID) === 'Nombre persistente' &&
      store.getCustomTitle('codex', ID) === 'El mismo id, otro agente',
    'el mismo sessionId en CC y Codex no colisiona'
  )
  await store.forgetCustomTitle('codex', ID)
  check(
    '5b',
    store.getCustomTitle('codex', ID) === undefined &&
      store.getCustomTitle('claude-code', ID) === 'Nombre persistente',
    'forget de un agente no toca al otro (lo que hace DELETE al borrar un transcript)'
  )

  hr('6. JSON corrupto: cae al .bak; sin respaldo, no lanza y arranca sin nombres')

  // Principal corrupto con un `.bak` bueno (lo que deja un corte a media escritura): se recupera.
  writeFileSync(`${titlesFile}.bak`, JSON.stringify({ [`claude-code:${ID}`]: 'del respaldo' }), 'utf-8')
  writeFileSync(titlesFile, '{ esto no es', 'utf-8')
  store = loadStore()
  check(
    '6r',
    store.getCustomTitle('claude-code', ID) === 'del respaldo',
    `principal corrupto -> lee el .bak ("${store.getCustomTitle('claude-code', ID)}")`
  )

  rmSync(`${titlesFile}.bak`, { force: true })
  writeFileSync(titlesFile, '{ esto no es json', 'utf-8')
  store = loadStore()
  let threw = false
  let value: string | undefined
  try {
    value = store.getCustomTitle('claude-code', ID)
  } catch {
    threw = true
  }
  check('6a', !threw && value === undefined, `archivo corrupto -> sin nombres, sin lanzar (threw=${threw})`)

  // Y sigue siendo escribible tras la corrupción (se reescribe entero).
  await store.setCustomTitle('claude-code', ID, 'recuperado')
  check('6b', readFile()?.[`claude-code:${ID}`] === 'recuperado', 'se puede volver a escribir tras la corrupción')

  // Valores no-string en el JSON se descartan sin contaminar el mapa.
  writeFileSync(titlesFile, JSON.stringify({ 'codex:abc': 42, 'codex:def': 'bueno' }), 'utf-8')
  store = loadStore()
  check(
    '6c',
    store.getCustomTitle('codex', 'abc') === undefined && store.getCustomTitle('codex', 'def') === 'bueno',
    'los valores que no son string se descartan; los buenos sobreviven'
  )

  hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
