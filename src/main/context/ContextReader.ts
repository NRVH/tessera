// =============================================================================
// Lector del contexto de la conversación viva de un proyecto, desde el host: cuánto de la
// ventana del modelo ocupa el último turno del transcript (Claude Code) o del rollout (Codex).
// Elige el chat vivo con el ancla (`anclaConversacion.ts`), lee por la cola y estima la ventana
// de Claude por modelo. Lo usa `ServicioContexto`.
// Decisiones: docs/decisiones/agentes/contexto-de-la-conversacion.md
// =============================================================================
import path from 'node:path'
import type { ContextAgent, ContextSnapshot } from '../../shared/context-ipc'
// Extensión explícita en los imports de valor: `test-context.mts` corre con `node` a secas.
import { leerLineasJsonl, type LineaJsonl } from '../util/jsonlCola.ts'
import { metaDeCabecera, type MetaTranscript } from '../transcripts/formatoTranscript.ts'
import { leerCabezaParseada } from '../transcripts/cabezaJsonl.ts'
import {
  claveAncla,
  elegirVivo,
  TOLERANCIA_EVENTO_MS,
  type Ancla,
  type CandidatoMedido,
  type RegistroAnclas
} from './anclaConversacion.ts'
import { basenameSuelto, esDelProyecto } from '../conversations/slugProyecto.ts'
import { conFechas, rolloutsCodex, transcriptsClaude } from '../transcripts/listadoTranscripts.ts'

/** Cola que se lee de cada transcript buscando el último turno con cuentas. */
const TAIL_BYTES = 256 * 1024
/** Cabeza que se lee para averiguar el `cwd` del transcript (vive en las primeras líneas). */
const HEAD_BYTES = 64 * 1024
/** Bytes leídos como mucho de la cabeza: una primera línea con una imagen pegada (megas de
 *  base64) se compacta en vez de perder el `cwd`. Ver `transcripts/cabezaJsonl.ts`. */
const HEAD_LECTURA_MAX = 32 * 1024 * 1024
/** Trozo de lectura: menor que el presupuesto, o `leerCabezaJsonl` pararía tras el primero. */
const HEAD_TROZO = 16 * 1024
/**
 * Transcripts que se examinan, de mtime más reciente a más viejo: una criba, no el criterio.
 * El margen es holgado a propósito (lo medido se cachea) para que una racha de punteros
 * reescritos en chats muertos no deje fuera al vivo.
 */
const MAX_CANDIDATES = 24

/** Frescura del dato: el vigilante del transcript es quien de verdad lo refresca. */
const TTL_MS = 5_000

/**
 * Escalones de ventana conocidos, para promocionar una estimación que se quedó
 * corta. No hay ninguno intermedio en la práctica: o 200 k, o 500 k, o 1 M.
 */
const CLAUDE_WINDOW_TIERS = [200_000, 500_000, 1_000_000]

/**
 * Ventana por modelo de Claude Code. Solo se listan los que se apartan del default;
 * el resto cae en 200 k, que es el tamaño clásico. Verificado contra transcripts
 * reales: una sesión de `claude-opus-5` se compactó automáticamente al pasar de
 * 1 000 000 de tokens (`compact_boundary.preTokens`), así que su ventana es de 1 M.
 */
const CLAUDE_WINDOW_BY_MODEL: Array<{ re: RegExp; tokens: number }> = [
  { re: /opus-5/, tokens: 1_000_000 },
  { re: /sonnet-5/, tokens: 1_000_000 },
  { re: /fable-5/, tokens: 1_000_000 }
]
const CLAUDE_WINDOW_DEFAULT = 200_000

/** Entrada de caché de un transcript ya medido: vale mientras el fichero no cambie. */
interface CachedMeasure {
  mtimeMs: number
  size: number
  measure: Measure | null
}

