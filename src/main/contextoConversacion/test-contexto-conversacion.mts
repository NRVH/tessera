#!/usr/bin/env node
// =============================================================================
// Prueba del LectorContexto (npm run test:contexto-conversacion). Sin Docker ni red.
// Fija qué conversación se mide y con qué números: la suma de las cuatro cuentas del último turno,
// sin subagentes, del proyecto del panel y leída por la cola del transcript.
// Codex exacto (sin `total_token_usage`), ventana de Claude estimada con promoción de escalón,
// 'no-data' frente a 'no-session', caché con `invalidate()`, compactación, `/clear` y elección del
// chat vivo por la marca interna.
// =============================================================================

import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LectorContexto, estimarVentanaClaude } from './LectorContexto.ts'
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

async function escribirJsonl(archivo: string, objetos: object[], mtime: Date): Promise<void> {
  await mkdir(path.dirname(archivo), { recursive: true })
  await writeFile(archivo, objetos.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8')
  await utimes(archivo, mtime, mtime)
}

/** Línea `assistant` de Claude Code tal como la escribe el CLI. */
function turnoCc(
  cwd: string,
  uso: Record<string, number>,
  extra: Record<string, unknown> = {}
): object {
  return {
    type: 'assistant',
    isSidechain: false,
    cwd,
    sessionId: 'sess-1',
    timestamp: '2026-08-01T10:00:00Z',
    message: { role: 'assistant', model: 'claude-opus-5', usage: uso },
    ...extra
  }
}

/** Frontera de compactado: lo que escribe el CLI al terminar un `/compact`. */
function compactacionCc(post: number, marcaTemporal: string, trigger = 'manual'): object {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    isSidechain: false,
    content: 'Conversation compacted',
    timestamp: marcaTemporal,
    compactMetadata: { trigger, preTokens: 255_770, postTokens: post }
  }
}

/** Evento `token_count` de Codex: el acumulado de sesión y el del último turno. */
function codexTokens(ultimoTotal: number, ventana: number): object {
  return {
    timestamp: '2026-08-01T10:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        // Acumulado de TODA la sesión: decenas de millones. No es el contexto.
        total_token_usage: { input_tokens: 74_878_898, total_tokens: 75_010_356 },
        last_token_usage: {
          input_tokens: ultimoTotal - 215,
          cached_input_tokens: 173_824,
          output_tokens: 215,
          total_tokens: ultimoTotal
        },
        model_context_window: ventana
      },
      rate_limits: null
    }
  }
}

