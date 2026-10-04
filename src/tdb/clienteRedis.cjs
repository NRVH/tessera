// =============================================================================
// El cliente de Redis: cargar `ioredis` a demanda, sus opciones, conectar, reconectar y el estado
// de cada conexión (la base y el MULTI abierto). Pieza de `redisComun.cjs`, que reexporta lo que
// usan `redis.cjs` y `sesionRedis.cjs`. `Redis` (el constructor) y `estados` tienen aquí su dueño.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

const { errorConfig, errorUso, esRespuestaError } = require('./erroresRedis.cjs')
const { textoDe } = require('./valoresRedis.cjs')

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
  else if (Array.isArray(o.cas) && o.cas.length > 0) tls.ca = o.cas
  return { tls }
}

/**
 * Las opciones de ioredis para una conexión (`ConexionTrabajador`: host, port, user, database en
 * texto, tls efectivo) y un secreto ('' = sin contraseña). `o.base` manda sobre `database`.
 * Nunca lleva el secreto a nada que se registre.
 */
function opcionesCliente(conexion, secreto, o = {}) {
  const con = conexion || {}
  const host = typeof con.host === 'string' ? con.host.trim() : ''
  if (!host) throw errorConfig('La conexión no tiene servidor.')
  if (/[\s,/?#@]/.test(host)) throw errorConfig(`«${host}» no es un servidor válido (un solo host, sin usuario ni opciones).`)
  const p = Number(con.port)
  const port = Number.isInteger(p) && p > 0 && p < 65536 ? p : 6379
  return {
    host,
    port,
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
    ...credencialesDe(con, secreto),
    ...opcionesTls(con, o)
  }
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

/** El error que explica un `connect()` fallido: el último evento `error` si el rechazo fue el genérico. */
function motivoDeConexion(err, e) {
  const generico = err && String(err.message || '') === 'Connection is closed.'
  return generico && e.ultimoError ? e.ultimoError : err
}

/** Conecta y devuelve `{ cliente, version }` (`version` = `redis_version`, o '' si no se puede leer). */
async function conectar(conexion, secreto, o = {}) {
  const Constructor = cargarRedis()
  const t = tlsDe(conexion || {})
  // Las CA del sistema, con la misma función que SQL Server y MongoDB (sin cargar tedious).
  const cas = t.cifrar && !t.confiarCertificado ? require('./sqlserverComun.cjs').certificadosDeConfianza() : null
  const opciones = opcionesCliente(conexion, secreto, { ...o, cas })
  const base = opciones.db
  // En la 0 y SELECT explícito después: si el SELECT del apretón de manos de ioredis falla, lo
  // traga y la conexión queda en la base 0 sin avisar.
  const cliente = new Constructor({ ...opciones, db: 0 })
  const e = preparar(cliente)
  try {
    await cliente.connect()
    await seleccionar(cliente, base)
    const version = await versionDe(cliente)
    return { cliente, version }
  } catch (err) {
    desconectar(cliente)
    throw motivoDeConexion(err, e)
  }
}

/**
 * Otra conexión con las mismas opciones y el mismo secreto, en la base 0: el trabajador la usa
 * para reabrir tras abandonar y para mandar CLIENT UNBLOCK o SCRIPT KILL desde otra conexión.
 */
async function reconectar(plantilla, override = {}) {
  const nuevo = plantilla.duplicate({ ...override, db: 0, lazyConnect: true })
  const e = preparar(nuevo)
  try {
    await nuevo.connect()
    return nuevo
  } catch (err) {
    desconectar(nuevo)
    throw motivoDeConexion(err, e)
  }
}

/** SELECT si la base actual es otra; recuerda cuál. No se puede cambiar de base dentro de un MULTI. */
async function seleccionar(cliente, base) {
  if (!baseValida(base)) throw errorUso(`La base ${String(base)} no es válida: tiene que ser un entero de 0 a ${BASE_MAXIMA}.`)
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
  conectar,
  reconectar,
  seleccionar
}
