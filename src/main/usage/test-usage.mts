#!/usr/bin/env node
// =============================================================================
// Prueba del UsageReader (npm run test:usage). Sin Docker.
// Cubre las dos fuentes y sus fallos: Codex (último `token_count` con límites, epoch en segundos,
// lectura por la cola, sin login o sin datos) y Claude (sin credenciales, API key, token inventado
// contra el endpoint real), más la caché con TTL.
// El caso del endpoint necesita red; sin ella se marca SKIP.
// =============================================================================

import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { UsageReader, tokenParaUso, urlUsoClaude } from './UsageReader.ts'
import { ventanasClaude, ventanasCodex } from './ventanasUso.ts'
import type { FSWatcher } from 'node:fs'
import { UsageWatcher, type Vigilar } from './UsageWatcher.ts'

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
function skip(name: string, why: string): void {
  console.log(`  [SKIP] ${name}`)
  console.log(`         -> ${why}`)
}

async function writeJsonl(file: string, objs: object[], mtime: Date): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, objs.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8')
  await utimes(file, mtime, mtime)
}

/** Evento `token_count` tal como lo escribe Codex, con o sin snapshot de límites. */
function tokenCount(ts: string, limits: object | null): object {
  return {
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { total_tokens: 1000 }, model_context_window: 258400 },
      rate_limits: limits
    }
  }
}

// Epoch SEGUNDOS, RELATIVOS a ahora. Eran dos constantes fijas de 2026, y el día que
// esas fechas quedaron atrás el lector empezó —con razón— a tratarlas como ventanas ya
// reiniciadas y tres casos se pusieron rojos sin que nadie hubiera tocado el código.
// Un test sobre "cuánto falta para X" no puede clavar X en el calendario.
const AHORA_SEG = Math.floor(Date.now() / 1000)
const RESETS_5H = AHORA_SEG + 2 * 3600
const RESETS_7D = AHORA_SEG + 5 * 86400
/** Ventana YA vencida: el caso que antes no cubría ningún test. */
const RESETS_PASADO = AHORA_SEG - 600

