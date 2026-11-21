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
import type { AgenteUso, ModoEjecucionUso, FotoUso } from '../../shared/usage-ipc'
import { ventanasClaude, ventanasCodex } from './ventanasUso.ts'
// Extensión explícita: `test-uso.mts` corre con `node` a secas.
import { leerCredencialesClaude } from './credencialesClaude.ts'
import { leerLineasJsonl, type LineaJsonl } from '../util/jsonlCola.ts'
import { algunaCaducada, caducarFoto } from './caducidad.ts'

/** Endpoint no documentado que alimenta el `/usage` del propio Claude Code. */
const URL_USO_CLAUDE = 'https://api.anthropic.com/api/oauth/usage'

/**
 * A dónde se pregunta el uso de Claude Code. Las pruebas de interfaz lo desvían con
 * `TESSERA_USO_CLAUDE` a un servidor suyo, y solo vale si es de ESTA máquina.
 */
export function urlUsoClaude(desvio: string | undefined = process.env.TESSERA_USO_CLAUDE): string {
  return desvio !== undefined && /^http:\/\/127\.0\.0\.1:\d{1,5}\/[\w/.-]*$/.test(desvio) ? desvio : URL_USO_CLAUDE
}

/**
 * El token que viaja en la petición: el de la cuenta SOLO hacia el endpoint real. Desviada
 * a un servidor de pruebas va uno de mentira, así que una variable de entorno olvidada no
 * puede sacar el token de la cuenta a un puerto de la máquina.
 */
export function tokenParaUso(url: string, token: string): string {
  return url === URL_USO_CLAUDE ? token : 'token-de-pruebas'
}

/**
 * User-Agent OBLIGATORIO. Sin un `claude-code/<version>` la petición cae en un
 * bucket agresivamente limitado y devuelve 429 constantes. La versión exacta no
 * se valida contra nada; basta con que la forma sea la del CLI.
 */
const AGENTE_USUARIO_CLAUDE = 'claude-code/2.1.201'

/** Beta que habilita la autenticación por token OAuth (la del login del CLI). */
const BETA_OAUTH_CLAUDE = 'oauth-2025-04-20'

/** Frescura del dato de Claude: es una llamada de red con rate limit por token. */
const TTL_CLAUDE_MS = 180_000
/** Codex es una lectura de disco: puede ser mucho más ágil. */
const TTL_CODEX_MS = 15_000
/** Un fallo se recuerda poco: que un login o un turno lo arreglen pronto. */
const TTL_FALLO_MS = 30_000

/**
 * SUELO de red para Claude: por mucho que nos fuercen (hover) o nos invaliden (fin de
 * turno), no se toca el endpoint más de una vez cada tanto. Sin este suelo, una ráfaga
 * de turnos cortos —o el ratón entrando y saliendo del footer— se traduciría en una
 * andanada de peticiones sobre un endpoint que limita por token y responde 429 al
 * insistente. Codex no lo necesita: leer la cola de un fichero local no molesta a nadie.
 */
const INTERVALO_MIN_RED_MS = 20_000

/**
 * ESPERA tras un 429, cuando el servidor no dice cuánta (`retry-after`). Se DUPLICA con
 * cada 429 seguido hasta el techo: si el endpoint nos está frenando, insistir al mismo
 * ritmo es justo lo que lo mantiene cerrado. Un éxito la borra.
 */
const ESPERA_REINTENTO_BASE_MS = 60_000
const ESPERA_REINTENTO_MAX_MS = 600_000

const TOPE_HTTP_MS = 8000

/** Cola del rollout que se lee buscando el último `token_count`. */
const BYTES_COLA = 256 * 1024
/** Rollouts recientes que se miran antes de rendirse (el último puede no tener límites). */
const MAX_TRANSCRIPCIONES_CODEX = 5


interface EntradaCacheUso {
  en: number
  ttl: number
  foto: FotoUso
  /**
   * Epoch ms antes del cual NO se vuelve a la red PASE LO QUE PASE (ni `force`, ni
   * invalidación por fin de turno). Es el castigo por 429: un techo blando (TTL) no
   * sirve aquí, porque `force` y la invalidación lo saltan por diseño.
   */
  reintentoEn?: number
  /** 429 seguidos (otros fallos no cuentan): cada uno duplica la espera. Un éxito lo devuelve a 0. */
  fallos?: number
}