/** Lo que se saca de la cola de un transcript: los tokens del último turno. */
interface Measure {
  /** Contexto ocupado. 0 = el transcript existe pero aún no tiene ningún turno. */
  usedTokens: number
  /** Ventana declarada por la fuente (Codex); 0 si hay que estimarla (Claude Code). */
  windowTokens: number
  model?: string
  sessionId?: string
  /**
   * Epoch ms del último evento FECHADO del transcript. Es la señal de vida con la que
   * se elige el chat vivo, y por eso se calcula aunque no haya ni un turno: un chat
   * recién abierto con `/clear` no tiene cuentas pero sí es el que está en marcha.
   */
  lastEventAt: number
  /** Epoch ms del evento MEDIDO (el turno, o la compactación). 0 si no lo fecha. */
  turnAt: number
  /** El número sale de una compactación recién hecha, no de un turno del agente. */
  compacted?: boolean
}

interface Candidate {
  path: string
  mtimeMs: number
  size: number
}

/**
 * Tope de la caché de metadatos. No se invalida nunca (el proyecto de un transcript no
 * cambia), así que sin tope crecería con cada fichero visto en toda la vida del proceso.
 */
const MAX_METAS = 4000

export class ContextReader {
  /** Medidas por RUTA de transcript, invalidadas por (mtime, size). */
  private readonly measures = new Map<string, CachedMeasure>()
  /** Metadatos por RUTA. Sin invalidación: no cambian nunca (ver MAX_METAS). */
  private readonly metas = new Map<string, MetaTranscript>()
  /** Última respuesta por (base, agente, proyecto), para no re-escanear en cada sondeo. */
  private readonly snaps = new Map<string, { at: number; snap: ContextSnapshot }>()
  /** Lecturas en vuelo: N paneles de la misma cuenta no deben escanear N veces. */
  private readonly inFlight = new Map<string, Promise<ContextSnapshot>>()
  private readonly now: () => number
  /**
   * Anclas de conversación por (agente, base, proyecto). Null = nadie las alimenta
   * (tests, o el anillo consultado sin sesión abierta) y manda la heurística de
   * siempre. Ver `anclaConversacion.ts`.
   */
  private readonly anclas: RegistroAnclas | null

  constructor(now: () => number = Date.now, anclas: RegistroAnclas | null = null) {
    this.now = now
    this.anclas = anclas
  }