async function main(): Promise<void> {
  const raiz = await mkdtemp(path.join(tmpdir(), 'tessera-context-test-'))
  const lector = new LectorContexto()

  // ---------------------------------------------------------------------------
  // Claude Code: dos proyectos en la MISMA cuenta, cada uno con su chat.
  // ---------------------------------------------------------------------------
  const ccBase = path.join(raiz, 'cc')
  const cwdAlpha = '/workspace/Alpha'
  const cwdBeta = '/workspace/Beta'

  // Chat de Alpha: el turno bueno es el ÚLTIMO, y hay un subagente DESPUÉS que no
  // debe contar (es el caso que inflaría el anillo si se colara).
  await escribirJsonl(
    path.join(ccBase, 'projects', '-workspace-Alpha', 'sess-1.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoCc(cwdAlpha, { input_tokens: 4, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }),
      turnoCc(cwdAlpha, { input_tokens: 2, cache_creation_input_tokens: 397, cache_read_input_tokens: 623_251, output_tokens: 1086 }),
      turnoCc(cwdAlpha, { input_tokens: 9, cache_creation_input_tokens: 0, cache_read_input_tokens: 40_000, output_tokens: 10 }, { isSidechain: true })
    ],
    new Date('2026-08-01T12:00:00Z')
  )
  // Chat de Beta, MÁS RECIENTE: si el filtro por proyecto no funcionase, Alpha
  // acabaría enseñando este número.
  await escribirJsonl(
    path.join(ccBase, 'projects', '-workspace-Beta', 'sess-2.jsonl'),
    [
      { type: 'user', cwd: cwdBeta, message: { role: 'user', content: 'hey' } },
      turnoCc(cwdBeta, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 30_000, output_tokens: 100 })
    ],
    new Date('2026-08-01T13:00:00Z')
  )
  // Hilo de subagente en fichero aparte: se excluye por ruta (`subagents/`).
  await escribirJsonl(
    path.join(ccBase, 'projects', '-workspace-Alpha', 'sess-1', 'subagents', 'agent-x.jsonl'),
    [turnoCc(cwdAlpha, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 999_999, output_tokens: 1 })],
    new Date('2026-08-01T14:00:00Z')
  )

  const alpha = await lector.leer(ccBase, 'claude-code', 'Alpha')
  const ESPERADO_ALPHA = 2 + 397 + 623_251 + 1086
  check(
    '(a) Claude: contexto = input + cache_creation + cache_read + output del último turno',
    alpha.tokensUsados === ESPERADO_ALPHA,
    `tokensUsados=${alpha.tokensUsados} (esperado ${ESPERADO_ALPHA}) · model=${alpha.modelo}`
  )
  check(
    '(b) Claude: los subagentes (isSidechain y `subagents/`) NO cuentan',
    alpha.tokensUsados === ESPERADO_ALPHA && alpha.sesionId === 'sess-1',
    `sessionId=${alpha.sesionId} tokensUsados=${alpha.tokensUsados} (un sidechain de 40k y otro de 1M quedaron fuera)`
  )

  const beta = await lector.leer(ccBase, 'claude-code', 'Beta')
  check(
    '(c) se mide el chat del PROYECTO del panel, no el más reciente de la cuenta',
    beta.tokensUsados === 1 + 30_000 + 100 && alpha.tokensUsados === ESPERADO_ALPHA,
    `Beta=${beta.tokensUsados} Alpha=${alpha.tokensUsados} (Beta es el más reciente y no contaminó a Alpha)`
  )
  check(
    '(f) Claude: ventana estimada por modelo (opus-5 -> 1M) y marcada como estimación',
    alpha.tokensVentana === 1_000_000 && alpha.ventanaEstimada === true && Math.round(alpha.porcentaje) === 62,
    `window=${alpha.tokensVentana} estimada=${alpha.ventanaEstimada} percent=${alpha.porcentaje.toFixed(1)}%`
  )

  // (d) Transcript LARGO: relleno > BYTES_COLA (256 KiB) ANTES del último turno.
  const baseGrande = path.join(raiz, 'cc-big')
  const relleno = Array.from({ length: 1500 }, () =>
    turnoCc(cwdAlpha, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 5, output_tokens: 1 }, {
      padding: 'x'.repeat(200)
    })
  )
  await escribirJsonl(
    path.join(baseGrande, 'projects', '-workspace-Alpha', 'sess-big.jsonl'),
    [...relleno, turnoCc(cwdAlpha, { input_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 150_000, output_tokens: 90 })],
    new Date('2026-08-01T15:00:00Z')
  )
  const lecturaGrande = await lector.leer(baseGrande, 'claude-code', 'Alpha')
  check(
    '(d) transcript de > 256 KiB: se lee por la COLA (el último turno, no el primero)',
    lecturaGrande.tokensUsados === 3 + 7 + 150_000 + 90,
    `tokensUsados=${lecturaGrande.tokensUsados} (esperado ${3 + 7 + 150_000 + 90})`
  )

  // (d2) Mientras el modelo piensa, la última línea es la petición entera a la API, más grande que la cola.
  const peticionBase = path.join(raiz, 'cc-peticion')
  await escribirJsonl(
    path.join(peticionBase, 'projects', '-workspace-Alpha', 'sess-peticion.jsonl'),
    [
      turnoCc(cwdAlpha, { input_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 150_000, output_tokens: 90 }),
      { type: 'api-request', cwd: cwdAlpha, timestamp: '2026-08-01T15:01:00Z', cuerpo: 'x'.repeat(900 * 1024) }
    ],
    new Date('2026-08-01T15:01:00Z')
  )
  const peticion = await lector.leer(peticionBase, 'claude-code', 'Alpha')
  check(
    '(d2) con una línea final mayor que la cola (la petición a la API), el anillo sigue en el último turno, no en 0',
    peticion.tokensUsados === 3 + 7 + 150_000 + 90,
    `tokensUsados=${peticion.tokensUsados}`
  )

  // (d3) Un mensaje sintético con el uso a 0 en la cola no basta: la cola sigue creciendo hasta el turno.
  // Las peticiones suman más de 1 MiB para que la ventana crecida también recorte.
  const sinteticoBase = path.join(raiz, 'cc-sintetico')
  const peticionGrande = (n: number): Record<string, unknown> => ({ type: 'api-request', cwd: cwdAlpha, timestamp: `2026-08-01T15:0${n}:00Z`, cuerpo: 'x'.repeat(700 * 1024) })
  await escribirJsonl(
    path.join(sinteticoBase, 'projects', '-workspace-Alpha', 'sess-sintetico.jsonl'),
    [
      peticionGrande(0),
      turnoCc(cwdAlpha, { input_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 90_000, output_tokens: 6 }),
      peticionGrande(1),
      peticionGrande(2),
      { ...turnoCc(cwdAlpha, { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }), timestamp: '2026-08-01T15:03:00Z' }
    ],
    new Date('2026-08-01T15:03:00Z')
  )
  const sintetico = await lector.leer(sinteticoBase, 'claude-code', 'Alpha')
  check('(d3) un mensaje sintético con el uso a 0 no corta la búsqueda: el anillo da el último turno real', sintetico.tokensUsados === 4 + 90_000 + 6, `tokensUsados=${sintetico.tokensUsados}`)

  // ---------------------------------------------------------------------------
  // Codex
  // ---------------------------------------------------------------------------
  const codexBase = path.join(raiz, 'codex')
  await escribirJsonl(
    path.join(codexBase, 'sessions', '2026', '08', '01', 'rollout-2026-08-01T10-00-00-019f8c59-8805-7e00-889b-5e44df0ad959.jsonl'),
    [
      { timestamp: '2026-08-01T10:00:00Z', type: 'session_meta', payload: { session_id: '019f8c59-8805-7e00-889b-5e44df0ad959', cwd: cwdAlpha } },
      codexTokens(50_000, 258_400),
      codexTokens(179_930, 258_400)
    ],
    new Date('2026-08-01T16:00:00Z')
  )
  const codex = await lector.leer(codexBase, 'codex', 'Alpha')
  check(
    '(e) Codex: last_token_usage + model_context_window (exacto), sin colar el acumulado',
    codex.tokensUsados === 179_930 &&
      codex.tokensVentana === 258_400 &&
      !codex.ventanaEstimada &&
      Math.round(codex.porcentaje) === 70,
    `used=${codex.tokensUsados} window=${codex.tokensVentana} percent=${codex.porcentaje.toFixed(1)}% estimada=${!!codex.ventanaEstimada}`
  )

  // (f2) Promoción de la ventana: tabla desfasada -> nunca un porcentaje imposible.
  check(
    '(f2) ventana estimada: se promociona al escalón siguiente si lo observado la supera',
    estimarVentanaClaude('modelo-desconocido', 120_000) === 200_000 &&
      estimarVentanaClaude('modelo-desconocido', 350_000) === 500_000 &&
      estimarVentanaClaude('modelo-desconocido', 900_000) === 1_000_000 &&
      estimarVentanaClaude('claude-opus-5', 623_650) === 1_000_000,
    `120k->${estimarVentanaClaude('x', 120_000)} 350k->${estimarVentanaClaude('x', 350_000)} 900k->${estimarVentanaClaude('x', 900_000)}`
  )

  // ---------------------------------------------------------------------------
  // (g) Estados sin dato
  // ---------------------------------------------------------------------------
  const vacio = await lector.leer(ccBase, 'claude-code', 'Gamma')
  check(
    "(g) proyecto sin ninguna conversación -> 'no-session'",
    vacio.noDisponible === 'no-session' && vacio.porcentaje === 0,
    `unavailable=${vacio.noDisponible}`
  )

  const nuevoBase = path.join(raiz, 'cc-nuevo')
  await escribirJsonl(
    path.join(nuevoBase, 'projects', '-workspace-Alpha', 'sess-nuevo.jsonl'),
    [{ type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } }],
    new Date('2026-08-01T17:00:00Z')
  )
  const nuevo = await lector.leer(nuevoBase, 'claude-code', 'Alpha')
  check(
    "(g2) chat abierto pero aún sin turnos del agente -> 'no-data' (no 'no-session')",
    nuevo.noDisponible === 'no-data',
    `unavailable=${nuevo.noDisponible}`
  )

  // ---------------------------------------------------------------------------
  // (i)(j) Compactar: la frontera cuenta como evento que cambia el contexto.
  // ---------------------------------------------------------------------------
  const compBase = path.join(raiz, 'cc-compact')
  const archivoCompactacion = path.join(compBase, 'projects', '-workspace-Alpha', 'sess-comp.jsonl')
  const turnoGordo = turnoCc(
    cwdAlpha,
    { input_tokens: 2, cache_creation_input_tokens: 768, cache_read_input_tokens: 253_000, output_tokens: 2000 },
    { timestamp: '2026-08-02T10:00:00Z' }
  )
  await escribirJsonl(
    archivoCompactacion,
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoGordo,
      compactacionCc(10_646, '2026-08-02T10:05:00Z')
    ],
    new Date('2026-08-02T10:05:00Z')
  )
  const compactado = await lector.leer(compBase, 'claude-code', 'Alpha')
  check(
    '(i) compactar baja el anillo YA: manda postTokens, no el turno anterior',
    compactado.tokensUsados === 10_646 &&
      compactado.compactado === true &&
      compactado.observadoEn === Date.parse('2026-08-02T10:05:00Z'),
    `used=${compactado.tokensUsados} (el turno previo era 255770) compacted=${compactado.compactado}`
  )
  check(
    '(i2) tras compactar la ventana sigue siendo la del modelo (no se pierde el modelo)',
    compactado.tokensVentana === 1_000_000 && compactado.modelo === 'claude-opus-5',
    `window=${compactado.tokensVentana} model=${compactado.modelo} percent=${compactado.porcentaje.toFixed(1)}%`
  )

  // Mismo fichero, con un turno DESPUÉS de la frontera: ese es el bueno.
  await escribirJsonl(
    archivoCompactacion,
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoGordo,
      compactacionCc(10_646, '2026-08-02T10:05:00Z'),
      turnoCc(
        cwdAlpha,
        { input_tokens: 2, cache_creation_input_tokens: 12_211, cache_read_input_tokens: 63_811, output_tokens: 778 },
        { timestamp: '2026-08-02T10:09:00Z' }
      )
    ],
    new Date('2026-08-02T10:09:00Z')
  )
  lector.invalidate()
  const trasCompactar = await lector.leer(compBase, 'claude-code', 'Alpha')
  check(
    '(j) con turnos POSTERIORES a la frontera, manda el turno (la frontera ya caducó)',
    trasCompactar.tokensUsados === 2 + 12_211 + 63_811 + 778 && !trasCompactar.compactado,
    `used=${trasCompactar.tokensUsados} compacted=${!!trasCompactar.compactado}`
  )

  // ---------------------------------------------------------------------------
  // (k) `/clear`: el chat vivo pasa a ser uno sin turnos.
  // ---------------------------------------------------------------------------
  const baseConversacionNueva = path.join(raiz, 'cc-clear')
  const dirConversacionNueva = path.join(baseConversacionNueva, 'projects', '-workspace-Alpha')
  await escribirJsonl(
    path.join(dirConversacionNueva, 'sess-viejo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoCc(
        cwdAlpha,
        { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 750_000, output_tokens: 0 },
        { timestamp: '2026-08-02T11:00:00Z' }
      )
    ],
    new Date('2026-08-02T11:00:00Z')
  )
  // Lo que el CLI escribe al hacer `/clear`: fichero NUEVO, el comando, y nada más.
  await escribirJsonl(
    path.join(dirConversacionNueva, 'sess-limpio.jsonl'),
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
  const limpio = await lector.leer(baseConversacionNueva, 'claude-code', 'Alpha')
  check(
    "(k) tras `/clear` -> 'no-data', NO el 75 % del chat que se acaba de cerrar",
    limpio.noDisponible === 'no-data' && limpio.tokensUsados === 0,
    `unavailable=${limpio.noDisponible} used=${limpio.tokensUsados} (el chat anterior tenía 750k)`
  )

  // ---------------------------------------------------------------------------
  // (l) El mtime miente: el CLI toca ficheros de chats ya muertos.
  // ---------------------------------------------------------------------------
  const mtimeBase = path.join(raiz, 'cc-mtime')
  const dirFechaModificacion = path.join(mtimeBase, 'projects', '-workspace-Alpha')
  await escribirJsonl(
    path.join(dirFechaModificacion, 'sess-vivo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoCc(
        cwdAlpha,
        { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 30_000, output_tokens: 0 },
        { timestamp: '2026-08-03T12:00:00Z' }
      )
    ],
    new Date('2026-08-03T12:00:00Z')
  )
  // Chat de hace días, pero recién TOCADO (mtime de hoy): no debe ganar.
  await escribirJsonl(
    path.join(dirFechaModificacion, 'sess-muerto.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoCc(
        cwdAlpha,
        { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 900_000, output_tokens: 0 },
        { timestamp: '2026-07-28T09:00:00Z' }
      ),
      { type: 'last-prompt', leafUuid: 'x' }
    ],
    new Date('2026-08-03T13:00:00Z')
  )
  const vivo = await lector.leer(mtimeBase, 'claude-code', 'Alpha')
  check(
    '(l) el chat vivo se elige por la hora INTERNA, no por el mtime del fichero',
    vivo.tokensUsados === 30_000,
    `used=${vivo.tokensUsados} (el difunto, con mtime posterior, tenía 900k)`
  )

  // ---------------------------------------------------------------------------
  // (h) Caché con TTL + invalidate (lo que hace main al ver escribir al agente)
  // ---------------------------------------------------------------------------
  let reloj = Date.parse('2026-08-01T18:00:00Z')
  const crono = new LectorContexto(() => reloj)
  const cacheBase = path.join(raiz, 'cc-cache')
  const archivo = path.join(cacheBase, 'projects', '-workspace-Alpha', 'sess-c.jsonl')
  await escribirJsonl(
    archivo,
    [turnoCc(cwdAlpha, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 10_000, output_tokens: 0 })],
    new Date('2026-08-01T18:00:00Z')
  )
  const antes = await crono.leer(cacheBase, 'claude-code', 'Alpha')
  await escribirJsonl(
    archivo,
    [turnoCc(cwdAlpha, { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 90_000, output_tokens: 0 })],
    new Date('2026-08-01T18:05:00Z')
  )
  const durante = await crono.leer(cacheBase, 'claude-code', 'Alpha')
  crono.invalidate()
  const despues = await crono.leer(cacheBase, 'claude-code', 'Alpha')
  check(
    '(h) dentro del TTL se devuelve lo cacheado; invalidate() trae el número nuevo',
    antes.tokensUsados === 10_001 && durante.tokensUsados === 10_001 && despues.tokensUsados === 90_001,
    `antes=${antes.tokensUsados} durante(TTL)=${durante.tokensUsados} tras invalidate=${despues.tokensUsados}`
  )
  reloj += 60_000 // por si acaso: el TTL vencido también debe traer el dato nuevo
  const vencido = await crono.leer(cacheBase, 'claude-code', 'Alpha')
  check(
    '(h2) vencido el TTL, la lectura vuelve al disco',
    vencido.tokensUsados === 90_001,
    `tokensUsados=${vencido.tokensUsados}`
  )

  // ---------------------------------------------------------------------------
  // (m) EL BUG DEL ANILLO, de extremo a extremo. Reanudas un chat viejo, sacas lo
  //     que necesitabas y vuelves al nuevo. Desde ese momento el nuevo NO recibe
  //     ningún evento, así que el reanudado conserva el último y —sin ancla— gana.
  // ---------------------------------------------------------------------------
  const baseFallo = path.join(raiz, 'cc-bug')
  const dirFallo = path.join(baseFallo, 'projects', '-workspace-Alpha')
  // Chat NUEVO (el que tienes delante): creado por `/clear`, sin un solo turno.
  await escribirJsonl(
    path.join(dirFallo, 'sess-nuevo.jsonl'),
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
  await escribirJsonl(
    path.join(dirFallo, 'sess-viejo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoCc(
        cwdAlpha,
        { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 750_000, output_tokens: 0 },
        { timestamp: '2026-08-05T11:30:00Z' }
      )
    ],
    new Date('2026-08-05T11:30:00Z')
  )
  const sinAncla = await lector.leer(baseFallo, 'claude-code', 'Alpha')
  check(
    '(m) SIN ancla el chat reanudado se lleva el anillo (el fallo que se arregla)',
    sinAncla.tokensUsados === 750_002 && sinAncla.anclaje === 'heuristica',
    `used=${sinAncla.tokensUsados} anclaje=${sinAncla.anclaje}`
  )

  let relojAncla = Date.parse('2026-08-05T11:35:00Z')
  const anclas = crearRegistroAnclas(() => relojAncla)
  const conAncla = new LectorContexto(() => relojAncla, anclas)
  anclas.anclar(claveAncla('claude-code', baseFallo, 'Alpha'), 'sess-nuevo')
  const anclado = await conAncla.leer(baseFallo, 'claude-code', 'Alpha')
  check(
    "(m2) CON ancla al chat nuevo -> 'no-data' (0 %), no el 75 % del reanudado",
    anclado.noDisponible === 'no-data' && anclado.anclaje === 'sesion',
    `unavailable=${anclado.noDisponible} used=${anclado.tokensUsados} anclaje=${anclado.anclaje}`
  )

  // (n) …y si te cambias de chat DENTRO del TUI, el envío re-ancla: el transcript que
  //     se mueve después de tu Enter pasa a ser el medido.
  anclas.marcarEnvio(claveAncla('claude-code', baseFallo, 'Alpha')) // Enter a las 11:35
  await escribirJsonl(
    path.join(dirFallo, 'sess-viejo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoCc(
        cwdAlpha,
        { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 750_000, output_tokens: 0 },
        { timestamp: '2026-08-05T11:36:00Z' }
      )
    ],
    new Date('2026-08-05T11:36:00Z')
  )
  relojAncla = Date.parse('2026-08-05T11:36:30Z')
  conAncla.invalidate()
  const reanclado = await conAncla.leer(baseFallo, 'claude-code', 'Alpha')
  check(
    '(n) el chat que recibe tu envío se convierte en el medido (re-anclaje por evidencia)',
    reanclado.tokensUsados === 750_002 && reanclado.anclaje === 'sesion',
    `used=${reanclado.tokensUsados} anclaje=${reanclado.anclaje}`
  )

  // ---------------------------------------------------------------------------
  // (o) Codex escribe los rollouts de SUBAGENTE en la MISMA carpeta `sessions/` y
  //     con el MISMO `cwd` que su padre. Mientras uno corre tiene el evento más
  //     reciente, así que sin excluirlo el anillo saltaba a SU ventana.
  // ---------------------------------------------------------------------------
  const subBase = path.join(raiz, 'codex-sub')
  await escribirJsonl(
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
  await escribirJsonl(
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
  const conSubagente = await lector.leer(subBase, 'codex', 'Alpha')
  check(
    '(o) el rollout de SUBAGENTE de Codex no se mide (es otra ventana)',
    conSubagente.tokensUsados === 50_000,
    `used=${conSubagente.tokensUsados} (el subagente, más reciente, tenía 250k)`
  )

  // ---------------------------------------------------------------------------
  // (p) El chat anclado se examina aunque no esté entre los MAX_CANDIDATOS más
  //     recientes por mtime: el CLI toca punteros de otros chats sin parar, y sin
  //     este rescate un chat al que llevas un rato sin escribir queda enterrado.
  // ---------------------------------------------------------------------------
  const hondoBase = path.join(raiz, 'cc-hondo')
  const hondoDir = path.join(hondoBase, 'projects', '-workspace-Alpha')
  await escribirJsonl(
    path.join(hondoDir, 'sess-hondo.jsonl'),
    [
      { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'hola' } },
      turnoCc(
        cwdAlpha,
        { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 12_345, output_tokens: 0 },
        { timestamp: '2026-08-07T08:00:00Z' }
      )
    ],
    new Date('2026-08-07T08:00:00Z') // el MÁS VIEJO de todos
  )
  for (let i = 0; i < 30; i++) {
    await escribirJsonl(
      path.join(hondoDir, `sess-ruido-${i}.jsonl`),
      [
        { type: 'user', cwd: cwdAlpha, message: { role: 'user', content: 'x' } },
        turnoCc(
          cwdAlpha,
          { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 999_000, output_tokens: 0 },
          { timestamp: '2026-08-07T09:00:00Z' }
        )
      ],
      new Date(Date.parse('2026-08-07T09:00:00Z') + i * 1000)
    )
  }
  const anclasHondo = crearRegistroAnclas(() => Date.parse('2026-08-07T10:00:00Z'))
  const lectorHondo = new LectorContexto(() => Date.parse('2026-08-07T10:00:00Z'), anclasHondo)
  anclasHondo.anclar(claveAncla('claude-code', hondoBase, 'Alpha'), 'sess-hondo')
  const hondo = await lectorHondo.leer(hondoBase, 'claude-code', 'Alpha')
  check(
    '(p) el chat anclado se rescata aunque quede fuera de la criba por mtime',
    hondo.tokensUsados === 12_346,
    `used=${hondo.tokensUsados} (los 30 de ruido tenían 999k y mtime posterior)`
  )

  // (q) Un chat que EMPIEZA pegando una imagen grande: su primera línea (la del `cwd`) son
  //     megas de base64. Con un corte fijo de la cabeza la línea quedaba partida, el `cwd` se
  //     perdía y el chat no contaba como del proyecto: anillo vacío.
  const imagenBase = path.join(raiz, 'cc-imagen')
  const imagenGrande = 'iVBORw0KGgo'.repeat(300_000) // ~3,3 MB de base64
  await escribirJsonl(
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
      turnoCc(cwdAlpha, { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 20_000, output_tokens: 7 })
    ],
    new Date('2026-08-01T16:00:00Z')
  )
  const conImagen = await lector.leer(imagenBase, 'claude-code', 'Alpha')
  check(
    '(q) un chat cuya primera línea es una imagen de megas conserva su `cwd` y su anillo',
    conImagen.tokensUsados === 5 + 20_000 + 7,
    `used=${conImagen.tokensUsados} (esperado ${5 + 20_000 + 7})`
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