export class LectorUso {
  private readonly cache = new Map<string, EntradaCacheUso>()
  /**
   * Lecturas EN VUELO por clave. Sin esto, las N barras de uso abiertas sobre la MISMA
   * cuenta (un panel por proyecto, y los ocultos siguen vivos por el keep-alive) reciben
   * a la vez el aviso de fin de turno, llaman a la vez, y como la caché solo se escribe
   * al VOLVER la petición, ninguna ve a las otras: salían N peticiones idénticas al
   * endpoint por cada turno. Ahora la primera va a la red y las demás se cuelgan de ella.
   */
  private readonly enCurso = new Map<string, Promise<FotoUso>>()
  /**
   * Último dato BUENO por cuenta. Cuando la fuente falla (un 429, la red), la UI no debe
   * quedarse en blanco: enseñar el último porcentaje conocido —marcado como viejo— es más
   * verdad que un guion, y evita que un límite de 1 min parezca que el uso "desapareció".
   */
  private readonly ultimoBueno = new Map<string, FotoUso>()
  /**
   * Reloj inyectable. Existe SOLO para que la prueba pueda saltar los minutos del suelo de
   * red y del backoff sin dormirlos de verdad; en producción es `Date.now`.
   */
  private readonly ahora: () => number

  constructor(ahora: () => number = Date.now) {
    this.ahora = ahora
  }

  /**
   * Uso de la cuenta cuya carpeta de credenciales es `base`. `claveCache` identifica
   * a la cuenta (id, o el modo host): el mismo `base` siempre da el mismo dato.
   *
   * `modo` sólo lo usa Claude Code, y sólo para decidir si puede mirar el llavero de
   * macOS (ver `credencialesClaude.ts`): en `container` las credenciales son las del
   * fichero montado y el llavero sería el token de OTRA cuenta. Por defecto
   * `container`, que es el caso conservador.
   */
  async leer(
    base: string,
    agente: AgenteUso,
    claveCache: string,
    forzar = false,
    modo: ModoEjecucionUso = 'container'
  ): Promise<FotoUso> {
    const cacheado = this.respuestaCacheada(claveCache, agente, forzar)
    if (cacheado) return cacheado

    // Coalescencia: una sola lectura real por cuenta, aunque la pidan a la vez N paneles.
    const flying = this.enCurso.get(claveCache)
    if (flying) return flying

    const promesa = this.cargar(base, agente, claveCache, modo)
    this.enCurso.set(claveCache, promesa)
    try {
      return await promesa
    } finally {
      this.enCurso.delete(claveCache)
    }
  }

  /** El dato cacheado si todavía vale (castigo por 429, TTL o suelo de red); si no, `undefined`. */
  private respuestaCacheada(
    claveCache: string,
    agente: AgenteUso,
    forzar: boolean
  ): FotoUso | undefined {
    const coincidencia = this.cache.get(claveCache)
    if (!coincidencia) return undefined
    const ahora = this.ahora()
    const age = ahora - coincidencia.en
    // El castigo por 429 manda sobre todo, incluido `forzar`: insistir empeora el bloqueo. Puede
    // durar 10 min, así que lo que se sirve se caduca a la hora de servirlo: una ventana que se
    // reinicia durante la espera no puede seguir enseñando el porcentaje de antes.
    if (coincidencia.reintentoEn !== undefined && ahora < coincidencia.reintentoEn) return caducarFoto(coincidencia.foto, ahora)
    // Una ventana ya reiniciada salta el TTL y el suelo de red. `caducarFoto` retira el
    // `restablecimientoEn` vencido antes de guardar, así que dispara una relectura y no una por sondeo.
    const caduca = algunaCaducada(coincidencia.foto, ahora)
    if (!forzar && age < coincidencia.ttl && !caduca) return coincidencia.foto
    // Una lectura sin credenciales no llegó a la red; al forzar se puede comprobar si ya hay sesión.
    if (forzar && coincidencia.foto.noDisponible === 'no-credentials') return undefined
    // El suelo de red gana también a `forzar` y al fin de turno: evita que un hover nervioso
    // se convierta en una tanda de 429.
    if (agente === 'claude-code' && age < INTERVALO_MIN_RED_MS && !caduca) return coincidencia.foto
    return undefined
  }

