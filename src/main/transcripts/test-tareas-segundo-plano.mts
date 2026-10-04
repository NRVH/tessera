#!/usr/bin/env node
// =============================================================================
// Prueba del trabajo pendiente leído del transcript de Claude Code (npm run
// test:segundo-plano): las formas de lanzamiento, el aviso de fin y el que NO es final, los
// despertares programados, las herramientas sin aviso de fin, los hilos de subagente y el
// estado de un proceso. Las líneas son las formas reales del CLI 2.1.x, recortadas.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import {
  aplicarSegundoPlano,
  cambiosSegundoPlano,
  haySegundoPlano,
  sinSegundoPlano,
  type CambioSegundoPlano
} from './tareasSegundoPlano.ts'
import type { LineaJsonl } from '../util/jsonlCola.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const T0 = Date.parse('2026-10-02T10:00:00.000Z')
const hora = (s: number): string => new Date(T0 + s * 1000).toISOString()
const resumen = (c: CambioSegundoPlano): string => (c.tipo === 'despertar' ? `despertar:${c.hasta}` : `${c.tipo}:${c.id}`)
const resumenes = (cs: CambioSegundoPlano[]): string => cs.map(resumen).join(' ')

const lanzaShell = (id: string, s: number): LineaJsonl => ({
  type: 'user',
  timestamp: hora(s),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Command running in background' }] },
  toolUseResult: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id }
})
const lanzaAgente = (id: string, s: number): LineaJsonl => ({
  type: 'user',
  timestamp: hora(s),
  toolUseResult: { isAsync: true, status: 'async_launched', agentId: id, description: 'x', prompt: 'y' }
})
const lanzaHabilidad = (id: string, s: number): LineaJsonl => ({
  type: 'user',
  timestamp: hora(s),
  toolUseResult: { status: 'forked', agentId: id, background: true }
})
const lanzaFlujo = (taskId: string, s: number): LineaJsonl => ({
  type: 'user',
  timestamp: hora(s),
  toolUseResult: { status: 'async_launched', runId: 'wf_abc123', taskId, taskType: 'workflow', workflowName: 'w' }
})
const aviso = (id: string, estado: string, s: number, nota = ''): LineaJsonl => ({
  type: 'user',
  timestamp: hora(s),
  message: {
    role: 'user',
    content: `<task-notification>\n<task-id>${id}</task-id>\n<status>${estado}</status>\n<summary>fin</summary>\n${nota}</task-notification>`
  }
})
/** El resultado real de `ScheduleWakeup` (medido en un transcript real). */
const programa = (para: number, s: number): LineaJsonl => ({
  type: 'user',
  timestamp: hora(s),
  toolUseResult: { scheduledFor: para, clampedDelaySeconds: 1800, wasClamped: false }
})
const cancela = (s: number): LineaJsonl => ({
  type: 'user',
  timestamp: hora(s),
  toolUseResult: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false, stopped: true, cancelledWakeups: 1 }
})
const usa = (nombre: string, s: number): LineaJsonl => ({
  type: 'assistant',
  timestamp: hora(s),
  message: { role: 'assistant', content: [{ type: 'text', text: 'voy' }, { type: 'tool_use', id: 'toolu_9', name: nombre, input: {} }] }
})

hr('1. Qué cuenta como lanzamiento')
{
  const c = cambiosSegundoPlano([lanzaShell('bsh1', 1), lanzaAgente('ag1', 2), lanzaHabilidad('sk1', 3), lanzaFlujo('wf1', 4)])
  check(
    '(1a) shell, subagente, habilidad aparte y flujo: cuatro lanzamientos, en orden',
    resumenes(c) === 'lanzada:bsh1 lanzada:ag1 lanzada:sk1 lanzada:wf1',
    resumenes(c)
  )
  check('(1b) cada cambio lleva la hora de su línea', c[0].at === T0 + 1000 && c[3].at === T0 + 4000, `${c[0].at} ${c[3].at}`)
  const noLanzan: LineaJsonl[] = [
    { type: 'user', timestamp: hora(1), toolUseResult: { stdout: 'ok', stderr: '' } },
    { type: 'user', timestamp: hora(1), toolUseResult: { status: 'completed', agentId: 'ag9' } },
    { type: 'user', timestamp: hora(1), toolUseResult: 'texto suelto' },
    { type: 'user', timestamp: hora(1), toolUseResult: [{ backgroundTaskId: 'en-lista' }] },
    { type: 'user', timestamp: hora(1), toolUseResult: { backgroundTaskId: '' } },
    { type: 'assistant', timestamp: hora(1), message: { content: [{ type: 'text', text: 'run_in_background' }] } },
    usa('Bash', 1)
  ]
  check('(1c) una herramienta en primer plano, un subagente que esperó o un resultado raro NO lanzan', cambiosSegundoPlano(noLanzan).length === 0, resumenes(cambiosSegundoPlano(noLanzan)))
  const sinHora = cambiosSegundoPlano([{ type: 'user', toolUseResult: { backgroundTaskId: 'b' } }, { type: 'user', timestamp: 'ayer', toolUseResult: { backgroundTaskId: 'c' } }])
  check('(1d) sin hora, o con una que no se entiende: `at` null', sinHora.length === 2 && sinHora.every((x) => x.at === null), JSON.stringify(sinHora))
}

