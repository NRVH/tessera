#!/usr/bin/env node
// =============================================================================
// Prueba de computeProfileDotStates (node src/renderer/src/features/pestanas/test-profile-dot-state.mts).
// Pura (sin React), corre bajo node. Cubre la prioridad de señales del punto de cada
// perfil y de cada proyecto: hibernating, hibernated (el modelo manda), waking, active.
// =============================================================================

import { computeProfileDotStates, computeProjectDotStates } from './profileDotState.ts'
import { agentTargetKey, type OpenAgentTarget } from './tabsModel.ts'
import type { AgentPaneStatus } from '../agentes/agentPaneTipos.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

function target(profileId: string, path: string): OpenAgentTarget {
  return {
    profileId,
    projectHostPath: path,
    agente: 'claude-code',
    key: agentTargetKey(profileId, path, 'claude-code')
  }
}

// Perfiles: alfa, beta, gamma, idle. Targets: alfa tiene 2 proyectos, beta 1, gamma 1.
const profileIds = ['alfa', 'beta', 'gamma', 'idle']
const tAlfa1 = target('alfa', 'C:\\alfa\\1')
const tAlfa2 = target('alfa', 'C:\\alfa\\2')
const tBeta = target('beta', 'C:\\beta\\1')
const tGamma = target('gamma', 'C:\\gamma\\1')
const targets = [tAlfa1, tAlfa2, tBeta, tGamma]

const agentStatus: Record<string, AgentPaneStatus> = {
  [tAlfa1.key]: 'live', // alfa tiene una sesión viva
  [tBeta.key]: 'booting', // beta arrancando
  [tGamma.key]: 'exited' // gamma su sesión murió
}

const out = computeProfileDotStates({
  profileIds,
  hibernatingProfiles: new Set(['alfa']), // alfa con hibernación EN VUELO (gana sobre 'live')
  hibernatedProfiles: new Set(['gamma']), // gamma hibernado según el modelo
  targets,
  agentStatus
})

check(
  "(1) alfa: hibernación en vuelo GANA aunque tenga sesión 'live' -> 'hibernating'",
  out.alfa === 'hibernating',
  `alfa=${out.alfa}`
)
// live gana a hibernated? NO: el modelo manda. Pero este 'alfa' está hibernating, así
// que (1) ya lo cubre; el caso live-vs-hibernated puro está en (5) abajo.
check("(2) beta: sesión 'booting' -> 'waking' (spinner de despertar)", out.beta === 'waking', `beta=${out.beta}`)
check(
  "(3) gamma: modelo hibernado + sesión 'exited' (no viva) -> 'hibernated' (gris)",
  out.gamma === 'hibernated',
  `gamma=${out.gamma}`
)
check("(4) idle: sin sesión, sin marcar -> 'active' (color; perezoso, no hibernado)", out.idle === 'active', `idle=${out.idle}`)

// (5) EL BUG REPORTADO: un perfil hibernado en el MODELO cuyo panel del keep-alive
// aún reporta un 'live' STALE debe pintarse GRIS (hibernated), no color. El modelo
// manda sobre el live stale.
const out2 = computeProfileDotStates({
  profileIds: ['x'],
  hibernatingProfiles: new Set(),
  hibernatedProfiles: new Set(['x']),
  targets: [target('x', 'C:\\x\\1')],
  agentStatus: { [agentTargetKey('x', 'C:\\x\\1', 'claude-code')]: 'live' } // stale
})
check(
  "(5) modelo hibernado GANA a un 'live' stale -> 'hibernated' (gris) [bug reportado]",
  out2.x === 'hibernated',
  `x=${out2.x}`
)

// (6) despertar: al entrar, el reducer ya sacó al perfil de hibernated (modelo), y
// el agente está 'booting' -> spinner 'waking' (no gris). Prueba que el flip previo
// permite el spinner de despertar.
const out3 = computeProfileDotStates({
  profileIds: ['y'],
  hibernatingProfiles: new Set(),
  hibernatedProfiles: new Set(), // el flip al entrar ya lo quitó
  targets: [target('y', 'C:\\y\\1')],
  agentStatus: { [agentTargetKey('y', 'C:\\y\\1', 'claude-code')]: 'booting' }
})
check("(6) tras el flip al entrar, 'booting' -> 'waking' (spinner de despertar)", out3.y === 'waking', `y=${out3.y}`)

// ---------------------------------------------------------------------------
// computeProjectDotStates: dot por PROYECTO (verde vivo / gris hibernado / spinner)
// ---------------------------------------------------------------------------
{
  const projects = [
    { projectHostPath: 'C:\\p\\viva', estado: 'active' as const },
    { projectHostPath: 'C:\\p\\arranca', estado: 'active' as const },
    { projectHostPath: 'C:\\p\\hib', estado: 'hibernated' as const },
    { projectHostPath: 'C:\\p\\idle', estado: 'active' as const }
  ]
  const out = computeProjectDotStates({
    projects,
    agentStatusByProject: {
      'C:\\p\\viva': 'live',
      'C:\\p\\arranca': 'booting',
      'C:\\p\\hib': 'live' // stale: el modelo (hibernated) debe ganar
    }
  })
  check("(P1) proyecto activo con sesión 'live' -> 'active' (verde)", out['C:\\p\\viva'] === 'active', `viva=${out['C:\\p\\viva']}`)
  check("(P2) proyecto activo 'booting' -> 'waking' (spinner)", out['C:\\p\\arranca'] === 'waking', `arranca=${out['C:\\p\\arranca']}`)
  check(
    "(P3) proyecto hibernado (perfil hibernado) + 'live' stale -> 'hibernated' (gris; el modelo gana)",
    out['C:\\p\\hib'] === 'hibernated',
    `hib=${out['C:\\p\\hib']}`
  )
  check("(P5) proyecto activo sin sesión (perezoso) -> 'active' (verde)", out['C:\\p\\idle'] === 'active', `idle=${out['C:\\p\\idle']}`)

  // El agente cerrado por inactividad: gris en SU pestaña; el punto del perfil no cambia,
  // porque `hibernatedProfiles` solo cuenta los proyectos 'hibernated'.
  const dormido = computeProjectDotStates({
    projects: [{ projectHostPath: 'C:\\p\\dormido', estado: 'agente-hibernado' as const }],
    agentStatusByProject: { 'C:\\p\\dormido': 'live' }
  })
  check(
    "(P6) agente hibernado por inactividad + 'live' stale -> 'hibernated' (gris)",
    dormido['C:\\p\\dormido'] === 'hibernated',
    `dormido=${dormido['C:\\p\\dormido']}`
  )
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(60))
console.log(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