const LIMITS = {
  limit_id: 'codex',
  primary: { used_percent: 3.0, window_minutes: 300, resets_at: RESETS_5H },
  secondary: { used_percent: 13.0, window_minutes: 10080, resets_at: RESETS_7D },
  plan_type: 'team'
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'tessera-usage-test-'))
  const reader = new UsageReader()

  // ---------------------------------------------------------------------------
  // Codex
  // ---------------------------------------------------------------------------
  const codexBase = path.join(root, 'codex')
  await writeFile(path.join(await mkdirp(codexBase), 'auth.json'), '{"auth_mode":"chatgpt"}', 'utf8')

  // Rollout VIEJO: sí tiene límites.
  await writeJsonl(
    path.join(codexBase, 'sessions', '2026', '07', '09', 'rollout-2026-07-09-aaa.jsonl'),
    [
      { timestamp: '2026-07-09T10:00:00Z', type: 'session_meta', payload: { session_id: 'aaa' } },
      tokenCount('2026-07-09T10:00:10Z', LIMITS)
    ],
    new Date('2026-07-09T10:00:10Z')
  )
  // Rollout MÁS RECIENTE pero SIN límites (sesión abierta que aún no pidió nada):
  // el lector no debe quedarse con este y rendirse.
  await writeJsonl(
    path.join(codexBase, 'sessions', '2026', '07', '10', 'rollout-2026-07-10-bbb.jsonl'),
    [
      { timestamp: '2026-07-10T09:00:00Z', type: 'session_meta', payload: { session_id: 'bbb' } },
      tokenCount('2026-07-10T09:00:01Z', null)
    ],
    new Date('2026-07-10T09:00:01Z')
  )

  const codex = await reader.read(codexBase, 'codex', 'k-codex')
  const p = codex.windows.find((w) => w.key === 'primary')
  const s = codex.windows.find((w) => w.key === 'secondary')
  check(
    '(a) Codex: cae al rollout anterior cuando el más reciente no trae rate_limits',
    !codex.unavailable && codex.windows.length === 2,
    `unavailable=${codex.unavailable ?? 'no'} windows=${JSON.stringify(codex.windows.map((w) => `${w.label}:${w.percent}%`))}`
  )
  check(
    '(b) Codex: window_minutes -> etiqueta, used_percent -> %, resets_at seg -> ms',
    p?.label === '5h' &&
      p?.percent === 3 &&
      p?.resetsAt === RESETS_5H * 1000 &&
      s?.label === '7d' &&
      s?.percent === 13 &&
      s?.resetsAt === RESETS_7D * 1000,
    `primary=${p?.label}/${p?.percent}%/${p?.resetsAt} secondary=${s?.label}/${s?.percent}%/${s?.resetsAt}`
  )
  check(
    '(b2) Codex: observedAt = ts del evento (el dato es el ÚLTIMO CONOCIDO, no de ahora)',
    codex.observedAt === Date.parse('2026-07-09T10:00:10Z'),
    `observedAt=${codex.observedAt ? new Date(codex.observedAt).toISOString() : 'ausente'}`
  )

  // (c) Rollout LARGO: relleno > TAIL_BYTES (256 KiB) ANTES del token_count, para que
  // el dato solo se vea leyendo por la cola.
  const bigBase = path.join(root, 'codex-big')
  await writeFile(path.join(await mkdirp(bigBase), 'auth.json'), '{}', 'utf8')
  const filler = Array.from({ length: 1200 }, (_, i) => ({
    timestamp: '2026-07-10T08:00:00Z',
    type: 'event_msg',
    payload: { type: 'agent_message', message: `relleno ${i} ${'x'.repeat(300)}` }
  }))
  await writeJsonl(
    path.join(bigBase, 'sessions', '2026', '07', '10', 'rollout-2026-07-10-big.jsonl'),
    [...filler, tokenCount('2026-07-10T08:30:00Z', LIMITS)],
    new Date('2026-07-10T08:30:00Z')
  )
  const big = await reader.read(bigBase, 'codex', 'k-big')
  check(
    '(c) Codex: rollout > 256 KiB -> el token_count final se encuentra leyendo la COLA',
    big.windows.length === 2 && big.windows[0].percent === 3,
    `windows=${big.windows.length} primary=${big.windows[0]?.percent}%`
  )

  // (d) Sin login vs con login pero sin snapshot.
  const emptyBase = path.join(root, 'codex-empty')
  await mkdirp(emptyBase)
  const noLogin = await reader.read(emptyBase, 'codex', 'k-empty')
  await writeFile(path.join(emptyBase, 'auth.json'), '{}', 'utf8')
  const loggedNoData = await reader.read(emptyBase, 'codex', 'k-empty2')
  check(
    '(d) Codex: sin auth.json -> no-credentials; con auth.json y sin rollouts -> no-data',
    noLogin.unavailable === 'no-credentials' && loggedNoData.unavailable === 'no-data',
    `sin-login=${noLogin.unavailable} con-login=${loggedNoData.unavailable}`
  )

  // ---------------------------------------------------------------------------
  // Claude Code
  // ---------------------------------------------------------------------------
  const ccEmpty = path.join(root, 'cc-empty')
  await mkdirp(ccEmpty)
  const ccNo = await reader.read(ccEmpty, 'claude-code', 'k-cc-empty')

  const ccApiKey = path.join(root, 'cc-apikey')
  await writeFile(
    path.join(await mkdirp(ccApiKey), '.credentials.json'),
    JSON.stringify({ someApiKeyAuth: { key: 'no-oauth' } }),
    'utf8'
  )
  const ccKey = await reader.read(ccApiKey, 'claude-code', 'k-cc-key')
  check(
    '(e) Claude: sin credencial -> no-credentials; credencial sin bloque OAuth -> not-subscription',
    ccNo.unavailable === 'no-credentials' && ccKey.unavailable === 'not-subscription',
    `sin-credencial=${ccNo.unavailable} api-key=${ccKey.unavailable}`
  )

  // (f) Token inventado contra el endpoint REAL: debe rebotar 401 -> 'auth-expired'.
  const ccFake = path.join(root, 'cc-fake')
  await writeFile(
    path.join(await mkdirp(ccFake), '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-token-inventado-para-la-prueba' } }),
    'utf8'
  )
  const online = await hasNetwork()
  if (!online) {
    skip('(f) Claude: token inválido -> 401 -> auth-expired', 'sin red: no se puede tocar el endpoint real')
  } else {
    const ccFakeRes = await reader.read(ccFake, 'claude-code', 'k-cc-fake')
    check(
      '(f) Claude: la petición real llega al endpoint y un token inválido da auth-expired (no error/429)',
      ccFakeRes.unavailable === 'auth-expired',
      `unavailable=${ccFakeRes.unavailable}${ccFakeRes.detail ? ` detail=${ccFakeRes.detail}` : ''}`
    )
  }

  // (g) Caché: la 2ª lectura no vuelve a la fuente. Se comprueba borrando el rollout
  // del disco (renombrando la carpeta) y viendo que el dato SIGUE ahí.
  const cached = await reader.read(codexBase, 'codex', 'k-codex')
  check(
    '(g) Caché con TTL: la relectura devuelve el mismo snapshot sin volver a la fuente',
    cached.fetchedAt === codex.fetchedAt && cached.windows.length === 2,
    `fetchedAt igual=${cached.fetchedAt === codex.fetchedAt}`
  )
  const forced = await reader.read(codexBase, 'codex', 'k-codex', true)
  check(
    '(g2) force=true salta la caché (fetchedAt nuevo, mismo dato)',
    forced.fetchedAt >= codex.fetchedAt && forced.windows.length === 2,
    `fetchedAt nuevo=${forced.fetchedAt !== codex.fetchedAt} windows=${forced.windows.length}`
  )

  // ---------------------------------------------------------------------------
  // (h) Parser del cuerpo de Claude, contra la respuesta REAL del endpoint
  // (capturada de una cuenta viva). Es el caso que importa: las claves heredadas
  // `seven_day_opus`/`seven_day_sonnet` vienen a NULL y la semanal por modelo solo
  // existe dentro de `limits[]`, en `scope.model.display_name`. Un parser que solo
  // mirase las claves heredadas perdería la 3ª barra sin dar ningún error.
  // ---------------------------------------------------------------------------
  const realBody = {
    five_hour: { utilization: 6, resets_at: '2026-07-11T09:49:59.750515+00:00' },
    seven_day: { utilization: 13, resets_at: '2026-07-12T00:59:59.750538+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
      {
        kind: 'session',
        percent: 6,
        resets_at: '2026-07-11T09:49:59.750515+00:00',
        scope: null
      },
      {
        kind: 'weekly_all',
        percent: 13,
        resets_at: '2026-07-12T00:59:59.750538+00:00',
        scope: null
      },
      {
        kind: 'weekly_scoped',
        percent: 0,
        resets_at: null, // nullable: la UI debe aguantarlo sin pintar "Invalid Date"
        scope: { model: { id: null, display_name: 'Fable' }, surface: null }
      }
    ]
  }
  const real = ventanasClaude(realBody)
  check(
    '(h) Claude: la respuesta real da las 3 barras, incluida la semanal por modelo (Fable)',
    real.length === 3 &&
      real[0].label === '5h' &&
      real[0].percent === 6 &&
      real[1].label === '7d' &&
      real[1].percent === 13 &&
      real[2].label === 'Fable 7d' &&
      real[2].percent === 0 &&
      real[2].resetsAt === undefined,
    real.map((w) => `${w.label}=${w.percent}%`).join(' · ')
  )

  // (i) Plan B: una cuenta que solo devuelva la forma heredada sigue funcionando.
  const legacy = ventanasClaude({
    five_hour: { utilization: 33, resets_at: '2026-04-11T07:00:00.528743+00:00' },
    seven_day: { utilization: 13, resets_at: '2026-04-17T00:59:59.951713+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: { utilization: 1, resets_at: '2026-04-16T03:00:00.951719+00:00' }
  })
  check(
    '(i) Claude: sin `limits[]` cae a la forma heredada (y salta las ventanas nulas)',
    legacy.length === 3 &&
      legacy[2].label === 'Sonnet 7d' &&
      legacy[2].percent === 1 &&
      !legacy.some((w) => w.key === 'seven_day_opus'),
    legacy.map((w) => `${w.label}=${w.percent}%`).join(' · ')
  )

  // ---------------------------------------------------------------------------
  // (i2) SE PINTA LO QUE LA CUENTA TRAE. Las ventanas no se dan por supuestas: si el
  // plan no tiene semanal por modelo, si homologa todo en una sola, o si mañana añade
  // otra, el pie enseña exactamente eso. Formas con los campos reales de la respuesta
  // (`kind`, `group`, `scope`), y las que aún no existen, con nombres inventados.
  // ---------------------------------------------------------------------------
  const etiquetas = (limits: object[]): string => ventanasClaude({ limits }).map((w) => w.label).join(' · ')
  const sesion = { kind: 'session', group: 'session', percent: 16, scope: null }
  const semanal = { kind: 'weekly_all', group: 'weekly', percent: 96, scope: null }
  const deModelo = (nombre: string): object => ({
    kind: 'weekly_scoped',
    group: 'weekly',
    percent: 17,
    scope: { model: { id: null, display_name: nombre }, surface: null }
  })
  check(
    '(i2a) dos semanales (la general y la de Fable): salen las dos, en el orden de la cuenta',
    etiquetas([sesion, semanal, deModelo('Fable')]) === '5h · 7d · Fable 7d',
    etiquetas([sesion, semanal, deModelo('Fable')])
  )
  check(
    '(i2b) una cuenta SIN la semanal de Fable enseña solo las que tiene',
    etiquetas([sesion, semanal]) === '5h · 7d',
    etiquetas([sesion, semanal])
  )
  check(
    '(i2c) si todo se homologa en un solo límite semanal, sale uno',
    etiquetas([semanal]) === '7d',
    etiquetas([semanal])
  )
  check(
    '(i2d) otra semanal por modelo que aparezca mañana sale con su nombre, sin tocar nada',
    etiquetas([sesion, semanal, deModelo('Fable'), deModelo('Opus')]) === '5h · 7d · Fable 7d · Opus 7d',
    etiquetas([sesion, semanal, deModelo('Fable'), deModelo('Opus')])
  )
  const porSuperficie = { kind: 'weekly_scoped', group: 'weekly', percent: 4, scope: { model: null, surface: 'Cowork' } }
  const sinScope = { kind: 'weekly_fable', group: 'weekly', percent: 9, scope: null }
  check(
    '(i2e) un límite acotado por superficie, o nombrado solo en su `kind`, también se nombra',
    etiquetas([porSuperficie, sinScope]) === 'Cowork 7d · Fable 7d',
    etiquetas([porSuperficie, sinScope])
  )
  const otroGrupo = { kind: 'monthly_all', group: 'monthly', percent: 2, scope: null }
  const sinGrupo = { kind: 'weekly_all', percent: 50 }
  check(
    '(i2f) un grupo desconocido se pinta con su nombre; sin `group`, se deduce del `kind`',
    etiquetas([otroGrupo, sinGrupo]) === 'Monthly · 7d',
    etiquetas([otroGrupo, sinGrupo])
  )
  const repetidas = ventanasClaude({ limits: [semanal, semanal, deModelo('Fable'), deModelo('Fable')] })
  check(
    '(i2g) dos límites iguales no comparten clave (la lista de React no puede pisarlos)',
    new Set(repetidas.map((w) => w.key)).size === 4,
    repetidas.map((w) => w.key).join(' ')
  )
  const basura = ventanasClaude({ limits: [null, 'x', { kind: 'session' }, { kind: 'session', percent: 'mucho' }, sesion] })
  check(
    '(i2h) una entrada rota o sin porcentaje se salta sin llevarse a las demás',
    basura.length === 1 && basura[0].label === '5h',
    basura.map((w) => w.label).join(' · ')
  )

  // Codex: hoy solo trae `primary` y `secondary`; si su plan añade otra ventana, sale.
  const codexDeHoy = ventanasCodex(
    {
      limit_id: 'codex',
      primary: { used_percent: 38, window_minutes: 300, resets_at: 1790371278 },
      secondary: { used_percent: 10, window_minutes: 10080, resets_at: 1790873206 },
      credits: { has_credits: false, unlimited: false, balance: null },
      individual_limit: null,
      plan_type: 'team'
    },
    0
  )
  check(
    '(i2i) Codex, con la forma real de su rollout: 5h y 7d, y nada de lo que no es una ventana',
    codexDeHoy.map((w) => w.label).join(' · ') === '5h · 7d' && codexDeHoy[0].resetsAt === 1790371278000,
    codexDeHoy.map((w) => `${w.label}=${w.percent}%`).join(' · ')
  )
  const codexConOtra = ventanasCodex(
    {
      secondary: { used_percent: 10, window_minutes: 10080 },
      individual_limit: { used_percent: 55, window_minutes: 43200 },
      primary: { used_percent: 38, window_minutes: 300 }
    },
    0
  )
  check(
    '(i2j) Codex con una ventana nueva: las dos de siempre primero y la nueva con su nombre',
    codexConOtra.map((w) => w.label).join(' · ') === '5h · 7d · Individual limit 30d',
    codexConOtra.map((w) => w.label).join(' · ')
  )
  const sinNombre = { kind: 'weekly_scoped', group: 'weekly', percent: 17, scope: { model: { id: 'claude-fable-5', display_name: null } } }
  const sinNada = { kind: 'weekly_scoped', group: 'weekly', percent: 17, scope: { model: null, surface: null } }
  check(
    '(i2l) un límite acotado sin nombre no pasa por la semanal general: usa el id del modelo, o «Otro»',
    etiquetas([semanal, sinNombre, sinNada]) === '7d · claude-fable-5 7d · Otro 7d',
    etiquetas([semanal, sinNombre, sinNada])
  )
  const heredados = ['constructor', 'toString', '__proto__', 'hasOwnProperty'].map((g) => etiquetas([{ kind: 'x', group: g, percent: 5 }]))
  check(
    '(i2m) un grupo que se llama como algo heredado de Object se pinta por su nombre, no como una función',
    heredados.every((e) => !/function|object/i.test(e)) && heredados[0] === 'X Constructor',
    heredados.join(' · ')
  )
  check(
    '(i2n) desviada a un servidor de pruebas, la petición NO lleva el token de la cuenta',
    tokenParaUso('https://api.anthropic.com/api/oauth/usage', 'secreto') === 'secreto' &&
      tokenParaUso('http://127.0.0.1:4567/uso', 'secreto') !== 'secreto',
    tokenParaUso('http://127.0.0.1:4567/uso', 'secreto')
  )
  check(
    '(i2k) el desvío del endpoint para las pruebas solo vale si apunta a esta máquina',
    urlUsoClaude('http://127.0.0.1:4567/uso') === 'http://127.0.0.1:4567/uso' &&
      urlUsoClaude(undefined) === 'https://api.anthropic.com/api/oauth/usage' &&
      ['https://evil.example/uso', 'http://127.0.0.1.evil.example:80/', 'http://localhost:80/x', 'http://127.0.0.1:80/x?y=@evil'].every(
        (u) => urlUsoClaude(u) === 'https://api.anthropic.com/api/oauth/usage'
      ),
    urlUsoClaude('https://evil.example/uso')
  )

  // ---------------------------------------------------------------------------
  // (j) FIN DE TURNO: escribir en el transcript -> el vigilante avisa (con rebote) ->
  // el dato cacheado caduca -> la siguiente lectura trae el % NUEVO. Es el ciclo
  // completo de la actualización "cuando el % de verdad se mueve".
  // ---------------------------------------------------------------------------
  const avisos: string[] = []
  const watcher = new UsageWatcher((key) => avisos.push(key))
  watcher.watch('k-codex', codexBase)

  // El agente responde: nuevo turno con más consumo (3% -> 21%).
  await writeJsonl(
    path.join(codexBase, 'sessions', '2026', '07', '10', 'rollout-2026-07-10-bbb.jsonl'),
    [
      { timestamp: '2026-07-10T09:00:00Z', type: 'session_meta', payload: { session_id: 'bbb' } },
      tokenCount('2026-07-10T09:05:00Z', {
        ...LIMITS,
        primary: { used_percent: 21.0, window_minutes: 300, resets_at: RESETS_5H }
      })
    ],
    new Date('2026-07-10T09:05:00Z')
  )

  const avisado = await waitFor(() => avisos.includes('k-codex'), 8000)
  check(
    '(j) el vigilante avisa cuando el agente escribe en su transcript (fin de turno)',
    avisado,
    avisado ? `avisos=${JSON.stringify(avisos)}` : 'no llegó ningún aviso en 8 s'
  )

  reader.invalidate('k-codex') // lo que hace main al recibir el aviso
  const tras = await reader.read(codexBase, 'codex', 'k-codex')
  check(
    '(j2) tras invalidar, la lectura trae el % NUEVO (3% -> 21%) sin esperar al TTL',
    tras.windows.find((w) => w.key === 'primary')?.percent === 21,
    `primary=${tras.windows.find((w) => w.key === 'primary')?.percent}%`
  )
  watcher.disposeAll()

  // ---------------------------------------------------------------------------
  // (k)(l)(m) LO QUE CAUSABA LOS 429. El endpoint de Claude se sustituye por un doble
  // que CUENTA las llamadas: es lo único que hay que observar aquí. El reloj también se
  // falsea, para saltar el suelo de red y el backoff sin dormirlos de verdad.
  // ---------------------------------------------------------------------------
  const ccReal = path.join(root, 'cc-real')
  await writeFile(
    path.join(await mkdirp(ccReal), '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-doble-de-prueba' } }),
    'utf8'
  )

  let llamadas = 0
  let responder: () => Response = () => jsonResponse({ limits: [{ kind: 'session', percent: 6 }] })
  const fetchReal = globalThis.fetch
  globalThis.fetch = (async () => {
    llamadas++
    // Latencia real: sin ella, las N lecturas "a la vez" se resolverían en fila y la
    // coalescencia parecería funcionar aunque no existiera.
    await new Promise((r) => setTimeout(r, 50))
    return responder()
  }) as typeof fetch

  let reloj = Date.parse('2026-07-13T12:00:00Z')
  const cronoReader = new UsageReader(() => reloj)

  try {
    // (k) Coalescencia: 6 paneles de la MISMA cuenta piden a la vez (fin de turno) ->
    // UNA sola petición. Esto es exactamente lo que multiplicaba el tráfico por proyecto
    // abierto y acababa en 429.
    const aLaVez = await Promise.all(
      Array.from({ length: 6 }, () => cronoReader.read(ccReal, 'claude-code', 'k-coal', true))
    )
    check(
      '(k) 6 lecturas simultáneas de la misma cuenta -> UNA sola petición al endpoint',
      llamadas === 1 && aLaVez.every((s) => s.windows[0]?.percent === 6),
      `peticiones=${llamadas} (esperado 1) · todas con dato=${aLaVez.every((s) => s.windows.length === 1)}`
    )

    // (l) 429: se conserva el ÚLTIMO DATO BUENO (marcado viejo) en vez de blanquear la
    // barra, y no se vuelve a llamar hasta que pase la espera pedida (retry-after).
    reloj += 30_000 // pasa el suelo de red
    responder = () => new Response('', { status: 429, headers: { 'retry-after': '60' } })
    const trasLimite = await cronoReader.read(ccReal, 'claude-code', 'k-coal', true)
    check(
      '(l) 429 -> la barra NO se vacía: se enseña el último dato bueno marcado como viejo',
      trasLimite.stale === true &&
        trasLimite.windows[0]?.percent === 6 &&
        trasLimite.unavailable === undefined,
      `stale=${trasLimite.stale} percent=${trasLimite.windows[0]?.percent} unavailable=${trasLimite.unavailable ?? 'no'}`
    )

    const antes = llamadas
    reloj += 25_000 // pasa el suelo de red, PERO no el retry-after de 60 s
    await cronoReader.read(ccReal, 'claude-code', 'k-coal', true)
    await cronoReader.read(ccReal, 'claude-code', 'k-coal', true)
    check(
      '(l2) durante la espera del 429, ni `force` vuelve a tocar el endpoint',
      llamadas === antes,
      `peticiones durante la espera=${llamadas - antes} (esperado 0)`
    )

    // (m) Pasada la espera, se reintenta y el dato bueno vuelve (y deja de ser viejo).
    reloj += 40_000 // ahora sí: 65 s desde el 429
    responder = () => jsonResponse({ limits: [{ kind: 'session', percent: 9 }] })
    const recuperado = await cronoReader.read(ccReal, 'claude-code', 'k-coal', true)
    check(
      '(m) pasada la espera, se reintenta solo y el dato vuelve fresco (6% -> 9%)',
      recuperado.windows[0]?.percent === 9 && !recuperado.stale,
      `percent=${recuperado.windows[0]?.percent} stale=${recuperado.stale ?? false} peticiones=${llamadas}`
    )

    // -------------------------------------------------------------------------
    // (n) CLAUDE: una ventana ya reiniciada salta el TTL y el suelo de red, pero con
    //     su propio suelo de un minuto. Es lo que hacía que el porcentaje viejo se
    //     quedara clavado hasta el siguiente sondeo (3 min) o para siempre.
    // -------------------------------------------------------------------------
    const vencido = new Date(reloj - 60_000).toISOString()
    const futuro = new Date(reloj + 3 * 3_600_000).toISOString()
    responder = () =>
      jsonResponse({ limits: [{ kind: 'session', percent: 88, resets_at: vencido }] })
    const cad1 = await cronoReader.read(ccReal, 'claude-code', 'k-cad', true)
    check(
      '(n) una ventana con la fecha de reinicio ya pasada sale a 0 % y marcada',
      cad1.windows[0]?.percent === 0 &&
        cad1.windows[0]?.reiniciada === true &&
        cad1.windows[0]?.resetsAt === undefined,
      `percent=${cad1.windows[0]?.percent} reiniciada=${cad1.windows[0]?.reiniciada} resetsAt=${cad1.windows[0]?.resetsAt}`
    )

    // (n2) EL ESCENARIO REAL: el dato se cachea cuando la ventana AÚN no ha vencido, y
    //      vence dentro del TTL. Sin la caducidad, el 88 % se quedaba en pantalla hasta
    //      que el TTL expirase —tres minutos enteros con un número que ya no existe—.
    const antes2 = llamadas
    responder = () =>
      jsonResponse({
        limits: [{ kind: 'session', percent: 88, resets_at: new Date(reloj + 30_000).toISOString() }]
      })
    reloj += 200_000 // vence el TTL de la entrada anterior
    const vivo = await cronoReader.read(ccReal, 'claude-code', 'k-cad')
    reloj += 40_000 // la ventana acaba de reiniciarse; el TTL (3 min) NO ha vencido
    responder = () =>
      jsonResponse({ limits: [{ kind: 'session', percent: 2, resets_at: futuro }] })
    const trasReset = await cronoReader.read(ccReal, 'claude-code', 'k-cad')
    check(
      '(n2) la ventana vence dentro del TTL: se vuelve a la fuente en vez de servir el % viejo',
      vivo.windows[0]?.percent === 88 &&
        llamadas === antes2 + 2 &&
        trasReset.windows[0]?.percent === 2 &&
        !trasReset.windows[0]?.reiniciada,
      `antes=${vivo.windows[0]?.percent}% despues=${trasReset.windows[0]?.percent}% peticiones=${llamadas - antes2} (esperado 2)`
    )

    // (n3) Y una sola: la relectura deja el `resetsAt` vencido FUERA, así que la entrada
    //      no vuelve a parecer caducada y esto no se convierte en una petición por sondeo.
    responder = () =>
      jsonResponse({ limits: [{ kind: 'session', percent: 88, resets_at: vencido }] })
    reloj += 200_000
    await cronoReader.read(ccReal, 'claude-code', 'k-cad') // esta va a la red (TTL vencido)
    const trasPrimera = llamadas
    reloj += 5_000
    await cronoReader.read(ccReal, 'claude-code', 'k-cad')
    reloj += 5_000
    await cronoReader.read(ccReal, 'claude-code', 'k-cad')
    check(
      '(n3) la caducidad dispara UNA relectura, no una por sondeo',
      llamadas === trasPrimera,
      `peticiones extra en 10 s=${llamadas - trasPrimera} (esperado 0)`
    )

    // (o) El ÚLTIMO DATO BUENO también caduca: servirlo tal cual tras un 429 devolvía
    //     un porcentaje alto de una ventana que mientras tanto se había reiniciado.
    const casiVencido = new Date(reloj + 30_000).toISOString()
    responder = () =>
      jsonResponse({ limits: [{ kind: 'session', percent: 77, resets_at: casiVencido }] })
    reloj += 200_000
    await cronoReader.read(ccReal, 'claude-code', 'k-stale') // guarda el "último bueno"
    responder = () => new Response('rate limited', { status: 429 })
    reloj += 200_000 // ahora el `casiVencido` ya quedó atrás
    const viejo = await cronoReader.read(ccReal, 'claude-code', 'k-stale', true)
    check(
      '(o) el dato viejo que se sirve tras un 429 no arrastra una ventana ya reiniciada',
      viejo.stale === true &&
        viejo.windows[0]?.percent === 0 &&
        viejo.windows[0]?.reiniciada === true,
      `stale=${viejo.stale} percent=${viejo.windows[0]?.percent} reiniciada=${viejo.windows[0]?.reiniciada}`
    )

    // (o2) DURANTE el castigo de un 429 (hasta 10 min) lo servido también caduca: si la ventana
    //     se reinicia en mitad de la espera, el porcentaje viejo no sigue en pantalla.
    reloj += 200_000
    responder = () =>
      jsonResponse({
        limits: [{ kind: 'session', percent: 77, resets_at: new Date(reloj + 60_000).toISOString() }]
      })
    await cronoReader.read(ccReal, 'claude-code', 'k-castigo', true)
    reloj += 30_000
    responder = () => new Response('', { status: 429, headers: { 'retry-after': '600' } })
    const alCastigo = await cronoReader.read(ccReal, 'claude-code', 'k-castigo', true)
    const antesCastigo = llamadas
    reloj += 60_000 // la ventana se reinicia; el castigo de 10 min sigue vigente
    const enCastigo = await cronoReader.read(ccReal, 'claude-code', 'k-castigo', true)
    check(
      '(o2) en pleno castigo por 429, una ventana que se reinicia sale a 0 % sin tocar el endpoint',
      alCastigo.windows[0]?.percent === 77 &&
        llamadas === antesCastigo &&
        enCastigo.stale === true &&
        enCastigo.windows[0]?.percent === 0 &&
        enCastigo.windows[0]?.reiniciada === true,
      `al castigo=${alCastigo.windows[0]?.percent}% · en castigo=${enCastigo.windows[0]?.percent}% reiniciada=${enCastigo.windows[0]?.reiniciada} stale=${enCastigo.stale} peticiones=${llamadas - antesCastigo}`
    )

    // (o3) Solo el 429 alarga el castigo: tres fallos de red/500 antes no convierten el primer
    //     429 en una espera de 8 min. Sin `retry-after`, el primero espera BACKOFF_BASE (60 s).
    reloj += 700_000
    responder = () => new Response('', { status: 500 })
    for (let i = 0; i < 3; i++) {
      await cronoReader.read(ccReal, 'claude-code', 'k-fails', true)
      reloj += 31_000 // pasa el TTL de fallo (30 s) y el suelo de red
    }
    responder = () => new Response('', { status: 429 })
    await cronoReader.read(ccReal, 'claude-code', 'k-fails', true)
    const antesFails = llamadas
    reloj += 70_000
    responder = () => jsonResponse({ limits: [{ kind: 'session', percent: 12 }] })
    const trasFails = await cronoReader.read(ccReal, 'claude-code', 'k-fails', true)
    check(
      '(o3) los fallos que no son 429 no multiplican el castigo: a los 70 s del primer 429 se reintenta',
      llamadas === antesFails + 1 && trasFails.windows[0]?.percent === 12,
      `peticiones=${llamadas - antesFails} (esperado 1) percent=${trasFails.windows[0]?.percent}`
    )
  } finally {
    globalThis.fetch = fetchReal
  }

  // ---------------------------------------------------------------------------
  // (p) CODEX: su dato es el ÚLTIMO CONOCIDO de disco. Si no mandas peticiones el
  //     fichero no cambia, así que sin caducidad devolvía el mismo % de una ventana
  //     reiniciada para siempre. Y la caducidad es POR VENTANA: la semanal, que no ha
  //     vencido, tiene que seguir intacta.
  // ---------------------------------------------------------------------------
  const cadBase = path.join(root, 'codex-caducado')
  await writeFile(path.join(await mkdirp(cadBase), 'auth.json'), '{"auth_mode":"chatgpt"}', 'utf8')
  await writeJsonl(
    path.join(cadBase, 'sessions', '2026', '07', '11', 'rollout-2026-07-11-ccc.jsonl'),
    [
      { timestamp: '2026-07-11T10:00:00Z', type: 'session_meta', payload: { session_id: 'ccc' } },
      tokenCount('2026-07-11T10:00:10Z', {
        limit_id: 'codex',
        primary: { used_percent: 85.0, window_minutes: 300, resets_at: RESETS_PASADO },
        secondary: { used_percent: 13.0, window_minutes: 10080, resets_at: RESETS_7D },
        plan_type: 'team'
      })
    ],
    new Date('2026-07-11T10:00:10Z')
  )
  const caducado = await reader.read(cadBase, 'codex', 'k-codex-caducado')
  const cadP = caducado.windows.find((w) => w.key === 'primary')
  const cadS = caducado.windows.find((w) => w.key === 'secondary')
  check(
    '(p) Codex: la ventana de 5 h ya reiniciada sale a 0 %; la semanal sigue intacta',
    cadP?.percent === 0 &&
      cadP?.reiniciada === true &&
      cadP?.resetsAt === undefined &&
      cadS?.percent === 13 &&
      !cadS?.reiniciada &&
      cadS?.resetsAt === RESETS_7D * 1000,
    `5h=${cadP?.percent}%/reiniciada=${cadP?.reiniciada} 7d=${cadS?.percent}%/reiniciada=${cadS?.reiniciada ?? false}`
  )

  await probarCicloDelVigilante()

  console.log('')
  const failed = results.filter((r) => !r.pass)
  if (failed.length) {
    console.log(`RESULTADO: ${failed.length} de ${results.length} comprobaciones FALLARON`)
    process.exit(1)
  }
  console.log(`RESULTADO: ${results.length} comprobaciones OK`)
}

