#!/usr/bin/env node
// =============================================================================
// Prueba del parser de marcas de turno y del reconocimiento de rollouts de subagente (npm run
// test:turnos). Sin disco.
// Las líneas están copiadas de transcripts reales: clavan las formas vistas que distinguen
// «terminó» de «sigue».
// Los casos clave: `task_started` huérfanos (manda el orden, no el emparejamiento), `turn_duration`
// frente a `stop_reason`, y un subagente de Codex con el mismo `cwd` que su padre.
// =============================================================================

import { ultimaMarca } from './marcasTurno.ts'
import { esRolloutDeSubagente, metaDeCabecera } from './formatoTranscript.ts'
import type { LineaJsonl } from '../util/jsonlCola.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
function hr(title: string): void {
  console.log(`\n=== ${title} ===`)
}

// --- Líneas con la forma REAL -----------------------------------------------

const codexStarted = (ts: string, modo = 'default'): LineaJsonl => ({
  timestamp: ts,
  type: 'event_msg',
  payload: {
    type: 'task_started',
    turn_id: '01a04432-906c-75e1-aaa6-064e1d53d1fe',
    started_at: 1787850559,
    model_context_window: 258400,
    collaboration_mode_kind: modo
  }
})
const codexComplete = (ts: string): LineaJsonl => ({
  timestamp: ts,
  type: 'event_msg',
  payload: {
    type: 'task_complete',
    turn_id: '01a04432-906c-75e1-aaa6-064e1d53d1fe',
    last_agent_message: 'Resultado de la inspección…'
  }
})
const codexTokens = (ts: string): LineaJsonl => ({
  timestamp: ts,
  type: 'event_msg',
  payload: { type: 'token_count', info: { model_context_window: 258400 } }
})
const codexAborted = (ts: string): LineaJsonl => ({
  timestamp: ts,
  type: 'event_msg',
  payload: { type: 'turn_aborted', reason: 'interrupted' }
})

const ccTurnDuration = (ts: string): LineaJsonl => ({
  parentUuid: 'b2f6f70b-17df-4464-b861-98c1ec99a3b6',
  isSidechain: false,
  type: 'system',
  subtype: 'turn_duration',
  durationMs: 40147,
  messageCount: 972,
  timestamp: ts,
  sessionId: '6472fd5c-4d02-4c6c-80cf-686240e51fea',
  version: '2.1.201'
})
const ccAssistant = (ts: string, stop: string | null, sidechain = false): LineaJsonl => ({
  isSidechain: sidechain,
  type: 'assistant',
  timestamp: ts,
  message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text: 'ok' }] }
})
const ccUser = (ts: string, texto: string): LineaJsonl => ({
  isSidechain: false,
  type: 'user',
  timestamp: ts,
  message: { role: 'user', content: texto }
})
const ccToolResult = (ts: string): LineaJsonl => ({
  isSidechain: false,
  type: 'user',
  timestamp: ts,
  message: { role: 'user', content: [{ type: 'tool_result', content: 'salida' }] }
})

const T1 = '2026-08-27T17:09:19.561Z'
const T2 = '2026-08-27T17:14:53.710Z'
const T3 = '2026-08-27T17:26:52.552Z'
const T4 = '2026-08-27T17:30:03.253Z'

