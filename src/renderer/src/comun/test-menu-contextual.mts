#!/usr/bin/env node
// =============================================================================
// Prueba del modelo puro del menú contextual (node src/renderer/src/comun/test-menu-contextual.mts):
// `normalizarEntradas` poda separadores huérfanos o pegados cuando un grupo sale vacío, y
// `indicesEnfocables` (flechas del teclado) se salta separadores y opciones deshabilitadas.
// Comprueba la colocación al cursor o encima de un punto, los submenús y la trayectoria del puntero hacia ellos.
// Sin React ni DOM: el modelo opera sobre entradas y medidas.
// =============================================================================

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { SEP, normalizarEntradas, indicesEnfocables, posicionMenu, posicionSubmenu, seDirigeAlPanel } = await import(
  pathToFileURL(path.join(here, 'menuContextualModelo.ts')).href
)

let passed = 0
let failed = 0
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

const noop = (): void => {}
const elemento = (etiqueta: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  label: etiqueta,
  onClick: noop,
  ...extra
})

/** Forma legible de un menú normalizado: "a | b" con "|" por separador. */
function forma(entradas: unknown[]): string {
  return entradas
    .map((e) => ('separator' in (e as object) ? '|' : (e as { label: string }).label))
    .join(' ')
}

console.log('\n=== normalizarEntradas: poda de separadores')

check(
  '1',
  forma(normalizarEntradas([SEP, elemento('a'), elemento('b')])) === 'a b',
  `separador INICIAL se quita -> "${forma(normalizarEntradas([SEP, elemento('a'), elemento('b')]))}"`
)
check(
  '2',
  forma(normalizarEntradas([elemento('a'), elemento('b'), SEP])) === 'a b',
  `separador FINAL se quita -> "${forma(normalizarEntradas([elemento('a'), elemento('b'), SEP]))}"`
)
check(
  '3',
  forma(normalizarEntradas([elemento('a'), SEP, SEP, SEP, elemento('b')])) === 'a | b',
  `separadores CONSECUTIVOS colapsan -> "${forma(normalizarEntradas([elemento('a'), SEP, SEP, SEP, elemento('b')]))}"`
)
check(
  '4',
  forma(normalizarEntradas([SEP, SEP])) === '',
  'un menú de solo separadores queda vacío'
)
check('5', forma(normalizarEntradas([])) === '', 'menú vacío -> vacío (no lanza)')
check(
  '6',
  forma(normalizarEntradas([elemento('a'), SEP, elemento('b')])) === 'a | b',
  'un menú ya correcto no se toca'
)

// El caso REAL que motiva la poda: el explorador arma
//   [abrir] SEP [renombrar] SEP [descartar?] [eliminar]
// y "descartar" solo existe si el archivo tiene cambios. Sin poda, un archivo
// LIMPIO dejaría "renombrar | | eliminar".
console.log('\n=== el caso real del explorador (grupo condicional vacío)')
const menuArchivoLimpio = normalizarEntradas([
  elemento('Abrir en el explorador'),
  elemento('Historial del archivo'),
  SEP,
  elemento('Renombrar…'),
  SEP,
  // (sin "Descartar cambios…": el archivo no tiene cambios)
  elemento('Eliminar archivo…', { danger: true })
])
check(
  '7',
  forma(menuArchivoLimpio) ===
    'Abrir en el explorador Historial del archivo | Renombrar… | Eliminar archivo…',
  `archivo sin cambios -> sin separador huérfano: "${forma(menuArchivoLimpio)}"`
)
check(
  '8',
  (menuArchivoLimpio[menuArchivoLimpio.length - 1] as { danger?: boolean }).danger === true,
  'la última opción es la destructiva (Eliminar), marcada en rojo'
)

// Y el de git: "Stage" existe siempre, "Descartar" no. Sin poda quedaría "Stage |".
const menuGitSinDescartar = normalizarEntradas([elemento('Stage'), SEP])
check('9', forma(menuGitSinDescartar) === 'Stage', `git sin descartar -> "${forma(menuGitSinDescartar)}"`)

console.log('\n=== indicesEnfocables: qué recorre el teclado')

const conCabeceras = [
  elemento('Global (compartidas)', { disabled: true }), // 0 cabecera
  elemento('cuenta A'), // 1
  SEP, // 2
  elemento('Privada', { disabled: true }), // 3 cabecera
  elemento('cuenta B'), // 4
  SEP, // 5
  elemento('Eliminar…', { danger: true }) // 6
]
const idx = indicesEnfocables(conCabeceras)
check(
  '10',
  JSON.stringify(idx) === JSON.stringify([1, 4, 6]),
  `salta separadores y cabeceras deshabilitadas -> ${JSON.stringify(idx)}`
)
check(
  '11',
  JSON.stringify(indicesEnfocables([SEP, SEP])) === '[]',
  'sin ítems enfocables -> [] (el menú se enfoca a sí mismo, Esc sigue cerrando)'
)

console.log('\n=== Submenús: dónde se abren y cuándo no se cierran')

const V = { width: 1000, height: 600 }
const P = { width: 200, height: 100 }
const derecha = posicionSubmenu({ left: 100, top: 50, width: 300, height: 28 }, P, V)
check('12', derecha.left === 402 && derecha.top === 44, `a la derecha de su fila -> ${JSON.stringify(derecha)}`)
const izquierda = posicionSubmenu({ left: 700, top: 50, width: 280, height: 28 }, P, V)
check('13', izquierda.left === 498, `sin sitio a la derecha, a la izquierda -> ${JSON.stringify(izquierda)}`)
const abajo = posicionSubmenu({ left: 100, top: 580, width: 300, height: 28 }, P, V)
check('14', abajo.top === 492, `dentro de la ventana por abajo -> ${JSON.stringify(abajo)}`)
const panel = { left: 400, top: 100, width: 200, height: 100 }
check('15', seDirigeAlPanel({ x: 300, y: 80 }, { x: 330, y: 100 }, panel), 'en diagonal hacia el panel: lo mantiene')
check('16', !seDirigeAlPanel({ x: 300, y: 80 }, { x: 280, y: 110 }, panel), 'alejándose: no')
check('17', !seDirigeAlPanel({ x: 300, y: 120 }, { x: 300, y: 300 }, panel), 'en vertical por el menú: no')

console.log('\n=== Menú: anclaje encima y compatibilidad con el cursor')
const encima = posicionMenu({ x: 100, y: 500 }, P, V, 'encima')
check('18', encima.left === 100 && encima.top === 400, 'si cabe, apoya su esquina inferior izquierda sobre el punto')
const sinSitioArriba = posicionMenu({ x: 100, y: 50 }, P, V, 'encima')
check('19', sinSitioArriba.top === 8, 'si no cabe por arriba, respeta el margen superior')
const sinSitioDerecha = posicionMenu({ x: 950, y: 500 }, P, V, 'encima')
check('20', sinSitioDerecha.left === 792 && sinSitioDerecha.top === 400, 'si no cabe por la derecha, se desplaza sin bajar')
const cursor = posicionMenu({ x: 100, y: 50 }, P, V)
check('21', cursor.left === 100 && cursor.top === 50, 'por defecto sigue abriendo en el cursor')
const cursorEnBorde = posicionMenu({ x: 950, y: 580 }, P, V)
check('22', cursorEnBorde.left === 792 && cursorEnBorde.top === 492, 'el cursor conserva el ajuste por los bordes derecho e inferior')

console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
console.log('='.repeat(78))
assert.equal(failed, 0)
