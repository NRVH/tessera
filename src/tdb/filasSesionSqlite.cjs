// =============================================================================
// Lectura de filas de la sesión SQLite: `iterate()` cortando en `maxFilas + 1` y `return()`.
// NUNCA un cursor vivo entre operaciones: en modo rollback un SELECT a medias retiene el bloqueo
// SHARED y el COMMIT de la aplicación dueña del archivo falla al instante con SQLITE_BUSY.
// «Más» es re-ejecutar saltando filas (`saltarFilas`). Depende de `celdas.cjs`, `sqliteComun.cjs`
// y `sesionTiempo.cjs`; lo usa `sesionSqlite.cjs`.
// Decisiones: docs/decisiones/bd/trabajador-sqlite-sesion.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')
const comun = require('./sqliteComun.cjs')
const { ahora, ms } = require('./sesionTiempo.cjs')

/** Una celda del CATÁLOGO: JSON nativo (un entero que cabe, como Number; el resto, texto). */
function celdaCatalogo(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') {
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
  }
  if (typeof v === 'number') return v
  if (v instanceof Uint8Array) return '0x' + Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('hex').toUpperCase()
  return v
}

/**
 * Un valor de la CLAVE del paginado por clave, con su clase de almacenamiento para volver a
 * enlazarlo igual (`valorDeBind` lo deshace): el entero exacto como texto de BigInt, el
 * real con los dígitos que lo reproducen, un BLOB en hexadecimal; el texto, tal cual.
 */
function valorDeClave(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return { sqlite: 'entero', valor: v.toString() }
  if (typeof v === 'number') return Number.isFinite(v) ? { sqlite: 'real', valor: String(v) } : String(v)
  if (v instanceof Uint8Array) return { sqlite: 'blob', valor: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('hex') }
  return String(v)
}

/**
 * Avanza el iterador saltando `saltar` filas y guardando hasta `pedir`. El perfil de la guardia
 * se mantiene puesto mientras se AVANZA (`conPerfil`), no solo al preparar: un cambio de esquema
 * a mitad hace que SQLite vuelva a preparar. Suelta el SELECT a medias YA: sin eso, el bloqueo
 * SHARED seguiría puesto.
 */
function recorrer(s, stmt, args, perfil, saltar, pedir) {
  const est = { filas: [], saltadas: 0, agotado: false }
  comun.conPerfil(s.c, perfil, () => {
    const it = stmt.iterate(...args)
    try {
      while (est.saltadas < saltar) {
        const r = it.next()
        if (r.done) {
          est.agotado = true
          break
        }
        est.saltadas++
      }
      while (!est.agotado && est.filas.length < pedir) {
        const r = it.next()
        if (r.done) {
          est.agotado = true
          break
        }
        est.filas.push(r.value)
      }
    } finally {
      if (typeof it.return === 'function') it.return()
    }
  })
  return est
}

/** Las filas que caben en la respuesta (`quitar` columnas del final descartadas); `ultima` es la última que cupo. */
function acumular(filas, op, topes, quitar) {
  const catalogo = op.proposito === 'catalogo'
  const acc = new celdas.AcumuladorPagina(topes.topeRespuesta)
  const tope = Math.min(filas.length, op.maxFilas)
  let cortada = false
  let ultima = null
  for (let i = 0; i < tope; i++) {
    const fila = quitar ? filas[i].slice(0, -quitar) : filas[i]
    let ok
    if (catalogo) ok = acc.agregar(fila.map(celdaCatalogo), null)
    else {
      const f = comun.filaSqlite(fila, topes)
      ok = acc.agregar(f.celdas, f.recortes)
    }
    if (!ok) {
      cortada = true
      break
    }
    ultima = filas[i]
  }
  return { acc, cortada, ultima }
}

/**
 * Las columnas que se quitan del final: la CLAVE del paginado por clave (`nClave`), que se
 * devuelve aparte, o la del ROWNUM de respaldo (no aplica aquí, pero es del contrato).
 */
function columnasAlFinal(op, nClave) {
  if (nClave > 0) return nClave
  return op.quitarUltimaColumna === true ? 1 : 0
}

/** Lee las filas de un lector ya preparado y arma el resultado. */
function leerFilas(s, p, args, op, topes, perfil) {
  const stmt = p.stmt
  stmt.setReturnArrays(true)
  const t0 = ahora()
  const saltar = Number.isInteger(op.saltarFilas) && op.saltarFilas > 0 ? op.saltarFilas : 0
  const pedir = op.maxFilas + 1
  const { filas, saltadas, agotado } = recorrer(s, stmt, args, perfil, saltar, pedir)
  const msEjecucion = ms(t0)
  const t1 = ahora()
  let columnas = comun.columnasSqlite(stmt)
  const nClave = Number.isInteger(op.claveAlFinal) && op.claveAlFinal > 0 ? op.claveAlFinal : 0
  const quitar = columnasAlFinal(op, nClave)
  if (quitar) columnas = columnas.slice(0, -quitar)
  const { acc, cortada, ultima } = acumular(filas, op, topes, quitar)
  const resultado = {
    tipo: 'filas',
    columnas,
    filasJson: acc.json(),
    nFilas: acc.n,
    hayMas: cortada || filas.length > op.maxFilas,
    lector: null,
    comando: null,
    msEjecucion,
    msLectura: ms(t1)
  }
  if (acc.recortes.length) resultado.recortes = acc.recortes
  if (saltar) resultado.saltadas = saltadas
  if (nClave > 0 && ultima !== null) resultado.ultimaClave = ultima.slice(-nClave).map(valorDeClave)
  // RETURNING: SQLite aplica TODOS los cambios en el primer paso; el total de filas solo se
  // sabe si el resultado terminó en esta página.
  if (totalConocido(op, { agotado, cortada, saltar })) resultado.afectadas = filas.length
  return resultado
}

function totalConocido(op, d) {
  return d.agotado && op.esDml === true && !d.cortada && d.saltar === 0
}

module.exports = { leerFilas }
