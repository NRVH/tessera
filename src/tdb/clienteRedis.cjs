// =============================================================================
// El cliente de Redis: cargar `ioredis` a demanda, sus opciones (a un servidor, a Sentinel o a
// Cluster, con `topologiaRedis.cjs`), conectar, reconectar y el estado de cada conexión (la base y
// el MULTI abierto). Pieza de `redisComun.cjs`; `Redis` (el constructor) y `estados` tienen aquí su dueño.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

const { errorConfig, errorUso, esRespuestaError } = require('./erroresRedis.cjs')
const { textoDe } = require('./valoresRedis.cjs')
const topologia = require('./topologiaRedis.cjs')

const TIMEOUT_CONEXION_MS = 15000
const BASES_POR_DEFECTO = 16
const BASE_MAXIMA = 9999

// --- Carga perezosa ---------------------------------------------------------------------------

let Redis = null
/** El constructor de `ioredis`, cargado a demanda: `tdb ls` no lo paga. */
function cargarRedis() {
  if (!Redis) Redis = require('ioredis')
  return Redis
}

// --- Estado de cada conexión ------------------------------------------------------------------

const estados = new WeakMap()

/** La base en la que está la conexión y el MULTI abierto (cola de lo encolado), o null. */
function estado(cliente) {
  let e = estados.get(cliente)
  if (!e) {
    e = { base: 0, multi: null, ultimoError: null, sinScanType: false }
    estados.set(cliente, e)
  }
  return e
}

function preparar(cliente) {
  const e = estado(cliente)
  // Sin oyente, ioredis escribe «Unhandled error event» en la consola. El último se guarda: es
  // el motivo REAL cuando `connect()` rechaza con «Connection is closed.».
  cliente.on('error', (err) => {
    e.ultimoError = err
  })
  // Sentinel: cada sentinel que no dio el maestro (no contesta, o no vigila ese nombre).
  cliente.on('sentinelError', (err) => {
    if (/got an invalid reply/.test(String(err && err.message))) e.sentinelSinMaestro = true
    else e.ultimoErrorSentinel = err
  })
  // Cluster: el error de un nodo (sin oyente se escribiría en la consola).
  cliente.on('node error', (err) => {
    e.ultimoError = err
  })
  return e
}

/** La base en la que está la conexión, según lo que se mandó. */
function baseActual(cliente) {
  return estado(cliente).base
}

/** Cierra sin esperar; admite null. */
function desconectar(cliente) {
  if (!cliente) return
  try {
    cliente.disconnect()
  } catch {
    // cerrando igual
  }
}

// --- Conexión ---------------------------------------------------------------------------------

function tlsDe(con) {
  const t = con && con.tls
  if (t && typeof t === 'object') return { cifrar: t.cifrar === true, confiarCertificado: t.confiarCertificado === true }
  // Sin decir nada: lo de Redis (`tlsPorDefecto` del descriptor), sin cifrar.
  return { cifrar: false, confiarCertificado: false }
}

function baseValida(n) {
  return Number.isInteger(n) && n >= 0 && n <= BASE_MAXIMA
}

/** La base de la conexión: la de `o.base` si viene, si no la de `database` ('' = 0). */
function baseDeConexion(con, o) {
  if (o && o.base !== undefined && o.base !== null) {
    if (!baseValida(o.base)) throw errorConfig(`La base ${String(o.base)} no es válida: tiene que ser un entero de 0 a ${BASE_MAXIMA}.`)
    return o.base
  }
  const t = con && typeof con.database === 'string' ? con.database.trim() : ''
  if (t === '') return 0
  if (!/^\d{1,4}$/.test(t)) throw errorConfig(`La base «${t}» no es válida: en Redis es un número (0, 1, 2…).`)
  return Number(t)
}

/** CLIENT SETNAME no admite blancos ni caracteres especiales. */
function nombreConexion(appName) {
  return String(appName || 'Tessera')
    .replace(/[^\x21-\x7e]/g, '_')
    .slice(0, 128)
}

/** Usuario y contraseña: con usuario y sin clave, AUTH usuario "" (un usuario `nopass` la acepta; si no, WRONGPASS). */
function credencialesDe(con, secreto) {
  const usuario = typeof con.user === 'string' ? con.user.trim() : ''
  const clave = typeof secreto === 'string' ? secreto : ''
  if (usuario) return { username: usuario, password: clave }
  return clave ? { password: clave } : {}
}

