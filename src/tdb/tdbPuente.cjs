// =============================================================================
// Cliente del puente local de Tessera: pide qué bases hay montadas AHORA y con qué secretos, y el
// túnel SSH de una conexión que lo lleva. Nunca lanza: si el puente no contesta, devuelve `null`.
// Solo depende de `node:net`, cargado al usarlo; lo usa `tdbContexto.cjs`.
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md
// =============================================================================
'use strict'

/** Tope de espera del puente. Si Tessera no contesta, se sigue con lo que haya. */
const PUENTE_TIMEOUT_MS = 5000

/**
 * Le pregunta a Tessera qué bases hay montadas AHORA y con qué credenciales. Si no contesta
 * —Tessera cerrada, pipe caído, protocolo distinto— devuelve `null`: degradar es mejor que
 * dejar una terminal esperando cinco segundos por cada comando.
 */
function pedirAlPuente(pipe, token) {
  return peticion(pipe, { v: 1, token, op: 'resolve' }, PUENTE_TIMEOUT_MS, (r) => (r && r.ok ? r : null))
}

/** Lo que espera `db.tunel`: abrirlo puede llevar el `ConnectTimeout` de ssh por salto y la autenticación. */
const TUNEL_TIMEOUT_MS = 40000

/**
 * Pide a Tessera el extremo local del túnel SSH de la conexión `id`, abriéndolo si hace falta.
 * Devuelve `{ ok, host, port }`, `{ ok: false, error }` con el motivo para el usuario, o `null`
 * si Tessera no contestó.
 */
function pedirTunel(pipe, token, id) {
  return peticion(pipe, { v: 1, token, op: 'db.tunel', id }, TUNEL_TIMEOUT_MS, (r) => (r && typeof r.ok === 'boolean' ? r : null))
}

/** Una petición de una línea al puente y su respuesta de una línea; `null` si no contesta a tiempo. */
function peticion(pipe, mensaje, topeMs, aceptar) {
  return new Promise((resolve) => {
    let hecho = false
    const acabar = (valor) => {
      if (hecho) return
      hecho = true
      resolve(valor)
    }
    let socket
    try {
      socket = require('node:net').connect(pipe)
    } catch {
      return acabar(null)
    }
    socket.setTimeout(topeMs)
    socket.on('timeout', () => {
      socket.destroy()
      acabar(null)
    })
    socket.on('error', () => acabar(null))
    let buffer = ''
    socket.on('data', (t) => {
      buffer += t.toString('utf-8')
    })
    socket.on('end', () => {
      try {
        const r = JSON.parse(buffer.trim().split(String.fromCharCode(10)).filter(Boolean).pop())
        acabar(aceptar(r))
      } catch {
        acabar(null)
      }
    })
    socket.write(JSON.stringify(mensaje) + String.fromCharCode(10))
  })
}

module.exports = { pedirAlPuente, pedirTunel }
