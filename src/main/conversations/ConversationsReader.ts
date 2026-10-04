// =============================================================================
// Lector de solo lectura de las conversaciones que Claude Code y Codex ya persisten en disco,
// bajo la carpeta de credenciales de cada cuenta, sin acoplarse al AccountStore.
//   - Claude Code: `<base>/projects/<proyecto>/<sessionId>.jsonl`.
//   - Codex: `<base>/sessions/AAAA/MM/DD/rollout-*.jsonl`.
// Dónde están lo dice `listadoTranscripts`; `slugProyecto` filtra por proyecto. Lo usa
// `ServicioConversaciones`.
// =============================================================================
import { stat, rm } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import type { ConvAgent, ConversationSummary } from '../../shared/conversations-ipc'
// Extensión explícita: `test-conversations.mts` corre con `node` a secas.
import { basenameSuelto, esDelProyecto } from './slugProyecto.ts'
import { conFechas, rolloutsCodex, transcriptsClaude } from '../transcripts/listadoTranscripts.ts'
import { leerCabezaJsonl } from '../transcripts/cabezaJsonl.ts'
import { recortarConElipsis } from './recorteTitulo.ts'

/** Directorio base de credenciales de una cuenta + su agente, a escanear en busca de transcripts. */
export interface ConversationBase {
  /** Carpeta host de la cuenta (de AccountStore.hostDirFor): default, privada o global. */
  dir: string
  agente: ConvAgent
}

/**
 * Acotaciones opcionales del escaneo; omitirlas devuelve todo lo del agente. Existen porque el
 * camino caliente es auto-reanudar el último chat, que solo quiere un id.
 */
export interface OpcionesEscaneo {
  /**
   * Ruta COMPLETA del proyecto en el host. Criba las carpetas de `projects/` por su nombre
   * antes de abrir ficheros y filtra de verdad por el `cwd` del transcript. Se pasa entera y el
   * basename se deriva dentro: con solo el basename, dos proyectos con el mismo nombre
   * mezclaban su historial.
   */
  rutaProyecto?: string
  /**
   * Devolver solo la conversación más reciente: ordena por mtime y resume de uno en uno hasta
   * el primero válido, en vez de resumirlas todas para ordenar.
   */
  soloUltima?: boolean
}

/**
 * Bytes de cabeza que se leen de cada transcript para el listado: título, `cwd` y primer
 * timestamp viven al principio del JSONL. El `updatedAt` sale del mtime del archivo.
 */
const HEAD_BYTES = 256 * 1024
/**
 * Bytes que se leen como mucho de la cabeza: una línea gigante (una imagen pegada en base64)
 * se atraviesa sin guardarla, y esto acota cuánto cuesta un transcript raro.
 */
const HEAD_LECTURA_MAX = 32 * 1024 * 1024
/** Longitud máxima del título en la lista, en caracteres visibles. */
const TITLE_MAX = 100

/** Entrada de caché de un resumen: válida mientras el archivo no cambie (mtime+size). */
interface CachedSummary {
  mtimeMs: number
  size: number
  summary: ConversationSummary | null
}

/** Lector de historial de conversaciones con caché de resúmenes por (mtime, size). */
export class ConversationsReader {
  /**
   * Caché de resúmenes por ruta de transcript: un archivo que no cambió no se vuelve a tocar
   * al reabrir el panel. Vive lo que la app; un transcript reanudado cambia su mtime.
   */
  private readonly cache = new Map<string, CachedSummary>()

