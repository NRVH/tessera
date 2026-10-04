#!/usr/bin/env node
// =============================================================================
// Prueba del ConversationsReader (npm run test:conversations). Sin Docker: solo fs, sobre
// transcripts escritos en un temporal.
// Títulos de Claude y Codex, `updatedAt` por mtime, transcript grande resumido por la cabeza y
// `deleteConversation` con su caché.
// La criba por carpeta (superconjunto, con marcha atrás en el panel) y `soloUltima` (la última de
// este proyecto, y una sola con varias bases). Una primera línea gigante no descarta la conversación;
// compactarla no rompe sus escapes, y un transcript de capturas no se lee entero.
// =============================================================================

import { mkdtemp, mkdir, writeFile, utimes, readdir, stat, readFile, open } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConversationsReader } from './ConversationsReader.ts'
import { compactarBase64, leerCabezaJsonl } from '../transcripts/cabezaJsonl.ts'

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

/** Escribe un JSONL a partir de objetos y fija su mtime (para controlar el orden). */
async function writeJsonl(file: string, objs: object[], mtime: Date): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, objs.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8')
  await utimes(file, mtime, mtime)
}

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_BIG = '33333333-3333-4333-8333-333333333333'
const UUID_T1 = '44444444-4444-4444-8444-444444444444'
const UUID_T2 = '55555555-5555-4555-8555-555555555555'
const UUID_OTRA = '66666666-6666-4666-8666-666666666666'

const UUID_DEL = '77777777-7777-4777-8777-777777777777'
/** Otra conversación de la MISMA carpeta cuyo id empieza igual: un borrado por prefijo se la llevaría. */
const UUID_VECINA = `${UUID_DEL}7`
const UUID_AJENA = '88888888-8888-4888-8888-888888888888'

const existe = async (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false
  )
const mensaje = (cwd: string): object[] => [
  { type: 'user', timestamp: '2026-07-10T10:00:00Z', cwd, message: { content: 'hola' } }
]

/**
 * El camino DESTRUCTIVO de Claude: borra el transcript y, con `rm -r`, su carpeta hermana.
 * Fija qué desaparece y, sobre todo, qué NO: la vecina, otro proyecto y una copia con el
 * mismo id fuera de `<base>/projects`.
 */
async function probarBorradoClaude(root: string, reader: ConversationsReader): Promise<void> {
  const base = path.join(root, 'claude-borrado')
  const fecha = new Date('2026-07-10T10:00:00Z')
  const borrada = path.join(base, 'projects', 'proy-a', `${UUID_DEL}.jsonl`)
  const hermana = path.join(base, 'projects', 'proy-a', UUID_DEL)
  const subagente = path.join(hermana, 'subagents', 'agent-x.jsonl')
  const vecina = path.join(base, 'projects', 'proy-a', `${UUID_VECINA}.jsonl`)
  const carpetaVecina = path.join(base, 'projects', 'proy-a', UUID_VECINA, 'subagents', 'agent-y.jsonl')
  const ajena = path.join(base, 'projects', 'proy-b', `${UUID_AJENA}.jsonl`)
  const copiaFuera = path.join(base, 'file-history', 'snap', 'projects', 'proy-c', `${UUID_DEL}.jsonl`)
  for (const f of [borrada, subagente, vecina, carpetaVecina, ajena, copiaFuera]) {
    await writeJsonl(f, mensaje('/x/proy'), fecha)
  }
  const todos = [borrada, subagente, vecina, carpetaVecina, ajena, copiaFuera]
  const quedan = async (): Promise<number> => (await Promise.all(todos.map(existe))).filter(Boolean).length

  for (const id of ['proy-b', '../proy-b', 'x', '', `${UUID_DEL}/../${UUID_AJENA}`]) {
    const hizo = await reader.deleteConversation(base, 'claude-code', id)
    check(`(l) un id sin forma de UUID ("${id}") no borra nada`, !hizo && (await quedan()) === todos.length, `borró=${hizo}`)
  }
  const sinEse = await reader.deleteConversation(base, 'claude-code', '99999999-9999-4999-8999-999999999999')
  check('(l.2) un UUID que no existe no borra nada', !sinEse && (await quedan()) === todos.length, `borró=${sinEse}`)

  const hizo = await reader.deleteConversation(base, 'claude-code', UUID_DEL)
  check('(m) borra el transcript y su carpeta hermana', hizo && !(await existe(borrada)) && !(await existe(hermana)), `borró=${hizo}`)
  check('(m.2) la vecina de la misma carpeta (id con el mismo prefijo) sigue', (await existe(vecina)) && (await existe(carpetaVecina)), 'transcript y carpeta')
  check('(m.3) la conversación de otro proyecto sigue', await existe(ajena), 'proy-b')
  check('(m.4) una copia con el mismo id FUERA de `<base>/projects` sigue', await existe(copiaFuera), 'file-history')
}