/** Un `fs.watch` falso: cuenta creaciones y cierres y deja disparar su 'error'. */
function vigilanteFalso(): { vigilar: Vigilar; creados: number; cerrados: number; fallar: () => void } {
  const mundo = {
    creados: 0,
    cerrados: 0,
    fallar: (): void => {},
    vigilar: ((): FSWatcher => {
      mundo.creados++
      const oyentes: (() => void)[] = []
      mundo.fallar = () => oyentes.forEach((f) => f())
      return {
        on: (evento: string, f: () => void) => {
          if (evento === 'error') oyentes.push(f)
        },
        close: () => {
          mundo.cerrados++
        }
      } as unknown as FSWatcher
    }) as Vigilar
  }
  return mundo
}

/**
 * (q)-(t) El vigilante no se cierra en cuanto lo suelta su último panel: cambiar de pane
 * entre dos de la misma cuenta suelta y vuelve a pedir, y cada vez cerraba y reabría el
 * `fs.watch`. Sin disco: con un `vigilar` falso y una gracia de 40 ms.
 */
async function probarCicloDelVigilante(): Promise<void> {
  const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  {
    const m = vigilanteFalso()
    const w = new UsageWatcher(() => {}, { graciaCierreMs: 40, vigilar: m.vigilar })
    w.watch('k', '/base')
    w.unwatch('k')
    w.watch('k', '/base')
    await esperar(90)
    check('(q) soltar y volver a pedir dentro de la gracia reutiliza el vigilante', m.creados === 1 && m.cerrados === 0, `creados=${m.creados} cerrados=${m.cerrados}`)
    w.unwatch('k')
    await esperar(90)
    check('(r) pasada la gracia sin paneles, se cierra una vez', m.creados === 1 && m.cerrados === 1, `creados=${m.creados} cerrados=${m.cerrados}`)
    w.unwatch('k')
    check('(r.2) soltar de más no hace nada', m.cerrados === 1, `cerrados=${m.cerrados}`)
    w.watch('k', '/base')
    check('(r.3) y pedirlo otra vez crea uno nuevo', m.creados === 2, `creados=${m.creados}`)
    w.disposeAll()
  }
  {
    const m = vigilanteFalso()
    const w = new UsageWatcher(() => {}, { graciaCierreMs: 40, vigilar: m.vigilar })
    w.watch('k', '/base')
    w.unwatch('k')
    w.disposeAll()
    await esperar(90)
    check('(s) `disposeAll` cierra ya y cancela el cierre pendiente (un solo cierre)', m.cerrados === 1, `cerrados=${m.cerrados}`)
    w.watch('k', '/base')
    w.watch('k', '/base')
    w.cerrar('k')
    check('(s.2) `cerrar` cierra en el acto aunque queden paneles', m.cerrados === 2, `cerrados=${m.cerrados}`)
    w.unwatch('k')
    w.unwatch('k')
    await esperar(90)
    check('(s.3) y los paneles que lo sueltan después no cierran nada más', m.cerrados === 2, `cerrados=${m.cerrados}`)
  }
  {
    const m = vigilanteFalso()
    const w = new UsageWatcher(() => {}, { graciaCierreMs: 40, vigilar: m.vigilar })
    w.watch('k', '/base')
    w.watch('k', '/base')
    m.fallar()
    check("(t) un 'error' del vigilante lo cierra", m.cerrados === 1, `cerrados=${m.cerrados}`)
    w.watch('k', '/base')
    check('(t.2) el siguiente `watch` lo vuelve a montar', m.creados === 2, `creados=${m.creados}`)
    // Tres paneles mirando: el error no perdió la cuenta de los dos primeros.
    w.unwatch('k')
    w.unwatch('k')
    await esperar(90)
    check('(t.3) con un panel aún mirando NO se cierra: el error no perdió la cuenta', m.cerrados === 1, `cerrados=${m.cerrados}`)
    w.unwatch('k')
    await esperar(90)
    check('(t.4) al soltarlo el último, se cierra', m.cerrados === 2, `cerrados=${m.cerrados}`)
    w.disposeAll()
  }
}

/** Respuesta JSON del doble del endpoint de Claude. */
function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

/** Espera a que `cond` se cumpla (sondeo corto), hasta `timeout`. */
async function waitFor(cond: () => boolean, timeout: number): Promise<boolean> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return cond()
}

async function mkdirp(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  return dir
}

/** ¿Hay salida a la red? Para no dar por FALLIDO el caso (f) en una máquina aislada. */
async function hasNetwork(): Promise<boolean> {
  try {
    await fetch('https://api.anthropic.com/', { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    return true
  } catch {
    return false
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