  /**
   * Contexto del chat vivo de `rutaProyecto` dentro de la carpeta de credenciales `base`.
   * `rutaProyecto` es la ruta completa del proyecto en el host (la misma con la que filtra el
   * historial), no su basename: dos proyectos con el mismo nombre compartirían anillo. Vacío =
   * no filtrar, se mide el chat más reciente que haya.
   */
  async read(base: string, agente: ContextAgent, rutaProyecto: string): Promise<ContextSnapshot> {
    // Misma clave que la del ancla: la misma tripleta (agente, carpeta, proyecto).
    const key = claveAncla(agente, base, rutaProyecto)
    const hit = this.snaps.get(key)
    if (hit && this.now() - hit.at < TTL_MS) return hit.snap

    const flying = this.inFlight.get(key)
    if (flying) return flying

    const promise = this.load(base, agente, rutaProyecto).then((snap) => {
      this.snaps.set(key, { at: this.now(), snap })
      return snap
    })
    this.inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      this.inFlight.delete(key)
    }
  }

  /** Marca lo cacheado como caducado (el agente acaba de escribir): la próxima lectura vuelve al disco. */
  invalidate(): void {
    this.snaps.clear()
  }

  private async load(base: string, agente: ContextAgent, rutaProyecto: string): Promise<ContextSnapshot> {
    let candidates: Candidate[]
    try {
      candidates = await this.listCandidates(base, agente, rutaProyecto)
    } catch (e) {
      return sinContexto(agente, 'error', e instanceof Error ? e.message : 'no se pudo listar')
    }
    if (!candidates.length) return sinContexto(agente, 'no-session')

    // Criba por mtime (barata); el vivo se decide después por el ancla o por la marca de
    // tiempo interna, no por cuál se tocó el último.
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)

    const ancla = this.anclas?.get(claveAncla(agente, base, rutaProyecto)) ?? null
    const examinar = candidatosAExaminar(candidates, ancla)
    const { medidos, sawProject } = await this.medirCandidatos(examinar, agente, rutaProyecto)

    const cands: CandidatoMedido[] = medidos.map(({ file, measure }) => ({
      sessionId: measure.sessionId,
      nombre: path.basename(file.path),
      lastEventAt: measure.lastEventAt,
      mtimeMs: file.mtimeMs
    }))
    const eleccion = elegirVivo(cands, ancla, TOLERANCIA_EVENTO_MS)
    // «Este proyecto no tiene chats» y «los tiene, pero aún sin turnos» se dicen distinto.
    if (eleccion.indice < 0) return sinContexto(agente, sawProject ? 'no-data' : 'no-session')
    // Lo aprendido por evidencia se fija: la próxima lectura ya no depende de que el chat
    // siga siendo el más reciente.
    if (eleccion.aprender) {
      this.anclas?.aprender(claveAncla(agente, base, rutaProyecto), eleccion.aprender)
    }

    // No se retrocede al chat anterior: el vivo es este, y sin turnos es que acaba de empezar.
    const { file, measure } = medidos[eleccion.indice]
    const anclaje = eleccion.anclaje === 'sesion' ? 'sesion' : 'heuristica'
    if (measure.usedTokens <= 0) return { ...sinContexto(agente, 'no-data'), anclaje }
    return snapshotDeMedida(agente, measure, file, anclaje)
  }

  /** Mide los candidatos que son del proyecto (y no de un subagente); dice si vio alguno del proyecto. */
  private async medirCandidatos(
    examinar: Candidate[],
    agente: ContextAgent,
    rutaProyecto: string
  ): Promise<{ medidos: Array<{ file: Candidate; measure: Measure }>; sawProject: boolean }> {
    let sawProject = false
    const medidos: Array<{ file: Candidate; measure: Measure }> = []
    for (const file of examinar) {
      if (rutaProyecto) {
        const meta = await this.metaOf(file.path, agente)
        if (meta.cwd === null) continue // sin `cwd` legible: no se puede atribuir
        if (meta.subagente) continue // rollout de subagente: es otra ventana
        if (!esDelProyecto(meta.cwd, rutaProyecto)) continue
      } else if ((await this.metaOf(file.path, agente)).subagente) {
        continue
      }
      sawProject = true
      const measure = await this.measureCached(file, agente)
      if (!measure) continue // ilegible: no se puede ni fechar
      medidos.push({ file, measure })
    }
    return { medidos, sawProject }
  }

  /**
   * Transcripts de la cuenta que pueden ser el chat vivo, con su mtime y tamaño.
   *
   * En Claude Code se CRIBAN por el nombre de la carpeta antes de tocar los ficheros
   * (ver `conversations/slugProyecto`). Importa porque esto no se pide de vez en
   * cuando: el anillo lo refresca cada 60 s y, además, se invalida al TERMINAR CADA
   * TURNO del agente — justo cuando estás esperando la respuesta—. Sin la criba, cada
   * una de esas veces recorría los 481 transcripts de los 42 proyectos para acabar
   * midiendo uno.
   *
   * La criba es un superconjunto y el filtro por `cwd` de `load` sigue mandando, así
   * que esto no puede cambiar QUÉ conversación se elige, solo cuántas se miran.
   */
  private async listCandidates(
    base: string,
    agente: ContextAgent,
    rutaProyecto: string
  ): Promise<Candidate[]> {
    // Codex: solo `sessions/` (`archived_sessions/` son chats ya cerrados, nunca el vivo) y
    // sin criba, porque no codifica el proyecto en la ruta. Claude: los transcripts de nivel
    // superior de `projects/<proyecto>/` (los hilos de subagente tienen su propia ventana),
    // cribados por carpeta. Si lo cribado no da nada se miran todos: aquí compensa, porque
    // no bloquea ninguna apertura y decir «sin sesión» habiendo una es un número mal puesto.
    const archivos =
      agente === 'codex'
        ? await rolloutsCodex(base)
        : await transcriptsClaude(base, {
            nombreProyecto: rutaProyecto ? basenameSuelto(rutaProyecto) : undefined,
            respaldo: 'todas'
          })
    const fechados = await conFechas(archivos)
    return fechados.map(({ archivo, st }) => ({ path: archivo, mtimeMs: st.mtimeMs, size: st.size }))
  }

  /**
   * Metadatos del transcript (de su CABEZA, cacheados por ruta): de qué proyecto es y
   * si es un rollout de subagente. Un fallo de lectura devuelve `cwd: null` y NO se
   * cachea: el fichero pudo borrarse entre el walk y esta llamada.
   */
  private async metaOf(file: string, agente: ContextAgent): Promise<MetaTranscript> {
    const hit = this.metas.get(file)
    if (hit !== undefined) return hit
    let cwd: string | null = null
    let subagente = false
    try {
      const lines = await leerCabezaParseada(file, {
        presupuesto: HEAD_BYTES,
        lecturaMax: HEAD_LECTURA_MAX,
        trozo: HEAD_TROZO
      })
      const meta = metaDeCabecera(agente, lines)
      cwd = meta.cwd
      subagente = meta.subagente
    } catch {
      return { cwd: null, subagente: false } // borrado entre el walk y aquí, o ilegible
    }
    if (cwd !== null) {
      // Tope: esta caché no se invalida nunca, así que sin él crecería con cada
      // transcript visto en toda la vida del proceso. Vaciarla entera es barato
      // (se repuebla leyendo cabeceras) y evita llevar una política de expulsión.
      if (this.metas.size >= MAX_METAS) this.metas.clear()
      this.metas.set(file, { cwd, subagente })
    }
    return { cwd, subagente }
  }

  /** Mide la cola del transcript re-usando la caché por (mtime, size). */
  private async measureCached(file: Candidate, agente: ContextAgent): Promise<Measure | null> {
    const hit = this.measures.get(file.path)
    if (hit && hit.mtimeMs === file.mtimeMs && hit.size === file.size) return hit.measure
    const measure = await (agente === 'codex'
      ? measureCodex(file.path, file.size)
      : measureClaude(file.path, file.size)
    ).catch(() => null)
    this.measures.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, measure })
    return measure
  }
}

