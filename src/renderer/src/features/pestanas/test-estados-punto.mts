#!/usr/bin/env node
// =============================================================================
// Prueba de calcularEstadosPuntoPerfil (node src/renderer/src/features/pestanas/test-estados-punto.mts).
// Pura (sin React), corre bajo node. Cubre la prioridad de señales del punto de cada
// perfil y de cada proyecto: hibernating, hibernated (el modelo manda), waking, active.
// =============================================================================

import { calcularEstadosPuntoPerfil, calcularEstadosPuntoProyecto } from './estadosPunto.ts'
import { claveDestinoAgente, type DestinoAgenteAbierto } from './modeloPestanas.ts'
import type { EstadoPaneAgente } from '../agentes/tiposPaneAgente.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

function destino(perfilId: string, ruta: string): DestinoAgenteAbierto {
  return {
    profileId: perfilId,
    projectHostPath: ruta,
    agente: 'claude-code',
    key: claveDestinoAgente(perfilId, ruta, 'claude-code')
  }
}

// Perfiles: alfa, beta, gamma, idle. Targets: alfa tiene 2 proyectos, beta 1, gamma 1.
const perfilIds = ['alfa', 'beta', 'gamma', 'idle']
const tAlfa1 = destino('alfa', 'C:\\alfa\\1')
const tAlfa2 = destino('alfa', 'C:\\alfa\\2')
const tBeta = destino('beta', 'C:\\beta\\1')
const tGamma = destino('gamma', 'C:\\gamma\\1')
const destinos = [tAlfa1, tAlfa2, tBeta, tGamma]

const estadoAgente: Record<string, EstadoPaneAgente> = {
  [tAlfa1.key]: 'live', // alfa tiene una sesión viva
  [tBeta.key]: 'booting', // beta arrancando
  [tGamma.key]: 'exited' // gamma su sesión murió
}

const salida = calcularEstadosPuntoPerfil({
  perfilIds,
  perfilIdsHibernando: new Set(['alfa']), // alfa con hibernación EN VUELO (gana sobre 'live')
  perfilIdsHibernados: new Set(['gamma']), // gamma hibernado según el modelo
  destinos,
  estadoAgente
})

check(
  "(1) alfa: hibernación en vuelo GANA aunque tenga sesión 'live' -> 'hibernating'",
  salida.alfa === 'hibernating',
  `alfa=${salida.alfa}`
)
// live gana a hibernated? NO: el modelo manda. Pero este 'alfa' está hibernating, así
// que (1) ya lo cubre; el caso live-vs-hibernated puro está en (5) abajo.
check("(2) beta: sesión 'booting' -> 'waking' (spinner de despertar)", salida.beta === 'waking', `beta=${salida.beta}`)
check(
  "(3) gamma: modelo hibernado + sesión 'exited' (no viva) -> 'hibernated' (gris)",
  salida.gamma === 'hibernated',
  `gamma=${salida.gamma}`
)
check("(4) idle: sin sesión, sin marcar -> 'active' (color; perezoso, no hibernado)", salida.idle === 'active', `idle=${salida.idle}`)

// (5) EL BUG REPORTADO: un perfil hibernado en el MODELO cuyo panel del keep-alive
// aún reporta un 'live' STALE debe pintarse GRIS (hibernated), no color. El modelo
// manda sobre el live stale.
const salida2 = calcularEstadosPuntoPerfil({
  perfilIds: ['x'],
  perfilIdsHibernando: new Set(),
  perfilIdsHibernados: new Set(['x']),
  destinos: [destino('x', 'C:\\x\\1')],
  estadoAgente: { [claveDestinoAgente('x', 'C:\\x\\1', 'claude-code')]: 'live' } // stale
})
check(
  "(5) modelo hibernado GANA a un 'live' stale -> 'hibernated' (gris) [bug reportado]",
  salida2.x === 'hibernated',
  `x=${salida2.x}`
)

// (6) despertar: al entrar, el reducer ya sacó al perfil de hibernated (modelo), y
// el agente está 'booting' -> spinner 'waking' (no gris). Prueba que el flip previo
// permite el spinner de despertar.
const salida3 = calcularEstadosPuntoPerfil({
  perfilIds: ['y'],
  perfilIdsHibernando: new Set(),
  perfilIdsHibernados: new Set(), // el flip al entrar ya lo quitó
  destinos: [destino('y', 'C:\\y\\1')],
  estadoAgente: { [claveDestinoAgente('y', 'C:\\y\\1', 'claude-code')]: 'booting' }
})
check("(6) tras el flip al entrar, 'booting' -> 'waking' (spinner de despertar)", salida3.y === 'waking', `y=${salida3.y}`)

// ---------------------------------------------------------------------------
// calcularEstadosPuntoProyecto: dot por PROYECTO (verde vivo / gris hibernado / spinner)
// ---------------------------------------------------------------------------
{
  const proyectos = [
    { rutaHostProyecto: 'C:\\p\\viva', estado: 'active' as const },
    { rutaHostProyecto: 'C:\\p\\arranca', estado: 'active' as const },
    { rutaHostProyecto: 'C:\\p\\hib', estado: 'hibernated' as const },
    { rutaHostProyecto: 'C:\\p\\idle', estado: 'active' as const }
  ]
  const salida = calcularEstadosPuntoProyecto({
    proyectos,
    estadoAgentePorProyecto: {
      'C:\\p\\viva': 'live',
      'C:\\p\\arranca': 'booting',
      'C:\\p\\hib': 'live' // stale: el modelo (hibernated) debe ganar
    }
  })
  check("(P1) proyecto activo con sesión 'live' -> 'active' (verde)", salida['C:\\p\\viva'] === 'active', `viva=${salida['C:\\p\\viva']}`)
  check("(P2) proyecto activo 'booting' -> 'waking' (spinner)", salida['C:\\p\\arranca'] === 'waking', `arranca=${salida['C:\\p\\arranca']}`)
  check(
    "(P3) proyecto hibernado (perfil hibernado) + 'live' stale -> 'hibernated' (gris; el modelo gana)",
    salida['C:\\p\\hib'] === 'hibernated',
    `hib=${salida['C:\\p\\hib']}`
  )
  check("(P5) proyecto activo sin sesión (perezoso) -> 'active' (verde)", salida['C:\\p\\idle'] === 'active', `idle=${salida['C:\\p\\idle']}`)

  // El agente cerrado por inactividad: gris en SU pestaña; el punto del perfil no cambia,
  // porque `perfilIdsHibernados` solo cuenta los proyectos 'hibernated'.
  const dormido = calcularEstadosPuntoProyecto({
    proyectos: [{ rutaHostProyecto: 'C:\\p\\dormido', estado: 'agente-hibernado' as const }],
    estadoAgentePorProyecto: { 'C:\\p\\dormido': 'live' }
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
