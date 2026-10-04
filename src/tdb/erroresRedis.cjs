// =============================================================================
// Los errores de Redis para `tdb` y el trabajador: la sintaxis, la configuración, el uso y la
// política con su código, y `normalizarError`, que los reduce a `{ clase, mensaje, codigo? }`.
// Pieza de `redisComun.cjs`, que reexporta lo que usan `redis.cjs` y `sesionRedis.cjs`.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

const CODIGO_PELIGROSO = 'TESSERA-PELIGROSO'
const CODIGO_NO_ADMITIDO = 'TESSERA-NO-ADMITIDO'
const CODIGO_SOLO_LECTURA = 'TESSERA-SOLO-LECTURA'
const CODIGO_PRODUCCION = 'TESSERA-PRODUCCION'
const CODIGO_SINTAXIS = 'TESSERA-SINTAXIS'

class ErrorSintaxis extends Error {
  constructor(mensaje, offsetCp) {
    super(mensaje)
    this.name = 'ErrorSintaxis'
    this.offsetCp = offsetCp
  }
}

function errorConfig(mensaje) {
  const e = new Error(mensaje)
  e.code = 'TESSERA-CONFIG'
  return e
}

function errorUso(mensaje) {
  const e = new Error(mensaje)
  e.code = 'TESSERA-USO'
  return e
}

/** Un rechazo de la política, ya como ErrorTrabajador (lo lee `sesion.cjs`) y con `codigo` (lo lee `tdb`). */
function errorPolitica(clase, codigo, mensaje) {
  const e = new Error(mensaje)
  e.code = codigo
  e.codigo = codigo
  e.trabajador = { clase, mensaje, codigo }
  return e
}

const CODIGOS_RED = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'ENOTFOUND',
  'EAI_AGAIN'
])

/** Un error que CONTESTÓ el servidor: WRONGTYPE, NOPERM… */
function esRespuestaError(err) {
  return Boolean(err && err.name === 'ReplyError')
}

/** La conexión se cayó: ECONNRESET, «Connection is closed»… */
function esPerdida(err) {
  if (!err || esRespuestaError(err)) return false
  if (CODIGOS_RED.has(err.code)) return true
  const m = String(err.message || '')
  return m === 'Connection is closed.' || m.startsWith("Stream isn't writeable") || err.name === 'MaxRetriesPerRequestError'
}

function mensajeRed(err) {
  if (err && err.syscall && err.code && err.address) {
    return `No se pudo hablar con Redis en ${err.address}${err.port ? ':' + err.port : ''} (${err.code}).`
  }
  const m = String((err && err.message) || err || 'Error de red')
  return m === 'Connection is closed.' ? 'La conexión con Redis se cerró.' : m
}

/** Un error del servidor con su código en mayúsculas (`WRONGTYPE`, `NOPERM`), si el mensaje empieza por uno. */
function errorDeServidorDesdeMensaje(mensaje) {
  const e = { clase: 'servidor', mensaje }
  const m = /^([A-Z][A-Z0-9_-]*)(?:\s|$)/.exec(mensaje)
  if (m) e.codigo = m[1]
  return e
}

/** Un error con código de Tessera: el de uso es de protocolo; los demás, del servidor. */
function errorPropio(err, mensaje) {
  if (!err || typeof err.code !== 'string') return null
  if (err.code === 'TESSERA-USO') return { clase: 'protocolo', mensaje, codigo: 'TESSERA-USO' }
  return err.code.startsWith('TESSERA-') ? { clase: 'servidor', mensaje, codigo: err.code } : null
}

/** Un error del driver o de Tessera como `{ clase, mensaje, codigo?, offsetCp? }` (ErrorTrabajador). */
function normalizarError(err) {
  if (err && err.trabajador) return err.trabajador
  if (err instanceof ErrorSintaxis || (err && err.name === 'ErrorSintaxis')) {
    return { clase: 'servidor', mensaje: err.message, codigo: CODIGO_SINTAXIS, offsetCp: Number(err.offsetCp) || 0 }
  }
  const mensaje = String((err && err.message) || err || 'Error desconocido')
  const propio = errorPropio(err, mensaje)
  if (propio) return propio
  if (esRespuestaError(err)) return errorDeServidorDesdeMensaje(mensaje)
  if (esPerdida(err)) return { clase: 'perdida', mensaje: mensajeRed(err) }
  return { clase: 'servidor', mensaje }
}

module.exports = {
  CODIGO_PELIGROSO,
  CODIGO_NO_ADMITIDO,
  CODIGO_SOLO_LECTURA,
  CODIGO_PRODUCCION,
  ErrorSintaxis,
  errorConfig,
  errorUso,
  errorPolitica,
  esRespuestaError,
  esPerdida,
  normalizarError
}
