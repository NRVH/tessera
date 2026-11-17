#!/usr/bin/env node
// =============================================================================
// Prueba de `ofreceDescartar` (ofertaMenuArbol.ts): el menú del árbol ofrece descartar a UN archivo
// con cambios y nunca a uno en conflicto (también AA y DD), con las letras reales de
// `construirDecoraciones` (feature git).
// La regla anterior (`porRuta.has`) lo ofrecía también en conflicto. Se corre con `node` a secas.
// =============================================================================

import { ofreceDescartar } from './ofertaMenuArbol.ts'
import { construirDecoraciones } from '../git/modelo/insigniaEstado.ts'
import type { CambioWorktree } from '../../../../shared/git-ipc.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: Array<{ name: string; pass: boolean }> = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const cambios: CambioWorktree[] = [
  { ruta: 'mod.txt', estadoIndice: '.', estadoWorktree: 'M' },
  { ruta: 'nuevo.txt', estadoIndice: '.', estadoWorktree: '?' },
  { ruta: 'preparado.txt', estadoIndice: 'A', estadoWorktree: '.' },
  { ruta: 'choque.txt', estadoIndice: 'U', estadoWorktree: 'U' },
  { ruta: 'borrado-ellos.txt', estadoIndice: 'U', estadoWorktree: 'D' },
  { ruta: 'ambos-anaden.txt', estadoIndice: 'A', estadoWorktree: 'A' },
  { ruta: 'ambos-borran.txt', estadoIndice: 'D', estadoWorktree: 'D' }
]
const decoraciones = construirDecoraciones(cambios)
const letra = (p: string): string | undefined => decoraciones.porRuta.get(p)

hr('1) archivos con cambios, fuera de conflicto -> se ofrece')
for (const p of ['mod.txt', 'nuevo.txt', 'preparado.txt']) {
  check(`${p} (letra ${letra(p)})`, ofreceDescartar(letra(p), 1, false), String(ofreceDescartar(letra(p), 1, false)))
}

hr('2) en conflicto -> NO se ofrece (la regla anterior sí lo hacía)')
for (const p of ['choque.txt', 'borrado-ellos.txt', 'ambos-anaden.txt', 'ambos-borran.txt']) {
  check(
    `${p} (letra ${letra(p)}): no se ofrece, aunque tiene decoración`,
    !ofreceDescartar(letra(p), 1, false) && decoraciones.porRuta.has(p),
    `ofrece=${ofreceDescartar(letra(p), 1, false)} decorado=${decoraciones.porRuta.has(p)}`
  )
}

hr('3) sin cambios, carpeta o varios elementos -> NO se ofrece')
check('archivo sin decoración', !ofreceDescartar(letra('limpio.txt'), 1, false), 'sin letra')
check('una carpeta', !ofreceDescartar('M', 1, true), 'esCarpeta')
check('dos elementos', !ofreceDescartar('M', 2, false), 'elementos=2')
check('fila sin selección (0) con cambios sí', ofreceDescartar('M', 0, false), 'elementos=0')

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
