#!/usr/bin/env node
// =============================================================================
// Prueba del modelo puro del menú contextual (node src/renderer/src/comun/test-context-menu.mts):
// `normalizeEntries` poda separadores huérfanos o pegados cuando un grupo sale vacío, y
// `focusableIndices` (flechas del teclado) se salta separadores y opciones deshabilitadas.
// Sin React ni DOM: el modelo es una función pura sobre arrays.
// =============================================================================

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { SEP, normalizeEntries, focusableIndices } = await import(
  pathToFileURL(path.join(here, 'contextMenuModel.ts')).href
)

let passed = 0
let failed = 0
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

const noop = (): void => {}
const item = (label: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  label,
  onClick: noop,
  ...extra
})

/** Forma legible de un menú normalizado: "a | b" con "|" por separador. */
function shape(entries: unknown[]): string {
  return entries
    .map((e) => ('separator' in (e as object) ? '|' : (e as { label: string }).label))
    .join(' ')
}

console.log('\n=== normalizeEntries: poda de separadores')

check(
  '1',
  shape(normalizeEntries([SEP, item('a'), item('b')])) === 'a b',
  `separador INICIAL se quita -> "${shape(normalizeEntries([SEP, item('a'), item('b')]))}"`
)
check(
  '2',
  shape(normalizeEntries([item('a'), item('b'), SEP])) === 'a b',
  `separador FINAL se quita -> "${shape(normalizeEntries([item('a'), item('b'), SEP]))}"`
)
check(
  '3',
  shape(normalizeEntries([item('a'), SEP, SEP, SEP, item('b')])) === 'a | b',
  `separadores CONSECUTIVOS colapsan -> "${shape(normalizeEntries([item('a'), SEP, SEP, SEP, item('b')]))}"`
)
check(
  '4',
  shape(normalizeEntries([SEP, SEP])) === '',
  'un menú de solo separadores queda vacío'
)
check('5', shape(normalizeEntries([])) === '', 'menú vacío -> vacío (no lanza)')
check(
  '6',
  shape(normalizeEntries([item('a'), SEP, item('b')])) === 'a | b',
  'un menú ya correcto no se toca'
)

// El caso REAL que motiva la poda: el explorador arma
//   [abrir] SEP [renombrar] SEP [descartar?] [eliminar]
// y "descartar" solo existe si el archivo tiene cambios. Sin poda, un archivo
// LIMPIO dejaría "renombrar | | eliminar".
console.log('\n=== el caso real del explorador (grupo condicional vacío)')
const menuArchivoLimpio = normalizeEntries([
  item('Abrir en el explorador'),
  item('Historial del archivo'),
  SEP,
  item('Renombrar…'),
  SEP,
  // (sin "Descartar cambios…": el archivo no tiene cambios)
  item('Eliminar archivo…', { danger: true })
])
check(
  '7',
  shape(menuArchivoLimpio) ===
    'Abrir en el explorador Historial del archivo | Renombrar… | Eliminar archivo…',
  `archivo sin cambios -> sin separador huérfano: "${shape(menuArchivoLimpio)}"`
)
check(
  '8',
  (menuArchivoLimpio[menuArchivoLimpio.length - 1] as { danger?: boolean }).danger === true,
  'la última opción es la destructiva (Eliminar), marcada en rojo'
)

// Y el de git: "Stage" existe siempre, "Descartar" no. Sin poda quedaría "Stage |".
const menuGitSinDescartar = normalizeEntries([item('Stage'), SEP])
check('9', shape(menuGitSinDescartar) === 'Stage', `git sin descartar -> "${shape(menuGitSinDescartar)}"`)

console.log('\n=== focusableIndices: qué recorre el teclado')

const conCabeceras = [
  item('Global (compartidas)', { disabled: true }), // 0 cabecera
  item('cuenta A'), // 1
  SEP, // 2
  item('Privada', { disabled: true }), // 3 cabecera
  item('cuenta B'), // 4
  SEP, // 5
  item('Eliminar…', { danger: true }) // 6
]
const idx = focusableIndices(conCabeceras)
check(
  '10',
  JSON.stringify(idx) === JSON.stringify([1, 4, 6]),
  `salta separadores y cabeceras deshabilitadas -> ${JSON.stringify(idx)}`
)
check(
  '11',
  JSON.stringify(focusableIndices([SEP, SEP])) === '[]',
  'sin ítems enfocables -> [] (el menú se enfoca a sí mismo, Esc sigue cerrando)'
)

console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
console.log('='.repeat(78))
assert.equal(failed, 0)