/** Solo cuentan `<base>/projects/<carpeta>/*.jsonl` (Claude) y `<base>/sessions/**` (Codex). */
async function probarAlcanceDelListado(root: string, reader: ConversationsReader): Promise<void> {
  const fecha = new Date('2026-07-10T11:00:00Z')
  const claude = path.join(root, 'claude-alcance')
  await writeJsonl(path.join(claude, 'projects', 'proy-a', `${UUID_DEL}.jsonl`), mensaje('/x/proy-a'), fecha)
  await writeJsonl(path.join(claude, 'file-history', 'x', 'projects', 'proy-y', `${UUID_AJENA}.jsonl`), mensaje('/x/proy-y'), fecha)
  await writeJsonl(path.join(claude, 'projects', 'proy-a', UUID_DEL, 'subagents', 'agent-z.jsonl'), mensaje('/x/proy-a'), fecha)
  const deClaude = await reader.listConversations([{ dir: claude, agente: 'claude-code' }])
  check(
    '(j) un transcript bajo otro `projects/` anidado no se lista, ni un hilo de subagente',
    deClaude.length === 1 && deClaude[0].id === UUID_DEL,
    `ids=${JSON.stringify(deClaude.map((c) => c.id.slice(0, 8)))}`
  )

  const codex = path.join(root, 'codex-alcance')
  const rollout = (id: string): object[] => [
    { type: 'session_meta', timestamp: '2026-07-10T09:00:00Z', payload: { session_id: id, cwd: '/x/beta' } },
    { type: 'event_msg', timestamp: '2026-07-10T09:00:01Z', payload: { type: 'user_message', message: 'hola' } }
  ]
  await writeJsonl(path.join(codex, 'sessions', '2026', '07', '10', `rollout-2026-07-10-${UUID_DEL}.jsonl`), rollout(UUID_DEL), fecha)
  const fuera = path.join(codex, '.tmp', 'sessions', `rollout-2026-07-10-${UUID_AJENA}.jsonl`)
  await writeJsonl(fuera, rollout(UUID_AJENA), fecha)
  const deCodex = await reader.listConversations([{ dir: codex, agente: 'codex' }])
  check(
    '(k) un rollout fuera de `<base>/sessions` no se lista',
    deCodex.length === 1 && deCodex[0].id === UUID_DEL,
    `ids=${JSON.stringify(deCodex.map((c) => c.id.slice(0, 8)))}`
  )
  const hizo = await reader.deleteConversation(codex, 'codex', UUID_AJENA)
  check('(k.2) ni se borra', !hizo && (await existe(fuera)), `borró=${hizo}`)
}

const UUID_FOTO_VIEJA = '99999999-9999-4999-8999-999999999990'
const UUID_FOTO = '99999999-9999-4999-8999-999999999991'
const UUID_TOCHO = '99999999-9999-4999-8999-999999999992'
const UUID_FOTO_CODEX = '99999999-9999-4999-8999-999999999993'
const UUID_EMOJI = '99999999-9999-4999-8999-999999999994'
const UUID_ESCAPE = '99999999-9999-4999-8999-999999999995'

/**
 * Una conversación que EMPIEZA pegando una imagen grande: el primer mensaje es una línea de
 * megas (base64) que no cabe en la cabeza. Tiene que salir en el panel, con su texto como
 * título, y ser la que retoma auto-reanudar.
 */
