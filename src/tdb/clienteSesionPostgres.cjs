// =============================================================================
// El `Client` de `pg` de la sesión PostgreSQL: consultas internas, estado de la transacción,
// ROLLBACK que sobrevive a un cancel tardío y el CancelRequest del protocolo (Stop) por una
// conexión aparte. Solo carga `pg` al cancelar; lo usan `sesionPostgres.cjs` y `cursorSesionPostgres.cjs`.
// =============================================================================
'use strict'

/** Consulta interna: filas en array, protocolo extendido, parsers por defecto. */
function interna(s, text, values) {
  const q = { text, rowMode: 'array', queryMode: 'extended' }
  if (values) q.values = values
  return s.cliente.query(q)
}

function estadoCliente(s) {
  return s.cliente ? s.cliente.getTransactionStatus() : null
}

/** ROLLBACK que sobrevive a un cancel que llegó tarde (57014): se reintenta una vez. */
async function rollbackSeguro(s) {
  try {
    return await interna(s, 'ROLLBACK')
  } catch (err) {
    if (err && err.code === '57014') return interna(s, 'ROLLBACK')
    throw err
  }
}

/**
 * Estado exacto con `getTransactionStatus()` (gratis) y, en 'T', `txid_current_if_assigned()`:
 * nulo = `abierta` (BEGIN sin cambios, pero retiene bloqueos de lectura).
 */
async function estadoTx(s, exacto) {
  const st = estadoCliente(s)
  if (st === 'E') return 'fallida'
  if (st !== 'T') return 'ninguna'
  if (exacto === false) return 'pendiente'
  try {
    const r = await interna(s, 'SELECT txid_current_if_assigned()')
    return r.rows[0][0] === null ? 'abierta' : 'pendiente'
  } catch {
    // PG < 10 no tiene la función: lo prudente es no dar la tx por vacía.
    return 'pendiente'
  }
}

async function esperarCancel(s) {
  if (s.cancelEnVuelo) {
    try {
      await s.cancelEnVuelo
    } catch {
      // el cancel es best-effort
    }
  }
}

/**
 * CancelRequest por una conexión aparte (sin autenticación: el servidor lo acepta antes del
 * pg_hba). Resuelve cuando el servidor la cierra —ya ha señalado al backend— o a los 5 s.
 */
function enviarCancelRequest(host, port, pid, clave) {
  return new Promise((resolve) => {
    const { Connection } = require('pg')
    const con = new Connection()
    let listo = false
    const fin = (ok) => {
      if (listo) return
      listo = true
      clearTimeout(reloj)
      try {
        con.stream.destroy()
      } catch {
        // ya cerrada
      }
      resolve(ok)
    }
    const reloj = setTimeout(() => fin(false), 5000)
    con.on('error', () => fin(false))
    con.on('end', () => fin(true))
    con.on('connect', () => {
      try {
        con.cancel(pid, clave)
      } catch {
        fin(false)
      }
    })
    try {
      if (typeof host === 'string' && host.startsWith('/')) con.connect(`${host}/.s.PGSQL.${port}`)
      else con.connect(port, host)
    } catch {
      fin(false)
    }
  })
}

module.exports = { interna, estadoCliente, rollbackSeguro, estadoTx, esperarCancel, enviarCancelRequest }