hr('2. Qué cuenta como fin')
{
  const fines = ['completed', 'failed', 'stopped', 'killed'].map((e, i) => aviso(`t${i}`, e, i))
  const c = cambiosSegundoPlano(fines)
  check('(2a) completed, failed, stopped y killed terminan la tarea', c.length === 4 && c.every((x) => x.tipo === 'terminada'), resumenes(c))
  const intermedio = aviso('ag1', 'completed', 5, '<note>This agent stopped with background work of its own still running</note>')
  check('(2b) el aviso de un subagente con trabajo suyo aún en marcha NO es el final', cambiosSegundoPlano([intermedio]).length === 0, 'ignorado')
  const final = aviso('ag1', 'completed', 9, '<note>A task-notification fires each time this agent stops with no live background children</note>')
  check('(2c) el siguiente aviso, ya sin hijos vivos, sí', resumenes(cambiosSegundoPlano([final])) === 'terminada:ag1', resumenes(cambiosSegundoPlano([final])))
  const citado: LineaJsonl = { type: 'user', timestamp: hora(1), message: { content: 'mira esto: <task-notification><task-id>x</task-id>' } }
  const delAsistente: LineaJsonl = { type: 'assistant', timestamp: hora(1), message: { content: '<task-notification><task-id>x</task-id>' } }
  const enBloques: LineaJsonl = { type: 'user', timestamp: hora(1), message: { content: [{ type: 'text', text: '<task-notification><task-id>x</task-id>' }] } }
  check('(2d) un aviso citado a mitad de un mensaje, del asistente o en bloques no cuenta', cambiosSegundoPlano([citado, delAsistente, enBloques]).length === 0, 'ignorados')
}

hr('3. Hilos de subagente')
{
  const hilo: LineaJsonl = { ...lanzaShell('bsh-hijo', 1), isSidechain: true }
  const despertarDeHilo: LineaJsonl = { ...programa(T0 + 9_000_000, 1), isSidechain: true }
  check('(3a) lo que lanza o programa un subagente en su hilo no es del hilo principal', cambiosSegundoPlano([hilo, despertarDeHilo]).length === 0, 'ignorado')
}

hr('4. Las tareas en marcha de un proceso')
{
  const desde = T0
  const e = sinSegundoPlano()
  check('(4a) un estado nuevo no tiene nada pendiente', !haySegundoPlano(e, T0), 'vacío')
  aplicarSegundoPlano(e, cambiosSegundoPlano([lanzaShell('a', 1), lanzaAgente('b', 2)]), desde)
  check('(4b) dos lanzadas, dos en marcha, y hay trabajo pendiente', e.enMarcha.size === 2 && haySegundoPlano(e, T0), [...e.enMarcha].join(','))
  aplicarSegundoPlano(e, cambiosSegundoPlano([lanzaShell('a', 1), lanzaAgente('b', 2), aviso('a', 'completed', 3)]), desde)
  check('(4c) releer la cola entera con el aviso de «a» deja solo «b»', e.enMarcha.size === 1 && e.enMarcha.has('b'), [...e.enMarcha].join(','))
  aplicarSegundoPlano(e, cambiosSegundoPlano([aviso('a', 'completed', 3), aviso('b', 'failed', 4)]), desde)
  check('(4d) el aviso llega aunque el lanzamiento ya no esté en la cola leída', e.enMarcha.size === 0 && !haySegundoPlano(e, T0), String(e.enMarcha.size))
  aplicarSegundoPlano(e, cambiosSegundoPlano([aviso('nunca-lanzada', 'completed', 5)]), desde)
  check('(4e) el aviso de una tarea desconocida no hace nada', e.enMarcha.size === 0, String(e.enMarcha.size))
}