async function probarLineaGigante(root: string, reader: ConversationsReader): Promise<void> {
  const base = path.join(root, 'claude-fotos')
  const carpeta = path.join(base, 'projects', '-x-fotos')
  const imagen = randomBytes(1_500_000).toString('base64') // ~2 MB en una sola línea
  const cwd = '/x/fotos'
  await writeJsonl(path.join(carpeta, `${UUID_FOTO_VIEJA}.jsonl`), [
    { type: 'user', timestamp: '2026-07-10T09:00:00Z', cwd, message: { content: 'la anterior' } },
    { type: 'assistant', timestamp: '2026-07-10T09:00:01Z', message: { content: 'ok' } }
  ], new Date('2026-07-10T09:00:01Z'))
  await writeJsonl(path.join(carpeta, `${UUID_FOTO}.jsonl`), [
    // Forma real de Claude Code: el `cwd` y la fecha van DETRÁS del mensaje, en la misma línea.
    {
      type: 'user',
      message: { role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imagen } },
        { type: 'text', text: '¿qué falla en esta captura?' }
      ] },
      timestamp: '2026-07-10T10:00:00Z', origin: { kind: 'human' }, cwd, sessionId: UUID_FOTO
    },
    { type: 'assistant', timestamp: '2026-07-10T10:00:05Z', message: { content: 'el botón' } }
  ], new Date('2026-07-10T10:00:05Z'))
  // Primera línea de texto enorme, sin base64: ni compactada cabe, se salta y se sigue.
  const tocho = 'palabra '.repeat(60_000)
  await writeJsonl(path.join(carpeta, `${UUID_TOCHO}.jsonl`), [
    { type: 'user', timestamp: '2026-07-10T08:00:00Z', cwd, message: { content: tocho } },
    { type: 'user', timestamp: '2026-07-10T08:00:10Z', cwd, message: { content: 'y ahora resúmelo' } },
    { type: 'assistant', timestamp: '2026-07-10T08:00:15Z', message: { content: 'hecho' } }
  ], new Date('2026-07-10T08:00:15Z'))

  const panel = await reader.listConversations([{ dir: base, agente: 'claude-code' }], { rutaProyecto: cwd })
  const foto = panel.find((c) => c.id === UUID_FOTO)
  check(
    '(n) la conversación que empieza con una imagen gigante sale en el panel, con su texto de título',
    foto?.title === '¿qué falla en esta captura?' && foto.projectPath === cwd && foto.messageCount === 2,
    `ids=${JSON.stringify(panel.map((c) => c.id.slice(-2)))} title="${foto?.title}" mensajes=${foto?.messageCount}`
  )
  const ultima = await reader.listConversations([{ dir: base, agente: 'claude-code' }], { rutaProyecto: cwd, soloUltima: true })
  check('(n.2) auto-reanudar retoma esa y no la anterior', ultima[0]?.id === UUID_FOTO, `id=${ultima[0]?.id.slice(-2)}`)
  const tochoConv = panel.find((c) => c.id === UUID_TOCHO)
  check(
    '(n.3) una primera línea de texto que ni compactada cabe se salta sin perder la conversación',
    tochoConv?.messageCount === 2 && tochoConv.title === 'y ahora resúmelo',
    `title="${tochoConv?.title}" mensajes=${tochoConv?.messageCount}`
  )

  const codex = path.join(root, 'codex-fotos')
  await writeJsonl(path.join(codex, 'sessions', '2026', '07', '10', `rollout-2026-07-10-${UUID_FOTO_CODEX}.jsonl`), [
    { type: 'session_meta', timestamp: '2026-07-10T09:00:00Z', payload: { session_id: UUID_FOTO_CODEX, cwd } },
    { type: 'event_msg', timestamp: '2026-07-10T09:00:01Z', payload: {
      type: 'user_message', message: 'mira la imagen', images: [`data:image/png;base64,${imagen}`]
    } }
  ], new Date('2026-07-10T09:00:01Z'))
  const deCodex = await reader.listConversations([{ dir: codex, agente: 'codex' }])
  check('(n.4) Codex: un user_message con imagen gigante también sale', deCodex[0]?.title === 'mira la imagen', `title="${deCodex[0]?.title}"`)
}

/** El título derivado se recorta por caracteres visibles: un emoji en el corte no queda partido. */
async function probarTituloConEmoji(root: string, reader: ConversationsReader): Promise<void> {
  const base = path.join(root, 'claude-emoji')
  const largo = 'a'.repeat(98) + '🚀🚀🚀'
  await writeJsonl(path.join(base, 'projects', '-x-emoji', `${UUID_EMOJI}.jsonl`), [
    { type: 'user', timestamp: '2026-07-10T10:00:00Z', cwd: '/x/emoji', message: { content: largo } }
  ], new Date('2026-07-10T10:00:00Z'))
  const [conv] = await reader.listConversations([{ dir: base, agente: 'claude-code' }])
  check(
    '(p) el recorte del título a 100 no parte un emoji (nada de «�»)',
    conv?.title === 'a'.repeat(98) + '🚀…',
    `final del título=${JSON.stringify(conv?.title.slice(-4))}`
  )
}