/** Las opciones de TLS: sin verificar si se confía en el certificado, o con las CA de `o.cas`. */
function opcionesTls(con, o) {
  const t = tlsDe(con)
  if (!t.cifrar) return {}
  const tls = {}
  if (t.confiarCertificado) tls.rejectUnauthorized = false
  else {
    if (Array.isArray(o.cas) && o.cas.length > 0) tls.ca = o.cas
    // Por túnel SSH, el certificado se verifica contra el host real, no contra 127.0.0.1.
    Object.assign(tls, require('./tlsComun.cjs').identidadPorTunel(con))
  }
  return { tls }
}

/**
 * Las opciones de ioredis para una conexión a UN servidor (`ConexionTrabajador`: host, port, user,
 * database en texto, tls efectivo) y un secreto ('' = sin contraseña). `o.base` manda sobre
 * `database`. Nunca lleva el secreto a nada que se registre.
 */
function opcionesCliente(conexion, secreto, o = {}) {
  const con = conexion || {}
  const host = typeof con.host === 'string' ? con.host.trim() : ''
  if (!host) throw errorConfig('La conexión no tiene servidor.')
  if (/[\s,/?#@]/.test(host)) throw errorConfig(`«${host}» no es un servidor válido (un solo host, sin usuario ni opciones).`)
  const p = Number(con.port)
  const port = Number.isInteger(p) && p > 0 && p < 65536 ? p : 6379
  return { host, port, ...opcionesComunes(con, credencialesDe(con, secreto), o) }
}

/** Lo que llevan todas las conexiones, a un servidor, al maestro de Sentinel o a cada nodo de Cluster. */
function opcionesComunes(con, credenciales, o) {
  return {
    db: baseDeConexion(con, o),
    connectionName: nombreConexion(o.appName),
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    autoResubscribe: false,
    autoResendUnfulfilledCommands: false,
    protocol: 2,
    stringNumbers: true,
    connectTimeout: TIMEOUT_CONEXION_MS,
    ...credenciales,
    ...opcionesTls(con, o)
  }
}

/**
 * El cliente sin conectar y la base en la que tiene que quedar. A un servidor y a Sentinel, en la 0
 * y SELECT después (ver `conectar`); en Cluster solo existe la 0.
 */
function crearCliente(conexion, secreto, o) {
  const Constructor = cargarRedis()
  const con = conexion || {}
  const t = topologia.topologiaDe(con)
  if (t === null) {
    const opciones = opcionesCliente(con, secreto, o)
    return { cliente: new Constructor({ ...opciones, db: 0 }), base: opciones.db }
  }
  // Defensa: el main no guarda Sentinel ni Cluster con túnel, pero el registro se puede editar a mano.
  if (con.hostTls) throw errorConfig('Sentinel y Cluster no van por túnel SSH: quita el túnel de la conexión.')
  const secretos = topologia.secretosDe(t, secreto)
  const comunes = opcionesComunes(con, credencialesDe(con, secretos.redis), o)
  if (t.modo === 'sentinel') {
    return { cliente: new Constructor({ ...topologia.opcionesSentinel(con, t, comunes, secretos, TIMEOUT_CONEXION_MS), db: 0 }), base: comunes.db }
  }
  if (comunes.db !== 0) throw errorConfig('En Cluster solo existe la base 0: deja la base vacía en la conexión.')
  const c = topologia.opcionesCluster(con, comunes, TIMEOUT_CONEXION_MS)
  return { cliente: new Constructor.Cluster(c.nodos, c.opciones), base: 0 }
}

async function versionDe(cliente) {
  try {
    const info = textoDe(await cliente.callBuffer('INFO', 'server'))
    const m = /(?:^|\n)redis_version:([^\r\n]+)/.exec(info)
    return m ? m[1].trim() : ''
  } catch (err) {
    if (esRespuestaError(err)) return ''
    throw err
  }
}

/** Un error de conexión con el mensaje de Tessera y el código de red del original (así sigue siendo una pérdida). */
function errorConMotivo(mensaje, original) {
  const err = new Error(mensaje)
  if (original && typeof original.code === 'string') err.code = original.code
  return err
}

/**
 * Por qué no se llegó a Sentinel o a Cluster, en vez del mensaje del cliente («All sentinels are
 * unreachable», «Failed to refresh slots cache»). null si el error no es de esos.
 */
function motivoDeTopologia(err, e, cliente) {
  const m = String((err && err.message) || '')
  if (m.startsWith('All sentinels are unreachable')) return motivoSentinel(e, cliente)
  if (m === 'None of startup nodes is available' || m === 'Failed to refresh slots cache.') return motivoCluster((err && err.lastNodeError) || e.ultimoError)
  return null
}

/** Sentinel: o no vigilan ese maestro, o ninguno contestó (con el último motivo). */
function motivoSentinel(e, cliente) {
  const maestro = cliente && cliente.options ? cliente.options.name : ''
  const ultimo = e.ultimoErrorSentinel
  if ((e.sentinelSinMaestro && !ultimo) || (ultimo && /No such master/i.test(String(ultimo.message)))) {
    return errorConMotivo(`Los sentinels contestan, pero ninguno vigila un maestro llamado «${maestro}».`)
  }
  const detalle = ultimo ? ` (${ultimo.message})` : ''
  return errorConMotivo(`Ningún sentinel dio el maestro «${maestro}»${detalle}: comprueba sus direcciones y, si la tienen, su contraseña.`, ultimo)
}

/** Cluster: ningún nodo semilla contestó, o el que contestó no es de un cluster. */
function motivoCluster(ultimo) {
  const t = ultimo ? String(ultimo.message || '') : ''
  if (/cluster support disabled/i.test(t)) return errorConMotivo('El servidor no es un nodo de Cluster (tiene el modo cluster apagado): elige «Un servidor» o Sentinel.')
  return errorConMotivo(`Ningún nodo semilla del Cluster contesta${t ? ` (${t})` : ''}.`, ultimo)
}

/** El error que explica un `connect()` fallido: el último evento `error` si el rechazo fue el genérico. */
function motivoDeConexion(err, e, cliente) {
  const topologico = motivoDeTopologia(err, e, cliente)
  if (topologico) return topologico
  const generico = err && String(err.message || '') === 'Connection is closed.'
  return generico && e.ultimoError ? e.ultimoError : err
}

/** Conecta y devuelve `{ cliente, version }` (`version` = `redis_version`, o '' si no se puede leer). */
async function conectar(conexion, secreto, o = {}) {
  const t = tlsDe(conexion || {})
  // Las CA del sistema, con la misma función que SQL Server y MongoDB (sin cargar tedious).
  const cas = t.cifrar && !t.confiarCertificado ? require('./tlsComun.cjs').certificadosDeConfianza() : null
  // En la 0 y SELECT explícito después: si el SELECT del apretón de manos de ioredis falla, lo
  // traga y la conexión queda en la base 0 sin avisar.
  const { cliente, base } = crearCliente(conexion, secreto, { ...o, cas })
  const e = preparar(cliente)
  try {
    await cliente.connect()
    await seleccionar(cliente, base)
    const version = await versionDe(cliente)
    return { cliente, version }
  } catch (err) {
    desconectar(cliente)
    throw motivoDeConexion(err, e, cliente)
  }
}

/**
 * Otra conexión con las mismas opciones y el mismo secreto, en la base 0: el trabajador la usa
 * para reabrir tras abandonar y para mandar CLIENT UNBLOCK o SCRIPT KILL desde otra conexión. Con
 * Sentinel vuelve a preguntar por el maestro (tras un failover, es el nuevo).
 */
async function reconectar(plantilla, override = {}) {
  const nuevo = topologia.esCluster(plantilla)
    ? plantilla.duplicate([], { redisOptions: { ...plantilla.options.redisOptions, ...override } })
    : plantilla.duplicate({ ...override, db: 0, lazyConnect: true })
  const e = preparar(nuevo)
  try {
    await nuevo.connect()
    return nuevo
  } catch (err) {
    desconectar(nuevo)
    throw motivoDeConexion(err, e, nuevo)
  }
}

/**
 * SELECT si la base actual es otra; recuerda cuál. No se puede cambiar de base dentro de un MULTI,
 * y en Cluster solo existe la 0.
 */
async function seleccionar(cliente, base) {
  if (!baseValida(base)) throw errorUso(`La base ${String(base)} no es válida: tiene que ser un entero de 0 a ${BASE_MAXIMA}.`)
  if (topologia.esCluster(cliente)) {
    if (base !== 0) throw errorUso('En Cluster solo existe la base 0: SELECT no está disponible.')
    return
  }
  const e = estado(cliente)
  if (e.base === base) return
  if (e.multi) {
    const err = new Error('Hay una transacción (MULTI) abierta en esta conexión: no se puede cambiar de base hasta EXEC o DISCARD.')
    err.code = 'TESSERA-MULTI'
    throw err
  }
  await cliente.callBuffer('SELECT', String(base))
  e.base = base
}

module.exports = {
  BASES_POR_DEFECTO,
  cargarRedis,
  estado,
  baseActual,
  desconectar,
  opcionesCliente,
  crearCliente,
  conectar,
  reconectar,
  seleccionar
}
