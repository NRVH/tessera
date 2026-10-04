// =============================================================================
// De la respuesta de cada agente a las ventanas de límite que pinta el pie: Claude Code
// (cuerpo del endpoint OAuth) y Codex (`rate_limits` de su rollout). Puro, sin red ni disco.
// Regla: se pinta LO QUE LA CUENTA TRAE, en su orden; ningún límite se da por supuesto, y uno
// que no se conoce (otro grupo, otro modelo, otra clave) se pinta igual con el nombre que trae.
// Lo usa `UsageReader`.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================

import type { UsageWindow } from '../../shared/usage-ipc.ts'

/** Una entrada del array `limits[]`, que es la forma VIVA de la respuesta de Claude Code. */
interface LimiteClaude {
  kind?: unknown
  /** Familia del límite: hoy `session` o `weekly`. */
  group?: unknown
  percent?: unknown
  resets_at?: unknown
  scope?: { model?: { id?: unknown; display_name?: unknown } | null; surface?: unknown } | null
}

/** El snapshot que Codex copia de las cabeceras HTTP a cada evento `token_count`. */
interface VentanaCodex {
  used_percent?: unknown
  window_minutes?: unknown
  /** Epoch en SEGUNDOS (versiones nuevas). */
  resets_at?: unknown
  /** Segundos que faltan (versiones viejas). Se resuelve contra el ts del evento. */
  resets_in_seconds?: unknown
}

/**
 * Lo que dura cada familia conocida de límites de Claude Code. Un `Map` y no un objeto: la
 * clave viene de la red, y `constructor` o `toString` no pueden casar con nada heredado.
 */
const PERIODO_DE_GRUPO = new Map([
  ['session', '5h'],
  ['weekly', '7d']
])

/** Sufijos de `kind` que no nombran nada: el límite general. */
const SIN_NOMBRE = new Set(['', 'all'])

/** Nombre de un límite acotado que no dice a qué: se distingue del general sin inventar nada. */
const ACOTADO_SIN_NOMBRE = 'Otro'

/** Las dos ventanas de Codex de siempre, que van primero y sin nombre. */
const CLAVES_CODEX = ['primary', 'secondary']

