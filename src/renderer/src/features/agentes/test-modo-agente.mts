// =============================================================================
// Prueba del modo por agente (npm run test:modo-agente): un agente de serie corre nativo salvo que
// elija Docker; los manuales, donde se definieron; el de la terminal, siempre nativo; y al llegar desde
// el modo por proyecto, los agentes con cuenta de un proyecto en Docker siguen en Docker.
// Decisiones: docs/decisiones/agentes/modo-por-agente.md
// =============================================================================

import { agenteNativo, puedeElegirModo } from './modoAgente.ts'
import { modosDesdeModoDeProyecto, normalizeWorkspaceState } from '../../../../shared/workspace-state-ipc.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

hr('(1) quién puede elegir')
check('los de serie de un proyecto y del espacio de datos, sí', puedeElegirModo('proyecto', 'claude-code') && puedeElegirModo('datos', 'codex'), 'ok')
check('NEGATIVO: un manual no (vive donde se definió)', !puedeElegirModo('proyecto', 'm-mio'), 'ok')
check('NEGATIVO: ni el agente de la terminal', !puedeElegirModo('terminal', 'claude-code'), 'ok')

hr('(2) el modo efectivo')
check('sin elección, nativo', agenteNativo({ lugar: 'proyecto', agente: 'codex', elegido: undefined }), 'ok')
check('con Docker elegido, Docker; con nativo, nativo', !agenteNativo({ lugar: 'proyecto', agente: 'codex', elegido: 'docker' }) && agenteNativo({ lugar: 'datos', agente: 'codex', elegido: 'nativo' }), 'ok')
check('un manual, donde se definió, ignorando una elección', agenteNativo({ lugar: 'proyecto', agente: 'm-a', elegido: 'docker', manualNativo: true }) && !agenteNativo({ lugar: 'proyecto', agente: 'm-b', elegido: 'nativo', manualNativo: false }), 'ok')
check('NEGATIVO: el de la terminal no pasa a Docker aunque haya una elección', agenteNativo({ lugar: 'terminal', agente: 'codex', elegido: 'docker' }), 'ok')

hr('(3) al llegar desde el modo por proyecto')
const modos = modosDesdeModoDeProyecto(
  {
    'p1|C:/docker|codex': 'cuenta-1',
    'p1|C:/docker|claude-code': null,
    'p1|C:/nativo|codex': 'cuenta-2',
    'p1|C:/docker|m-mio': 'manual',
    'p2|C:/a|b|codex': 'cuenta-3'
  },
  ['p1|C:/nativo']
)
check(
  'los agentes con cuenta de un proyecto en Docker siguen en Docker; sin cuenta, de un proyecto nativo o manuales, no se apuntan',
  JSON.stringify(modos) === JSON.stringify({ 'p1|C:/docker|codex': 'docker', 'p2|C:/a|b|codex': 'docker' }),
  JSON.stringify(modos)
)
const abiertos = modosDesdeModoDeProyecto({}, ['p|C:/n'], ['p|C:/d', 'p|C:/n'])
check(
  'los agentes de serie de un proyecto abierto que estaba en Docker siguen en Docker aunque nunca eligieran cuenta; los del nativo, no',
  JSON.stringify(abiertos) === JSON.stringify({ 'p|C:/d|claude-code': 'docker', 'p|C:/d|codex': 'docker' }),
  JSON.stringify(abiertos)
)
const viejo = normalizeWorkspaceState({
  byProfile: { p: { openProjects: [{ projectHostPath: 'C:/d', name: 'd' }], activePath: 'C:/d' } },
  settings: { agentAccountByTarget: { 'p|C:/d|codex': 'c1' }, windowsModeProjects: ['p|C:/n'] }
})
const nuevo = normalizeWorkspaceState({ settings: { agentAccountByTarget: { 'p|C:/d|codex': 'c1' }, windowsModeProjects: [], agentModeByTarget: {} } })
check(
  'al leer un archivo viejo (sin modo por agente) se migra; uno nuevo, aunque arrastre la lista vieja, se respeta',
  viejo?.settings?.agentModeByTarget['p|C:/d|codex'] === 'docker' &&
    viejo?.settings?.agentModeByTarget['p|C:/d|claude-code'] === 'docker' &&
    Object.keys(nuevo?.settings?.agentModeByTarget ?? { x: 1 }).length === 0,
  JSON.stringify({ viejo: viejo?.settings?.agentModeByTarget, nuevo: nuevo?.settings?.agentModeByTarget })
)

hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === results.length ? 0 : 1)
