#!/usr/bin/env node
// =============================================================================
// Prueba de `ofreceDescartar` (ofertaMenuArbol.ts): el menú del árbol ofrece descartar a UN archivo
// con cambios y nunca a uno en conflicto (también AA y DD), con las letras reales de
// `buildDecorations` (feature git).
// La regla anterior (`byPath.has`) lo ofrecía también en conflicto. Se corre con `node` a secas.
// =============================================================================

import { ofreceDescartar } from './ofertaMenuArbol.ts'
import { buildDecorations } from '../git/modelo/statusBadge.ts'
import type { WorkingChange } from '../../../../shared/git-ipc.ts'

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

const cambios: WorkingChange[] = [
  { path: 'mod.txt', indexStatus: '.', worktreeStatus: 'M' },
  { path: 'nuevo.txt', indexStatus: '.', worktreeStatus: '?' },
  { path: 'preparado.txt', indexStatus: 'A', worktreeStatus: '.' },
  { path: 'choque.txt', indexStatus: 'U', worktreeStatus: 'U' },
  { path: 'borrado-ellos.txt', indexStatus: 'U', worktreeStatus: 'D' },
  { path: 'ambos-anaden.txt', indexStatus: 'A', worktreeStatus: 'A' },
  { path: 'ambos-borran.txt', indexStatus: 'D', worktreeStatus: 'D' }
]
const dec = buildDecorations(cambios)
const letra = (p: string): string | undefined => dec.byPath.get(p)

hr('1) archivos con cambios, fuera de conflicto -> se ofrece')
for (const p of ['mod.txt', 'nuevo.txt', 'preparado.txt']) {
  check(`${p} (letra ${letra(p)})`, ofreceDescartar(letra(p), 1, false), String(ofreceDescartar(letra(p), 1, false)))
}

hr('2) en conflicto -> NO se ofrece (la regla anterior sí lo hacía)')
for (const p of ['choque.txt', 'borrado-ellos.txt', 'ambos-anaden.txt', 'ambos-borran.txt']) {
  check(
    `${p} (letra ${letra(p)}): no se ofrece, aunque tiene decoración`,
    !ofreceDescartar(letra(p), 1, false) && dec.byPath.has(p),
    `ofrece=${ofreceDescartar(letra(p), 1, false)} decorado=${dec.byPath.has(p)}`
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
