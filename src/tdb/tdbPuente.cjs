// =============================================================================
// Cliente del puente local de Tessera: pide qué bases hay montadas AHORA y con qué secretos.
// Nunca lanza: si el puente no contesta, devuelve `null` y `tdb` sigue con el entorno.
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
    socket.setTimeout(PUENTE_TIMEOUT_MS)
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
        acabar(r && r.ok ? r : null)
      } catch {
        acabar(null)
      }
    })
    socket.write(JSON.stringify({ v: 1, token, op: 'resolve' }) + String.fromCharCode(10))
  })
}

module.exports = { pedirAlPuente }
