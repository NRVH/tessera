#!/usr/bin/env node
// =============================================================================
// Prueba de los panes remotos de la actualización nativa
// (node src/renderer/src/features/agentes/test-panes-remotos.mts): solo las sesiones de ventanas
// de agente que ningún pane propio tiene, nativas, y sus órdenes viajan con su sesión; relanzar
// devuelve lo que diga la ventana dueña y, sin respuesta o con error, «fallo». Puro.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import type { EstadoAgentesNativos, SesionNativa } from '../../../../shared/agentes-nativos-ipc.ts'
import { PERFIL_VENTANA_AGENTE, type PeticionPaneRemoto } from '../../../../shared/ventana-agente-ipc.ts'
import { panesRemotos } from './panesRemotos.ts'
import type { ApiAgentePane } from './tipos.ts'

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

function sesion(sessionId: string, profileId: string): SesionNativa {
  return {
    sessionId,
    profileId,
    projectHostPath: '/home/ana',
    agente: 'claude-code',
    versionLanzada: '1.0.0',
    atrasada: true,
    trabajando: false,
    esperandoRespuesta: false,
    puedeTenerTextoSinEnviar: false
  }
}

function estadoCon(sesiones: SesionNativa[]): EstadoAgentesNativos {
  return { sesiones } as unknown as EstadoAgentesNativos
}

const local = { sessionId: () => 'v-propia' } as unknown as ApiAgentePane

async function main(): Promise<void> {
  hr('(1) Qué sesiones tienen pane remoto')
  const pedidas: PeticionPaneRemoto[] = []
  const pedir = async (req: PeticionPaneRemoto): Promise<'ok' | null> => {
    pedidas.push(req)
    return req.accion === 'relanzar' ? 'ok' : null
  }
  const estado = estadoCon([sesion('v-1', PERFIL_VENTANA_AGENTE), sesion('p-1', 'personal'), sesion('v-propia', PERFIL_VENTANA_AGENTE)])
  const remotos = panesRemotos(estado, [local], pedir)
  check('(1a) solo las de ventanas de agente sin pane propio', remotos.length === 1 && remotos[0].sessionId() === 'v-1', remotos.map((r) => r.sessionId()).join(','))
  check('(1b) nativas', remotos[0].hostMode(), 'host')
  check('(1c) sin foto, ninguna', panesRemotos(null, [], pedir).length === 0, 'vacío')

  hr('(2) Las órdenes viajan con su sesión')
  remotos[0].preparar()
  remotos[0].liberar()
  const r = await remotos[0].relanzar({ banner: 'Actualizado', error: false })
  check('(2a) preparar, soltar y relanzar, en orden y con su sesión', pedidas.map((p) => `${p.accion}:${p.sessionId}`).join(',') === 'preparar:v-1,liberar:v-1,relanzar:v-1', JSON.stringify(pedidas))
  check('(2b) relanzar lleva el banner', pedidas[2]?.banner === 'Actualizado' && pedidas[2]?.error === undefined, JSON.stringify(pedidas[2]))
  check('(2c) y devuelve lo que dice la ventana dueña', r === 'ok', String(r))

  hr('(3) Sin respuesta o con error, «fallo»')
  const sinRespuesta = panesRemotos(estado, [local], async () => null)[0]
  check('(3a) null al relanzar → fallo', (await sinRespuesta.relanzar({ banner: '' })) === 'fallo', 'fallo')
  const conError = panesRemotos(estado, [local], async () => {
    throw new Error('ventana cerrada')
  })[0]
  check('(3b) error al relanzar → fallo', (await conError.relanzar({ banner: '' })) === 'fallo', 'fallo')
  let rompio = false
  try {
    conError.preparar()
    conError.liberar()
  } catch {
    rompio = true
  }
  check('(3c) preparar y soltar no lanzan aunque la ventana no responda', !rompio, String(rompio))

  hr('RESULTADO (PASS/FAIL)')
  for (const x of results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}`)
    console.log(`      -> ${x.evidence}`)
  }
  const passed = results.filter((x) => x.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

void main()
