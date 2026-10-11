// =============================================================================
// Los documentos de MongoDB como FILAS DE ARCHIVO: una página de documentos del driver pasa a JSON (un
// documento por fila, en EJSON relajado: números como números y los tipos sin equivalente con su
// envoltorio) o a CSV (una fila por documento, con las columnas de la primera página). Puro: lo usa la
// op `exportarAbrir`/`exportarMas` de `sesionMongodb.cjs`. Depende de `cargaMongodb.cjs` y `textoMongodb.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-explain-y-exportar.md
// =============================================================================
'use strict'

const { ejson } = require('./cargaMongodb.cjs')
const { texto } = require('./textoMongodb.cjs')

const FORMATOS = ['json', 'csv']

/** El documento (o valor) como JSON en una línea, en EJSON relajado. */
function jsonDe(v) {
  return ejson().stringify(v, { relaxed: true })
}

/** Los tipos BSON que en un CSV valen su texto plano. */
const CELDA_BSON = {
  ObjectId: (v) => v.toHexString(),
  Int32: (v) => String(v.value),
  Double: (v) => String(v.value),
  Long: (v) => v.toString(),
  Decimal128: (v) => v.toString()
}

/**
 * El valor de un campo como celda de CSV: texto plano en lo escalar, JSON en subdocumentos y listas y notación
 * del shell en el resto de tipos BSON (`UUID("…")`, `Timestamp(…)`); null si no hay valor.
 */
function celdaCsv(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v !== 'object') return String(v)
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (Array.isArray(v)) return jsonDe(v)
  if (Object.prototype.hasOwnProperty.call(CELDA_BSON, v._bsontype)) return CELDA_BSON[v._bsontype](v)
  return v._bsontype !== undefined || v instanceof RegExp || v instanceof Uint8Array ? texto(v, true) : jsonDe(v)
}

/**
 * Una página de documentos como filas del formato. `columnas` solo cuenta en CSV: los campos de un
 * documento que no estén en ellas no se escriben, y `omitidos` cuenta los documentos a los que les pasó.
 */
function paginaExportada(documentos, formato, columnas) {
  if (formato === 'json') return { filas: documentos.map((d) => [jsonDe(d)]), omitidos: 0 }
  const conocidas = new Set(columnas)
  let omitidos = 0
  const filas = documentos.map((d) => {
    if (Object.keys(d).some((k) => !conocidas.has(k))) omitidos++
    return columnas.map((c) => celdaCsv(d[c]))
  })
  return { filas, omitidos }
}

module.exports = { FORMATOS, celdaCsv, paginaExportada }
