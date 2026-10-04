// =============================================================================
// Salida del servidor de la sesión PostgreSQL: los NOTICE, INFO y WARNING que llegan por el
// `Client` mientras corre UNA sentencia, sin viaje extra, y cuáles cuentan como aviso.
// Depende de `celdas.cjs`; lo usa `sesionPostgres.cjs`.
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')

/**
 * Severidades de NOTICE que son un aviso. `severity` llega TRADUCIDA según `lc_messages`
 * (pg-protocol no guarda el campo V, el que no se traduce): se cubren inglés y español, y además
 * la clase 01 de SQLSTATE (`RAISE WARNING` da 01000). Los avisos del propio servidor como «there
 * is already a transaction in progress» son WARNING con otra clase (25001): no basta con el código.
 */
const SEVERIDADES_AVISO = new Set(['WARNING', 'ADVERTENCIA'])

function esAvisoPg(msg) {
  const codigo = msg && typeof msg.code === 'string' ? msg.code : ''
  const severidad = msg && typeof msg.severity === 'string' ? msg.severity.toUpperCase() : ''
  return SEVERIDADES_AVISO.has(severidad) || codigo.startsWith('01')
}

/**
 * Escucha los NOTICE/INFO/WARNING del cliente mientras corre UNA sentencia. Devuelve la función
 * que deja de escuchar y entrega las líneas (o undefined si no hubo).
 */
function escucharSalida(s) {
  const acc = new celdas.AcumuladorSalida()
  const oyente = (msg) => acc.agregar(msg && msg.message !== undefined ? msg.message : '', esAvisoPg(msg))
  s.cliente.on('notice', oyente)
  return () => {
    s.cliente.removeListener('notice', oyente)
    const lineas = acc.lineas()
    return lineas.length > 0 ? lineas : undefined
  }
}

module.exports = { escucharSalida }
