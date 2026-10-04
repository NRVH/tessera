// =============================================================================
// El TEXTO de un valor de MongoDB en notación del shell (`ObjectId("…")`, `ISODate("…")`,
// `NumberLong("…")`), con los tipos numéricos explícitos donde un número a pelo cambiaría de tipo al
// volver: el viaje texto -> BSON -> texto es exacto. Depende solo de `literalesMongodb.cjs` (el tope
// de profundidad); lo usan `tiposMongodb.cjs` y `mongoComun.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-conexion-y-tipos.md
// =============================================================================
'use strict'

const { TOPE_PROFUNDIDAD } = require('./literalesMongodb.cjs')

const IDENTIFICADOR = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function numero(n) {
  if (Number.isNaN(n)) return 'NaN'
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity'
  if (Object.is(n, -0)) return '-0'
  return String(n)
}

function uuidDe(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function escribirDouble(x) {
  // Un double SIN decimales a pelo volvería como Int32.
  return Number.isFinite(x) && Number.isInteger(x) ? `Double(${numero(x)})` : numero(x)
}

function escribirBinary(v) {
  if (v.sub_type === 4 && v.position === 16) return `UUID("${uuidDe(v.toString('hex'))}")`
  return `BinData(${v.sub_type}, "${v.toString('base64')}")`
}

const CONSTRUCTORES_SIMPLES = {
  Int32: (v) => numero(v.value),
  Double: (v) => escribirDouble(v.value),
  Long: (v) => `NumberLong("${v.toString()}")`,
  Decimal128: (v) => `NumberDecimal("${v.toString()}")`,
  ObjectId: (v) => `ObjectId("${v.toHexString()}")`,
  Binary: escribirBinary,
  Timestamp: (v) => `Timestamp(${v.t}, ${v.i})`,
  BSONRegExp: (v) => `RegExp(${JSON.stringify(v.pattern)}, ${JSON.stringify(v.options)})`,
  MinKey: () => 'MinKey()',
  MaxKey: () => 'MaxKey()',
  BSONSymbol: (v) => `Symbol(${JSON.stringify(String(v.value))})`
}

function escribirBson(v, tipo, compacto, nivel) {
  const simple = Object.prototype.hasOwnProperty.call(CONSTRUCTORES_SIMPLES, tipo) ? CONSTRUCTORES_SIMPLES[tipo] : null
  if (simple) return simple(v)
  switch (tipo) {
    case 'Code':
      return v.scope ? `Code(${JSON.stringify(v.code)}, ${escribir(v.scope, compacto, nivel)})` : `Code(${JSON.stringify(v.code)})`
    case 'DBRef':
      return `DBRef(${JSON.stringify(v.collection)}, ${escribir(v.oid, compacto, nivel)}${v.db ? `, ${JSON.stringify(v.db)}` : ''})`
    default:
      return JSON.stringify(String(v))
  }
}

function envolver(abre, cierra, partes, compacto, nivel) {
  const enLinea = `${abre} ${partes.join(', ')} ${cierra}`
  if (compacto || (nivel > 0 && enLinea.length <= 72 && !enLinea.includes('\n'))) return enLinea
  const pad = '  '.repeat(nivel + 1)
  return `${abre}\n${partes.map((p) => pad + p).join(',\n')}\n${'  '.repeat(nivel)}${cierra}`
}

/** El texto de un valor que no es un objeto (o `null` si lo es y hay que seguir). */
function escribirPrimitivo(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v)
    case 'boolean':
      return String(v)
    case 'number':
      return numero(v)
    case 'bigint':
      return `NumberLong("${v.toString()}")`
    case 'object':
      return null
    default:
      return JSON.stringify(String(v))
  }
}

function escribirDocumento(v, compacto, nivel) {
  const claves = Object.keys(v)
  if (claves.length === 0) return '{}'
  const partes = claves.map((k) => `${IDENTIFICADOR.test(k) ? k : JSON.stringify(k)}: ${escribir(v[k], compacto, nivel + 1)}`)
  return envolver('{', '}', partes, compacto, nivel)
}

function escribir(v, compacto, nivel) {
  const p = escribirPrimitivo(v)
  if (p !== null) return p
  if (nivel > TOPE_PROFUNDIDAD) return '…'
  if (typeof v._bsontype === 'string') return escribirBson(v, v._bsontype, compacto, nivel)
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'new Date(NaN)' : `ISODate("${v.toISOString()}")`
  if (v instanceof RegExp) return `/${v.source}/${v.flags}`
  if (v instanceof Uint8Array) return `BinData(0, "${Buffer.from(v).toString('base64')}")`
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return envolver('[', ']', v.map((x) => escribir(x, compacto, nivel + 1)), compacto, nivel)
  }
  return escribirDocumento(v, compacto, nivel)
}

/** El valor en notación del shell; `compacto` lo deja en una línea. */
function texto(valor, compacto = false) {
  return escribir(valor, compacto === true, 0)
}

module.exports = { escribir, texto }