/** Respuesta sin número que pintar: la UI apaga el anillo y explica el motivo. */
function sinContexto(
  agente: ContextAgent,
  unavailable: ContextSnapshot['unavailable'],
  detail?: string
): ContextSnapshot {
  return {
    agente,
    usedTokens: 0,
    windowTokens: 0,
    percent: 0,
    observedAt: 0,
    fetchedAt: Date.now(),
    unavailable,
    detail
  }
}

/**
 * Los candidatos a medir: los `MAX_CANDIDATES` más recientes y, si hay ancla, el chat anclado
 * aunque quede fuera: un chat sin escribir queda enterrado bajo los punteros que el CLI
 * reescribe en otros y sin este rescate el ancla no lo encontraría.
 */
function candidatosAExaminar(candidates: Candidate[], ancla: Ancla | null): Candidate[] {
  const examinar = candidates.slice(0, MAX_CANDIDATES)
  if (ancla?.estado.tipo === 'anclada') {
    const id = ancla.estado.sessionId
    if (!examinar.some((c) => nombreContieneSesion(c.path, id))) {
      const rescatado = candidates.find((c) => nombreContieneSesion(c.path, id))
      if (rescatado) examinar.push(rescatado)
    }
  }
  return examinar
}

/** El snapshot de una medida con turnos; la ventana de Claude Code se estima por modelo. */
function snapshotDeMedida(
  agente: ContextAgent,
  measure: Measure,
  file: Candidate,
  anclaje: 'sesion' | 'heuristica'
): ContextSnapshot {
  const windowTokens = measure.windowTokens || estimateClaudeWindow(measure.model, measure.usedTokens)
  const percent = windowTokens > 0 ? clampPercent((measure.usedTokens / windowTokens) * 100) : 0
  return {
    agente,
    usedTokens: measure.usedTokens,
    windowTokens,
    percent,
    model: measure.model,
    sessionId: measure.sessionId,
    // Solo Claude Code estima: Codex publica su ventana en el propio evento.
    ...(measure.windowTokens ? {} : { windowEstimated: true }),
    ...(measure.compacted ? { compacted: true } : {}),
    anclaje,
    observedAt: Math.round(measure.turnAt || file.mtimeMs),
    fetchedAt: Date.now()
  }
}

