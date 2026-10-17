#!/usr/bin/env node
// =============================================================================
// Prueba de expansionRepos (node src/renderer/src/features/git/modelo/test-expansion-repos.mts):
// qué secciones de repo de la vista Cambios se ven abiertas, que lo tocado a mano manda sobre lo de
// por defecto y que plegar o desplegar todos solo toca los repos del proyecto.
// =============================================================================

import { conRepoAbierto, plegarRepos, repoAbierto, reposPorDefecto, type ExpansionRepos } from './expansionRepos.ts'

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

const A = 'C:\\p\\uno\\a'
const B = 'C:\\p\\uno\\b'
const OTRO = 'C:\\p\\dos\\c'

hr('(1) Por defecto: abierto solo el repo con cambios')
{
  check('con cambios: abierto', repoAbierto({}, A, true), 'true')
  check('sin cambios: cerrado', !repoAbierto({}, A, false), 'false')
}

hr('(2) Lo tocado a mano manda y sobrevive')
{
  const cerrado = conRepoAbierto({}, A, false)
  check('cerrado a mano con cambios: cerrado', !repoAbierto(cerrado, A, true), JSON.stringify(cerrado))
  const abierto = conRepoAbierto({}, B, true)
  check('abierto a mano sin cambios: abierto', repoAbierto(abierto, B, false), JSON.stringify(abierto))
  check('fijar lo que ya estaba devuelve el MISMO mapa', conRepoAbierto(cerrado, A, false) === cerrado, 'misma identidad')
}

hr('(3) Plegar y desplegar todos: solo los repos del proyecto')
{
  const inicial: ExpansionRepos = { [OTRO]: true }
  const plegado = plegarRepos(inicial, [A, B])
  check('plegar cierra los del proyecto', !repoAbierto(plegado, A, true) && !repoAbierto(plegado, B, true), JSON.stringify(plegado))
  check('plegar no toca los de otro proyecto', plegado[OTRO] === true, String(plegado[OTRO]))
  const desplegado = reposPorDefecto(plegado, [A, B])
  check('desplegar vuelve a lo de por defecto', repoAbierto(desplegado, A, true) && !repoAbierto(desplegado, B, false), JSON.stringify(desplegado))
  check('desplegar no toca los de otro proyecto', desplegado[OTRO] === true, String(desplegado[OTRO]))
  check('desplegar sin nada tocado devuelve el MISMO mapa', reposPorDefecto(inicial, [A, B]) === inicial, 'misma identidad')
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
