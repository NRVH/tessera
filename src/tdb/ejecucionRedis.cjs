// =============================================================================
// Ejecutar un comando de Redis con `callBuffer` y llevar la cuenta de la base y del MULTI de la
// conexión (la cola de lo encolado, para saber la base tras un EXEC y pintar sus respuestas por
// comando). Pieza de `redisComun.cjs`, que reexporta `ejecutar`.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

const { errorUso, esRespuestaError } = require('./erroresRedis.cjs')
const { nombreComando } = require('./comandosRedis.cjs')
const { aBuffer, nombreEnvio, respuestaDe } = require('./valoresRedis.cjs')
const { estado } = require('./clienteRedis.cjs')

/** El EXEC de un MULTI abierto: cierra la cola, toma la base del último `SELECT` que ejecutó y pinta cada respuesta por su comando. */
function terminarMulti(e, r, ctx) {
  const cola = e.multi
  e.multi = null
  if (Array.isArray(r)) {
    r.forEach((x, i) => {
      if (cola[i] && cola[i].base !== undefined && !(x instanceof Error)) e.base = cola[i].base
    })
  }
  return respuestaDe(r, { ...ctx, cola })
}

/** Apunta el comando en la cola del MULTI abierto, o abre uno, o recuerda la base de un `SELECT`. */
function registrar(e, nombre, argv) {
  if (e.multi !== null) {
    if (nombre === 'discard') {
      e.multi = null
    } else if (nombre !== 'multi') {
      const q = { nombre, argc: argv.length }
      if (nombre === 'select') q.base = Number(aBuffer(argv[1]).toString('latin1'))
      e.multi.push(q)
    }
  } else if (nombre === 'multi') {
    e.multi = []
  } else if (nombre === 'select' && argv.length > 1) {
    const n = Number(aBuffer(argv[1]).toString('latin1'))
    if (Number.isInteger(n)) e.base = n
  }
}

/**
 * Ejecuta un comando y devuelve su `DbKvRespuesta` (`callBuffer`). Un error de PRIMER nivel
 * LANZA (el llamador lo convierte en `motivo: 'servidor'`); los anidados van como `{ tipo: 'error' }`.
 */
async function ejecutar(cliente, argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw errorUso('No hay ningún comando.')
  const nombre = nombreComando(argv)
  const e = estado(cliente)
  const enMulti = e.multi !== null && nombre !== 'exec' && nombre !== 'discard' && nombre !== 'multi'
  let r
  try {
    r = await cliente.callBuffer(nombreEnvio(argv[0]), ...argv.slice(1).map(aBuffer))
  } catch (err) {
    // EXEC con EXECABORT o un DISCARD que falla: el servidor ya no tiene MULTI.
    if (esRespuestaError(err) && (nombre === 'exec' || nombre === 'discard')) e.multi = null
    throw err
  }
  const ctx = { nombre, argc: argv.length, enMulti }
  if (e.multi !== null && nombre === 'exec') return terminarMulti(e, r, ctx)
  registrar(e, nombre, argv)
  return respuestaDe(r, ctx)
}

module.exports = { ejecutar }
