// =============================================================================
// Errores de la sesión SQLite: el nombre del código de un error de node:sqlite, qué es una
// pérdida (solo una conexión cerrada por debajo: SQLite no tiene red que se caiga) y el
// `ErrorTrabajador` que sale al main. Sin dependencias; lo usan los `*SesionSqlite.cjs`.
// =============================================================================
'use strict'

/** Los códigos PRIMARIOS de SQLite (`errcode & 0xff`) por nombre. */
const PRIMARIOS = {
  1: 'SQLITE_ERROR',
  2: 'SQLITE_INTERNAL',
  3: 'SQLITE_PERM',
  4: 'SQLITE_ABORT',
  5: 'SQLITE_BUSY',
  6: 'SQLITE_LOCKED',
  7: 'SQLITE_NOMEM',
  8: 'SQLITE_READONLY',
  9: 'SQLITE_INTERRUPT',
  10: 'SQLITE_IOERR',
  11: 'SQLITE_CORRUPT',
  13: 'SQLITE_FULL',
  14: 'SQLITE_CANTOPEN',
  15: 'SQLITE_PROTOCOL',
  17: 'SQLITE_SCHEMA',
  18: 'SQLITE_TOOBIG',
  19: 'SQLITE_CONSTRAINT',
  20: 'SQLITE_MISMATCH',
  21: 'SQLITE_MISUSE',
  23: 'SQLITE_AUTH',
  25: 'SQLITE_RANGE',
  26: 'SQLITE_NOTADB'
}

/** Los EXTENDIDOS que el usuario ve a menudo (el resto sale por su primario). */
const EXTENDIDOS = {
  261: 'SQLITE_BUSY_RECOVERY',
  517: 'SQLITE_BUSY_SNAPSHOT',
  773: 'SQLITE_BUSY_TIMEOUT',
  264: 'SQLITE_READONLY_RECOVERY',
  520: 'SQLITE_READONLY_CANTLOCK',
  776: 'SQLITE_READONLY_ROLLBACK',
  1032: 'SQLITE_READONLY_DBMOVED',
  275: 'SQLITE_CONSTRAINT_CHECK',
  531: 'SQLITE_CONSTRAINT_COMMITHOOK',
  787: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  1043: 'SQLITE_CONSTRAINT_FUNCTION',
  1299: 'SQLITE_CONSTRAINT_NOTNULL',
  1555: 'SQLITE_CONSTRAINT_PRIMARYKEY',
  1811: 'SQLITE_CONSTRAINT_TRIGGER',
  2067: 'SQLITE_CONSTRAINT_UNIQUE',
  2323: 'SQLITE_CONSTRAINT_VTAB',
  2579: 'SQLITE_CONSTRAINT_ROWID',
  3091: 'SQLITE_CONSTRAINT_DATATYPE'
}

/** El nombre del código de un error de node:sqlite (`errcode`, extendido), o undefined. */
function codigoSqlite(err) {
  const n = err && typeof err.errcode === 'number' ? err.errcode : null
  if (n === null) return undefined
  return EXTENDIDOS[n] || PRIMARIOS[n & 0xff] || `SQLITE_${n}`
}

/**
 * SQLITE_BUSY_SNAPSHOT (WAL: otra conexión escribió después de que esta transacción empezara a
 * leer; al instante, sin reintento) lleva su propio mensaje: solo se sale revirtiendo.
 */
const MENSAJE_SNAPSHOT =
  'Otra conexión escribió en la base después de que esta transacción empezara a leer (modo WAL): ' +
  'esta transacción ya no puede escribir. Revierte y vuelve a intentarlo.'
/** Algunas sentencias (`INSERT OR ROLLBACK`, `RAISE(ROLLBACK)`) revierten la transacción entera en silencio. */
const DETALLE_REVERTIDA = 'SQLite revirtió la transacción entera: los cambios pendientes se perdieron.'

/** Error de protocolo del trabajador (`__protocolo`): un mensaje mal formado del main. */
function errorProtocolo(mensaje, codigo) {
  const e = new Error(mensaje)
  e.code = codigo
  e.__protocolo = true
  return e
}

function esPerdida(err) {
  return Boolean(err && err.codigo === 'TESSERA-SQLITE-CERRADA')
}

/** La clase de un error: pérdida, solo lectura o servidor. */
function claseDeSqlite(err, tessera, codigo, mensaje) {
  if (esPerdida(err)) return 'perdida'
  if (tessera === 'TESSERA-SQLITE-NO-PERMITIDO' && /solo lectura/i.test(mensaje)) return 'soloLectura'
  if (codigo && codigo.startsWith('SQLITE_READONLY')) return 'soloLectura'
  return 'servidor'
}

/**
 * Error de node:sqlite o de `sqliteComun` -> `ErrorTrabajador`. `err.__offsetCp` lo pone la
 * bisección de `ejecutar`; `err.__revertida`, que la transacción desapareció con el error. Los
 * mensajes de error de apertura no llevan la ruta (los arma `sqliteComun`).
 */
function normalizarError(err) {
  const mensaje = String((err && err.message) || err || 'Error desconocido')
  const tessera = err && typeof err.codigo === 'string' && err.codigo.startsWith('TESSERA-SQLITE-') ? err.codigo : null
  const codigo = tessera || codigoSqlite(err)
  const e = { mensaje, clase: 'servidor' }
  if (codigo) e.codigo = codigo
  e.clase = claseDeSqlite(err, tessera, codigo, mensaje)
  if (e.clase === 'servidor' && codigo === 'SQLITE_BUSY_SNAPSHOT') e.mensaje = `${MENSAJE_SNAPSHOT} (${mensaje})`
  if (err) anotarMarcas(err, e)
  return e
}

/** Lo que la sesión colgó del error: la posición (`__offsetCp`) y que la transacción desapareció (`__revertida`). */
function anotarMarcas(err, e) {
  if (Number.isInteger(err.__offsetCp) && err.__offsetCp >= 0) e.offsetCp = err.__offsetCp
  if (err.__revertida === true) e.detalle = DETALLE_REVERTIDA
}

module.exports = { codigoSqlite, errorProtocolo, esPerdida, normalizarError }
