// =============================================================================
// Contrato IPC del uso de cuenta de los agentes (main <-> preload <-> UI).
// Claude Code: endpoint OAuth `/api/oauth/usage` con el token del CLI (fichero o, en macOS,
// llavero; ver `main/usage/credencialesClaude.ts`). Codex: el último `token_count` de su rollout,
// sin red.
// De ahí la asimetría de frescura: el dato de Claude es de ahora y el de Codex el último conocido;
// `observedAt` solo lo rellena Codex.
// Canales: invoke GET, WATCH y UNWATCH (renderer -> main); push CHANGED (main -> renderer).
// =============================================================================

import type { ConvAgent, ConvRunMode } from './conversations-ipc'

/** Mismo par de agentes y mismos modos de ejecución que el historial. */
export type UsageAgent = ConvAgent
export type UsageRunMode = ConvRunMode

export const USAGE_CHANNELS = {
  /** invoke: uso de la cuenta activa. UsageRequest -> UsageSnapshot. */
  GET: 'usage:get',
  /**
   * invoke: empieza a VIGILAR la carpeta de esa cuenta. UsageRequest -> void.
   *
   * El uso solo se mueve cuando el agente responde, y justo entonces AMBOS agentes
   * escriben en su transcript (`projects/…jsonl` en CC, `sessions/…rollout.jsonl` en
   * Codex). Vigilar ese fichero es, pues, la señal de "acaba de terminar un turno"
   * que sirve para los dos por igual, sin tener que adivinarla del flujo del pty.
   */
  WATCH: 'usage:watch',
  /** invoke: deja de vigilar (el panel se desmontó). UsageRequest -> void. */
  UNWATCH: 'usage:unwatch',
  /** push (main -> renderer): esa cuenta acaba de escribir; su uso ya no vale. UsageChanged. */
  CHANGED: 'usage:changed'
} as const

export interface UsageRequest {
  /** Agente activo: determina la FUENTE (endpoint OAuth vs rollout en disco). */
  agente: UsageAgent
  /** Cuenta activa; determina QUÉ carpeta de credenciales se lee. Se ignora en modo host. */
  accountId: string
  /** Modo de ejecución; ausente => 'container'. En 'host' se lee el home nativo. */
  mode?: UsageRunMode
  /**
   * Ignora la caché y va a la fuente. La UI lo usa al abrir el desplegable; el
   * sondeo periódico NO, para no castigar el endpoint de Anthropic (ver TTL).
   */
  force?: boolean
}

/**
 * Identidad de la FUENTE de uso: qué carpeta se lee. Es la clave de la caché y de
 * los vigilantes en main, y la que viaja en `UsageChanged` para que cada panel sepa
 * si el aviso va con él. En modo Windows no hay cuentas: la fuente es el home nativo,
 * una por agente.
 */
export function usageKey(req: { agente: UsageAgent; accountId: string; mode?: UsageRunMode }): string {
  return req.mode === 'host' ? `host:${req.agente}` : req.accountId
}

/**
 * El `resetsAt` más cercano que todavía NO ha pasado, o undefined si no hay ninguno.
 * La UI lo usa para programar una relectura justo DESPUÉS del reinicio, en vez de
 * esperar al siguiente sondeo (3 min en Claude) enseñando un número que ya no vale.
 *
 * Vive en el contrato y no junto al lector del main porque quien lo llama es el
 * RENDERER: solo lee `UsageSnapshot`, que es de aquí.
 */
export function proximoReset(snap: UsageSnapshot | null, ahora: number): number | undefined {
  let mejor: number | undefined
  for (const w of snap?.windows ?? []) {
    if (typeof w.resetsAt !== 'number' || w.resetsAt <= ahora) continue
    if (mejor === undefined || w.resetsAt < mejor) mejor = w.resetsAt
  }
  return mejor
}

/** Aviso de que la cuenta `key` escribió en su transcript: su uso cacheado ya no vale. */
export interface UsageChanged {
  key: string
}

/** Una ventana de límite (5 h, 7 días, 7 días de un modelo concreto…). */
export interface UsageWindow {
  /** Clave estable de la fuente (`five_hour`, `seven_day_opus`, `primary`…). Para React keys. */
  key: string
  /** Etiqueta corta ya lista para pintar: '5h', '7d', 'Opus 7d'. */
  label: string
  /** Porcentaje CONSUMIDO del límite, 0-100. */
  percent: number
  /** Epoch ms en que la ventana se reinicia; ausente si la fuente no lo dice. */
  resetsAt?: number
  /**
   * Esta ventana YA se reinició (su `resetsAt` quedó atrás) y el dato que teníamos era
   * de antes. Su `percent` se ha puesto a 0 —tras el reinicio, y sin peticiones nuevas,
   * el consumo real es ~0— y se ha RETIRADO su `resetsAt`, porque la ventana nueva
   * empieza a contar con la próxima petición y cualquier fecha que pusiéramos aquí
   * sería inventada. La UI lo dice en vez de enseñar un cero pelado.
   */
  reiniciada?: boolean
}

/** Por qué no hay datos. La UI pinta un guion y explica en el tooltip. */
export type UsageUnavailable =
  /** No hay login en esa cuenta (aún no se ha usado el agente / se cerró sesión). */
  | 'no-credentials'
  /** Hay login, pero el agente todavía no ha dejado ningún snapshot (Codex sin turnos). */
  | 'no-data'
  /** El token OAuth ya no vale (el CLI lo renueva solo al usarlo; hasta entonces, sin dato). */
  | 'auth-expired'
  /** Cuentas de API key, no de suscripción: no tienen ventanas de límite que mostrar. */
  | 'not-subscription'
  /** El endpoint nos frenó (429). Transitorio: se reintenta con espera creciente. */
  | 'rate-limited'
  /** Fallo de red / respuesta inesperada. `detail` lleva el motivo. */
  | 'error'

export interface UsageSnapshot {
  agente: UsageAgent
  /** Ventanas a pintar, en orden (5 h primero). Vacío si `unavailable`. */
  windows: UsageWindow[]
  /** Epoch ms de ESTA lectura (cuándo respondió main), no del dato. */
  fetchedAt: number
  /**
   * Epoch ms del SNAPSHOT en sí. Solo lo rellena Codex, cuyo dato es el último
   * conocido y puede ser viejo; en Claude el dato es de ahora y va sin él.
   */
  observedAt?: number
  unavailable?: UsageUnavailable
  detail?: string
  /**
   * El dato es el ÚLTIMO BUENO, no uno recién leído: la fuente falló (429 / red) y main
   * prefiere enseñar el porcentaje de hace un rato antes que blanquear la barra. `fetchedAt`
   * sigue siendo el de la lectura BUENA, así que la UI puede decir de cuándo es.
   */
  stale?: boolean
  /**
   * Solo main: cuánto pidió esperar el servidor (`Retry-After`) tras un 429. No se pinta;
   * alimenta el backoff del lector.
   */
  retryAfterMs?: number
}
