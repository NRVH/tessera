// =============================================================================
// Errores de la sesión PostgreSQL: qué fallos significan que la sesión ya no existe y el
// `ErrorTrabajador` que sale al main, con la posición, el detalle y la pista del servidor.
// Sin dependencias; lo usa `sesionPostgres.cjs`.
// =============================================================================
'use strict'

/** Códigos que significan "la sesión ya no existe" (además de la clase 08). */
const CODIGOS_PERDIDA = new Set(['57P01', '57P02', '57P03', '57P04', '57P05', '25P03'])

function esPerdida(err) {
  if (!err) return false
  const codigo = typeof err.code === 'string' ? err.code : ''
  if (codigo.startsWith('08') || CODIGOS_PERDIDA.has(codigo)) return true
  if (codigo === 'ECONNRESET' || codigo === 'EPIPE') return true
  const mensaje = String(err.message || '')
  return (
    mensaje.startsWith('Connection terminated') ||
    mensaje.includes('not queryable') ||
    mensaje.includes('Client was closed')
  )
}

/** La clase de un error: pérdida, cancelada, timeout, solo lectura o servidor. */
function claseDePostgres(err, codigo, mensaje) {
  if (esPerdida(err)) return 'perdida'
  if (codigo === '57014') return err.__cancelPedido ? 'cancelada' : 'timeout'
  if (codigo === '25006') return 'soloLectura'
  if (!codigo && /timeout/i.test(mensaje)) return 'timeout'
  return 'servidor'
}

/** Posición del servidor (1-based) -> offset en puntos de código (0-based), o `undefined` si no vale. */
function offsetDe(posicion) {
  const p = Number(posicion)
  return Number.isInteger(p) && p >= 1 ? p - 1 : undefined
}

/** Campos de texto del error del servidor -> su nombre en `ErrorTrabajador`. */
const CAMPOS_DE_TEXTO = [
  ['internalQuery', 'consultaInterna'],
  ['where', 'donde'],
  ['detail', 'detalle'],
  ['hint', 'pista']
]

/**
 * Anota en `e` lo que el servidor dijo del error: la posición y la interna (offsets en puntos de
 * código) y el texto de la consulta interna, dónde, detalle y pista. Sin `position` (un error
 * dentro de un DO o de una función SQL), el main marca la posición con la consulta interna o la
 * «line N» del cuerpo `$$`.
 */
function anotarDetalle(err, e) {
  if (err.position !== undefined) {
    const p = offsetDe(err.position)
    if (p !== undefined) e.offsetCp = p
  }
  if (err.internalPosition !== undefined) {
    const p = offsetDe(err.internalPosition)
    if (p !== undefined) e.offsetInternoCp = p
  }
  for (const [campo, nombre] of CAMPOS_DE_TEXTO) {
    if (typeof err[campo] === 'string' && err[campo]) e[nombre] = err[campo]
  }
}

/**
 * Error del driver -> `ErrorTrabajador`. `err.__cancelPedido` lo marca la sesión si el usuario
 * pulsó Stop mientras corría: un 57014 así es `cancelada`; sin él, es el `statement_timeout` del
 * servidor.
 */
function normalizarError(err) {
  const mensaje = String((err && err.message) || err || 'Error desconocido')
  const codigo = err && typeof err.code === 'string' ? err.code : undefined
  const e = { mensaje, clase: 'servidor' }
  if (codigo) e.codigo = codigo
  e.clase = claseDePostgres(err, codigo, mensaje)
  if (err) anotarDetalle(err, e)
  return e
}

module.exports = { esPerdida, normalizarError }
