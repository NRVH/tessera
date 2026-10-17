// =============================================================================
// El cliente del puente local de Tessera para `tssh`: una petición por conexión, JSON en una línea, con el
// token de la sesión (`TESSERA_DB_SESSION`) por el pipe de `TESSERA_DB_PIPE`, como `tdb`. Si Tessera no
// contesta, no reconoce la sesión o no conoce la operación, falla con el código 3 y dice qué hacer. Los
// «no» de la propia operación los decide quien la pide. Depende de `node:net`, `tsshSalida` y `textosTssh`.
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md, docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const net = require('node:net')
const { CODIGOS, ErrorTssh } = require('./tsshSalida.cjs')
const { textosTssh } = require('./textosTssh.cjs')

/** Lo que se espera a Tessera por petición. */
const TOPE_MS = 5000
/** Una respuesta más larga no es del puente. */
const MAX_RESPUESTA = 1024 * 1024

/** El pipe y el token de esta terminal, o un fallo claro si no la abrió Tessera. */
function credenciales(env) {
  const pipe = env.TESSERA_DB_PIPE
  const token = env.TESSERA_DB_SESSION
  if (!pipe || !token) {
    throw new ErrorTssh(CODIGOS.puente, textosTssh().terminalAjena)
  }
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
function enviar(pipe, linea) {
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
    socket.setTimeout(TOPE_MS, () => acabar(null))
    socket.on('error', () => acabar(null))
    socket.on('connect', () => socket.write(linea))
    socket.on('data', (trozo) => {
      leido += trozo.toString('utf-8')
      const corte = leido.indexOf('\n')
      if (corte >= 0) acabar(leerRespuesta(leido.slice(0, corte)))
      else if (leido.length > MAX_RESPUESTA) acabar(null)
    })
    socket.on('end', () => acabar(leerRespuesta(leido)))
  })
}

/** Los «no» del propio puente (no los de la operación), con el código 3. */
function exigirPuente(r) {
  const t = textosTssh()
  if (r === null) throw new ErrorTssh(CODIGOS.puente, t.tesseraNoContesta)
  if (r.ok === true) return r
  // Los `error` que se comparan son códigos del puente, no textos para nadie: no se traducen.
  if (r.error === 'no autorizado') throw new ErrorTssh(CODIGOS.puente, t.sesionNoReconocida)
  if (r.error === 'operacion desconocida' || r.error === 'version de protocolo distinta') {
    throw new ErrorTssh(CODIGOS.puente, t.versionDistinta)
  }
  if (r.error === 'error interno') throw new ErrorTssh(CODIGOS.puente, t.falloInterno)
  return r
}

/** Pide una operación al puente con el token de esta sesión. Los campos no pueden pisar la versión, el token ni la operación. */
async function pedir(op, campos = {}, env = process.env) {
  const { pipe, token } = credenciales(env)
  const respuesta = await enviar(pipe, JSON.stringify({ ...campos, v: 1, token, op }) + '\n')
  return exigirPuente(respuesta)
}

module.exports = { pedir, credenciales }