/**
 * Contexto ocupado según el último evento que lo cambió: un turno del asistente (suma de
 * `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` y `output_tokens`;
 * solo `input_tokens` daría casi cero porque en un chat largo todo viene de caché) o una
 * compactación (`compact_boundary`, con `postTokens`), que gana si es posterior al último turno.
 * Se saltan las líneas `isSidechain`: los subagentes tienen otra ventana.
 */
async function measureClaude(file: string, size: number): Promise<Measure | null> {
  const lines = await leerLineasJsonl(file, size, TAIL_BYTES, 'tail')
  const est: EstadoClaude = {
    lastEventAt: 0,
    turnIdx: -1,
    turnUsed: 0,
    turnAt: 0,
    sessionId: undefined,
    boundaryIdx: -1,
    boundaryUsed: 0,
    boundaryAt: 0,
    model: undefined
  }
  for (let i = lines.length - 1; i >= 0; i--) leerLineaClaude(est, lines[i], i)

  const compacted = est.boundaryIdx > est.turnIdx
  return {
    // Sin turno ni frontera queda en 0: transcript recién abierto, sin nada que medir.
    usedTokens: compacted ? est.boundaryUsed : est.turnUsed,
    windowTokens: 0, // el transcript no la publica: se estima por modelo
    model: est.model,
    sessionId: est.sessionId ?? path.basename(file, '.jsonl'),
    lastEventAt: est.lastEventAt,
    turnAt: compacted ? est.boundaryAt : est.turnAt,
    ...(compacted ? { compacted: true } : {})
  }
}

/** Lo que `measureClaude` va recogiendo al recorrer el transcript de la última línea a la primera. */
interface EstadoClaude {
  lastEventAt: number
  turnIdx: number
  turnUsed: number
  turnAt: number
  sessionId: string | undefined
  boundaryIdx: number
  boundaryUsed: number
  boundaryAt: number
  /** Se busca aunque gane la compactación: su línea no lo dice y la ventana saldría inflada. */
  model: string | undefined
}

/** Incorpora una línea (recorrida de fin a inicio) al estado: fecha, frontera de compactación o turno. */
function leerLineaClaude(est: EstadoClaude, obj: LineaJsonl, i: number): void {
  const at = parseTime(obj.timestamp)
  if (at && !est.lastEventAt) est.lastEventAt = at

  if (est.boundaryIdx < 0 && obj.type === 'system' && obj.subtype === 'compact_boundary') {
    registrarFrontera(est, obj, i, at)
    return
  }
  if (obj.type !== 'assistant' || obj.isSidechain === true) return
  registrarTurnoAsistente(est, obj, i, at)
}

/** Registra una compactación; sin `postTokens` (CLI viejo) no hay nada que leer y manda el turno. */
function registrarFrontera(est: EstadoClaude, obj: LineaJsonl, i: number, at: number): void {
  const meta = obj.compactMetadata as Record<string, unknown> | undefined
  if (typeof meta?.postTokens === 'number' && Number.isFinite(meta.postTokens)) {
    est.boundaryIdx = i
    est.boundaryUsed = meta.postTokens
    est.boundaryAt = at
  }
}

/** Registra el modelo y, si aún no hay turno, el primer turno del asistente con tokens. */
function registrarTurnoAsistente(est: EstadoClaude, obj: LineaJsonl, i: number, at: number): void {
  const message = obj.message as Record<string, unknown> | undefined
  const usage = message?.usage as Record<string, unknown> | undefined
  if (!usage) return
  if (!est.model && typeof message?.model === 'string') est.model = message.model
  if (est.turnIdx >= 0) return // el turno ya está: se sigue solo por el modelo
  const used =
    num(usage.input_tokens) +
    num(usage.cache_creation_input_tokens) +
    num(usage.cache_read_input_tokens) +
    num(usage.output_tokens)
  if (used <= 0) return
  est.turnIdx = i
  est.turnUsed = used
  est.turnAt = at
  if (typeof obj.sessionId === 'string') est.sessionId = obj.sessionId
}

