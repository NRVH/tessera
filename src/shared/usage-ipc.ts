// =============================================================================
// Contrato IPC del uso de cuenta de los agentes (main <-> preload <-> UI).
// Claude Code: endpoint OAuth `/api/oauth/usage` con el token del CLI (fichero o, en macOS,
// llavero; ver `main/uso/credencialesClaude.ts`). Codex: el último `token_count` de su rollout,
// sin red.
// De ahí la asimetría de frescura: el dato de Claude es de ahora y el de Codex el último conocido;
// `observadoEn` solo lo rellena Codex.
// Canales: invoke GET, WATCH y UNWATCH (renderer -> main); push CHANGED (main -> renderer).
// =============================================================================

import type { AgenteConversacion, ModoEjecucionConversacion } from './conversations-ipc'

/** Mismo par de agentes y mismos modos de ejecución que el historial. */
export type AgenteUso = AgenteConversacion
export type ModoEjecucionUso = ModoEjecucionConversacion

export const USAGE_CHANNELS = {
  /** invoke: uso de la cuenta activa. PeticionUso -> FotoUso. */
  GET: 'usage:get',
  /**
   * invoke: empieza a VIGILAR la carpeta de esa cuenta. PeticionUso -> void.
   *
   * El uso solo se mueve cuando el agente responde, y justo entonces AMBOS agentes
   * escriben en su transcript (`projects/…jsonl` en CC, `sessions/…rollout.jsonl` en
   * Codex). Vigilar ese fichero es, pues, la señal de "acaba de terminar un turno"
   * que sirve para los dos por igual, sin tener que adivinarla del flujo del pty.
   */
  WATCH: 'usage:watch',
  /** invoke: deja de vigilar (el panel se desmontó). PeticionUso -> void. */
  UNWATCH: 'usage:unwatch',
  /** push (main -> renderer): esa cuenta acaba de escribir; su uso ya no vale. CambioUso. */
  CHANGED: 'usage:changed'
} as const

export interface PeticionUso {
  /** Agente activo: determina la FUENTE (endpoint OAuth vs rollout en disco). */
  agente: AgenteUso
  /** Cuenta activa; determina QUÉ carpeta de credenciales se lee. Se ignora en modo host. */
  accountId: string
  /** Modo de ejecución; ausente => 'container'. En 'host' se lee el home nativo. */
  mode?: ModoEjecucionUso
  /**
   * Ignora la caché y va a la fuente. La UI lo usa al abrir el desplegable; el
   * sondeo periódico NO, para no castigar el endpoint de Anthropic (ver TTL).
   */
  force?: boolean
}

/**
 * Identidad de la FUENTE de uso: qué carpeta se lee. Es la clave de la caché y de
 * los vigilantes en main, y la que viaja en `CambioUso` para que cada panel sepa
 * si el aviso va con él. En modo Windows no hay cuentas: la fuente es el home nativo,
 * una por agente.
 */
export function claveUso(req: { agente: AgenteUso; accountId: string; mode?: ModoEjecucionUso }): string {
  return req.mode === 'host' ? `host:${req.agente}` : req.accountId
}

/**
 * El `restablecimientoEn` más cercano que todavía NO ha pasado, o undefined si no hay ninguno.
 * La UI lo usa para programar una relectura justo DESPUÉS del reinicio, en vez de
 * esperar al siguiente sondeo (3 min en Claude) enseñando un número que ya no vale.
 *
 * Vive en el contrato y no junto al lector del main porque quien lo llama es el
 * RENDERER: solo lee `FotoUso`, que es de aquí.
 */
export function proximoRestablecimiento(foto: FotoUso | null, ahora: number): number | undefined {
  let mejor: number | undefined
  for (const w of foto?.windows ?? []) {
    if (typeof w.restablecimientoEn !== 'number' || w.restablecimientoEn <= ahora) continue
    if (mejor === undefined || w.restablecimientoEn < mejor) mejor = w.restablecimientoEn
  }
  return mejor
}

/** Aviso de que la cuenta `clave` escribió en su transcript: su uso cacheado ya no vale. */
export interface CambioUso {
  clave: string
}

/** Una ventana de límite (5 h, 7 días, 7 días de un modelo concreto…). */
export interface VentanaUso {
  /** Clave estable de la fuente (`five_hour`, `seven_day_opus`, `primary`…). Para React keys. */
  clave: string
  /** Etiqueta corta ya lista para pintar: '5h', '7d', 'Opus 7d'. */
  etiqueta: string
  /** Porcentaje CONSUMIDO del límite, 0-100. */
  porcentaje: number
  /** Epoch ms en que la ventana se reinicia; ausente si la fuente no lo dice. */
  restablecimientoEn?: number
  /**
   * Esta ventana YA se reinició (su `restablecimientoEn` quedó atrás) y el dato que teníamos era
   * de antes. Su `porcentaje` se ha puesto a 0 —tras el reinicio, y sin peticiones nuevas,
   * el consumo real es ~0— y se ha RETIRADO su `restablecimientoEn`, porque la ventana nueva
   * empieza a contar con la próxima petición y cualquier fecha que pusiéramos aquí
   * sería inventada. La UI lo dice en vez de enseñar un cero pelado.
   */
  reiniciada?: boolean
}

/** Por qué no hay datos. La UI pinta un guion y explica en el tooltip. */
export type MotivoUsoNoDisponible =
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

export interface FotoUso {
  agente: AgenteUso
  /** Ventanas a pintar, en orden (5 h primero). Vacío si `unavailable`. */
  windows: VentanaUso[]
  /** Epoch ms de ESTA lectura (cuándo respondió main), no del dato. */
  consultadoEn: number
  /**
   * Epoch ms del SNAPSHOT en sí. Solo lo rellena Codex, cuyo dato es el último
   * conocido y puede ser viejo; en Claude el dato es de ahora y va sin él.
   */
  observadoEn?: number
  noDisponible?: MotivoUsoNoDisponible
  detalle?: string
  /**
   * El dato es el ÚLTIMO BUENO, no uno recién leído: la fuente falló (429 / red) y main
   * prefiere enseñar el porcentaje de hace un rato antes que blanquear la barra. `consultadoEn`
   * sigue siendo el de la lectura BUENA, así que la UI puede decir de cuándo es.
   */
  desactualizado?: boolean
  /**
   * Solo main: cuánto pidió esperar el servidor (`Retry-After`) tras un 429. No se pinta;
   * alimenta el backoff del lector.
   */
  esperaReintentoMs?: number
}
