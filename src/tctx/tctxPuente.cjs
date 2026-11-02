// =============================================================================
// El cliente del puente local de Tessera para `tctx`: una petición por conexión, JSON en una línea, con el
// token de la sesión (`TESSERA_DB_SESSION`) por el pipe de `TESSERA_DB_PIPE`, como `tdb` y `tssh`. Sin
// respuesta a tiempo resuelve `null`; los «no» los lee `tctxOrdenes.exigirPuente`.
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md, docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
'use strict'

const net = require('node:net')
const { CODIGOS, ErrorTctx } = require('./tctxSalida.cjs')
const { textosTctx } = require('./textosTctx.cjs')

/** Lo que se espera a Tessera por petición. */
const TOPE_MS = 5000
/** Una respuesta más larga no es del puente. */
const MAX_RESPUESTA = 1024 * 1024

/** El pipe y el token de esta terminal, o un fallo claro si no la abrió Tessera. */
function credenciales(env) {
  const pipe = env.TESSERA_DB_PIPE
  const token = env.TESSERA_DB_SESSION
  if (!pipe || !token) throw new ErrorTctx(CODIGOS.puente, textosTctx().terminalAjena)
  return { pipe, token }
}

/** El objeto de una línea JSON, o `null`. */
function leerRespuesta(texto) {
  try {
    const r = JSON.parse(String(texto).trim())
    return r !== null && typeof r === 'object' ? r : null
  } catch {
    return null
  }
}

/** Manda una línea y resuelve con la respuesta, o con `null` si Tessera no contesta a tiempo. */
function enviar(pipe, linea, topeMs) {
  return new Promise((resolve) => {
    let hecho = false
    let leido = ''
    let socket = null
    const acabar = (valor) => {
      if (hecho) return
      hecho = true
      if (socket) socket.destroy()
      resolve(valor)
    }
    try {
      socket = net.connect(pipe)
    } catch {
      acabar(null)
      return
    }
    socket.setTimeout(topeMs, () => acabar(null))
    socket.on('error', () => acabar(null))
    socket.on('connect', () => socket.write(linea))
    // Con codificación, un carácter multibyte partido entre dos trozos se une en vez de salir como U+FFFD.
    socket.setEncoding('utf8')
    socket.on('data', (trozo) => {
      leido += trozo
      const corte = leido.indexOf('\n')
      if (corte >= 0) acabar(leerRespuesta(leido.slice(0, corte)))
      else if (leido.length > MAX_RESPUESTA) acabar(null)
    })
    socket.on('end', () => acabar(leerRespuesta(leido)))
  })
}

/**
 * Pide una operación al puente con el token de esta sesión. Los campos no pueden pisar la versión, el token ni
 * la operación. Una operación larga (`buscar`) pasa su propio tope de espera.
 */
async function pedir(op, campos = {}, env = process.env, topeMs = TOPE_MS) {
  const { pipe, token } = credenciales(env)
  return enviar(pipe, JSON.stringify({ ...campos, v: 1, token, op }) + '\n', topeMs)
}

module.exports = { pedir }