/**
 * Ventana de Claude Code a partir del modelo. Si lo observado ya la supera, la tabla
 * está desfasada (modelo nuevo, o ventana ampliada): se promociona al siguiente
 * escalón conocido en vez de pintar un porcentaje imposible.
 */
export function estimateClaudeWindow(model: string | undefined, usedTokens: number): number {
  const base =
    (model && CLAUDE_WINDOW_BY_MODEL.find((m) => m.re.test(model))?.tokens) || CLAUDE_WINDOW_DEFAULT
  if (usedTokens <= base) return base
  const next = CLAUDE_WINDOW_TIERS.find((t) => t >= usedTokens)
  // Por encima del último escalón conocido, redondear hacia arriba al millón para que
  // el anillo siga significando algo (y no se quede clavado en el 100 %).
  return next ?? Math.ceil(usedTokens / 1_000_000) * 1_000_000
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

/**
 * Último `token_count` con `info`. Aquí no se estima nada: `last_token_usage` es el
 * turno que se acaba de mandar (lo que ocupa la ventana AHORA) y `model_context_window`
 * es su tamaño. OJO con `total_token_usage`: es el ACUMULADO de toda la sesión
 * (decenas de millones en un chat largo) y no tiene nada que ver con el contexto.
 */
async function measureCodex(file: string, size: number): Promise<Measure | null> {
  const lines = await leerLineasJsonl(file, size, TAIL_BYTES, 'tail')
  let lastEventAt = 0
  let found: Measure | null = null

  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = lines[i]
    const at = parseTime(obj.timestamp)
    if (at && !lastEventAt) lastEventAt = at
    if (found) continue // ya está el turno; se sigue solo por si falta fechar el final

    const payload = obj.payload
    if (payload?.type !== 'token_count') continue
    const info = payload.info as Record<string, unknown> | null | undefined
    if (!info || typeof info !== 'object') continue
    const last = info.last_token_usage as Record<string, unknown> | undefined
    if (!last) continue
    const used = num(last.total_tokens) || num(last.input_tokens) + num(last.output_tokens)
    if (used <= 0) continue
    found = {
      usedTokens: used,
      windowTokens: num(info.model_context_window),
      model: typeof info.model === 'string' ? info.model : undefined,
      sessionId: codexSessionIdFromName(file),
      lastEventAt: 0,
      turnAt: at
    }
  }
  // Aunque no haya ni un `token_count` se devuelve la medida: un rollout recién
  // abierto (un `/new`) no tiene turnos pero SÍ es el chat vivo, y hay que poder
  // fecharlo para que gane al anterior en vez de que el anterior siga mandando.
  return {
    usedTokens: 0,
    windowTokens: 0,
    sessionId: codexSessionIdFromName(file),
    turnAt: 0,
    ...found,
    lastEventAt
  }
}

/** sessionId de Codex desde el nombre `rollout-<ts>-<uuid>.jsonl`. */
function codexSessionIdFromName(file: string): string {
  const base = path.basename(file, '.jsonl')
  return base.match(/rollout-.*?-([0-9a-fA-F-]{36})$/)?.[1] ?? base
}

// ---------------------------------------------------------------------------
// Utilidades de E/S
// ---------------------------------------------------------------------------

/**
 * ¿El nombre del fichero corresponde a esa conversación? Sirve para los dos formatos:
 * `<sessionId>.jsonl` en Claude Code y `rollout-<fecha>-<uuid>.jsonl` en Codex —donde,
 * comprobado, el uuid SOBREVIVE a los `codex resume` porque se sigue anexando al mismo
 * fichero—. Se compara por inclusión para no depender de ninguna de las dos formas.
 */
function nombreContieneSesion(file: string, sessionId: string): boolean {
  return sessionId.length > 0 && path.basename(file).includes(sessionId)
}

/** Epoch ms de una marca ISO del transcript; 0 si falta o no es válida. */
function parseTime(v: unknown): number {
  if (typeof v !== 'string') return 0
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

/** Número o 0: los campos de `usage` faltan o vienen nulos según la versión del CLI. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}