hr('5. Lo lanzado ANTES de arrancar el proceso no es suyo')
{
  // El proceso arranca en T0+10 s reanudando una conversación con una tarea que quedó a medias.
  const desde = T0 + 10_000
  const e = sinSegundoPlano()
  aplicarSegundoPlano(e, cambiosSegundoPlano([lanzaShell('vieja', 2), programa(T0 + 9_000_000, 3), lanzaShell('nueva', 12)]), desde)
  check('(5a) la tarea vieja murió con su proceso: no deja el veto pegado', !e.enMarcha.has('vieja') && e.enMarcha.has('nueva'), [...e.enMarcha].join(','))
  check('(5b) el despertar que programó el proceso anterior tampoco cuenta', e.despertarHasta === 0, String(e.despertarHasta))
  const sinHora = sinSegundoPlano()
  aplicarSegundoPlano(sinHora, [{ tipo: 'lanzada', id: 'x', at: null }], desde)
  check('(5c) sin hora cuenta: ante la duda, no se hiberna', sinHora.enMarcha.has('x'), [...sinHora.enMarcha].join(','))
  const justo = sinSegundoPlano()
  aplicarSegundoPlano(justo, [{ tipo: 'lanzada', id: 'y', at: desde }], desde)
  check('(5d) lanzada en el mismo instante del arranque: cuenta', justo.enMarcha.has('y'), [...justo.enMarcha].join(','))
}

hr('6. Despertares programados (`/loop`)')
{
  const para = T0 + 1_800_000
  const c = cambiosSegundoPlano([programa(para, 1)])
  check('(6a) el resultado de ScheduleWakeup da la hora del despertar', resumenes(c) === `despertar:${para}`, resumenes(c))
  const e = sinSegundoPlano()
  aplicarSegundoPlano(e, c, T0)
  check('(6b) hasta esa hora hay trabajo pendiente: no se hiberna a mitad de un bucle', haySegundoPlano(e, T0 + 60_000) && haySegundoPlano(e, para - 1), String(e.despertarHasta))
  check('(6c) con un minuto de margen pasada la hora, por si tarda en dispararse', haySegundoPlano(e, para + 59_000), 'dentro del margen')
  check('(6d) y después ya no: un despertar que no llegó no deja el veto pegado', !haySegundoPlano(e, para + 61_000), 'fuera del margen')
  aplicarSegundoPlano(e, cambiosSegundoPlano([programa(para, 1), programa(para + 600_000, 2)]), T0)
  check('(6e) reprogramar gana el último', e.despertarHasta === para + 600_000, String(e.despertarHasta))
  aplicarSegundoPlano(e, cambiosSegundoPlano([programa(para, 1), cancela(3)]), T0)
  check('(6f) `stop: true` lo cancela', e.despertarHasta === 0 && !haySegundoPlano(e, T0), String(e.despertarHasta))
  const parecidos: LineaJsonl[] = [
    { type: 'user', timestamp: hora(1), toolUseResult: { scheduledFor: 'mañana', clampedDelaySeconds: 5 } },
    { type: 'user', timestamp: hora(1), toolUseResult: { scheduledFor: para } }
  ]
  check('(6g) un resultado que solo se le parece no programa nada', cambiosSegundoPlano(parecidos).length === 0, resumenes(cambiosSegundoPlano(parecidos)))
}

hr('7. Herramientas sin aviso de fin')
{
  const c = cambiosSegundoPlano([usa('CronCreate', 1), usa('Monitor', 2)])
  check('(7a) usar CronCreate o Monitor cuenta como una tarea que no termina', resumenes(c) === 'lanzada:sin-fin:CronCreate lanzada:sin-fin:Monitor', resumenes(c))
  const e = sinSegundoPlano()
  aplicarSegundoPlano(e, c, T0)
  check('(7b) y veta hasta que el proceso se relance', haySegundoPlano(e, T0 + 86_400_000), [...e.enMarcha].join(','))
  const delUsuario: LineaJsonl = { type: 'user', timestamp: hora(1), message: { content: [{ type: 'tool_use', name: 'CronCreate' }] } }
  const roto: LineaJsonl = { type: 'assistant', timestamp: hora(1), message: { content: [null, { type: 'tool_use' }, 'x'] } }
  check('(7c) solo cuenta en una línea del asistente, y un bloque roto no rompe nada', cambiosSegundoPlano([delUsuario, roto]).length === 0, 'ignorados')
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
