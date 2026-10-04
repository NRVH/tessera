#!/usr/bin/env node
// =============================================================================
// Prueba del store de agentes (node src/renderer/src/features/agentes/test-store-agentes.mts).
// Fija que una acción que no cambia nada NO avisa a nadie ni cambia el estado: cada pane
// reporta su estado al montarse y al cambiar, y un aviso de más repinta la ventana.
// Decisiones: docs/decisiones/agentes/pane-del-agente-sin-re-render.md
// =============================================================================

import { handleTargetStatus, handleTargetVivo, selectAccount, selectAgent, useStoreAgentes } from './store.ts'

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
useStoreAgentes.subscribe(() => {
  avisos++
})

/** Ejecuta la acción dos veces: la primera cambia (un aviso), la segunda no (ninguno). */
function unaVezAvisa(nombre: string, accion: () => void): void {
  const n = avisos
  accion()
  check(`${nombre}: el cambio avisa una vez`, avisos === n + 1, `avisos ${n} -> ${avisos}`)
  const estado = useStoreAgentes.getState()
  accion()
  check(
    `${nombre}: repetido no avisa y conserva el estado`,
    avisos === n + 1 && useStoreAgentes.getState() === estado,
    `avisos ${n + 1} -> ${avisos}`
  )
}

hr('(1) Cada acción avisa solo cuando cambia algo')
{
  const key = 'alfa|C:\\p\\alfa|claude-code'
  unaVezAvisa('handleTargetStatus', () => handleTargetStatus(key, 'live'))
  unaVezAvisa('handleTargetVivo(true)', () => handleTargetVivo(key, true))
  unaVezAvisa('selectAgent', () => selectAgent('alfa', 'codex'))
  unaVezAvisa('selectAccount', () => selectAccount(key, 'cuenta-1'))
  unaVezAvisa('handleTargetVivo(false)', () => handleTargetVivo(key, false))
}

hr('(2) Lo que queda en el estado')
{
  const s = useStoreAgentes.getState()
  const key = 'alfa|C:\\p\\alfa|claude-code'
  check('estado de sesión anotado', s.agentStatus[key] === 'live', String(s.agentStatus[key]))
  check('agente elegido del perfil', s.selectedAgentByProfile.alfa === 'codex', String(s.selectedAgentByProfile.alfa))
  check('cuenta del target', s.accountByTarget[key] === 'cuenta-1', String(s.accountByTarget[key]))
  check('ya no está vivo', !s.vivos.has(key), `vivos=${s.vivos.size}`)
  const n = avisos
  handleTargetVivo('nunca-vivo', false)
  check('apagar uno que no estaba vivo no avisa', avisos === n, `avisos ${n} -> ${avisos}`)
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
