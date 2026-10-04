// =============================================================================
// Errores de MongoDB para `tdb` y el proceso de sesión: `ErrorSintaxis` (con su posición),
// los errores de configuración y de uso, y `normalizarError`, que los reparte en las clases de
// `protocoloTrabajador.ts`. No depende de ningún otro módulo local ni carga el driver.
// Decisiones: docs/decisiones/bd/mongodb-interprete-del-shell.md
// =============================================================================
'use strict'

class ErrorSintaxis extends Error {
  constructor(mensaje, offset, campo) {
    super(mensaje)
    this.name = 'ErrorSintaxis'
    this.offset = offset
    if (campo) this.campo = campo
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

const NOMBRES_PERDIDA = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoTopologyClosedError',
  'MongoClientClosedError',
  'MongoNotConnectedError',
  'MongoServerClosedError',
  'MongoPoolClosedError'
])

/** ¿Es una red caída o un cliente cerrado? */
function esPerdida(err) {
  return Boolean(err && NOMBRES_PERDIDA.has(err.name))
}

function mensajeDe(err) {
  const m = String((err && err.message) || err || 'Error desconocido')
  return err && typeof err.codeName === 'string' && err.codeName && !m.includes(err.codeName) ? `${m} (${err.codeName})` : m
}

function errorDeSintaxis(err) {
  const e = { clase: 'servidor', mensaje: err.message, codigo: 'TESSERA-SINTAXIS', offsetCp: Number(err.offset) || 0 }
  if (err.campo) e.campoDocs = err.campo
  return e
}

function errorDeServidor(err) {
  const e = { clase: 'servidor', mensaje: mensajeDe(err) }
  if (typeof err.code === 'number' || (typeof err.code === 'string' && err.code)) e.codigo = String(err.code)
  return e
}

/** Un error del driver o del intérprete como `{ clase, mensaje, codigo?, offsetCp?, campoDocs? }`. */
function normalizarError(err) {
  if (!err) return { clase: 'servidor', mensaje: mensajeDe(err) }
  if (err.trabajador) return err.trabajador
  if (err instanceof ErrorSintaxis || err.name === 'ErrorSintaxis') return errorDeSintaxis(err)
  if (err.name === 'AbortError' || err.code === 11601) return { clase: 'cancelada', mensaje: 'Operación cancelada.' }
  if (err.code === 50) return { clase: 'timeout', mensaje: mensajeDe(err), codigo: '50' }
  if (esPerdida(err)) return { clase: 'perdida', mensaje: mensajeDe(err) }
  return errorDeServidor(err)
}

module.exports = { ErrorSintaxis, errorConfig, errorUso, esPerdida, normalizarError }