  /** Va a la fuente y actualiza caché, backoff y último-dato-bueno. */
  private async cargar(
    base: string,
    agente: AgenteUso,
    claveCache: string,
    modo: ModoEjecucionUso
  ): Promise<FotoUso> {
    const leido = agente === 'codex' ? await leerUsoCodex(base) : await leerUsoClaude(base, modo)
    const prev = this.cache.get(claveCache)
    const ahora = this.ahora()
    // El dato de Codex es el ÚLTIMO CONOCIDO: si no mandas peticiones, el rollout no
    // cambia y esto devolvería el mismo porcentaje de una ventana que ya se reinició.
    // (En Claude la lectura es de ahora, así que aquí normalmente no toca nada.)
    const fresh = caducarFoto(leido, ahora)

    // Un fallo TRANSITORIO (429 / red / respuesta rara) no es un estado de la cuenta: es
    // ruido. Se degrada al último dato bueno y se espera antes de volver a molestar.
    if (fresh.noDisponible === 'rate-limited' || fresh.noDisponible === 'error') {
      // Solo un 429 cuenta para el castigo exponencial: una red caída o un 500 no dicen que
      // estemos insistiendo demasiado, y contarlos alargaba la espera del siguiente 429.
      const limitado = fresh.noDisponible === 'rate-limited'
      const fallos = (prev?.fallos ?? 0) + (limitado ? 1 : 0)
      const esperaReintento =
        limitado
          ? Math.max(
              fresh.esperaReintentoMs ?? 0,
              Math.min(ESPERA_REINTENTO_BASE_MS * 2 ** (fallos - 1), ESPERA_REINTENTO_MAX_MS)
            )
          : 0
      // El último dato bueno puede ser de hace 10 min y describir una ventana que
      // mientras tanto se ha reiniciado: se caduca ANTES de servirlo, o el "dato viejo"
      // acabaría siendo un porcentaje alto de una ventana que ya está a cero.
      const datoBueno = this.ultimoBueno.get(claveCache)
      const foto: FotoUso = datoBueno
        ? { ...caducarFoto(datoBueno, ahora), desactualizado: true, detalle: fresh.detalle }
        : fresh
      this.cache.set(claveCache, {
        en: ahora,
        ttl: esperaReintento || TTL_FALLO_MS,
        foto,
        fallos,
        ...(esperaReintento ? { reintentoEn: ahora + esperaReintento } : {})
      })
      return foto
    }

    // Éxito (o estado estable: sin login, cuenta por API key…): se olvida el castigo. Se guarda
    // `leido`, la lectura cruda y no la caducada: caducar depende de la hora a la que se enseña,
    // no de cuándo se leyó, y la rama de fallo ya vuelve a caducar antes de servirla.
    if (!fresh.noDisponible) this.ultimoBueno.set(claveCache, leido)
    const ttl = fresh.noDisponible
      ? TTL_FALLO_MS
      : agente === 'codex'
        ? TTL_CODEX_MS
        : TTL_CLAUDE_MS
    this.cache.set(claveCache, { en: ahora, ttl, foto: fresh })
    return fresh
  }

  /**
   * Marca el dato como CADUCADO sin borrarlo: la próxima lectura vuelve a la fuente,
   * pero el `en` (y el `reintentoEn` de un 429) se conservan, para que el suelo de red y el
   * backoff sigan contando. Lo llama el vigilante al ver que el agente acaba de escribir
   * en su transcript.
   */
  invalidate(claveCache: string): void {
    const coincidencia = this.cache.get(claveCache)
    if (coincidencia) coincidencia.ttl = 0
  }

  /** Olvida lo cacheado de una cuenta (al hacer login/logout el dato anterior ya no vale). */
  olvidar(claveCache: string): void {
    this.cache.delete(claveCache)
    this.ultimoBueno.delete(claveCache)
  }
}

