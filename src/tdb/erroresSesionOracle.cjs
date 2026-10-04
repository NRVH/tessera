// =============================================================================
// Errores de la sesión Oracle: el código ORA/NJS/DPI de un fallo, qué códigos son pérdida de
// la sesión, la advertencia de compilación y el `ErrorTrabajador` que sale al main.
// La posición del error llega en bytes UTF-8 y aquí se pasa a puntos de código.
// Depende de `oracle.cjs` (solo `limpiarRutasHost`); lo usa `sesionOracle.cjs`.
// =============================================================================
'use strict'

// Rutas del equipo -> `<cliente>`: la MISMA que quita las del cliente al cargarlo (oracle.cjs
// solo carga `path` y `fs` al importarse; el driver se sigue cargando tarde, en `abrir`).
const { limpiarRutasHost } = require('./oracle.cjs')

/** "La sesión ya no existe", más 01092/02399 (instancia caída, tiempo máximo). */
const CODIGOS_PERDIDA = new Set([
  'ORA-03113',
  'ORA-03114',
  'ORA-03135',
  'ORA-02396',
  'ORA-00028',
  'ORA-01012',
  'ORA-01092',
  'ORA-02399',
  'ORA-12537',
  'ORA-12547',
  'NJS-500',
  'NJS-003',
  'DPI-1010',
  'DPI-1080'
])
const CODIGOS_TIMEOUT = new Set(['NJS-123', 'DPI-1067'])
const CODIGOS_DRIVER = new Set(['DPI-1047', 'DPI-1072', 'NJS-138', 'NJS-533', 'NJS-116'])

function codigoOracle(err) {
  if (!err) return undefined
  if (typeof err.code === 'string' && /^(ORA|NJS|DPI)-\d+$/.test(err.code)) return err.code
  const m = String(err.message || '').match(/^(ORA|NJS|DPI)-\d+/)
  return m ? m[0] : undefined
}

function esPerdida(err) {
  const codigo = codigoOracle(err)
  return Boolean(codigo && CODIGOS_PERDIDA.has(codigo))
}

/**
 * `result.warning` -> `advertencia`. node-oracledb convierte el ORA-24344 del servidor («success
 * with compilation error») en su NJS-700 en los DOS modos, y solo thick conserva la línea ORA en
 * el mensaje. Se devuelve el código del SERVIDOR, igual en thin y en thick: es el que documenta
 * Oracle y con el que el usuario encuentra ayuda.
 */
function advertenciaOracle(w) {
  const codigo = codigoOracle(w)
  if (codigo === 'NJS-700' || (w && w.errorNum === 24344)) {
    return { codigo: 'ORA-24344', mensaje: 'ORA-24344: success with compilation error' }
  }
  const a = { mensaje: String((w && w.message) || w) }
  if (codigo) a.codigo = codigo
  return a
}

/** Offset en bytes UTF-8 -> puntos de código, sobre el SQL que se envió. */
function bytesAPuntosDeCodigo(sql, offsetBytes) {
  let bytes = 0
  let cp = 0
  for (const ch of String(sql)) {
    if (bytes >= offsetBytes) return cp
    const c = ch.codePointAt(0)
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
    cp++
  }
  return cp
}

/** La clase de un error que no es de driver ausente: pérdida, cancelada, timeout, solo lectura, driver o servidor. */
function claseDeOracle(err, codigo) {
  if (codigo && CODIGOS_PERDIDA.has(codigo)) return 'perdida'
  if (codigo === 'ORA-01013') return 'cancelada'
  if (codigo && CODIGOS_TIMEOUT.has(codigo)) return err.__cancelPedido ? 'cancelada' : 'timeout'
  if (codigo === 'ORA-01456') return 'soloLectura'
  if (codigo && CODIGOS_DRIVER.has(codigo)) return 'driver'
  return 'servidor'
}

/**
 * Error del driver -> `ErrorTrabajador`. `sql` es el texto enviado (para el offset).
 * `err.__cancelPedido` lo marca la sesión si el usuario pulsó Stop. Un offset 0 no se informa:
 * Oracle pone 0 en todo error que no es de análisis y marcar el inicio sería mentir.
 */
function normalizarError(err, sql) {
  const codigo = codigoOracle(err)
  let mensaje = String((err && err.message) || err || 'Error desconocido')
  if (codigo === 'DPI-1047' || codigo === 'DPI-1072' || /DPI-10(47|72)/.test(mensaje)) {
    mensaje = limpiarRutasHost(mensaje)
  }
  const e = { mensaje, clase: 'servidor' }
  if (codigo) e.codigo = codigo
  if (err && err.requiereDriver) {
    e.clase = 'driver'
    e.requiereDriver = err.requiereDriver
  } else {
    e.clase = claseDeOracle(err, codigo)
  }
  if (sql && err && typeof err.offset === 'number' && err.offset > 0) {
    e.offsetCp = bytesAPuntosDeCodigo(sql, err.offset)
  }
  return e
}

module.exports = { esPerdida, advertenciaOracle, bytesAPuntosDeCodigo, normalizarError, limpiarRutasHost }
