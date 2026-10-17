// =============================================================================
// Redis a Sentinel o a Cluster (`DbTopologiaRedis`): la lista de servidores del campo host, qué se
// rechaza al guardar (también la mitad de un solo servidor: una lista sin topología) y el secreto
// guardado de una conexión cuyos sentinels tienen contraseña propia (las dos en un sobre).
// Puro, neutral y ES2020: lo usan el main, el formulario y sus pruebas. Copia en `tdb/topologiaRedis.cjs`.
// Decisiones: docs/decisiones/bd/redis-sentinel-y-cluster.md
// =============================================================================

import type { DbClaveSentinel, DbTopologiaRedis } from './db-ipc.ts'
import { txUri } from './textosUri.ts'

/** El puerto de fábrica de un sentinel (el que el formulario propone al elegir Sentinel). */
export const PUERTO_SENTINEL = 26379

/** Servidores como mucho en la lista: más es un error de pegado, no una topología. */
export const SERVIDORES_MAX = 32

/** Caracteres como mucho del nombre del maestro (los de Redis no tienen tope, pero un nombre real es corto). */
export const MAESTRO_MAX = 200

const CLAVES_SENTINEL: readonly DbClaveSentinel[] = ['ninguna', 'misma', 'propia']

export interface ServidorRedis {
  host: string
  port: number
}

export type ResultadoServidores = { ok: true; servidores: ServidorRedis[] } | { ok: false; error: string }

/** Un puerto de texto (`'6379'`) válido, o null. */
function puertoDe(texto: string): number | null {
  if (!/^\d{1,5}$/.test(texto)) return null
  const n = Number(texto)
  return n >= 1 && n <= 65535 ? n : null
}

