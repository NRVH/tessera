// =============================================================================
// Peticiones de la sesión SQL Server: los binds del protocolo como parámetros de tedious, el
// envío de UNA petición (lote sin parámetros con `execSqlBatch`; con ellos, `execSql`) y las
// consultas internas de Tessera. Sin dependencias locales (tedious llega en `s.tedious`); lo usa
// `sesionSqlserver.cjs`.
// =============================================================================
'use strict'

/** TEXTSIZE sin tope (el de tedious y el del servidor). */
const TEXTSIZE_MAXIMO = 2147483647

/**
 * TEXTSIZE (bytes) para unos topes: sin tope de celda (catálogo), el máximo. El tope de celda
 * lo corta el SERVIDOR (tope × 2 + 2): con TEXTSIZE corta el (n)varchar(max) y tedious ya no
 * junta 20 MB en memoria.
 */
function textsizeDe(topes) {
  if (!topes.topeCelda) return TEXTSIZE_MAXIMO
  return Math.min(TEXTSIZE_MAXIMO, topes.topeCelda * 2 + 2)
}

function errorProtocolo(codigo, mensaje) {
  const e = new Error(mensaje)
  e.code = codigo
  e.__protocolo = true
  return e
}

/**
 * El tipo de tedious de un valor de bind: un número como entero (el OFFSET de la rejilla lo exige)
 * y el texto como nvarchar, que el servidor convierte al tipo de su sitio con el DATEFORMAT fijado.
 */
function parametroDe(tedious, nombre, v) {
  const T = tedious.TYPES
  if (v === null || v === undefined) return { nombre, tipo: T.NVarChar, valor: null }
  if (typeof v === 'number' && Number.isInteger(v)) {
    return Math.abs(v) <= 2147483647 ? { nombre, tipo: T.Int, valor: v } : { nombre, tipo: T.BigInt, valor: String(v) }
  }
  if (typeof v === 'number') return { nombre, tipo: T.Float, valor: v }
  if (typeof v === 'boolean') return { nombre, tipo: T.Bit, valor: v }
  return { nombre, tipo: T.NVarChar, valor: String(v) }
}

/** `{ entrada, valor }` (de otro motor) o `{ sqlite, valor }` → su valor; lo demás, tal cual. */
function valorDeBind(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && ('entrada' in v || 'sqlite' in v)) {
    return v.valor === undefined ? null : v.valor
  }
  return v
}

/**
 * Un bind del protocolo como parámetro. Una CLAVE binaria llega como `{ sqlite: 'blob', valor:
 * hex }` (`bindClaveBinaria` de `motores/sesionSqlserver.ts`): va como VarBinary de verdad,
 * porque SQL Server no convierte un nvarchar en varbinary sin que se lo pidan.
 */
function parametroDeBind(tedious, nombre, v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && v.sqlite === 'blob' && typeof v.valor === 'string') {
    return { nombre, tipo: tedious.TYPES.VarBinary, valor: Buffer.from(v.valor, 'hex') }
  }
  return parametroDe(tedious, nombre, valorDeBind(v))
}

/** Los binds del protocolo como parámetros `@p1…` (o por nombre, si vienen con nombre). */
function parametrosDe(tedious, binds) {
  if (binds === undefined || binds === null) return null
  if (Array.isArray(binds)) {
    if (binds.length === 0) return null
    return binds.map((v, i) => parametroDeBind(tedious, `p${i + 1}`, v))
  }
  if (typeof binds === 'object') {
    const lista = Object.keys(binds).map((k) => parametroDeBind(tedious, k.replace(/^@/, ''), binds[k]))
    return lista.length > 0 ? lista : null
  }
  throw errorProtocolo('TESSERA-BINDS', 'Binds de SQL Server con una forma desconocida.')
}

/**
 * Manda UNA petición y resuelve con el error (o null) cuando termina. `oyentes(req)` engancha
 * sus eventos antes de mandarla. Sin parámetros, lote (conserva las #temp, los SET y el USE de la
 * consola; dentro de sp_executesql una #temp muere al salir); con ellos, sp_executesql.
 */
function peticion(s, sql, parametros, oyentes) {
  const { Request } = s.tedious
  return new Promise((resolve) => {
    let req
    try {
      req = new Request(sql, (err) => {
        if (s.peticion === req) s.peticion = null
        resolve(err || null)
      })
    } catch (e) {
      resolve(e)
      return
    }
    if (parametros) for (const p of parametros) req.addParameter(p.nombre, p.tipo, p.valor)
    if (oyentes) oyentes(req)
    s.peticion = req
    try {
      if (parametros) s.conexion.execSql(req)
      else s.conexion.execSqlBatch(req)
    } catch (e) {
      s.peticion = null
      resolve(e)
    }
  })
}

/** SQL de Tessera: filas como arrays de valores crudos. Lanza el error del servidor. */
async function interna(s, sql, binds) {
  const filas = []
  const err = await peticion(s, sql, parametrosDe(s.tedious, binds), (req) => {
    req.on('row', (cols) => filas.push(cols.map((c) => (c ? c.value : null))))
  })
  if (err) {
    err.__con = s.con
    throw err
  }
  return filas
}

module.exports = { TEXTSIZE_MAXIMO, textsizeDe, errorProtocolo, parametrosDe, valorDeBind, peticion, interna }