// ---------------------------------------------------------------------------
// Claude Code: endpoint OAuth
// ---------------------------------------------------------------------------

async function leerUsoClaude(base: string, modo: ModoEjecucionUso): Promise<FotoUso> {
  const sinUso = (noDisponible: FotoUso['noDisponible'], detalle?: string): FotoUso => ({
    agente: 'claude-code',
    windows: [],
    consultadoEn: Date.now(),
    noDisponible,
    detalle
  })

  // DÓNDE están las credenciales lo decide `credencialesClaude`, no este módulo: en
  // macOS el CLI no escribe `.credentials.json`, guarda el mismo bloque en el llavero.
  // Aquí sólo se traduce el resultado a lo que la UI sabe decir.
  const credenciales = await leerCredencialesClaude(base, modo)
  // Sin fichero ni llavero (cuenta nunca usada / logout): no hay nada que pedir.
  if (credenciales.clase === 'ausente') return sinUso('no-credentials')
  // Una cuenta de API key no tiene bloque OAuth: no hay ventanas de límite que enseñar.
  if (credenciales.clase === 'sin-oauth') return sinUso('not-subscription')
  // HABÍA credencial y no se pudo leer (el llavero de macOS pidiendo autorización, por
  // ejemplo). Es `error` y NO `no-credentials` a propósito: sólo `error` cae en la rama
  // transitoria de `load`, que conserva el último dato bueno. Con `no-credentials` unas
  // barras correctas se borrarían para decir «esta cuenta aún no ha iniciado sesión»,
  // que además de falso no se arregla solo a ojos del usuario.
  if (credenciales.clase === 'fallo') return sinUso('error', credenciales.detalle)
  const token = credenciales.token

  let res: Response
  try {
    const url = urlUsoClaude()
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenParaUso(url, token)}`,
        'anthropic-beta': BETA_OAUTH_CLAUDE,
        'User-Agent': AGENTE_USUARIO_CLAUDE,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(TOPE_HTTP_MS)
    })
  } catch (e) {
    return sinUso('error', e instanceof Error ? e.message : 'fallo de red')
  }

  // El access token dura ~1 h. Cuando caduca no lo renovamos NOSOTROS: el propio CLI
  // lo refresca al usarlo y reescribe el fichero, y la siguiente lectura ya funciona.
  // Meternos a refrescarlo por nuestra cuenta sería competir con él por el refresh
  // token (y una rotación perdida = login roto), a cambio de un dato cosmético.
  if (res.status === 401 || res.status === 403) return sinUso('auth-expired')
  // 429: el endpoint nos frena. Se distingue del resto porque tiene tratamiento propio
  // (backoff creciente arriba) y porque el usuario merece que se lo digan sin susto: no
  // es que la cuenta se haya roto, es que hay que esperar un momento.
  if (res.status === 429) {
    const foto = sinUso('rate-limited', 'demasiadas consultas seguidas')
    const reintento = leerEsperaReintento(res.headers.get('retry-after'))
    return reintento !== undefined ? { ...foto, esperaReintentoMs: reintento } : foto
  }
  if (!res.ok) return sinUso('error', `HTTP ${res.status}`)

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = (await res.json()) as Record<string, unknown>
  } catch {
    return sinUso('error', 'respuesta ilegible')
  }

  const ventanas = ventanasClaude(cuerpo)
  if (!ventanas.length) return sinUso('no-data')
  return { agente: 'claude-code', windows: ventanas, consultadoEn: Date.now() }
}

/** `Retry-After` en ms. Admite las dos formas del estándar: segundos o fecha HTTP. */
function leerEsperaReintento(crudo: string | null): number | undefined {
  if (!crudo) return undefined
  const segundos = Number(crudo)
  if (Number.isFinite(segundos) && segundos >= 0) return segundos * 1000
  const instante = Date.parse(crudo)
  if (Number.isNaN(instante)) return undefined
  return Math.max(0, instante - Date.now())
}

// ---------------------------------------------------------------------------
// Codex: último `token_count` de los rollouts
// ---------------------------------------------------------------------------

async function leerUsoCodex(base: string): Promise<FotoUso> {
  const sinUso = (noDisponible: FotoUso['noDisponible'], detalle?: string): FotoUso => ({
    agente: 'codex',
    windows: [],
    consultadoEn: Date.now(),
    noDisponible,
    detalle
  })

  // Sin `auth.json` no hay login; distinguirlo de "aún no ha hablado" hace que el
  // tooltip pueda decir la verdad ("inicia sesión" vs "usa el agente una vez").
  const hayLogin = await existe(path.join(base, 'auth.json'))

  // Los rollouts vivos están en `sessions/`; `archived_sessions/` guarda los cerrados.
  // Se miran ambos: tras archivar una sesión, el último snapshot conocido sigue ahí.
  const archivos = [
    ...(await recorrerTranscripcionesCodex(path.join(base, 'sessions'))),
    ...(await recorrerTranscripcionesCodex(path.join(base, 'archived_sessions')))
  ]
  if (!archivos.length) return sinUso(hayLogin ? 'no-data' : 'no-credentials')

  // Del más reciente al más viejo: el primero que traiga límites gana. No siempre es
  // el último fichero — una sesión recién abierta puede no haber hecho aún ninguna
  // petición, y entonces sus `token_count` vienen con `rate_limits` nulo.
  archivos.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const archivo of archivos.slice(0, MAX_TRANSCRIPCIONES_CODEX)) {
    const foto = await leerTranscripcionCodex(archivo.ruta, archivo.tamano).catch(() => null)
    if (foto) return foto
  }
  return sinUso(hayLogin ? 'no-data' : 'no-credentials')
}

/** Busca en la COLA del rollout el último `token_count` que traiga `rate_limits`. */
export async function leerTranscripcionCodex(archivo: string, tamano: number): Promise<FotoUso | null> {
  const lineas = await leerLineasCola(archivo, tamano)
  for (let i = lineas.length - 1; i >= 0; i--) {
    const obj = lineas[i]
    const datos = obj?.payload as Record<string, unknown> | undefined
    if (datos?.type !== 'token_count') continue
    const limites = datos.rate_limits as Record<string, unknown> | null | undefined
    if (!limites || typeof limites !== 'object') continue

    const observadoEn = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN
    const instante = Number.isNaN(observadoEn) ? Date.now() : observadoEn
    const ventanas = ventanasCodex(limites, instante)
    if (!ventanas.length) continue

    return { agente: 'codex', windows: ventanas, consultadoEn: Date.now(), observadoEn: instante }
  }
  return null
}

// ---------------------------------------------------------------------------
// Utilidades de E/S
// ---------------------------------------------------------------------------

interface ArchivoTranscripcionCodex {
  ruta: string
  mtimeMs: number
  tamano: number
}

/** Rollouts (`rollout-*.jsonl`) bajo `dir`, recursivo. Tolerante a que `dir` no exista. */
async function recorrerTranscripcionesCodex(dir: string): Promise<ArchivoTranscripcionCodex[]> {
  const salida: ArchivoTranscripcionCodex[] = []
  let entradas: import('node:fs').Dirent[]
  try {
    entradas = await readdir(dir, { withFileTypes: true })
  } catch {
    return salida
  }
  for (const e of entradas) {
    const rutaCompleta = path.join(dir, e.name)
    if (e.isDirectory()) {
      salida.push(...(await recorrerTranscripcionesCodex(rutaCompleta)))
    } else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
      let st: Stats
      try {
        st = await stat(rutaCompleta)
      } catch {
        continue
      }
      salida.push({ ruta: rutaCompleta, mtimeMs: st.mtimeMs, tamano: st.size })
    }
  }
  return salida
}

/** Alias local del tipo compartido: el nombre corto se usa en todo el archivo. */
type LineaJson = LineaJsonl

/**
 * Cola del rollout (hasta `BYTES_COLA`). El dato es el ÚLTIMO `token_count`, así que
 * leer el fichero entero —que puede ser de megas— sería tirar E/S a la basura.
 */
async function leerLineasCola(archivo: string, tamano: number): Promise<LineaJson[]> {
  return leerLineasJsonl(archivo, tamano, BYTES_COLA, 'tail')
}

async function existe(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
