#!/usr/bin/env node
// =============================================================================
// Prueba del ContextReader (npm run test:context). Sin Docker ni red.
// Fija qué conversación se mide y con qué números: la suma de las cuatro cuentas del último turno,
// sin subagentes, del proyecto del panel y leída por la cola del transcript.
// Codex exacto (sin `total_token_usage`), ventana de Claude estimada con promoción de escalón,
// 'no-data' frente a 'no-session', caché con `invalidate()`, compactación, `/clear` y elección del
// chat vivo por la marca interna.
// =============================================================================

import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ContextReader, estimateClaudeWindow } from './ContextReader.ts'
import { claveAncla, crearRegistroAnclas } from './anclaConversacion.ts'

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}

async function writeJsonl(file: string, objs: object[], mtime: Date): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, objs.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8')
  await utimes(file, mtime, mtime)
}

/** Línea `assistant` de Claude Code tal como la escribe el CLI. */
function ccTurn(
  cwd: string,
  usage: Record<string, number>,
  extra: Record<string, unknown> = {}
): object {
  return {
    type: 'assistant',
    isSidechain: false,
    cwd,
    sessionId: 'sess-1',
    timestamp: '2026-08-01T10:00:00Z',
    message: { role: 'assistant', model: 'claude-opus-5', usage },
    ...extra
  }
}

/** Frontera de compactado: lo que escribe el CLI al terminar un `/compact`. */
function ccBoundary(post: number, timestamp: string, trigger = 'manual'): object {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    isSidechain: false,
    content: 'Conversation compacted',
    timestamp,
    compactMetadata: { trigger, preTokens: 255_770, postTokens: post }
  }
}

