// =============================================================================
// Redis a Sentinel o a Cluster para `tdb` y el trabajador: la topología guardada en la conexión, la
// lista de servidores, el sobre con las dos contraseñas y las opciones de ioredis de cada modo. Pieza
// de `clienteRedis.cjs`. Copia de lo que valida `shared/topologiaRedis.ts`: `test-topologia-redis`
// fija que los dos lados leen igual la lista y el sobre.
// Decisiones: docs/decisiones/bd/redis-sentinel-y-cluster.md
// =============================================================================

'use strict'

const { errorConfig } = require('./erroresRedis.cjs')

const SOBRE = 'tessera-redis-sentinel-1'
const SERVIDORES_MAX = 32
const CLAVES_SENTINEL = new Set(['ninguna', 'misma', 'propia'])

/** La topología de la conexión: null (un servidor), `{ modo: 'cluster' }` o la de Sentinel. Lanza si no se entiende. */
function topologiaDe(con) {
  const t = con ? con.topologiaRedis : undefined
  if (t === undefined || t === null) return null
  if (typeof t !== 'object' || (t.modo !== 'sentinel' && t.modo !== 'cluster')) {
    throw errorConfig('La topología de Redis de la conexión no se entiende: corrígela con «Editar conexión…» en Tessera.')
  }
  if (t.modo === 'cluster') return { modo: 'cluster' }
  const maestro = typeof t.maestro === 'string' ? t.maestro.trim() : ''
  if (!maestro) throw errorConfig('Falta el nombre del maestro que vigilan los sentinels.')
  return { modo: 'sentinel', maestro, claveSentinel: CLAVES_SENTINEL.has(t.claveSentinel) ? t.claveSentinel : 'ninguna' }
}

/** Un elemento de la lista (`h`, `h:1`, `[v6]`, `[v6]:1`) o el motivo por el que no vale. */
function servidorDe(texto, puertoPorDefecto) {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(texto) || /^([^:[\]]+)(?::(\d+))?$/.exec(texto)
  if (!m || /[\s/?#@,]/.test(m[1])) return `«${texto}» no es un servidor válido (host o host:puerto).`
  if (m[2] === undefined) return { host: m[1], port: puertoPorDefecto }
  const n = /^\d{1,5}$/.test(m[2]) ? Number(m[2]) : 0
  if (n < 1 || n > 65535) return `El puerto de «${texto}» no es válido: tiene que ser un número de 1 a 65535.`
  return { host: m[1], port: n }
}

/** Los servidores del campo host (separados por comas), sin repetidos; lanza con el motivo si alguno no vale. */
function servidoresDe(host, puertoPorDefecto) {
  const p = Number(puertoPorDefecto)
  const porDefecto = Number.isInteger(p) && p > 0 && p < 65536 ? p : 6379
  const partes = String(host || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (partes.length === 0) throw errorConfig('La conexión no tiene servidores.')
  if (partes.length > SERVIDORES_MAX) throw errorConfig(`Son más de ${SERVIDORES_MAX} servidores: con unos pocos basta, el resto se descubre.`)
  const salida = []
  for (const t of partes) {
    const s = servidorDe(t, porDefecto)
    if (typeof s === 'string') throw errorConfig(s)
    if (!salida.some((x) => x.host === s.host && x.port === s.port)) salida.push(s)
  }
  return salida
}

/** Las dos contraseñas de un secreto descifrado; uno que no es un sobre es la de Redis sola. */
function desempaquetar(secreto) {
  try {
    const v = JSON.parse(secreto)
    if (Array.isArray(v) && v.length === 3 && v[0] === SOBRE && typeof v[1] === 'string' && typeof v[2] === 'string') {
      return { redis: v[1], sentinel: v[2] }
    }
  } catch {
    // no es un sobre
  }
  return { redis: secreto, sentinel: '' }
}

/** La contraseña de Redis y la de los sentinels según la topología (`claveSentinel`). */
function secretosDe(topologia, secreto) {
  const s = typeof secreto === 'string' ? secreto : ''
  if (!topologia || topologia.modo !== 'sentinel') return { redis: s, sentinel: '' }
  if (topologia.claveSentinel === 'propia') return desempaquetar(s)
  return { redis: s, sentinel: topologia.claveSentinel === 'misma' ? s : '' }
}

/**
 * Las opciones de un cliente de Sentinel: las de siempre (`comunes`) más los sentinels, el maestro y
 * su contraseña. Un intento por sentinel y sin reintentar la vuelta: si ninguno contesta, se dice.
 * El cifrado vale para los sentinels y para el maestro.
 */
function opcionesSentinel(con, topologia, comunes, secretos, timeoutMs) {
  const o = {
    ...comunes,
    sentinels: servidoresDe(con.host, con.port),
    name: topologia.maestro,
    role: 'master',
    sentinelRetryStrategy: () => null,
    sentinelCommandTimeout: timeoutMs,
    sentinelMaxConnections: 4,
    updateSentinels: true,
    failoverDetector: false
  }
  if (secretos.sentinel) o.sentinelPassword = secretos.sentinel
  if (comunes.tls) {
    o.enableTLSForSentinelMode = true
    o.sentinelTLS = comunes.tls
  }
  delete o.host
  delete o.port
  return o
}

/**
 * Las opciones de un Cluster: los nodos semilla y las de cada nodo (`redisOptions`, sin base: solo
 * existe la 0). Sin reintentos de todo el cluster; MOVED y ASK los sigue el cliente solo.
 */
function opcionesCluster(con, comunes, timeoutMs) {
  const nodo = { ...comunes }
  delete nodo.host
  delete nodo.port
  delete nodo.db
  delete nodo.lazyConnect
  return {
    nodos: servidoresDe(con.host, con.port),
    opciones: {
      redisOptions: nodo,
      lazyConnect: true,
      clusterRetryStrategy: () => null,
      enableReadyCheck: true,
      slotsRefreshTimeout: timeoutMs,
      maxRedirections: 16,
      scaleReads: 'master'
    }
  }
}

/** ¿Es un cliente de Cluster? */
function esCluster(cliente) {
  return Boolean(cliente && cliente.isCluster === true)
}

/** ¿Es un cliente que llega al maestro por sus sentinels? */
function esSentinel(cliente) {
  return Boolean(cliente && !esCluster(cliente) && cliente.options && Array.isArray(cliente.options.sentinels) && cliente.options.sentinels.length > 0)
}

module.exports = {
  topologiaDe,
  servidoresDe,
  desempaquetar,
  secretosDe,
  opcionesSentinel,
  opcionesCluster,
  esCluster,
  esSentinel
}