  /**
   * Lista las conversaciones de un conjunto de carpetas base (una por cuenta, de
   * AccountStore.hostDirFor), más recientes primero. Se escanea por cuenta y no por convención
   * de ruta: las cuentas globales viven fuera de `perfiles/<id>/`.
   */
  async listConversations(
    bases: ConversationBase[],
    opts: OpcionesEscaneo = {}
  ): Promise<ConversationSummary[]> {
    const norm: OpcionesEscaneo = { ...opts }
    const out: ConversationSummary[] = []
    const seen = new Set<string>()
    for (const { dir, agente } of bases) {
      const items =
        agente === 'codex' ? await this.listCodexIn(dir, norm) : await this.listClaudeIn(dir, norm)
      for (const it of items) {
        const key = `${it.agente}:${it.id}`
        if (seen.has(key)) continue // dos cuentas pueden apuntar a la misma carpeta (default)
        seen.add(key)
        out.push(it)
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt)
    // `soloUltima` promete UNA conversación y cada base aporta la suya: el recorte va después
    // de ordenar para quedarse con la más reciente de todas.
    return opts.soloUltima === true ? out.slice(0, 1) : out
  }

  /**
   * Borra del disco el transcript de una conversación (por sessionId) dentro de la carpeta base
   * de una cuenta; en Claude Code, también la carpeta hermana `<sessionId>/`. Devuelve true si
   * borró algo. Irreversible: quien llama debe confirmar antes.
   */
  async deleteConversation(dir: string, agente: ConvAgent, sessionId: string): Promise<boolean> {
    if (!/^[0-9a-fA-F-]{8,64}$/.test(sessionId)) return false // guarda: solo ids con forma de UUID
    const files =
      agente === 'codex'
        ? (await rolloutsCodex(dir)).filter((p) => codexSessionIdFromName(p) === sessionId)
        : (await transcriptsClaude(dir, { respaldo: 'todas' })).filter(
            (p) => path.basename(p, '.jsonl') === sessionId
          )
    let deleted = false
    for (const file of files) {
      await rm(file, { force: true })
      this.cache.delete(file) // el resumen memorizado ya no aplica
      deleted = true
      if (agente !== 'codex') {
        // Carpeta hermana con subagentes/snapshots de esa sesión, si existe.
        await rm(path.join(path.dirname(file), sessionId), { recursive: true, force: true }).catch(() => {})
      }
    }
    return deleted
  }

  private async listClaudeIn(base: string, opts: OpcionesEscaneo = {}): Promise<ConversationSummary[]> {
    // La criba solo mira el nombre de la carpeta; el filtro exacto usa la ruta entera. Si lo
    // cribado no da ningún transcript (el proyecto no tiene historial, o Claude Code cambió
    // cómo nombra sus carpetas), el camino caliente (`soloUltima`) responde vacío y arranca
    // una conversación nueva; el panel, que lo pide el usuario, prefiere mirarlo todo.
    const files = await transcriptsClaude(base, {
      nombreProyecto: opts.rutaProyecto ? basenameSuelto(opts.rutaProyecto) : undefined,
      respaldo: opts.soloUltima === true ? 'ninguna' : 'todas'
    })
    return this.resumir(files, 'claude-code', opts)
  }

  /**
   * Resume una lista de transcripts. Con `soloUltima` ordena por mtime (el mismo `updatedAt`
   * del camino largo) y abre de uno en uno hasta el primero válido: hay que seguir buscando si
   * un transcript no tiene mensajes (`/clear`) o es de otro proyecto, porque la criba por
   * nombre es un superconjunto y Codex no tiene criba. Por eso se aplica también aquí el
   * filtro exacto del servicio.
   */
  private async resumir(
    files: string[],
    agente: ConvAgent,
    opts: OpcionesEscaneo
  ): Promise<ConversationSummary[]> {
    if (opts.soloUltima !== true) {
      const out: ConversationSummary[] = []
      for (const file of files) {
        const s = await this.summarizeCached(file, agente)
        if (s) out.push(s)
      }
      return out
    }
    const quiero = opts.rutaProyecto ?? ''
    // Hay que tener todos los `stat` antes de ordenar; van en paralelo con tope.
    const conFecha = await conFechas(files)
    conFecha.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    for (const { archivo: file, st } of conFecha) {
      const s = await this.summarizeCached(file, agente, st)
      if (!s) continue
      if (quiero && !esDelProyecto(s.projectPath, quiero)) continue
      return [s]
    }
    return []
  }

  /**
   * Resume un transcript reusando la caché por (mtime, size). Un stat fallido (archivo borrado
   * entre el walk y aquí) devuelve null sin lanzar.
   */
  private async summarizeCached(
    file: string,
    agente: ConvAgent,
    stYaHecho?: Stats
  ): Promise<ConversationSummary | null> {
    let st: Stats
    if (stYaHecho) {
      // El camino de `soloUltima` ya hizo el stat para ordenar por mtime.
      st = stYaHecho
    } else {
      try {
        st = await stat(file)
      } catch {
        return null
      }
    }
    const hit = this.cache.get(file)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.summary
    const summary =
      agente === 'codex'
        ? await this.summarizeCodex(file, st).catch(() => null)
        : await this.summarizeClaude(file, st).catch(() => null)
    this.cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, summary })
    return summary
  }

  private async summarizeClaude(file: string, st: Stats): Promise<ConversationSummary | null> {
    const lines = await this.readHead(file)
    const acc: AcumuladoClaude = {
      aiTitle: null,
      firstUser: null,
      cwd: '',
      firstTs: 0,
      count: 0,
      sessionId: path.basename(file, '.jsonl')
    }
    for (const obj of lines) acumularClaude(acc, obj)
    if (acc.count === 0) return null
    const title = clip(acc.aiTitle ?? acc.firstUser ?? '(sin título)')
    return {
      id: acc.sessionId,
      agente: 'claude-code',
      title,
      project: acc.cwd ? path.posix.basename(acc.cwd) : '',
      projectPath: acc.cwd,
      // updatedAt del mtime (última escritura = última actividad): no hace falta leer el final.
      startedAt: acc.firstTs || Math.round(st.mtimeMs),
      updatedAt: Math.round(st.mtimeMs),
      messageCount: acc.count
    }
  }

  // Codex no codifica el cwd en ninguna ruta (agrupa por fecha): no hay criba posible y se
  // recorre todo. `soloUltima` sí aplica, con la ruta como filtro exacto (ver `resumir`).
  private async listCodexIn(base: string, opts: OpcionesEscaneo = {}): Promise<ConversationSummary[]> {
    return this.resumir(await rolloutsCodex(base), 'codex', opts)
  }

  private async summarizeCodex(file: string, st: Stats): Promise<ConversationSummary | null> {
    const lines = await this.readHead(file)
    const acc: AcumuladoCodex = { sessionId: '', cwd: '', firstTs: 0, firstUser: null, count: 0 }
    for (const obj of lines) acumularCodex(acc, obj)
    if (acc.count === 0) return null
    if (!acc.sessionId) acc.sessionId = codexSessionIdFromName(file)
    return {
      id: acc.sessionId,
      agente: 'codex',
      title: clip(acc.firstUser ?? '(sin título)'),
      project: acc.cwd ? path.posix.basename(acc.cwd) : '',
      projectPath: acc.cwd,
      startedAt: acc.firstTs || Math.round(st.mtimeMs),
      updatedAt: Math.round(st.mtimeMs),
      messageCount: acc.count
    }
  }

  /**
   * Lee la cabeza (hasta HEAD_BYTES guardados) de un JSONL y devuelve sus líneas parseadas. Una
   * línea gigante (una imagen pegada) no corta la lectura ni descarta la conversación: ver
   * `transcripts/cabezaJsonl.ts`. Las líneas inválidas se saltan.
   */
  private async readHead(file: string): Promise<JsonLine[]> {
    const crudas = await leerCabezaJsonl(file, { presupuesto: HEAD_BYTES, lecturaMax: HEAD_LECTURA_MAX })
    const out: JsonLine[] = []
    for (const line of crudas) {
      try {
        out.push(JSON.parse(line.trim()))
      } catch {
        // línea corrupta/truncada: se ignora, el resto del hilo sigue válido
      }
    }
    return out
  }
}