/** Con líneas normales, la lectura por líneas devuelve lo mismo que un corte fijo de la cabeza. */
async function probarCabezaIgualQueCorteFijo(archivo: string): Promise<void> {
  const presupuesto = 256 * 1024
  const crudo = (await readFile(archivo)).subarray(0, presupuesto).toString('utf8').split('\n')
  crudo.pop() // el corte fijo tira la línea partida
  const fijo = crudo.filter((l) => l.trim())
  const porLineas = await leerCabezaJsonl(archivo, { presupuesto, lecturaMax: 32 * 1024 * 1024 })
  check(
    '(o) con líneas normales, la cabeza por líneas es idéntica al corte fijo de 256 KiB',
    porLineas.length === fijo.length && porLineas.every((l, i) => l === fijo[i]),
    `líneas: por líneas=${porLineas.length} corte fijo=${fijo.length}`
  )
}

/** Escapes JSON tal como van en la línea cruda, seguidos de una tirada de base64. */
const ESCAPES_CRUDOS = ['\\n', '\\t', '\\r', '\\b', '\\f', '\\u0001', '\\u00e9', '\\"', '\\/', '\\\\']
const TIRADA = 'QUJD'.repeat(100)

/**
 * Una tirada de base64 justo detrás de un escape (`\n`, `é`…): la letra del escape no puede
 * entrar en la tirada, o queda una barra suelta y la línea deja de ser JSON. Ni de golpe, ni con
 * el escape partido entre dos trozos de lectura, ni en el historial.
 */
async function probarEscapesAntesDeLaTirada(root: string, reader: ConversationsReader): Promise<void> {
  const rotos = ESCAPES_CRUDOS.filter((esc) => {
    const valor = (JSON.parse(`"${esc}"`) as string) + ' fin'
    try {
      return (JSON.parse(compactarBase64(`{"t":"${esc}${TIRADA} fin"}`)) as { t: string }).t !== valor
    } catch {
      return true
    }
  })
  check('(q) compactar no rompe ningún escape seguido de una tirada', rotos.length === 0, `rotos=${JSON.stringify(rotos)}`)

  // El escape partido en cada posición posible de la frontera entre dos trozos de 1 KiB.
  const dir = path.join(root, 'cabeza-escapes')
  await mkdir(dir, { recursive: true })
  const fallos: string[] = []
  let casos = 0
  // Relleno fuera del alfabeto base64, para que la única tirada sea la de detrás del escape.
  const cola = '. '.repeat(1000)
  for (const esc of ['\\u00e9', '\\n', '\\\\']) {
    for (const frontera of [5120, 6144]) {
      for (let j = -6; j <= 2; j++) {
        const inicio = '{"type":"user","t":"'
        const relleno = '.'.repeat(frontera + j - inicio.length)
        const linea = `${inicio}${relleno}${esc}${TIRADA} fin${cola}"}`
        const archivo = path.join(dir, `e${casos++}.jsonl`)
        await writeFile(archivo, linea + '\n{"type":"assistant"}\n')
        const leidas = await leerCabezaJsonl(archivo, { presupuesto: 16 * 1024, lecturaMax: 32 * 1024 * 1024, trozo: 1024 })
        const delante = relleno + (JSON.parse(`"${esc}"`) as string)
        let ok = leidas.length === 2
        try {
          // Si la frontera parte la tirada, el trozo corto que queda a un lado (<256) no se quita.
          const t = (JSON.parse(leidas[0]) as { t: string }).t
          const resto = t.slice(delante.length, t.length - (' fin' + cola).length)
          ok &&= t.startsWith(delante) && t.endsWith(' fin' + cola) && /^[A-Za-z0-9+/=]{0,255}$/.test(resto)
        } catch {
          ok = false
        }
        if (!ok) fallos.push(`${esc}@${frontera}${j >= 0 ? '+' : ''}${j}`)
      }
    }
  }
  check(
    '(q.2) un escape partido entre dos trozos tampoco se rompe al compactar',
    fallos.length === 0,
    `casos=${casos} fallos=${JSON.stringify(fallos)}`
  )

  // De punta a punta: la primera línea, con un `\n` delante de la tirada, conserva el título.
  const base = path.join(root, 'claude-escapes')
  const texto = 'mira este blob:\n' + TIRADA + ' y dime qué es ' + 'x y '.repeat(20_000)
  await writeJsonl(path.join(base, 'projects', '-x-escapes', `${UUID_ESCAPE}.jsonl`), [
    { type: 'user', timestamp: '2026-07-10T10:00:00Z', cwd: '/x/escapes', message: { content: texto } },
    { type: 'assistant', timestamp: '2026-07-10T10:00:05Z', message: { content: 'es base64' } }
  ], new Date('2026-07-10T10:00:05Z'))
  const [conv] = await reader.listConversations([{ dir: base, agente: 'claude-code' }])
  check(
    '(q.3) una primera línea con `\\n` delante de la tirada sale en el panel con su título',
    conv?.id === UUID_ESCAPE && conv.title.startsWith('mira este blob: y dime qué es') && conv.messageCount === 2,
    `id=${conv?.id.slice(-2)} title="${conv?.title.slice(0, 40)}" mensajes=${conv?.messageCount}`
  )
}

