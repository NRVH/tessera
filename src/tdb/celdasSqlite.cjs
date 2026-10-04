// =============================================================================
// Las celdas de SQLite: un REAL como lo escribe SQLite, BigInt como texto, BLOB en hex, el
// tipo lógico por afinidad y las columnas de un resultado. Pieza de `sqliteComun.cjs`, que
// reexporta todo; los topes son los de `celdas.cjs`.
// Decisiones: docs/decisiones/bd/adaptador-sqlite-apertura-y-autorizador.md
// =============================================================================

'use strict'

const celdas = require('./celdas.cjs')

/**
 * Un REAL como texto, en la FORMA de SQLite y con los dígitos del double más corto que lo
 * representa: `100.0`, `0.5`, `1.0e+21`, `1.0e-07`, `Inf`, `-Inf`, `0.0` (también para -0).
 * Notación exponencial desde 1e17 y por debajo de 1e-4, como SQLite (1e16 →
 * «10000000000000000.0», 1e17 → «1.0e+17»).
 */
function textoReal(n) {
  if (Number.isNaN(n)) return null
  if (n === Infinity) return 'Inf'
  if (n === -Infinity) return '-Inf'
  if (n === 0) return '0.0'
  const abs = Math.abs(n)
  if (abs >= 1e17 || abs < 1e-4) {
    const [mantisa, exp] = n.toExponential().split('e')
    const m = mantisa.indexOf('.') >= 0 ? mantisa : mantisa + '.0'
    const signo = exp[0] === '-' ? '-' : '+'
    const digitos = exp.replace(/^[+-]/, '')
    return `${m}e${signo}${digitos.length < 2 ? '0' + digitos : digitos}`
  }
  const s = String(n)
  return s.indexOf('.') >= 0 || s.indexOf('e') >= 0 ? s : s + '.0'
}

function esBytes(v) {
  return v instanceof Uint8Array
}

/**
 * Una celda de SQLite como `DbCelda` (`string | null`; SQLite no tiene booleanos), con su
 * longitud original si se recortó. `topes` de `celdas.topesDe`. En el catálogo (`topes.catalogo`)
 * no se recorta nada, pero un BigInt sigue siendo texto (JSON no sabe escribirlo).
 */
function celdaSqlite(v, topes) {
  if (v === null || v === undefined) return { valor: null, original: null }
  if (typeof v === 'bigint') return { valor: v.toString(), original: null }
  if (typeof v === 'number') return { valor: textoReal(v), original: null }
  if (esBytes(v)) {
    if (topes.catalogo) return { valor: '0x' + Buffer.from(v).toString('hex').toUpperCase(), original: null }
    return celdas.hexCorto(Buffer.from(v.buffer, v.byteOffset, v.byteLength), topes.topeBinario)
  }
  if (typeof v === 'string') return topes.catalogo ? { valor: v, original: null } : celdas.recortarTexto(v, topes.topeCelda)
  return { valor: String(v), original: null }
}

/** Una fila (en ARRAY, `setReturnArrays` o `Object.values`) como `{ celdas, recortes }`, como `filaPg`. */
function filaSqlite(fila, topes) {
  const out = new Array(fila.length)
  let recortes = null
  for (let c = 0; c < fila.length; c++) {
    const r = celdaSqlite(fila[c], topes)
    out[c] = r.valor
    if (r.original !== null && r.original !== undefined) {
      if (!recortes) recortes = []
      recortes.push([c, r.original])
    }
  }
  return { celdas: out, recortes }
}

/**
 * El tipo LÓGICO de una columna por su tipo DECLARADO, con las reglas de AFINIDAD de SQLite
 * (INT → entero; CHAR, CLOB, TEXT → texto; BLOB → binario; REAL, FLOA, DOUB → real; lo
 * demás, NUMERIC). Una columna sin tipo (una expresión, o declarada sin él) es 'otro': en
 * SQLite el tipo es del VALOR, no de la columna. Las declaradas DATE/TIME (afinidad NUMERIC,
 * pero la fecha se guarda casi siempre como texto) van como 'texto' para no alinearlas ni
 * ordenarlas como números.
 */
function tipoLogicoSqlite(declarado) {
  const t = String(declarado || '').toUpperCase()
  if (t === '') return 'otro'
  if (t.indexOf('INT') >= 0) return 'numero'
  if (t.indexOf('CHAR') >= 0 || t.indexOf('CLOB') >= 0 || t.indexOf('TEXT') >= 0) return 'texto'
  if (t.indexOf('BLOB') >= 0) return 'binario'
  if (t.indexOf('REAL') >= 0 || t.indexOf('FLOA') >= 0 || t.indexOf('DOUB') >= 0) return 'numero'
  if (t.indexOf('DATE') >= 0 || t.indexOf('TIME') >= 0) return 'texto'
  return 'numero'
}

/** Las columnas de un resultado como `DbColumnaResultado` (con su origen, que node:sqlite da). */
function columnasSqlite(stmt) {
  return stmt.columns().map((c) => {
    const col = { nombre: String(c.name), tipoLogico: tipoLogicoSqlite(c.type), tipoMotor: c.type ? String(c.type) : '' }
    if (c.table) col.tabla = String(c.table)
    if (c.column) col.columna = String(c.column)
    if (c.database) col.esquema = String(c.database)
    return col
  })
}

module.exports = { textoReal, celdaSqlite, filaSqlite, tipoLogicoSqlite, columnasSqlite }
