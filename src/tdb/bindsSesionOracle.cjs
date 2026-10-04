// =============================================================================
// Binds de la sesión Oracle: convierte los binds que manda el main a los del driver (LOB
// temporal, texto nacional o CHAR de entrada; CLOB de salida leído entero hasta su tope).
// El trabajador sigue sin saber qué SQL ejecuta: solo convierte la forma del bind.
// Depende de `celdas.cjs`; lo usa `sesionOracle.cjs`.
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')

/** Tope de un bind de salida de texto (CLOB) si el main no manda otro: 16 Mi unidades. */
const TOPE_SALIDA_TEXTO = 16 * 1024 * 1024

/**
 * Binds con nombre del main -> binds de oracledb. Un valor `{ salida: 'texto', tope }` es un bind
 * de SALIDA de tipo CLOB (el DDL de DBMS_METADATA): se lee entero hasta su tope al terminar. Lo
 * demás pasa tal cual.
 */
function prepararBinds(oracledb, binds) {
  if (Array.isArray(binds)) return { binds: binds.map((v) => bindEntrada(oracledb, v)), salidas: null }
  if (!binds || typeof binds !== 'object') return { binds: binds || [], salidas: null }
  const out = {}
  let salidas = null
  for (const k of Object.keys(binds)) {
    const v = binds[k]
    if (v && typeof v === 'object' && v.salida === 'texto') {
      out[k] = { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_CLOB }
      if (!salidas) salidas = {}
      salidas[k] = Number.isInteger(v.tope) && v.tope > 0 ? v.tope : TOPE_SALIDA_TEXTO
    } else {
      out[k] = bindEntrada(oracledb, v)
    }
  }
  return { binds: out, salidas }
}

/**
 * Tipo de oracledb de cada `entrada` que el main sabe pedir. El texto de «=»/«≠» del filtro guiado
 * va como CHAR: Oracle lo compara como a un literal (con relleno contra una columna CHAR, sin él
 * contra un VARCHAR2). Una NCHAR/NVARCHAR2 pide el juego NACIONAL, que en una base no Unicode el
 * de la base convertiría en «?».
 */
function tipoDeEntrada(oracledb, entrada) {
  if (entrada === 'clob') return oracledb.DB_TYPE_CLOB
  if (entrada === 'nclob') return oracledb.DB_TYPE_NCLOB
  if (entrada === 'nvarchar') return oracledb.DB_TYPE_NVARCHAR
  if (entrada === 'char') return oracledb.DB_TYPE_CHAR
  return undefined
}

/**
 * `{ entrada: 'clob' | 'nclob' | 'nvarchar' | 'char', valor }` -> bind de entrada de ese tipo. Un
 * texto de más de 4000 bytes no cabe como VARCHAR2 en una sentencia: como CLOB el driver crea un
 * LOB temporal. Lo demás, tal cual.
 */
function bindEntrada(oracledb, v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v
  const type = tipoDeEntrada(oracledb, v.entrada)
  if (type === undefined) return v
  return {
    dir: oracledb.BIND_IN,
    type,
    val: v.valor === null || v.valor === undefined ? null : String(v.valor)
  }
}

/** Lee los CLOB de salida: `{ nombre: { texto, longitud, recortado } | null }`. */
async function leerSalidasTexto(res, salidas) {
  const r = {}
  for (const k of Object.keys(salidas)) {
    const lob = res.outBinds ? res.outBinds[k] : null
    if (lob === null || lob === undefined) {
      r[k] = null
      continue
    }
    if (typeof lob === 'string') {
      const t = celdas.recortarTexto(lob, salidas[k])
      r[k] = { texto: t.valor, longitud: lob.length, recortado: t.original !== null }
      continue
    }
    const tope = salidas[k]
    const l = await celdas.leerLob(lob, { topeCelda: tope, topeBinario: tope })
    const texto = l.valor === null || l.valor === undefined ? '' : String(l.valor)
    r[k] = { texto, longitud: l.original !== null && l.original !== undefined ? l.original : texto.length, recortado: l.original !== null && l.original !== undefined }
  }
  return r
}

module.exports = { prepararBinds, leerSalidasTexto }