/** Un elemento de la lista (`h`, `h:1`, `[v6]` o `[v6]:1`), con el puerto por defecto si no lo dice. */
function servidorDe(texto: string, puertoPorDefecto: number): ServidorRedis | string {
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(texto)
  const simple = v6 ? null : /^([^:[\]]+)(?::(\d+))?$/.exec(texto)
  const m = v6 ?? simple
  if (!m) return txUri().redis.servidorInvalido(texto)
  const host = m[1]
  if (/[\s/?#@,]/.test(host)) return txUri().redis.servidorInvalido(texto)
  const port = m[2] === undefined ? puertoPorDefecto : puertoDe(m[2])
  if (port === null) return txUri().redis.puertoServidor(texto)
  return { host, port }
}

/**
 * La lista de servidores del campo host (`a:26379, b, [::1]:7000`): separados por comas, cada uno
 * con su puerto o con `puertoPorDefecto`. Los repetidos se quitan.
 */
export function servidoresRedis(host: string, puertoPorDefecto: number): ResultadoServidores {
  const partes = host
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (partes.length === 0) return { ok: false, error: txUri().redis.faltaServidor }
  if (partes.length > SERVIDORES_MAX) return { ok: false, error: txUri().redis.demasiados(SERVIDORES_MAX) }
  const servidores: ServidorRedis[] = []
  for (const p of partes) {
    const s = servidorDe(p, puertoPorDefecto)
    if (typeof s === 'string') return { ok: false, error: s }
    if (!servidores.some((x) => x.host === s.host && x.port === s.port)) servidores.push(s)
  }
  return { ok: true, servidores }
}

/** ¿Tiene la forma de `DbTopologiaRedis`? (El maestro puede venir vacío: eso lo dice `validarTopologiaRedis`.) */
export function esTopologiaRedis(x: unknown): x is DbTopologiaRedis {
  if (x === null || typeof x !== 'object') return false
  const t = x as Record<string, unknown>
  if (t.modo === 'cluster') return true
  return t.modo === 'sentinel' && typeof t.maestro === 'string' && CLAVES_SENTINEL.includes(t.claveSentinel as DbClaveSentinel)
}

/** Lo que mira `validarTopologiaRedis` de la conexión. */
export interface DestinoTopologia {
  host: string
  port: number
  database?: string
  /** ¿Va por túnel SSH? */
  tunel: boolean
}

/**
 * Por qué se rechaza la topología de una conexión de Redis, o null si vale. Sin topología (un
 * servidor), una lista de servidores también se rechaza: el cliente usaría solo el primero.
 */
export function validarTopologiaRedis(t: unknown, c: DestinoTopologia): string | null {
  if (t === undefined || t === null) {
    return c.host.includes(',') ? txUri().redis.variosServidores : null
  }
  if (!esTopologiaRedis(t)) return txUri().redis.topologiaInvalida
  const nombre = t.modo === 'sentinel' ? 'Sentinel' : 'Cluster'
  if (c.tunel) return txUri().redis.sinTunel(nombre)
  const lista = servidoresRedis(c.host, c.port)
  if (!lista.ok) return lista.error
  if (t.modo === 'cluster') {
    const base = (c.database ?? '').trim()
    return base === '' || base === '0' ? null : txUri().redis.clusterBase
  }
  const maestro = t.maestro.trim()
  if (maestro === '') return txUri().redis.faltaMaestro
  if (maestro.length > MAESTRO_MAX || /\s/.test(maestro)) return txUri().redis.maestro
  return null
}

/** La topología como se guarda: objeto nuevo, claves en orden fijo y el maestro recortado. */
export function topologiaAGuardar(t: DbTopologiaRedis): DbTopologiaRedis {
  return t.modo === 'cluster' ? { modo: 'cluster' } : { modo: 'sentinel', maestro: t.maestro.trim(), claveSentinel: t.claveSentinel }
}

// --- El secreto de una conexión con sentinels de contraseña propia ----------------------------

/** Marca del sobre: la primera posición de la lista que se guarda cifrada. */
const SOBRE = 'tessera-redis-sentinel-1'

/** ¿Se guardan dos contraseñas (Redis y sentinels) en un sobre? */
export function llevaSobre(t: unknown): boolean {
  return esTopologiaRedis(t) && t.modo === 'sentinel' && t.claveSentinel === 'propia'
}

/** Las dos contraseñas en el texto que se cifra. */
export function empaquetarSecretos(redis: string, sentinel: string): string {
  return JSON.stringify([SOBRE, redis, sentinel])
}

/** Las dos contraseñas de un texto descifrado; uno que no es un sobre es la de Redis sola. */
export function desempaquetarSecretos(secreto: string): { redis: string; sentinel: string } {
  try {
    const v: unknown = JSON.parse(secreto)
    if (Array.isArray(v) && v.length === 3 && v[0] === SOBRE && typeof v[1] === 'string' && typeof v[2] === 'string') {
      return { redis: v[1], sentinel: v[2] }
    }
  } catch {
    // no es un sobre
  }
  return { redis: secreto, sentinel: '' }
}

/** Lo que `secretoAGuardar` necesita saber de una edición o un alta. */
export interface CambioSecretos {
  /** El secreto guardado ya descifrado; null = no había (o no se puede descifrar). */
  previo: string | null
  /** ¿El guardado era un sobre? */
  previoConSobre: boolean
  /** ¿Lo nuevo es un sobre? */
  nuevoConSobre: boolean
  /** `password` de la entrada: undefined = conservar, '' = borrar. */
  password?: string
  /** `passwordSentinel` de la entrada, con las mismas reglas. */
  passwordSentinel?: string
  /** Había un secreto guardado y en este equipo no se descifra (`previo` es null por eso). */
  previoIlegible?: boolean
}

/** Lo que se dice cuando cambiar el sobre necesita la contraseña guardada y no se puede leer. */
export function errorSecretoIlegible(): string {
  return txUri().redis.secretoIlegible
}

/**
 * Lo que se pasa al guardado como contraseña (`undefined` = conservar la guardada, '' = borrarla,
 * texto = cifrarlo): la de Redis tal cual, o el sobre con las dos cuando los sentinels llevan la
 * suya. Sin nada que cambie devuelve `undefined`: recifrar lo mismo daría otro texto cifrado y la
 * conexión perdería su marca de verificada sin motivo.
 */
export function secretoAGuardar(c: CambioSecretos): string | undefined {
  if (!c.previoConSobre && !c.nuevoConSobre) return c.password
  if (c.previoConSobre === c.nuevoConSobre && c.password === undefined && c.passwordSentinel === undefined) return undefined
  // Rehacer el sobre con un trozo «conservado» que no se puede leer lo guardaría vacío: se pide en vez de pisarlo.
  if (c.previoIlegible === true && (c.password === undefined || (c.nuevoConSobre && c.passwordSentinel === undefined))) {
    throw new Error(errorSecretoIlegible())
  }
  const previo = c.previo === null ? { redis: '', sentinel: '' } : c.previoConSobre ? desempaquetarSecretos(c.previo) : { redis: c.previo, sentinel: '' }
  const redis = c.password !== undefined ? c.password : previo.redis
  if (!c.nuevoConSobre) return redis
  const sentinel = c.passwordSentinel !== undefined ? c.passwordSentinel : previo.sentinel
  return redis === '' && sentinel === '' ? '' : empaquetarSecretos(redis, sentinel)
}
