#!/usr/bin/env node
// =============================================================================
// Prueba de enOrdenEstable (node src/renderer/src/util/test-orden-estable.mts): el orden
// del DOM de los panes vivos no depende del orden de las pestañas. Fija la propiedad que
// importa: reordenar, añadir o quitar no cambia el orden relativo de los que se quedan.
// Decisiones: docs/decisiones/renderer/reordenar-proyectos-arrastrando.md
// =============================================================================

import { enOrdenEstable } from './ordenEstable.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

interface Pane {
  key: string
}
const pane = (key: string): Pane => ({ key })
const claves = (l: readonly Pane[]): string => l.map((p) => p.key).join(' ')
const orden = (l: readonly Pane[]): Pane[] => enOrdenEstable(l, (p) => p.key)

const a = pane('alfa|C:\\p\\alfa|claude-code')
const b = pane('alfa|C:\\p\\beta|claude-code')
const c = pane('alfa|C:\\p\\gamma|claude-code')
const d = pane('beta|C:\\p\\delta|claude-code')

const base = orden([a, b, c, d])
check('(1) cualquier orden de entrada da el mismo resultado', [[c, a, b, d], [d, c, b, a], [b, d, a, c]].every((l) => claves(orden(l)) === claves(base)), claves(base))
check('(2) devuelve los MISMOS objetos, no copias', base.every((p) => [a, b, c, d].includes(p)), 'identidad')
const entrada = [c, a, b]
orden(entrada)
check('(3) no muta la lista de entrada', claves(entrada) === claves([c, a, b]), claves(entrada))

const sinB = orden([c, a, d])
check('(4) quitar uno no cambia el orden relativo de los demás', claves(sinB) === claves(base.filter((p) => p !== b)), claves(sinB))
const nuevo = pane('alfa|C:\\p\\beta-2|claude-code')
const conNuevo = orden([d, nuevo, c, b, a])
check('(5) añadir uno no cambia el orden relativo de los que estaban', claves(conNuevo.filter((p) => p !== nuevo)) === claves(base), claves(conNuevo))

const mayus = orden([pane('b'), pane('B'), pane('a'), pane('A')])
check('(6) compara por código de carácter, sin configuración regional', claves(mayus) === 'A B a b', claves(mayus))
const iguales = orden([pane('x'), pane('x')])
check('(7) claves iguales no lanzan ni se pierden', iguales.length === 2, `n=${iguales.length}`)
check('(8) lista vacía', orden([]).length === 0, '[]')

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