/**
 * Red de seguridad: si una línea compactada deja de ser JSON (aquí, un número de 300 cifras fuera
 * de una cadena), se salta y lo demás se conserva, sin devolver la línea rota.
 */
async function probarRedDeSeguridad(root: string): Promise<void> {
  const archivo = path.join(root, 'cabeza-red', 'numero.jsonl')
  await mkdir(path.dirname(archivo), { recursive: true })
  const rara = `{"n":${'1'.repeat(300)},"pad":"${'x'.repeat(70_000)}"}`
  await writeFile(archivo, `${rara}\n{"type":"user","t":"sigue"}\n`)
  const leidas = await leerCabezaJsonl(archivo, { presupuesto: 256 * 1024, lecturaMax: 32 * 1024 * 1024 })
  const parsean = leidas.every((l) => {
    try {
      JSON.parse(l)
      return true
    } catch {
      return false
    }
  })
  check(
    '(q.4) una línea que compactada deja de ser JSON se salta y la siguiente se conserva',
    parsean && leidas.length === 1 && leidas[0].includes('"sigue"'),
    `líneas=${leidas.length} todas JSON=${parsean}`
  )
}

/** Bytes que `fn` lee con `FileHandle.read` (se envuelve el prototipo mientras corre). */
async function bytesLeidos(fn: () => Promise<unknown>): Promise<number> {
  const h = await open(import.meta.filename, 'r')
  const proto = Object.getPrototypeOf(h) as { read: (...a: unknown[]) => Promise<{ bytesRead: number }> }
  await h.close()
  const original = proto.read
  let total = 0
  proto.read = async function (this: unknown, ...a: unknown[]) {
    const r = await original.apply(this, a)
    total += r.bytesRead
    return r
  }
  try {
    await fn()
  } finally {
    proto.read = original
  }
  return total
}

/**
 * Coste: un transcript casi todo capturas (tool_result con imagen en base64) no se recorre hasta
 * `lecturaMax` en cada lectura de cabeza. Lo leído de más tiene tope, y el título sigue.
 */
