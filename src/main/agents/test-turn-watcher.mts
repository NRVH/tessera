#!/usr/bin/env node
// =============================================================================
// Prueba del vigilante de turnos con archivos reales (npm run test:vigilante-turnos): que
// lo que el transcript dice de las tareas en segundo plano llega a la sesión del proyecto,
// también cuando la cola leída no trae ninguna marca de turno, y que no llega a la de otro
// proyecto ni desde un transcript de Codex.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TurnWatcher } from './TurnWatcher.ts'
import type { CambioSegundoPlano } from '../transcripts/tareasSegundoPlano.ts'

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
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
async function esperarHasta(cond: () => boolean, ms: number): Promise<boolean> {
  const limite = Date.now() + ms
  while (!cond()) {
    if (Date.now() > limite) return false
    await sleep(50)
  }
  return true
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-vigilante-'))
const baseClaude = path.join(tmp, 'claude')
const baseCodex = path.join(tmp, 'codex')
const carpetaA = path.join(baseClaude, 'projects', 'C--proy-a')
const carpetaB = path.join(baseClaude, 'projects', 'C--proy-b')
const carpetaCodex = path.join(baseCodex, 'sessions', '2026', '10', '02')
for (const c of [carpetaA, carpetaB, carpetaCodex]) mkdirSync(c, { recursive: true })

const recibidos: Array<{ sessionId: string; cambios: CambioSegundoPlano[] }> = []
const marcas: string[] = []
const vigilante = new TurnWatcher(
  (sessionId, marca) => marcas.push(`${sessionId}:${marca.tipo}`),
  () => {},
  (sessionId, cambios) => recibidos.push({ sessionId, cambios })
)
const de = (sessionId: string): string =>
  recibidos
    .filter((r) => r.sessionId === sessionId)
    .flatMap((r) => r.cambios.map((c) => (c.tipo === 'despertar' ? `despertar:${c.hasta}` : `${c.tipo}:${c.id}`)))
    .join(' ')

const linea = (cwd: string, extra: Record<string, unknown>): string =>
  JSON.stringify({ cwd, sessionId: 'chat', timestamp: new Date().toISOString(), ...extra }) + '\n'
const lanzaShell = (cwd: string, id: string): string =>
  linea(cwd, { type: 'user', toolUseResult: { stdout: '', stderr: '', backgroundTaskId: id } })
const avisoFin = (cwd: string, id: string): string =>
  linea(cwd, {
    type: 'user',
    message: { role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>` }
  })

try {
  vigilante.watch('sesion-a', { base: baseClaude, agente: 'claude-code', proyecto: 'a' })
  vigilante.watch('sesion-b', { base: baseClaude, agente: 'claude-code', proyecto: 'b' })
  vigilante.watch('sesion-codex', { base: baseCodex, agente: 'codex', proyecto: 'a' })
  // Una cuenta sin estrenar: su carpeta de transcripts no existe y el `fs.watch` no se monta.
  vigilante.watch('sesion-sin-carpeta', { base: path.join(tmp, 'no-existe'), agente: 'claude-code', proyecto: 'a' })
  await sleep(200)

  hr('0. Quien pregunta sabe si de verdad se está vigilando')
  check('(0a) una sesión con su carpeta vigilada: sí', vigilante.vigila('sesion-a') && vigilante.vigila('sesion-b'), 'vigiladas')
  check('(0b) una cuya carpeta no se pudo vigilar: NO (su silencio no es «no ha pasado nada»)', !vigilante.vigila('sesion-sin-carpeta'), 'sin vigilante')
  check('(0c) una que nunca se pidió: no', !vigilante.vigila('desconocida'), 'desconocida')

  hr('1. Un lanzamiento en segundo plano llega a la sesión de su proyecto')
  const transcriptA = path.join(carpetaA, 'chat.jsonl')
  appendFileSync(transcriptA, lanzaShell('C:\\proy\\a', 'bsh1'))
  const llegoLanzada = await esperarHasta(() => de('sesion-a').includes('lanzada:bsh1'), 5000)
  check('(1a) llega aunque la cola no traiga ninguna marca de turno', llegoLanzada && marcas.length === 0, `a=[${de('sesion-a')}] marcas=${marcas.length}`)
  check('(1b) no llega a la sesión de otro proyecto de la misma cuenta', de('sesion-b') === '', `b=[${de('sesion-b')}]`)

  hr('2. El aviso de fin también, en su orden')
  recibidos.length = 0
  appendFileSync(transcriptA, avisoFin('C:\\proy\\a', 'bsh1'))
  const llegoFin = await esperarHasta(() => de('sesion-a').includes('terminada:bsh1'), 5000)
  check('(2a) la cola releída trae el lanzamiento y DESPUÉS su fin', llegoFin && de('sesion-a').endsWith('lanzada:bsh1 terminada:bsh1'), `a=[${de('sesion-a')}]`)

  hr('3. Lo que no es del hilo principal de Claude Code no cuenta')
  recibidos.length = 0
  appendFileSync(path.join(carpetaB, 'chat.jsonl'), linea('C:\\proy\\b', { type: 'user', isSidechain: true, toolUseResult: { backgroundTaskId: 'hijo' } }))
  appendFileSync(
    path.join(carpetaCodex, 'rollout-x.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { cwd: 'C:\\proy\\a' } }) + '\n' + JSON.stringify({ type: 'x', toolUseResult: { backgroundTaskId: 'de-codex' } }) + '\n'
  )
  await sleep(1200)
  check('(3a) ni el hilo de un subagente ni un transcript de Codex entregan nada', recibidos.length === 0, JSON.stringify(recibidos))

  hr('4. Una sesión que deja de vigilarse ya no recibe')
  vigilante.unwatch('sesion-a')
  appendFileSync(transcriptA, lanzaShell('C:\\proy\\a', 'bsh2'))
  await sleep(1200)
  check('(4a) tras unwatch no llega nada más', de('sesion-a') === '', `a=[${de('sesion-a')}]`)
  check('(4b) y deja de contar como vigilada', !vigilante.vigila('sesion-a') && vigilante.vigila('sesion-b'), 'a fuera, b dentro')

  hr('5. Un chat que empieza con una imagen de megas sigue atribuido a su proyecto')
  recibidos.length = 0
  const transcriptImagen = path.join(carpetaB, 'imagen.jsonl')
  // La primera línea (la del `cwd`) es una imagen pegada en base64: con un corte fijo de la
  // cabeza quedaba partida y el transcript se quedaba sin proyecto, y sin sus avisos.
  const imagen = 'iVBORw0KGgo'.repeat(300_000)
  appendFileSync(
    transcriptImagen,
    linea('C:\\proy\\b', { type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: imagen } }] } })
  )
  appendFileSync(transcriptImagen, lanzaShell('C:\\proy\\b', 'bshimg'))
  const llegoImagen = await esperarHasta(() => de('sesion-b').includes('lanzada:bshimg'), 5000)
  check('(5a) el aviso llega aunque el `cwd` solo esté en la primera línea gigante', llegoImagen, `b=[${de('sesion-b')}]`)
} finally {
  vigilante.disposeAll()
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* la carpeta temporal la recoge el sistema */
  }
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