function acotarPorcentaje(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** `algo_asi` → `Algo asi`: el nombre legible de una clave que no se conoce. */
function legible(clave: string): string {
  return capitalizar(clave.replace(/[_-]+/g, ' ').trim())
}

/** Epoch ms de un ISO; undefined si no lo es (el campo es nullable en varias ventanas). */
function epochDeIso(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const n = Date.parse(v)
  return Number.isNaN(n) ? undefined : n
}

const textoDe = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/** Familia de un límite: su `group`, o lo que va antes del primer `_` de su `kind`. */
function grupoDe(raw: LimiteClaude): string {
  return textoDe(raw.group) ?? (textoDe(raw.kind) ?? '').split('_')[0]
}

/** El nombre que trae el `scope` de un límite: el del modelo (o su id) o el de la superficie. */
function nombreDeScope(scope: LimiteClaude['scope']): string | null {
  const modelo = textoDe(scope?.model?.display_name) ?? textoDe(scope?.model?.id)
  if (modelo) return modelo
  const superficie = scope?.surface
  return textoDe(superficie) ?? textoDe((superficie as { display_name?: unknown } | null)?.display_name)
}

/**
 * A qué se acota un límite, o null si es el general: el modelo (su nombre o, sin él, su id) o
 * la superficie de su `scope` y, si no trae `scope`, lo que su `kind` diga detrás del grupo
 * (`weekly_opus` → «Opus»). Uno acotado que no dice a qué no pasa por el general: «Otro».
 */
function ambitoDe(raw: LimiteClaude, grupo: string): string | null {
  const deScope = nombreDeScope(raw.scope)
  if (deScope) return deScope
  const kind = textoDe(raw.kind) ?? ''
  const resto = kind.startsWith(`${grupo}_`) ? kind.slice(grupo.length + 1) : kind === grupo ? '' : kind
  if (SIN_NOMBRE.has(resto)) return null
  return resto === 'scoped' ? ACOTADO_SIN_NOMBRE : legible(resto)
}

/** Etiqueta corta de un límite: «5h», «7d», «Fable 7d», o el nombre de un grupo desconocido. */
function etiquetaClaude(raw: LimiteClaude): string {
  const grupo = grupoDe(raw)
  const ambito = ambitoDe(raw, grupo)
  const periodo = PERIODO_DE_GRUPO.get(grupo) ?? (grupo ? legible(grupo) : null)
  if (periodo === null) return ambito ?? '?'
  return ambito ? `${ambito} ${periodo}` : periodo
}

/** Deja la clave única: dos límites iguales a ojos de la clave no pueden pisarse en la lista. */
function claveUnica(clave: string, usadas: Set<string>): string {
  let unica = clave
  for (let n = 2; usadas.has(unica); n++) unica = `${clave}#${n}`
  usadas.add(unica)
  return unica
}

/** `limits[]` → ventanas, en el orden de la respuesta; las entradas sin porcentaje se saltan. */
function ventanasDeLimits(limits: LimiteClaude[]): UsageWindow[] {
  const out: UsageWindow[] = []
  const usadas = new Set<string>()
  for (const raw of limits) {
    if (!raw || typeof raw !== 'object' || typeof raw.percent !== 'number') continue
    const modelo = textoDe(raw.scope?.model?.display_name)
    const kind = String(raw.kind)
    out.push({
      key: claveUnica(modelo ? `${kind}:${modelo}` : kind, usadas),
      label: etiquetaClaude(raw),
      percent: acotarPorcentaje(raw.percent),
      resetsAt: epochDeIso(raw.resets_at)
    })
  }
  return out
}

/** Añade una ventana heredada si existe y trae un `utilization` numérico (las nulas se saltan). */
function pushHeredada(out: UsageWindow[], body: Record<string, unknown>, key: string, label: string): void {
  const w = body[key]
  if (!w || typeof w !== 'object') return
  const { utilization, resets_at: resetsAt } = w as { utilization?: unknown; resets_at?: unknown }
  if (typeof utilization !== 'number') return
  out.push({ key, label, percent: acotarPorcentaje(utilization), resetsAt: epochDeIso(resetsAt) })
}

/**
 * Ventanas a pintar a partir del cuerpo del endpoint de Claude Code. La respuesta trae DOS
 * representaciones: `limits[]` (la que pinta el propio `/usage`, y la única con las semanales
 * por modelo) manda; `five_hour` / `seven_day` / `seven_day_<modelo>` es el plan B, por si la
 * quitan o una cuenta antigua solo devuelve esa.
 */
export function ventanasClaude(body: Record<string, unknown>): UsageWindow[] {
  const limits = body.limits
  if (Array.isArray(limits) && limits.length) {
    const modernas = ventanasDeLimits(limits as LimiteClaude[])
    if (modernas.length) return modernas
  }
  const out: UsageWindow[] = []
  pushHeredada(out, body, 'five_hour', '5h')
  pushHeredada(out, body, 'seven_day', '7d')
  for (const key of Object.keys(body)) {
    const model = /^seven_day_(.+)$/.exec(key)?.[1]
    if (model) pushHeredada(out, body, key, `${legible(model)} 7d`)
  }
  return out
}

/**
 * La ventana se etiqueta por su DURACIÓN, no por su nombre: `primary`/`secondary` no dicen
 * nada al usuario, y hoy son 300 min (5 h) y 10080 (7 d) pero eso es cosa del plan.
 */
function etiquetaDuracion(minutes: unknown): string | null {
  if (typeof minutes !== 'number' || minutes <= 0) return null
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/** `resets_at` (epoch seg) en versiones nuevas; `resets_in_seconds` (relativo) en las viejas. */
function reinicioCodex(w: VentanaCodex, observedAt: number): number | undefined {
  if (typeof w.resets_at === 'number') return w.resets_at * 1000
  if (typeof w.resets_in_seconds === 'number') return observedAt + w.resets_in_seconds * 1000
  return undefined
}

/**
 * Ventanas del `rate_limits` de un `token_count` de Codex: `primary` y `secondary` primero y,
 * detrás, cualquier otra clave que traiga la forma de una ventana (un `used_percent` numérico),
 * con su nombre delante. Hoy solo vienen las dos; si su plan añade otra, sale sin tocar nada.
 */
export function ventanasCodex(limits: Record<string, unknown>, observedAt: number): UsageWindow[] {
  const out: UsageWindow[] = []
  const claves = [...CLAVES_CODEX, ...Object.keys(limits).filter((k) => !CLAVES_CODEX.includes(k))]
  for (const clave of claves) {
    const w = limits[clave] as VentanaCodex | null | undefined
    if (!w || typeof w !== 'object' || typeof w.used_percent !== 'number') continue
    const duracion = etiquetaDuracion(w.window_minutes)
    const conocida = CLAVES_CODEX.includes(clave)
    out.push({
      key: clave,
      label: conocida ? (duracion ?? '?') : [legible(clave), duracion].filter(Boolean).join(' '),
      percent: acotarPorcentaje(w.used_percent),
      resetsAt: reinicioCodex(w, observedAt)
    })
  }
  return out
}