async function probarCosteConCapturas(root: string): Promise<void> {
  const archivo = path.join(root, 'cabeza-capturas', 'capturas.jsonl')
  await mkdir(path.dirname(archivo), { recursive: true })
  const captura = randomBytes(75_000).toString('base64') // ~100 KB por captura
  const lineas = [JSON.stringify({ type: 'user', cwd: '/x/capturas', message: { content: 'prueba la UI' } })]
  for (let i = 0; i < 60; i++) {
    lineas.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'captura', input: {} }] } }))
    lineas.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: captura } }
    ] }] } }))
  }
  await writeFile(archivo, lineas.join('\n') + '\n')
  const tam = (await stat(archivo)).size
  for (const [quien, opts, tope] of [
    ['historial', { presupuesto: 256 * 1024, lecturaMax: 32 * 1024 * 1024 }, 2 * 1024 * 1024],
    ['vigilante de turnos', { presupuesto: 32 * 1024, lecturaMax: 32 * 1024 * 1024, trozo: 8 * 1024 }, 1024 * 1024]
  ] as const) {
    let leidas: string[] = []
    const bytes = await bytesLeidos(async () => {
      leidas = await leerCabezaJsonl(archivo, opts)
    })
    check(
      `(q.5) ${quien}: un transcript de capturas se lee hasta un tope y no entero, y conserva el título`,
      bytes <= tope && leidas[0]?.includes('prueba la UI') === true,
      `leídos=${(bytes / 1024).toFixed(0)} KiB de ${(tam / 1024).toFixed(0)} KiB (tope ${tope / 1024} KiB) líneas=${leidas.length}`
    )
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'tessera-conv-test-'))
  const ccBase = path.join(root, 'claude')
  const codexBase = path.join(root, 'codex')

  // (a) CC con ai-title, en proyecto "alpha".
  const ccFile = path.join(ccBase, 'projects', 'alpha-enc', `${UUID_A}.jsonl`)
  await writeJsonl(
    ccFile,
    [
      { type: 'user', timestamp: '2026-07-09T10:00:00Z', cwd: '/mnt/workspace/alpha', message: { content: 'hola CC' } },
      { type: 'ai-title', aiTitle: 'Refactor del login' },
      { type: 'assistant', timestamp: '2026-07-09T10:00:05Z', message: { content: 'listo' } }
    ],
    new Date('2026-07-09T10:00:05Z')
  )

  // (b) Codex con session_meta + user_message, en proyecto "beta".
  const codexFile = path.join(codexBase, 'sessions', '2026', '07', '09', `rollout-2026-07-09-${UUID_B}.jsonl`)
  await writeJsonl(
    codexFile,
    [
      { type: 'session_meta', timestamp: '2026-07-09T09:00:00Z', payload: { session_id: UUID_B, cwd: '/x/beta' } },
      { type: 'event_msg', timestamp: '2026-07-09T09:00:01Z', payload: { type: 'user_message', message: 'arregla el bug' } }
    ],
    new Date('2026-07-09T09:00:01Z') // mtime ANTERIOR al de CC -> CC debe ir primero
  )

  // (d) CC GRANDE (> HEAD_BYTES): cabecera con contenido + relleno enorme al final.
  const bigFile = path.join(ccBase, 'projects', 'alpha-enc', `${UUID_BIG}.jsonl`)
  const filler = { type: 'assistant', timestamp: '2026-07-09T08:00:00Z', message: { content: 'x'.repeat(2000) } }
  const bigObjs: object[] = [
    { type: 'user', timestamp: '2026-07-09T08:00:00Z', cwd: '/mnt/workspace/alpha', message: { content: 'pregunta larga' } }
  ]
  for (let i = 0; i < 400; i++) bigObjs.push(filler) // ~ 400 * 2KB > 256 KiB
  await writeJsonl(bigFile, bigObjs, new Date('2026-07-09T08:00:00Z'))

  const reader = new ConversationsReader()

  // --- Listado ---------------------------------------------------------------
  const all = await reader.listConversations([
    { dir: ccBase, agente: 'claude-code' },
    { dir: codexBase, agente: 'codex' }
  ])

  const cc = all.find((c) => c.id === UUID_A)
  check('(a) CC toma el ai-title como título', cc?.title === 'Refactor del login', `title="${cc?.title}"`)
  check('(a.2) CC deriva el proyecto del cwd', cc?.project === 'alpha', `project="${cc?.project}"`)

  const codex = all.find((c) => c.id === UUID_B)
  check('(b) Codex toma el primer user_message como título', codex?.title === 'arregla el bug', `title="${codex?.title}"`)
  check('(b.2) Codex saca el sessionId de session_meta', codex?.id === UUID_B, `id="${codex?.id}"`)

  // (c) Orden por updatedAt (mtime) descendente: CC (10:00) antes que big (08:00);
  // codex (09:00) en medio. Verifica que updatedAt salió del mtime.
  const order = all.map((c) => c.id)
  const idxCc = order.indexOf(UUID_A)
  const idxCodex = order.indexOf(UUID_B)
  const idxBig = order.indexOf(UUID_BIG)
  check(
    '(c) orden por updatedAt (mtime) desc: CC > Codex > big',
    idxCc < idxCodex && idxCodex < idxBig,
    `orden=${JSON.stringify(order.map((id) => id.slice(0, 2)))}`
  )
  check(
    '(c.2) updatedAt de CC ≈ mtime del archivo',
    cc !== undefined && cc.updatedAt === Date.parse('2026-07-09T10:00:05Z'),
    `updatedAt=${cc?.updatedAt} esperado=${Date.parse('2026-07-09T10:00:05Z')}`
  )

  // (d) el transcript GRANDE se resume por la cabeza (no se descarta por tamaño).
  const big = all.find((c) => c.id === UUID_BIG)
  check('(d) transcript grande (>HEAD_BYTES) se resume por la cabeza', big?.title === 'pregunta larga', `title="${big?.title}"`)

  // Filtro por proyecto (como en index.ts): solo "alpha" -> CC + big, no Codex.
  const alpha = all.filter((c) => c.projectPath.split(/[\\/]/).pop() === 'alpha')
  check('(filtro) por proyecto "alpha" -> 2 (CC + big), sin Codex', alpha.length === 2, `n=${alpha.length}`)

  // --- (f/g/h) CRIBA por nombre de carpeta + soloUltima -----------------------
  // Carpetas con la codificación REAL de CC (el cwd con lo no alfanumérico a '-').
  // `otra-tessera` es el señuelo que importa: pasa la criba de "tessera" (termina en
  // "-tessera") Y es la más reciente de las tres.
  const dirTessera = path.join(ccBase, 'projects', 'd--Datos-Proyectos-Varios-tessera')
  const dirOtra = path.join(ccBase, 'projects', 'd--Datos-otra-tessera')
  await writeJsonl(
    path.join(dirTessera, `${UUID_T1}.jsonl`),
    [
      { type: 'user', timestamp: '2026-07-09T11:00:00Z', cwd: 'D:\\Datos\\Proyectos\\Varios\\tessera', message: { content: 'la vieja' } },
      { type: 'assistant', timestamp: '2026-07-09T11:00:01Z', message: { content: 'ok' } }
    ],
    new Date('2026-07-09T11:00:00Z')
  )
  await writeJsonl(
    path.join(dirTessera, `${UUID_T2}.jsonl`),
    [
      { type: 'user', timestamp: '2026-07-09T12:00:00Z', cwd: 'D:\\Datos\\Proyectos\\Varios\\tessera', message: { content: 'la ultima de tessera' } },
      { type: 'assistant', timestamp: '2026-07-09T12:00:01Z', message: { content: 'ok' } }
    ],
    new Date('2026-07-09T12:00:00Z')
  )
  await writeJsonl(
    path.join(dirOtra, `${UUID_OTRA}.jsonl`),
    [
      { type: 'user', timestamp: '2026-07-09T13:00:00Z', cwd: 'D:\\Datos\\otra-tessera', message: { content: 'de OTRO proyecto' } },
      { type: 'assistant', timestamp: '2026-07-09T13:00:01Z', message: { content: 'ok' } }
    ],
    new Date('2026-07-09T13:00:00Z') // LA MÁS RECIENTE de todas, a propósito
  )

  const cribado = await reader.listConversations([{ dir: ccBase, agente: 'claude-code' }], {
    rutaProyecto: 'D:/Datos/Proyectos/Varios/tessera'
  })
  const ids = new Set(cribado.map((c) => c.id))
  check(
    '(f) la criba entra solo en las carpetas que pueden ser del proyecto',
    ids.has(UUID_T1) && ids.has(UUID_T2) && !ids.has(UUID_A) && !ids.has(UUID_BIG),
    `n=${cribado.length}; deja fuera alpha (carpeta que no puede ser de "tessera")`
  )
  check(
    '(f.2) pero la criba es un SUPERCONJUNTO: "otra-tessera" también entra',
    ids.has(UUID_OTRA),
    'termina en "-tessera"; quien lo descarta es el filtro exacto por cwd'
  )

  // EL CASO QUE JUSTIFICA EL FILTRO EXACTO DENTRO DEL READER: la candidata más
  // reciente (13:00) es de OTRO proyecto. Sin ese filtro, `soloUltima` la devolvería,
  // el handler la descartaría por cwd y el agente arrancaría SIN reanudar, en silencio.
  const ultima = await reader.listConversations([{ dir: ccBase, agente: 'claude-code' }], {
    rutaProyecto: 'D:/Datos/Proyectos/Varios/tessera',
    soloUltima: true
  })
  check(
    '(g) soloUltima devuelve UNA sola conversación',
    ultima.length === 1,
    `n=${ultima.length}`
  )
  check(
    '(g.2) y es la más reciente DE ESTE proyecto, no la más reciente a secas',
    ultima[0]?.id === UUID_T2,
    `id=${ultima[0]?.id.slice(0, 2)} (T2=12:00 gana a OTRA=13:00, que es de otro proyecto)`
  )

  // (h) MARCHA ATRÁS: "alpha" vive en una carpeta que NO sigue la codificación de CC
  // (`alpha-enc`), así que la criba no casa con nada. Sin el barrido completo de
  // reserva, el historial saldría vacío sin ningún error.
  const conFallback = await reader.listConversations([{ dir: ccBase, agente: 'claude-code' }], {
    rutaProyecto: '/mnt/workspace/alpha'
  })
  check(
    '(h) sin coincidencias en la criba se recorre TODO (marcha atrás)',
    conFallback.some((c) => c.id === UUID_A),
    `n=${conFallback.length}; la carpeta "alpha-enc" no casa con la criba y aun así se encuentra`
  )
  // (h.2) …pero el camino CALIENTE no usa esa marcha atrás. Sin coincidencias en la
  // criba, `soloUltima` responde vacío en vez de abrir todos los transcritos del disco.
  // La causa abrumadoramente más probable de "0 coincidencias" NO es que CC cambiara su
  // codificación, es que el proyecto se abre por primera vez y no tiene historial — y
  // ahí recorrerlo todo para acabar sin nada es exactamente el gasto que esto vino a
  // eliminar, en cada apertura de proyecto nuevo. Vacío significa conversación nueva,
  // que es la degradación que auto-reanudar ya documenta.
  const ultimaAlpha = await reader.listConversations([{ dir: ccBase, agente: 'claude-code' }], {
    rutaProyecto: '/mnt/workspace/alpha',
    soloUltima: true
  })
  check(
    '(h.2) soloUltima NO usa la marcha atrás: sin criba responde vacío, no lo abre todo',
    ultimaAlpha.length === 0,
    `n=${ultimaAlpha.length} -> conversación nueva, sin leer los transcripts de los demás proyectos`
  )
  // Y con la criba acertando, `soloUltima` sí elige (ya cubierto en (g)); aquí se fija
  // que la lista COMPLETA del panel sigue encontrando a alpha por la marcha atrás.
  check(
    '(h.3) el panel (sin soloUltima) sí recorre todo y encuentra a alpha',
    conFallback.filter((c) => c.projectPath.split(/[\\/]/).pop() === 'alpha').length === 2,
    'CC + big, las dos de alpha'
  )

  // Con VARIAS bases, `soloUltima` tiene que seguir devolviendo UNA (la más reciente de
  // todas), no una por base.
  const dosBases = await reader.listConversations(
    [
      { dir: ccBase, agente: 'claude-code' },
      { dir: codexBase, agente: 'codex' }
    ],
    { soloUltima: true }
  )
  check(
    '(i) soloUltima con dos bases devuelve UNA, no una por base',
    dosBases.length === 1,
    `n=${dosBases.length}`
  )

  // --- (e) deleteConversation borra el archivo -------------------------------
  const deleted = await reader.deleteConversation(codexBase, 'codex', UUID_B)
  const codexLeft = await readdir(path.join(codexBase, 'sessions', '2026', '07', '09')).catch(() => [])
  check('(e) deleteConversation borra el transcript de Codex', deleted && codexLeft.length === 0, `deleted=${deleted} left=${codexLeft.length}`)

  await probarBorradoClaude(root, reader)
  await probarAlcanceDelListado(root, reader)
  await probarLineaGigante(root, reader)
  await probarCabezaIgualQueCorteFijo(bigFile)
  await probarEscapesAntesDeLaTirada(root, reader)
  await probarRedDeSeguridad(root)
  await probarCosteConCapturas(root)
  await probarTituloConEmoji(root, reader)

  console.log('\n' + '='.repeat(78))
  const allPass = results.every((r) => r.pass)
  console.log(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  console.log('='.repeat(78))
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error('[test:conversations] error inesperado:', err)
  process.exit(1)
})