/**
 * Una línea ya parseada de un `.jsonl` de agente. Los campos conocidos se declaran; el resto
 * es `unknown` y lo estrechan los helpers.
 */
type JsonLine = Record<string, unknown> & { type?: string; payload?: Record<string, unknown> }

/** Lo que se va recogiendo de la cabeza de un transcript de Claude Code. */
interface AcumuladoClaude {
  aiTitle: string | null
  firstUser: string | null
  cwd: string
  firstTs: number
  count: number
  sessionId: string
}

/** Lo que se va recogiendo de la cabeza de un rollout de Codex. */
interface AcumuladoCodex {
  sessionId: string
  cwd: string
  firstTs: number
  firstUser: string | null
  count: number
}

/** Incorpora una línea de Claude Code al acumulado. */
function acumularClaude(acc: AcumuladoClaude, obj: JsonLine): void {
  const type = obj?.type
  if (type === 'ai-title' && typeof obj.aiTitle === 'string') acc.aiTitle = obj.aiTitle
  if (typeof obj?.sessionId === 'string') acc.sessionId = obj.sessionId
  if (type === 'user' || type === 'assistant') acumularMensajeClaude(acc, obj, type)
}

/** Incorpora una línea `user` o `assistant` de Claude Code: fecha, cwd, cuenta y primer mensaje humano. */
function acumularMensajeClaude(acc: AcumuladoClaude, obj: JsonLine, type: string): void {
  const ts = parseTs(obj.timestamp)
  if (ts && !acc.firstTs) acc.firstTs = ts
  if (typeof obj?.cwd === 'string' && !acc.cwd) acc.cwd = obj.cwd
  const text = claudeMessageText(obj)
  if (!text) return
  acc.count++
  if (type === 'user' && acc.firstUser === null && isHumanClaudeUser(obj)) acc.firstUser = text
}

