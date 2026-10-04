#!/usr/bin/env node
// =============================================================================
// Prueba del store del editor (node src/renderer/src/features/editor/test-store-editor.mts).
// Fija que las pestañas por target viven en el store con el modelo puro de `editorTabsModel`, que
// lo que no cambia nada devuelve el MISMO mapa sin avisar, y los ayudantes `conMarca` y `subirTokens`.
// =============================================================================

import { closeTab, openTab, type EditorTabsState } from './editorTabsModel.ts'
import { actualizarPestanas, actualizarTarget, conMarca, subirTokens, useStoreEditor } from './store.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

let avisos = 0
useStoreEditor.subscribe(() => {
  avisos++
})
const abrir = (target: string, path: string): void =>
  actualizarPestanas((m) => actualizarTarget(m, target, (s) => openTab(s, { kind: 'file', file: { path, name: path } })))
const del = (target: string): EditorTabsState | undefined => useStoreEditor.getState().pestanasPorTarget.get(target)

hr('(1) Pestañas por target en el store')
{
  abrir('alfa|C:\\a', 'src/uno.ts')
  abrir('alfa|C:\\a', 'src/dos.ts')
  abrir('beta|C:\\b', 'LEEME.md')
  check('target A: dos pestañas, la última activa', del('alfa|C:\\a')?.tabs.length === 2 && del('alfa|C:\\a')?.activeId === 'src/dos.ts', JSON.stringify(del('alfa|C:\\a')?.activeId))
  check('target B: la suya, sin mezclar', del('beta|C:\\b')?.tabs.map((t) => t.id).join() === 'LEEME.md', del('beta|C:\\b')?.tabs.map((t) => t.id).join() ?? '—')
  actualizarPestanas((m) => actualizarTarget(m, 'alfa|C:\\a', (s) => closeTab(s, 'src/dos.ts')))
  check('cerrar hereda la vecina', del('alfa|C:\\a')?.activeId === 'src/uno.ts', JSON.stringify(del('alfa|C:\\a')?.activeId))
}

hr('(2) Lo que no cambia nada: mismo mapa y sin aviso')
{
  const antes = useStoreEditor.getState().pestanasPorTarget
  const n = avisos
  actualizarPestanas((m) => actualizarTarget(m, 'alfa|C:\\a', (s) => closeTab(s, 'no-existe')))
  check('cerrar una pestaña inexistente: mismo mapa', useStoreEditor.getState().pestanasPorTarget === antes, 'identidad')
  check('cerrar una pestaña inexistente: sin aviso', avisos === n, `avisos ${n} -> ${avisos}`)
}

hr('(3) Ayudantes conMarca y subirTokens')
{
  const vacio = new Set<string>()
  check('conMarca sin cambio devuelve el mismo conjunto', conMarca(vacio, 'x', false) === vacio, 'identidad')
  check('conMarca marca y desmarca', conMarca(conMarca(vacio, 'x', true), 'x', false).size === 0, 'vacío')
  const t = subirTokens(subirTokens(new Map(), ['a']), ['a', 'b'])
  check('subirTokens cuenta por clave', t.get('a') === 2 && t.get('b') === 1, JSON.stringify([...t]))
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
