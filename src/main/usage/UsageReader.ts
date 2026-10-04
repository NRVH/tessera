// =============================================================================
// Lector del uso de cuenta de Claude Code (endpoint OAuth) y Codex (último `token_count` del
// rollout), siempre desde el host y sin entrar al contenedor. Cachea por (cuenta, agente) con
// TTL, suelo de red y backoff tras un 429, porque el endpoint limita por token.
// De dónde sale el token lo decide `credencialesClaude.ts`; lo usa `ServicioUso`.
// Decisiones: docs/decisiones/agentes/uso-de-cuenta.md
// =============================================================================
import type { Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { UsageAgent, UsageRunMode, UsageSnapshot } from '../../shared/usage-ipc'
import { ventanasClaude, ventanasCodex } from './ventanasUso.ts'
// Extensión explícita: `test-usage.mts` corre con `node` a secas.
import { leerCredencialesClaude } from './credencialesClaude.ts'
import { leerLineasJsonl, type LineaJsonl } from '../util/jsonlCola.ts'
import { algunaCaducada, caducarSnapshot } from './caducidad.ts'

/** Endpoint no documentado que alimenta el `/usage` del propio Claude Code. */
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/**
 * A dónde se pregunta el uso de Claude Code. Las pruebas de interfaz lo desvían con
 * `TESSERA_USO_CLAUDE` a un servidor suyo, y solo vale si es de ESTA máquina.
 */
export function urlUsoClaude(desvio: string | undefined = process.env.TESSERA_USO_CLAUDE): string {
  return desvio !== undefined && /^http:\/\/127\.0\.0\.1:\d{1,5}\/[\w/.-]*$/.test(desvio) ? desvio : CLAUDE_USAGE_URL
}

/**
 * El token que viaja en la petición: el de la cuenta SOLO hacia el endpoint real. Desviada
 * a un servidor de pruebas va uno de mentira, así que una variable de entorno olvidada no
 * puede sacar el token de la cuenta a un puerto de la máquina.
 */
export function tokenParaUso(url: string, token: string): string {
  return url === CLAUDE_USAGE_URL ? token : 'token-de-pruebas'
}

/**
 * User-Agent OBLIGATORIO. Sin un `claude-code/<version>` la petición cae en un
 * bucket agresivamente limitado y devuelve 429 constantes. La versión exacta no
 * se valida contra nada; basta con que la forma sea la del CLI.
 */
const CLAUDE_USER_AGENT = 'claude-code/2.1.201'

/** Beta que habilita la autenticación por token OAuth (la del login del CLI). */
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20'

/** Frescura del dato de Claude: es una llamada de red con rate limit por token. */
const TTL_CLAUDE_MS = 180_000
/** Codex es una lectura de disco: puede ser mucho más ágil. */
const TTL_CODEX_MS = 15_000
/** Un fallo se recuerda poco: que un login o un turno lo arreglen pronto. */
const TTL_FAIL_MS = 30_000

/**
 * SUELO de red para Claude: por mucho que nos fuercen (hover) o nos invaliden (fin de
 * turno), no se toca el endpoint más de una vez cada tanto. Sin este suelo, una ráfaga
 * de turnos cortos —o el ratón entrando y saliendo del footer— se traduciría en una
 * andanada de peticiones sobre un endpoint que limita por token y responde 429 al
 * insistente. Codex no lo necesita: leer la cola de un fichero local no molesta a nadie.
 */
const MIN_NET_MS = 20_000

/**
 * ESPERA tras un 429, cuando el servidor no dice cuánta (`retry-after`). Se DUPLICA con
 * cada 429 seguido hasta el techo: si el endpoint nos está frenando, insistir al mismo
 * ritmo es justo lo que lo mantiene cerrado. Un éxito la borra.
 */
const BACKOFF_BASE_MS = 60_000
const BACKOFF_MAX_MS = 600_000

const HTTP_TIMEOUT_MS = 8000

/** Cola del rollout que se lee buscando el último `token_count`. */
const TAIL_BYTES = 256 * 1024
/** Rollouts recientes que se miran antes de rendirse (el último puede no tener límites). */
const MAX_ROLLOUTS = 5


interface CacheEntry {
  at: number
  ttl: number
  snap: UsageSnapshot
  /**
   * Epoch ms antes del cual NO se vuelve a la red PASE LO QUE PASE (ni `force`, ni
   * invalidación por fin de turno). Es el castigo por 429: un techo blando (TTL) no
   * sirve aquí, porque `force` y la invalidación lo saltan por diseño.
   */
  retryAt?: number
  /** 429 seguidos (otros fallos no cuentan): cada uno duplica la espera. Un éxito lo devuelve a 0. */
  fails?: number
}

export class UsageReader {
  private readonly cache = new Map<string, CacheEntry>()
  /**
   * Lecturas EN VUELO por clave. Sin esto, las N barras de uso abiertas sobre la MISMA
   * cuenta (un panel por proyecto, y los ocultos siguen vivos por el keep-alive) reciben
   * a la vez el aviso de fin de turno, llaman a la vez, y como la caché solo se escribe
   * al VOLVER la petición, ninguna ve a las otras: salían N peticiones idénticas al
   * endpoint por cada turno. Ahora la primera va a la red y las demás se cuelgan de ella.
   */
  private readonly inFlight = new Map<string, Promise<UsageSnapshot>>()
  /**
   * Último dato BUENO por cuenta. Cuando la fuente falla (un 429, la red), la UI no debe
   * quedarse en blanco: enseñar el último porcentaje conocido —marcado como viejo— es más
   * verdad que un guion, y evita que un límite de 1 min parezca que el uso "desapareció".
   */
  private readonly lastGood = new Map<string, UsageSnapshot>()
  /**
   * Reloj inyectable. Existe SOLO para que la prueba pueda saltar los minutos del suelo de
   * red y del backoff sin dormirlos de verdad; en producción es `Date.now`.
   */
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /**
   * Uso de la cuenta cuya carpeta de credenciales es `base`. `cacheKey` identifica
   * a la cuenta (id, o el modo host): el mismo `base` siempre da el mismo dato.
   *
   * `modo` sólo lo usa Claude Code, y sólo para decidir si puede mirar el llavero de
   * macOS (ver `credencialesClaude.ts`): en `container` las credenciales son las del
   * fichero montado y el llavero sería el token de OTRA cuenta. Por defecto
   * `container`, que es el caso conservador.
   */
  async read(
    base: string,
    agente: UsageAgent,
    cacheKey: string,
    force = false,
    modo: UsageRunMode = 'container'
  ): Promise<UsageSnapshot> {
    const cacheado = this.respuestaCacheada(cacheKey, agente, force)
    if (cacheado) return cacheado

    // Coalescencia: una sola lectura real por cuenta, aunque la pidan a la vez N paneles.
    const flying = this.inFlight.get(cacheKey)
    if (flying) return flying

    const promise = this.load(base, agente, cacheKey, modo)
    this.inFlight.set(cacheKey, promise)
    try {
      return await promise
    } finally {
      this.inFlight.delete(cacheKey)
    }
  }

  /** El dato cacheado si todavía vale (castigo por 429, TTL o suelo de red); si no, `undefined`. */
  private respuestaCacheada(
    cacheKey: string,
    agente: UsageAgent,
    force: boolean
  ): UsageSnapshot | undefined {
    const hit = this.cache.get(cacheKey)
    const ahora = this.now()
    const age = hit ? ahora - hit.at : Infinity
    // El castigo por 429 manda sobre todo, incluido `force`: insistir empeora el bloqueo. Puede
    // durar 10 min, así que lo que se sirve se caduca a la hora de servirlo: una ventana que se
    // reinicia durante la espera no puede seguir enseñando el porcentaje de antes.
    if (hit?.retryAt !== undefined && ahora < hit.retryAt) return caducarSnapshot(hit.snap, ahora)
    // Una ventana ya reiniciada salta el TTL y el suelo de red. `caducarSnapshot` retira el
    // `resetsAt` vencido antes de guardar, así que dispara una relectura y no una por sondeo.
    const caduca = !!hit && algunaCaducada(hit.snap, ahora)
    if (!force && hit && age < hit.ttl && !caduca) return hit.snap
    // El suelo de red gana también a `force` y al fin de turno: evita que un hover nervioso
    // se convierta en una tanda de 429.
    if (hit && agente === 'claude-code' && age < MIN_NET_MS && !caduca) return hit.snap
    return undefined
  }

  /** Va a la fuente y actualiza caché, backoff y último-dato-bueno. */
  private async load(
    base: string,
    agente: UsageAgent,
    cacheKey: string,
    modo: UsageRunMode
  ): Promise<UsageSnapshot> {
    const leido = agente === 'codex' ? await readCodexUsage(base) : await readClaudeUsage(base, modo)
    const prev = this.cache.get(cacheKey)
    const now = this.now()
    // El dato de Codex es el ÚLTIMO CONOCIDO: si no mandas peticiones, el rollout no
    // cambia y esto devolvería el mismo porcentaje de una ventana que ya se reinició.
    // (En Claude la lectura es de ahora, así que aquí normalmente no toca nada.)
    const fresh = caducarSnapshot(leido, now)

    // Un fallo TRANSITORIO (429 / red / respuesta rara) no es un estado de la cuenta: es
    // ruido. Se degrada al último dato bueno y se espera antes de volver a molestar.
    if (fresh.unavailable === 'rate-limited' || fresh.unavailable === 'error') {
      // Solo un 429 cuenta para el castigo exponencial: una red caída o un 500 no dicen que
      // estemos insistiendo demasiado, y contarlos alargaba la espera del siguiente 429.
      const limitado = fresh.unavailable === 'rate-limited'
      const fails = (prev?.fails ?? 0) + (limitado ? 1 : 0)
      const backoff =
        limitado
          ? Math.max(
              fresh.retryAfterMs ?? 0,
              Math.min(BACKOFF_BASE_MS * 2 ** (fails - 1), BACKOFF_MAX_MS)
            )
          : 0
      // El último dato bueno puede ser de hace 10 min y describir una ventana que
      // mientras tanto se ha reiniciado: se caduca ANTES de servirlo, o el "dato viejo"
      // acabaría siendo un porcentaje alto de una ventana que ya está a cero.
      const good = this.lastGood.get(cacheKey)
      const snap: UsageSnapshot = good
        ? { ...caducarSnapshot(good, now), stale: true, detail: fresh.detail }
        : fresh
      this.cache.set(cacheKey, {
        at: now,
        ttl: backoff || TTL_FAIL_MS,
        snap,
        fails,
        ...(backoff ? { retryAt: now + backoff } : {})
      })
      return snap
    }

    // Éxito (o estado estable: sin login, cuenta por API key…): se olvida el castigo. Se guarda
    // `leido`, la lectura cruda y no la caducada: caducar depende de la hora a la que se enseña,
    // no de cuándo se leyó, y la rama de fallo ya vuelve a caducar antes de servirla.
    if (!fresh.unavailable) this.lastGood.set(cacheKey, leido)
    const ttl = fresh.unavailable
      ? TTL_FAIL_MS
      : agente === 'codex'
        ? TTL_CODEX_MS
        : TTL_CLAUDE_MS
    this.cache.set(cacheKey, { at: now, ttl, snap: fresh })
    return fresh
  }

  /**
   * Marca el dato como CADUCADO sin borrarlo: la próxima lectura vuelve a la fuente,
   * pero el `at` (y el `retryAt` de un 429) se conservan, para que el suelo de red y el
   * backoff sigan contando. Lo llama el vigilante al ver que el agente acaba de escribir
   * en su transcript.
   */
  invalidate(cacheKey: string): void {
    const hit = this.cache.get(cacheKey)
    if (hit) hit.ttl = 0
  }

  /** Olvida lo cacheado de una cuenta (al hacer login/logout el dato anterior ya no vale). */
  forget(cacheKey: string): void {
    this.cache.delete(cacheKey)
    this.lastGood.delete(cacheKey)
  }
}

// ---------------------------------------------------------------------------
// Claude Code: endpoint OAuth
// ---------------------------------------------------------------------------

async function readClaudeUsage(base: string, modo: UsageRunMode): Promise<UsageSnapshot> {
  const fail = (unavailable: UsageSnapshot['unavailable'], detail?: string): UsageSnapshot => ({
    agente: 'claude-code',
    windows: [],
    fetchedAt: Date.now(),
    unavailable,
    detail
  })

  // DÓNDE están las credenciales lo decide `credencialesClaude`, no este módulo: en
  // macOS el CLI no escribe `.credentials.json`, guarda el mismo bloque en el llavero.
  // Aquí sólo se traduce el resultado a lo que la UI sabe decir.
  const creds = await leerCredencialesClaude(base, modo)
  // Sin fichero ni llavero (cuenta nunca usada / logout): no hay nada que pedir.
  if (creds.clase === 'ausente') return fail('no-credentials')
  // Una cuenta de API key no tiene bloque OAuth: no hay ventanas de límite que enseñar.
  if (creds.clase === 'sin-oauth') return fail('not-subscription')
  // HABÍA credencial y no se pudo leer (el llavero de macOS pidiendo autorización, por
  // ejemplo). Es `error` y NO `no-credentials` a propósito: sólo `error` cae en la rama
  // transitoria de `load`, que conserva el último dato bueno. Con `no-credentials` unas
  // barras correctas se borrarían para decir «esta cuenta aún no ha iniciado sesión»,
  // que además de falso no se arregla solo a ojos del usuario.
  if (creds.clase === 'fallo') return fail('error', creds.detalle)
  const token = creds.token

  let res: Response
  try {
    const url = urlUsoClaude()
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenParaUso(url, token)}`,
        'anthropic-beta': CLAUDE_OAUTH_BETA,
        'User-Agent': CLAUDE_USER_AGENT,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    })
  } catch (e) {
    return fail('error', e instanceof Error ? e.message : 'fallo de red')
  }

  // El access token dura ~1 h. Cuando caduca no lo renovamos NOSOTROS: el propio CLI
  // lo refresca al usarlo y reescribe el fichero, y la siguiente lectura ya funciona.
  // Meternos a refrescarlo por nuestra cuenta sería competir con él por el refresh
  // token (y una rotación perdida = login roto), a cambio de un dato cosmético.
  if (res.status === 401 || res.status === 403) return fail('auth-expired')
  // 429: el endpoint nos frena. Se distingue del resto porque tiene tratamiento propio
  // (backoff creciente arriba) y porque el usuario merece que se lo digan sin susto: no
  // es que la cuenta se haya roto, es que hay que esperar un momento.
  if (res.status === 429) {
    const snap = fail('rate-limited', 'demasiadas consultas seguidas')
    const retry = parseRetryAfter(res.headers.get('retry-after'))
    return retry !== undefined ? { ...snap, retryAfterMs: retry } : snap
  }
  if (!res.ok) return fail('error', `HTTP ${res.status}`)

  let body: Record<string, unknown>
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    return fail('error', 'respuesta ilegible')
  }

  const windows = ventanasClaude(body)
  if (!windows.length) return fail('no-data')
  return { agente: 'claude-code', windows, fetchedAt: Date.now() }
}

/** `Retry-After` en ms. Admite las dos formas del estándar: segundos o fecha HTTP. */
function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined
  const secs = Number(raw)
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000
  const at = Date.parse(raw)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - Date.now())
}

// ---------------------------------------------------------------------------
// Codex: último `token_count` de los rollouts
// ---------------------------------------------------------------------------

async function readCodexUsage(base: string): Promise<UsageSnapshot> {
  const fail = (unavailable: UsageSnapshot['unavailable'], detail?: string): UsageSnapshot => ({
    agente: 'codex',
    windows: [],
    fetchedAt: Date.now(),
    unavailable,
    detail
  })

  // Sin `auth.json` no hay login; distinguirlo de "aún no ha hablado" hace que el
  // tooltip pueda decir la verdad ("inicia sesión" vs "usa el agente una vez").
  const loggedIn = await exists(path.join(base, 'auth.json'))

  // Los rollouts vivos están en `sessions/`; `archived_sessions/` guarda los cerrados.
  // Se miran ambos: tras archivar una sesión, el último snapshot conocido sigue ahí.
  const files = [
    ...(await walkRollouts(path.join(base, 'sessions'))),
    ...(await walkRollouts(path.join(base, 'archived_sessions')))
  ]
  if (!files.length) return fail(loggedIn ? 'no-data' : 'no-credentials')

  // Del más reciente al más viejo: el primero que traiga límites gana. No siempre es
  // el último fichero — una sesión recién abierta puede no haber hecho aún ninguna
  // petición, y entonces sus `token_count` vienen con `rate_limits` nulo.
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const file of files.slice(0, MAX_ROLLOUTS)) {
    const snap = await readCodexRollout(file.path, file.size).catch(() => null)
    if (snap) return snap
  }
  return fail(loggedIn ? 'no-data' : 'no-credentials')
}

/** Busca en la COLA del rollout el último `token_count` que traiga `rate_limits`. */
async function readCodexRollout(file: string, size: number): Promise<UsageSnapshot | null> {
  const lines = await readTailLines(file, size)
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = lines[i]
    const payload = obj?.payload as Record<string, unknown> | undefined
    if (payload?.type !== 'token_count') continue
    const limits = payload.rate_limits as Record<string, unknown> | null | undefined
    if (!limits || typeof limits !== 'object') continue

    const observedAt = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN
    const at = Number.isNaN(observedAt) ? Date.now() : observedAt
    const windows = ventanasCodex(limits, at)
    if (!windows.length) continue

    return { agente: 'codex', windows, fetchedAt: Date.now(), observedAt: at }
  }
  return null
}

// ---------------------------------------------------------------------------
// Utilidades de E/S
// ---------------------------------------------------------------------------

interface RolloutFile {
  path: string
  mtimeMs: number
  size: number
}

/** Rollouts (`rollout-*.jsonl`) bajo `dir`, recursivo. Tolerante a que `dir` no exista. */
async function walkRollouts(dir: string): Promise<RolloutFile[]> {
  const out: RolloutFile[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walkRollouts(full)))
    } else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
      let st: Stats
      try {
        st = await stat(full)
      } catch {
        continue
      }
      out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size })
    }
  }
  return out
}

/** Alias local del tipo compartido: el nombre corto se usa en todo el archivo. */
type JsonLine = LineaJsonl

/**
 * Cola del rollout (hasta `TAIL_BYTES`). El dato es el ÚLTIMO `token_count`, así que
 * leer el fichero entero —que puede ser de megas— sería tirar E/S a la basura.
 */
async function readTailLines(file: string, size: number): Promise<JsonLine[]> {
  return leerLineasJsonl(file, size, TAIL_BYTES, 'tail')
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