function main(): void {
  hr('Codex')

  const cierraCodex = ultimaMarca('codex', [codexStarted(T1), codexTokens(T2), codexComplete(T2)])
  check(
    '(1) la cola termina en task_complete => cierra',
    cierraCodex?.tipo === 'cierra' && cierraCodex.motivo === 'task_complete',
    `${cierraCodex?.tipo}/${cierraCodex?.motivo}`
  )

  // El caso REAL: 3 task_started / 2 task_complete (uno de ellos por cambio de modo,
  // superado 37 ms después). Emparejar por conteo o por turn_id se rompe aquí.
  const real = ultimaMarca('codex', [
    codexStarted(T1, 'plan'),
    codexStarted(T1),
    codexComplete(T2),
    codexStarted(T3),
    codexTokens(T4),
    codexComplete(T4)
  ])
  check(
    '(2) 3 aperturas / 2 cierres (caso real): manda el ORDEN, no el emparejamiento',
    real?.tipo === 'cierra' && real.motivo === 'task_complete',
    `${real?.tipo}/${real?.motivo}`
  )

  const abriendo = ultimaMarca('codex', [codexComplete(T2), codexStarted(T3)])
  check(
    '(3) la cola termina en task_started => abre',
    abriendo?.tipo === 'abre',
    `${abriendo?.tipo}/${abriendo?.motivo}`
  )

  const abortado = ultimaMarca('codex', [codexStarted(T1), codexAborted(T2)])
  check(
    '(4) interrumpir (turn_aborted) también cierra: si no, el turno no acababa nunca',
    abortado?.tipo === 'cierra' && abortado.motivo === 'turn_aborted',
    `${abortado?.tipo}/${abortado?.motivo}`
  )

  hr('Claude Code')

  const dur = ultimaMarca('claude-code', [ccAssistant(T1, 'stop_sequence'), ccTurnDuration(T2)])
  check(
    '(5) `turn_duration` cierra (y es el marcador PRIMARIO: se ha visto con stop_sequence)',
    dur?.tipo === 'cierra' && dur.motivo === 'turn_duration',
    `${dur?.tipo}/${dur?.motivo}`
  )

  const endTurn = ultimaMarca('claude-code', [ccAssistant(T1, 'tool_use'), ccAssistant(T2, 'end_turn')])
  check(
    '(6) sin `turn_duration` (CLI viejo), `end_turn` es el respaldo',
    endTurn?.tipo === 'cierra' && endTurn.motivo === 'end_turn',
    `${endTurn?.tipo}/${endTurn?.motivo}`
  )

  const sidechain = ultimaMarca('claude-code', [
    ccAssistant(T1, 'tool_use'),
    ccAssistant(T2, 'end_turn', true) // el subagente terminó, tú no
  ])
  check(
    '(7) el `end_turn` de un SUBAGENTE no cierra tu turno',
    sidechain?.tipo === 'abre' && sidechain.motivo === 'tool_use',
    `${sidechain?.tipo}/${sidechain?.motivo}`
  )

  const interrumpido = ultimaMarca('claude-code', [
    ccAssistant(T1, 'tool_use'),
    ccUser(T2, '[Request interrupted by user for tool use]')
  ])
  check(
    '(8) interrumpir con Esc no escribe fin de turno: lo dice en una línea `user`',
    interrumpido?.tipo === 'cierra' && interrumpido.motivo === 'interrupted',
    `${interrumpido?.tipo}/${interrumpido?.motivo}`
  )

  const enHerramienta = ultimaMarca('claude-code', [ccAssistant(T1, 'end_turn'), ccToolResult(T2)])
  check(
    '(9) un `tool_result` significa que el turno SIGUE en marcha',
    enHerramienta?.tipo === 'abre' && enHerramienta.motivo === 'tool_result',
    `${enHerramienta?.tipo}/${enHerramienta?.motivo}`
  )

  hr('Sin marcador conocido')

  const nada = ultimaMarca('claude-code', [
    { type: 'mode', mode: 'normal' },
    { type: 'last-prompt', leafUuid: 'x' },
    ccAssistant(T1, null)
  ])
  check(
    '(10) ninguna línea reconocible => null (no se inventa un final)',
    nada === null,
    `marca=${JSON.stringify(nada)}`
  )

  hr('Rollouts de subagente de Codex')

  const padre = {
    id: '01a04432-9047-7bb2-b9f5-22a9cdc091d0',
    session_id: '01a04432-9047-7bb2-b9f5-22a9cdc091d0',
    cwd: 'D:\\Datos\\Proyectos\\Equipo\\Modulo',
    thread_source: 'user',
    source: 'cli'
  }
  const hijo = {
    id: '01a04432-420d-7a40-bded-6ee1bdf6f04c',
    cwd: 'D:\\Datos\\Proyectos\\Equipo\\Modulo', // MISMO cwd que el padre
    thread_source: 'subagent',
    parent_thread_id: '01a04432-9047-7bb2-b9f5-22a9cdc091d0',
    source: { subagent: { thread_spawn: { parent_thread_id: '01a04432-9047-7bb2-b9f5-22a9cdc091d0' } } }
  }
  check(
    '(11) el rollout del padre no es de subagente; el del hijo sí (mismo cwd los dos)',
    !esRolloutDeSubagente(padre) && esRolloutDeSubagente(hijo),
    `padre=${esRolloutDeSubagente(padre)} hijo=${esRolloutDeSubagente(hijo)}`
  )

  check(
    '(12) basta UNA de las tres señales (un CLI puede escribir solo una)',
    esRolloutDeSubagente({ parent_thread_id: 'x' }) &&
      esRolloutDeSubagente({ source: { subagent: {} } }) &&
      esRolloutDeSubagente({ thread_source: 'subagent' }),
    'parent_thread_id / source.subagent / thread_source'
  )

  check(
    '(13) un `session_meta` de una versión SIN esos campos NO es subagente (degrada como antes)',
    !esRolloutDeSubagente({ id: 'x', cwd: '/w' }),
    'sin thread_source ni parent_thread_id ni source.subagent'
  )

  const metaHijo = metaDeCabecera('codex', [{ type: 'session_meta', payload: hijo }])
  const metaCC = metaDeCabecera('claude-code', [
    { type: 'mode', mode: 'normal' },
    { type: 'user', cwd: 'D:\\proj\\Alpha', message: {} }
  ])
  check(
    '(14) `metaDeCabecera` saca el cwd de los dos formatos y marca el subagente',
    metaHijo.subagente && metaHijo.cwd === hijo.cwd && metaCC.cwd === 'D:\\proj\\Alpha' && !metaCC.subagente,
    `codex=${metaHijo.cwd}/sub=${metaHijo.subagente} cc=${metaCC.cwd}/sub=${metaCC.subagente}`
  )

  const allPass = results.every((r) => r.pass)
  console.log('\n' + '='.repeat(60))
  console.log(
    `VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`
  )
  process.exit(allPass ? 0 : 1)
}

main()