/** Incorpora una línea de Codex al acumulado. */
function acumularCodex(acc: AcumuladoCodex, obj: JsonLine): void {
  if (obj?.type === 'session_meta') {
    const p = obj.payload ?? {}
    if (typeof p.session_id === 'string') acc.sessionId = p.session_id
    if (typeof p.cwd === 'string') acc.cwd = p.cwd
  }
  const ts = parseTs(obj?.timestamp)
  if (ts && !acc.firstTs) acc.firstTs = ts
  const m = codexEventMessage(obj)
  if (!m) return
  acc.count++
  if (m.role === 'user' && acc.firstUser === null) acc.firstUser = m.text
}

/** Valor anidado de `obj` siguiendo `ruta`; `undefined` si algún paso no es un objeto. */
function campo(obj: unknown, ...ruta: string[]): unknown {
  let actual = obj
  for (const clave of ruta) {
    if (actual === null || typeof actual !== 'object') return undefined
    actual = (actual as Record<string, unknown>)[clave]
  }
  return actual
}

/** Epoch ms desde un timestamp ISO o numérico; 0 si no se reconoce. */
function parseTs(v: unknown): number {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000 // seg -> ms si viene en segundos
  if (typeof v === 'string') {
    const n = Date.parse(v)
    if (!Number.isNaN(n)) return n
  }
  return 0
}

/** Recorta y colapsa espacios de un título de una línea. */
function clip(s: string): string {
  return recortarConElipsis(s.replace(/\s+/g, ' ').trim(), TITLE_MAX)
}

/** Texto inyectado por el CLI (no tecleado por el humano): caveats, hooks y wrappers de comandos. */
function isCliWrapperText(text: string): boolean {
  return /^<(local-command|command-name|command-message|command-args|user-prompt-submit-hook)\b/.test(
    text.trimStart()
  )
}

/** ¿La línea `user` de CC es un mensaje humano tecleado (no un tool_result ni un wrapper interno)? */
function isHumanClaudeUser(obj: JsonLine): boolean {
  const content = campo(obj, 'message', 'content')
  // Los wrappers del CLI vienen como string pero no los tecleó el usuario.
  if (typeof content === 'string' && isCliWrapperText(content)) return false
  if (campo(obj, 'origin', 'kind') === 'human') return true
  if (campo(obj, 'promptSource') === 'typed') return true
  // Fallback: contenido string directo (los tool_result vienen como array de bloques).
  return typeof content === 'string'
}

/** Extrae el texto visible de un mensaje de CC (string directo o bloques `text`). */
function claudeMessageText(obj: JsonLine): string {
  const content = campo(obj, 'message', 'content')
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      const text = campo(block, 'text')
      if (campo(block, 'type') === 'text' && typeof text === 'string') parts.push(text)
      // thinking / tool_use / tool_result / image: se omiten del hilo legible
    }
    return parts.join('\n').trim()
  }
  return ''
}

/** Extrae {role,text} de un `event_msg` de Codex (user_message / agent_message); null si no aplica. */
function codexEventMessage(obj: JsonLine): { role: 'user' | 'assistant'; text: string } | null {
  if (obj?.type !== 'event_msg') return null
  const tipo = campo(obj, 'payload', 'type')
  const mensaje = campo(obj, 'payload', 'message')
  if (typeof mensaje !== 'string') return null
  if (tipo !== 'user_message' && tipo !== 'agent_message') return null
  const text = mensaje.trim()
  if (!text) return null
  return { role: tipo === 'user_message' ? 'user' : 'assistant', text }
}

/** sessionId de Codex desde el nombre `rollout-<ts>-<uuid>.jsonl` (fallback si falta session_meta). */
function codexSessionIdFromName(file: string): string {
  const base = path.basename(file, '.jsonl')
  const m = base.match(/rollout-.*?-([0-9a-fA-F-]{36})$/)
  return m ? m[1] : base
}