/** Evento `token_count` de Codex: el acumulado de sesión y el del último turno. */
function codexTokens(lastTotal: number, window: number): object {
  return {
    timestamp: '2026-08-01T10:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        // Acumulado de TODA la sesión: decenas de millones. No es el contexto.
        total_token_usage: { input_tokens: 74_878_898, total_tokens: 75_010_356 },
        last_token_usage: {
          input_tokens: lastTotal - 215,
          cached_input_tokens: 173_824,
          output_tokens: 215,
          total_tokens: lastTotal
        },
        model_context_window: window
      },
      rate_limits: null
    }
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'tessera-context-test-'))
  const reader = new ContextReader()

  // ---------------------------------------------------------------------------
  // Claude Code: dos proyectos en la MISMA cuenta, cada uno con su chat.
  // ---------------------------------------------------------------------------
  const ccBase = path.join(root, 'cc')
  const cwdAlpha = '/workspace/Alpha'
  const cwdBeta = '/workspace/Beta'

  // Chat de Alpha: el turno bueno es el ÚLTIMO, y hay un subagente DESPUÉS que no
  // debe contar (es el caso que inflaría el anillo si se colara).
  await writeJsonl(
    path.join(ccBase, 'projects', '-workspace-Alpha', 'sess-1.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      ccTurn(cwdAlpha, { input_tokens: 4, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }),
      ccTurn(cwdAlpha, { input_tokens: 2, cache_creation_input_tokens: 397, cache_read_input_tokens: 623_251, output_tokens: 1086 }),
      ccTurn(cwdAlpha, { input_tokens: 9, cache_creation_input_tokens: 0, cache_read_input_tokens: 40_000, output_tokens: 10 }, { isSidechain: true })
    ],
    new Date('2026-08-01T12:00:00Z')
  )
  // Chat de Beta, MÁS RECIENTE: si el filtro por proyecto no funcionase, Alpha
  // acabaría enseñando este número.
  await writeJsonl(
    path.join(ccBase, 'projects', '-workspace-Beta', 'sess-2.jsonl'),
    [
      { type: 'user', cwd: cwdBeta, message: { role: 'user', content: 'hey' } },
      ccTurn(cwdBeta, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 30_000, output_tokens: 100 })
    ],
    new Date('2026-08-01T13:00:00Z')
  )
  // Hilo de subagente en fichero aparte: se excluye por ruta (`subagents/`).
  await writeJsonl(
    path.join(ccBase, 'projects', '-workspace-Alpha', 'sess-1', 'subagents', 'agent-x.jsonl'),
    [ccTurn(cwdAlpha, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 999_999, output_tokens: 1 })],
    new Date('2026-08-01T14:00:00Z')
  )

  const alpha = await reader.read(ccBase, 'claude-code', 'Alpha')
  const ESPERADO_ALPHA = 2 + 397 + 623_251 + 1086
  check(
    '(a) Claude: contexto = input + cache_creation + cache_read + output del último turno',
    alpha.usedTokens === ESPERADO_ALPHA,
    `usedTokens=${alpha.usedTokens} (esperado ${ESPERADO_ALPHA}) · model=${alpha.model}`
  )
  check(
    '(b) Claude: los subagentes (isSidechain y `subagents/`) NO cuentan',
    alpha.usedTokens === ESPERADO_ALPHA && alpha.sessionId === 'sess-1',
    `sessionId=${alpha.sessionId} usedTokens=${alpha.usedTokens} (un sidechain de 40k y otro de 1M quedaron fuera)`
  )

  const beta = await reader.read(ccBase, 'claude-code', 'Beta')
  check(
    '(c) se mide el chat del PROYECTO del panel, no el más reciente de la cuenta',
    beta.usedTokens === 1 + 30_000 + 100 && alpha.usedTokens === ESPERADO_ALPHA,
    `Beta=${beta.usedTokens} Alpha=${alpha.usedTokens} (Beta es el más reciente y no contaminó a Alpha)`
  )
  check(
    '(f) Claude: ventana estimada por modelo (opus-5 -> 1M) y marcada como estimación',
    alpha.windowTokens === 1_000_000 && alpha.windowEstimated === true && Math.round(alpha.percent) === 62,
    `window=${alpha.windowTokens} estimada=${alpha.windowEstimated} percent=${alpha.percent.toFixed(1)}%`
  )

  // (d) Transcript LARGO: relleno > TAIL_BYTES (256 KiB) ANTES del último turno.
  const bigBase = path.join(root, 'cc-big')
  const relleno = Array.from({ length: 1500 }, () =>
    ccTurn(cwdAlpha, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 5, output_tokens: 1 }, {
      padding: 'x'.repeat(200)
    })
  )
  await writeJsonl(
    path.join(bigBase, 'projects', '-workspace-Alpha', 'sess-big.jsonl'),
    [...relleno, ccTurn(cwdAlpha, { input_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 150_000, output_tokens: 90 })],
    new Date('2026-08-01T15:00:00Z')
  )
  const big = await reader.read(bigBase, 'claude-code', 'Alpha')
  check(
    '(d) transcript de > 256 KiB: se lee por la COLA (el último turno, no el primero)',
    big.usedTokens === 3 + 7 + 150_000 + 90,
    `usedTokens=${big.usedTokens} (esperado ${3 + 7 + 150_000 + 90})`
  )

  // ---------------------------------------------------------------------------
  // Codex
  // ---------------------------------------------------------------------------
  const codexBase = path.join(root, 'codex')
  await writeJsonl(
    path.join(codexBase, 'sessions', '2026', '08', '01', 'rollout-2026-08-01T10-00-00-019f8c59-8805-7e00-889b-5e44df0ad959.jsonl'),
    [
      { timestamp: '2026-08-01T10:00:00Z', type: 'session_meta', payload: { session_id: '019f8c59-8805-7e00-889b-5e44df0ad959', cwd: cwdAlpha } },
      codexTokens(50_000, 258_400),
      codexTokens(179_930, 258_400)
    ],
    new Date('2026-08-01T16:00:00Z')
  )
  const codex = await reader.read(codexBase, 'codex', 'Alpha')
  check(
    '(e) Codex: last_token_usage + model_context_window (exacto), sin colar el acumulado',
    codex.usedTokens === 179_930 &&
      codex.windowTokens === 258_400 &&
      !codex.windowEstimated &&
      Math.round(codex.percent) === 70,
    `used=${codex.usedTokens} window=${codex.windowTokens} percent=${codex.percent.toFixed(1)}% estimada=${!!codex.windowEstimated}`
  )

  // (f2) Promoción de la ventana: tabla desfasada -> nunca un porcentaje imposible.
  check(
    '(f2) ventana estimada: se promociona al escalón siguiente si lo observado la supera',
    estimateClaudeWindow('modelo-desconocido', 120_000) === 200_000 &&
      estimateClaudeWindow('modelo-desconocido', 350_000) === 500_000 &&
      estimateClaudeWindow('modelo-desconocido', 900_000) === 1_000_000 &&
      estimateClaudeWindow('claude-opus-5', 623_650) === 1_000_000,
    `120k->${estimateClaudeWindow('x', 120_000)} 350k->${estimateClaudeWindow('x', 350_000)} 900k->${estimateClaudeWindow('x', 900_000)}`
  )

  // ---------------------------------------------------------------------------
  // (g) Estados sin dato
  // ---------------------------------------------------------------------------
  const vacio = await reader.read(ccBase, 'claude-code', 'Gamma')
  check(
    "(g) proyecto sin ninguna conversación -> 'no-session'",
    vacio.unavailable === 'no-session' && vacio.percent === 0,
    `unavailable=${vacio.unavailable}`
  )

  const nuevoBase = path.join(root, 'cc-nuevo')
  await writeJsonl(
    path.join(nuevoBase, 'projects', '-workspace-Alpha', 'sess-nuevo.jsonl'),
    [{ type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } }],
    new Date('2026-08-01T17:00:00Z')
  )
  const nuevo = await reader.read(nuevoBase, 'claude-code', 'Alpha')
  check(
    "(g2) chat abierto pero aún sin turnos del agente -> 'no-data' (no 'no-session')",
    nuevo.unavailable === 'no-data',
    `unavailable=${nuevo.unavailable}`
  )

  // ---------------------------------------------------------------------------
  // (i)(j) Compactar: la frontera cuenta como evento que cambia el contexto.
  // ---------------------------------------------------------------------------
  const compBase = path.join(root, 'cc-compact')
  const compFile = path.join(compBase, 'projects', '-workspace-Alpha', 'sess-comp.jsonl')
  const turnoGordo = ccTurn(
    cwdAlpha,
    { input_tokens: 2, cache_creation_input_tokens: 768, cache_read_input_tokens: 253_000, output_tokens: 2000 },
    { timestamp: '2026-08-02T10:00:00Z' }
  )
  await writeJsonl(
    compFile,
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoGordo,
      ccBoundary(10_646, '2026-08-02T10:05:00Z')
    ],
    new Date('2026-08-02T10:05:00Z')
  )
  const compactado = await reader.read(compBase, 'claude-code', 'Alpha')
  check(
    '(i) compactar baja el anillo YA: manda postTokens, no el turno anterior',
    compactado.usedTokens === 10_646 &&
      compactado.compacted === true &&
      compactado.observedAt === Date.parse('2026-08-02T10:05:00Z'),
    `used=${compactado.usedTokens} (el turno previo era 255770) compacted=${compactado.compacted}`
  )
  check(
    '(i2) tras compactar la ventana sigue siendo la del modelo (no se pierde el modelo)',
    compactado.windowTokens === 1_000_000 && compactado.model === 'claude-opus-5',
    `window=${compactado.windowTokens} model=${compactado.model} percent=${compactado.percent.toFixed(1)}%`
  )

  // Mismo fichero, con un turno DESPUÉS de la frontera: ese es el bueno.
  await writeJsonl(
    compFile,
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoGordo,
      ccBoundary(10_646, '2026-08-02T10:05:00Z'),
      ccTurn(
        cwdAlpha,
        { input_tokens: 2, cache_creation_input_tokens: 12_211, cache_read_input_tokens: 63_811, output_tokens: 778 },
        { timestamp: '2026-08-02T10:09:00Z' }
      )
    ],
    new Date('2026-08-02T10:09:00Z')
  )
  reader.invalidate()
  const trasCompactar = await reader.read(compBase, 'claude-code', 'Alpha')
  check(
    '(j) con turnos POSTERIORES a la frontera, manda el turno (la frontera ya caducó)',
    trasCompactar.usedTokens === 2 + 12_211 + 63_811 + 778 && !trasCompactar.compacted,
    `used=${trasCompactar.usedTokens} compacted=${!!trasCompactar.compacted}`
  )

  // ---------------------------------------------------------------------------
  // (k) `/clear`: el chat vivo pasa a ser uno sin turnos.
  // ---------------------------------------------------------------------------
  const clearBase = path.join(root, 'cc-clear')
  const clearDir = path.join(clearBase, 'projects', '-workspace-Alpha')
  await writeJsonl(
    path.join(clearDir, 'sess-viejo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      ccTurn(
        cwdAlpha,
        { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 750_000, output_tokens: 0 },
        { timestamp: '2026-08-02T11:00:00Z' }
      )
    ],
    new Date('2026-08-02T11:00:00Z')
  )
  // Lo que el CLI escribe al hacer `/clear`: fichero NUEVO, el comando, y nada más.
  await writeJsonl(
    path.join(clearDir, 'sess-limpio.jsonl'),
    [
      { type: 'mode', mode: 'normal' },
      {
        type: 'user',
        cwd: cwdAlpha,
        timestamp: '2026-08-02T11:10:00Z',
        message: { role: 'user', content: '<command-name>/clear</command-name>' }
      },
      { type: 'system', subtype: 'local_command', timestamp: '2026-08-02T11:10:00Z', content: '' }
    ],
    new Date('2026-08-02T11:10:00Z')
  )
  const limpio = await reader.read(clearBase, 'claude-code', 'Alpha')
  check(
    "(k) tras `/clear` -> 'no-data', NO el 75 % del chat que se acaba de cerrar",
    limpio.unavailable === 'no-data' && limpio.usedTokens === 0,
    `unavailable=${limpio.unavailable} used=${limpio.usedTokens} (el chat anterior tenía 750k)`
  )

  // ---------------------------------------------------------------------------
  // (l) El mtime miente: el CLI toca ficheros de chats ya muertos.
  // ---------------------------------------------------------------------------
  const mtimeBase = path.join(root, 'cc-mtime')
  const mtimeDir = path.join(mtimeBase, 'projects', '-workspace-Alpha')
  await writeJsonl(
    path.join(mtimeDir, 'sess-vivo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      ccTurn(
        cwdAlpha,
        { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 30_000, output_tokens: 0 },
        { timestamp: '2026-08-03T12:00:00Z' }
      )
    ],
    new Date('2026-08-03T12:00:00Z')
  )
  // Chat de hace días, pero recién TOCADO (mtime de hoy): no debe ganar.
  await writeJsonl(
    path.join(mtimeDir, 'sess-muerto.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      ccTurn(
        cwdAlpha,
        { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 900_000, output_tokens: 0 },
        { timestamp: '2026-07-28T09:00:00Z' }
      ),
      { type: 'last-prompt', leafUuid: 'x' }
    ],
    new Date('2026-08-03T13:00:00Z')
  )
  const vivo = await reader.read(mtimeBase, 'claude-code', 'Alpha')
  check(
    '(l) el chat vivo se elige por la hora INTERNA, no por el mtime del fichero',
    vivo.usedTokens === 30_000,
    `used=${vivo.usedTokens} (el difunto, con mtime posterior, tenía 900k)`
  )

  // ---------------------------------------------------------------------------
  // (h) Caché con TTL + invalidate (lo que hace main al ver escribir al agente)
  // ---------------------------------------------------------------------------
  let reloj = Date.parse('2026-08-01T18:00:00Z')
  const crono = new ContextReader(() => reloj)
  const cacheBase = path.join(root, 'cc-cache')
  const file = path.join(cacheBase, 'projects', '-workspace-Alpha', 'sess-c.jsonl')
  await writeJsonl(
    file,
    [ccTurn(cwdAlpha, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 10_000, output_tokens: 0 })],
    new Date('2026-08-01T18:00:00Z')
  )
  const antes = await crono.read(cacheBase, 'claude-code', 'Alpha')
  await writeJsonl(
    file,
    [ccTurn(cwdAlpha, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 90_000, output_tokens: 0 })],
    new Date('2026-08-01T18:05:00Z')
  )
  const durante = await crono.read(cacheBase, 'claude-code', 'Alpha')
  crono.invalidate()
  const despues = await crono.read(cacheBase, 'claude-code', 'Alpha')
  check(
    '(h) dentro del TTL se devuelve lo cacheado; invalidate() trae el número nuevo',
    antes.usedTokens === 10_001 && durante.usedTokens === 10_001 && despues.usedTokens === 90_001,
    `antes=${antes.usedTokens} durante(TTL)=${durante.usedTokens} tras invalidate=${despues.usedTokens}`
  )
  reloj += 60_000 // por si acaso: el TTL vencido también debe traer el dato nuevo
  const vencido = await crono.read(cacheBase, 'claude-code', 'Alpha')
  check(
    '(h2) vencido el TTL, la lectura vuelve al disco',
    vencido.usedTokens === 90_001,
    `usedTokens=${vencido.usedTokens}`
  )

  // ---------------------------------------------------------------------------
  // (m) EL BUG DEL ANILLO, de extremo a extremo. Reanudas un chat viejo, sacas lo
  //     que necesitabas y vuelves al nuevo. Desde ese momento el nuevo NO recibe
  //     ningún evento, así que el reanudado conserva el último y —sin ancla— gana.
  // ---------------------------------------------------------------------------
  const bugBase = path.join(root, 'cc-bug')
  const bugDir = path.join(bugBase, 'projects', '-workspace-Alpha')
  // Chat NUEVO (el que tienes delante): creado por `/clear`, sin un solo turno.
  await writeJsonl(
    path.join(bugDir, 'sess-nuevo.jsonl'),
    [
      {
        type: 'user',
        cwd: cwdAlpha,
        timestamp: '2026-08-05T11:10:00Z',
        message: { role: 'user', content: '<command-name>/clear</command-name>' }
      }
    ],
    new Date('2026-08-05T11:10:00Z')
  )
  // Chat VIEJO, reanudado hace un momento: su último evento es el más reciente.
  await writeJsonl(
    path.join(bugDir, 'sess-viejo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      ccTurn(
        cwdAlpha,
        { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 750_000, output_tokens: 0 },
        { timestamp: '2026-08-05T11:30:00Z' }
      )
    ],
    new Date('2026-08-05T11:30:00Z')
  )
  const sinAncla = await reader.read(bugBase, 'claude-code', 'Alpha')
  check(
    '(m) SIN ancla el chat reanudado se lleva el anillo (el fallo que se arregla)',
    sinAncla.usedTokens === 750_002 && sinAncla.anclaje === 'heuristica',
    `used=${sinAncla.usedTokens} anclaje=${sinAncla.anclaje}`
  )

  let relojAncla = Date.parse('2026-08-05T11:35:00Z')
  const anclas = crearRegistroAnclas(() => relojAncla)
  const conAncla = new ContextReader(() => relojAncla, anclas)
  anclas.pin(claveAncla('claude-code', bugBase, 'Alpha'), 'sess-nuevo')
  const anclado = await conAncla.read(bugBase, 'claude-code', 'Alpha')
  check(
    "(m2) CON ancla al chat nuevo -> 'no-data' (0 %), no el 75 % del reanudado",
    anclado.unavailable === 'no-data' && anclado.anclaje === 'sesion',
    `unavailable=${anclado.unavailable} used=${anclado.usedTokens} anclaje=${anclado.anclaje}`
  )

  // (n) …y si te cambias de chat DENTRO del TUI, el envío re-ancla: el transcript que
  //     se mueve después de tu Enter pasa a ser el medido.
  anclas.touch(claveAncla('claude-code', bugBase, 'Alpha')) // Enter a las 11:35
  await writeJsonl(
    path.join(bugDir, 'sess-viejo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      ccTurn(
        cwdAlpha,
        { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 750_000, output_tokens: 0 },
        { timestamp: '2026-08-05T11:36:00Z' }
      )
    ],
    new Date('2026-08-05T11:36:00Z')
  )
  relojAncla = Date.parse('2026-08-05T11:36:30Z')
  conAncla.invalidate()
  const reanclado = await conAncla.read(bugBase, 'claude-code', 'Alpha')
  check(
    '(n) el chat que recibe tu envío se convierte en el medido (re-anclaje por evidencia)',
    reanclado.usedTokens === 750_002 && reanclado.anclaje === 'sesion',
    `used=${reanclado.usedTokens} anclaje=${reanclado.anclaje}`
  )

  // ---------------------------------------------------------------------------
  // (o) Codex escribe los rollouts de SUBAGENTE en la MISMA carpeta `sessions/` y
  //     con el MISMO `cwd` que su padre. Mientras uno corre tiene el evento más
  //     reciente, así que sin excluirlo el anillo saltaba a SU ventana.
  // ---------------------------------------------------------------------------
  const subBase = path.join(root, 'codex-sub')
  await writeJsonl(
    path.join(subBase, 'sessions', '2026', '08', '06', 'rollout-2026-08-06T10-00-00-01a04432-9047-7bb2-b9f5-22a9cdc091d0.jsonl'),
    [
      {
        timestamp: '2026-08-06T10:00:00Z',
        type: 'session_meta',
        payload: {
          id: '01a04432-9047-7bb2-b9f5-22a9cdc091d0',
          session_id: '01a04432-9047-7bb2-b9f5-22a9cdc091d0',
          cwd: cwdAlpha,
          thread_source: 'user',
          source: 'cli'
        }
      },
      codexTokens(50_000, 258_400)
    ],
    new Date('2026-08-06T10:00:00Z')
  )
  await writeJsonl(
    path.join(subBase, 'sessions', '2026', '08', '06', 'rollout-2026-08-06T10-05-00-01a04432-420d-7a40-bded-6ee1bdf6f04c.jsonl'),
    [
      {
        timestamp: '2026-08-06T10:05:00Z',
        type: 'session_meta',
        payload: {
          id: '01a04432-420d-7a40-bded-6ee1bdf6f04c',
          cwd: cwdAlpha, // MISMO cwd que el padre: el filtro por proyecto no lo separa
          thread_source: 'subagent',
          parent_thread_id: '01a04432-9047-7bb2-b9f5-22a9cdc091d0',
          source: { subagent: { thread_spawn: { parent_thread_id: '01a04432-9047-7bb2-b9f5-22a9cdc091d0' } } }
        }
      },
      { ...codexTokens(250_000, 258_400), timestamp: '2026-08-06T10:06:00Z' }
    ],
    new Date('2026-08-06T10:06:00Z')
  )
  const conSubagente = await reader.read(subBase, 'codex', 'Alpha')
  check(
    '(o) el rollout de SUBAGENTE de Codex no se mide (es otra ventana)',
    conSubagente.usedTokens === 50_000,
    `used=${conSubagente.usedTokens} (el subagente, más reciente, tenía 250k)`
  )

  // ---------------------------------------------------------------------------
  // (p) El chat anclado se examina aunque no esté entre los MAX_CANDIDATES más
  //     recientes por mtime: el CLI toca punteros de otros chats sin parar, y sin
  //     este rescate un chat al que llevas un rato sin escribir queda enterrado.
  // ---------------------------------------------------------------------------
  const hondoBase = path.join(root, 'cc-hondo')
  const hondoDir = path.join(hondoBase, 'projects', '-workspace-Alpha')
  await writeJsonl(
    path.join(hondoDir, 'sess-hondo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      ccTurn(
        cwdAlpha,
        { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 12_345, output_tokens: 0 },
        { timestamp: '2026-08-07T08:00:00Z' }
      )
    ],
    new Date('2026-08-07T08:00:00Z') // el MÁS VIEJO de todos
  )
  for (let i = 0; i < 30; i++) {
    await writeJsonl(
      path.join(hondoDir, `sess-ruido-${i}.jsonl`),
      [
        { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'x' } },
        ccTurn(
          cwdAlpha,
          { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 999_000, output_tokens: 0 },
          { timestamp: '2026-08-07T09:00:00Z' }
        )
      ],
      new Date(Date.parse('2026-08-07T09:00:00Z') + i * 1000)
    )
  }
  const anclasHondo = crearRegistroAnclas(() => Date.parse('2026-08-07T10:00:00Z'))
  const lectorHondo = new ContextReader(() => Date.parse('2026-08-07T10:00:00Z'), anclasHondo)
  anclasHondo.pin(claveAncla('claude-code', hondoBase, 'Alpha'), 'sess-hondo')
  const hondo = await lectorHondo.read(hondoBase, 'claude-code', 'Alpha')
  check(
    '(p) el chat anclado se rescata aunque quede fuera de la criba por mtime',
    hondo.usedTokens === 12_346,
    `used=${hondo.usedTokens} (los 30 de ruido tenían 999k y mtime posterior)`
  )

  // (q) Un chat que EMPIEZA pegando una imagen grande: su primera línea (la del `cwd`) son
  //     megas de base64. Con un corte fijo de la cabeza la línea quedaba partida, el `cwd` se
  //     perdía y el chat no contaba como del proyecto: anillo vacío.
  const imagenBase = path.join(root, 'cc-imagen')
  const imagenGrande = 'iVBORw0KGgo'.repeat(300_000) // ~3,3 MB de base64
  await writeJsonl(
    path.join(imagenBase, 'projects', '-workspace-Alpha', 'sess-imagen.jsonl'),
    [
      {
        type: 'user',
        cwd: cwdAlpha,
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'mira esto' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imagenGrande } }
          ]
        }
      },
      ccTurn(cwdAlpha, { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 20_000, output_tokens: 7 })
    ],
    new Date('2026-08-01T16:00:00Z')
  )
  const conImagen = await reader.read(imagenBase, 'claude-code', 'Alpha')
  check(
    '(q) un chat cuya primera línea es una imagen de megas conserva su `cwd` y su anillo',
    conImagen.usedTokens === 5 + 20_000 + 7,
    `used=${conImagen.usedTokens} (esperado ${5 + 20_000 + 7})`
  )

  console.log('')
  const failed = results.filter((r) => !r.pass)
  if (failed.length) {
    console.log(`RESULTADO: ${failed.length} de ${results.length} comprobaciones FALLARON`)
    process.exit(1)
  }
  console.log(`RESULTADO: ${results.length} comprobaciones OK`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
