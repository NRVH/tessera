// =============================================================================
// Los TIPOS de los valores de MongoDB y su vista en la tabla del explorador: `tipoDe` (los de
// `DbDocTipo` en `db-documentos-ipc.ts`), `celda` (tipo y vista corta), `documento` (id EJSON,
// texto y celdas), `columnasDe` y la muestra de campos de una colección (`$sample`).
// Depende de `cargaMongodb.cjs` y `textoMongodb.cjs`; lo usan `mongoComun.cjs` y las sesiones.
// Decisiones: docs/decisiones/bd/mongodb-conexion-y-tipos.md
// =============================================================================
'use strict'

const { ejson } = require('./cargaMongodb.cjs')
const { escribir, texto } = require('./textoMongodb.cjs')

const TOPE_VISTA = 200

const TIPOS_BSON = {
  Int32: 'int',
  Double: 'double',
  Long: 'long',
  Decimal128: 'decimal',
  ObjectId: 'objectId',
  Binary: 'binary',
  BSONRegExp: 'regex',
  Timestamp: 'timestamp'
}

/** El tipo de un valor que no es un objeto, o null si lo es. */
function tipoDePrimitivo(v) {
  if (v === null || v === undefined) return 'null'
  switch (typeof v) {
    case 'string':
      return 'string'
    case 'boolean':
      return 'bool'
    case 'number':
      return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? 'int' : 'double'
    case 'bigint':
      return 'long'
    case 'object':
      return null
    default:
      return 'otro'
  }
}

/** El tipo de un valor para la tabla: `'string' | 'int' | 'long' | 'objectId' | …`. */
function tipoDe(v) {
  const p = tipoDePrimitivo(v)
  if (p !== null) return p
  const b = v._bsontype
  if (b !== undefined) return Object.prototype.hasOwnProperty.call(TIPOS_BSON, b) ? TIPOS_BSON[b] : 'otro'
  if (v instanceof Date) return 'date'
  if (v instanceof RegExp) return 'regex'
  if (v instanceof Uint8Array) return 'binary'
  if (Array.isArray(v)) return 'array'
  return 'objeto'
}

function recortar(s) {
  return s.length > TOPE_VISTA ? s.slice(0, TOPE_VISTA) + '…' : s
}

function vistaDe(tipo, v) {
  switch (tipo) {
    case 'string':
      return recortar(v)
    case 'objeto': {
      const n = Object.keys(v).length
      return `{ ${n} campo${n === 1 ? '' : 's'} }`
    }
    case 'array':
      return `[ ${v.length} ]`
    case 'date':
      return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString()
    case 'null':
      return v === undefined ? 'undefined' : 'null'
    default:
      return recortar(escribir(v, true, 0))
  }
}

/** `{ tipo, vista }` de un valor (vista corta: `{ 3 campos }`, `[ 5 ]`). */
function celda(v) {
  const tipo = tipoDe(v)
  return { tipo, vista: vistaDe(tipo, v) }
}

/** `{ idEjson, texto, celdas }` de un documento. */
function documento(d) {
  const EJSON = ejson()
  const celdas = {}
  for (const k of Object.keys(d)) celdas[k] = celda(d[k])
  return {
    idEjson: Object.prototype.hasOwnProperty.call(d, '_id') ? EJSON.stringify(d._id, { relaxed: false }) : '',
    texto: texto(d),
    celdas
  }
}

/** Las columnas conocidas en su orden y detrás las nuevas de `docs`. */
function columnasDe(docs, conocidas) {
  const salida = Array.isArray(conocidas) ? conocidas.filter((c) => typeof c === 'string') : []
  const vistas = new Set(salida)
  for (const d of docs || []) {
    if (!d || typeof d !== 'object') continue
    for (const k of Object.keys(d)) {
      if (!vistas.has(k)) {
        vistas.add(k)
        salida.push(k)
      }
    }
  }
  return salida
}

/** Cuenta, por campo de primer nivel, en cuántos documentos sale y con qué tipos. */
function contarCampos(docs) {
  const campos = new Map()
  for (const d of docs) {
    for (const k of Object.keys(d)) {
      let c = campos.get(k)
      if (!c) {
        c = { nombre: k, presencia: 0, tipos: new Map(), orden: campos.size }
        campos.set(k, c)
      }
      c.presencia++
      const t = tipoDe(d[k])
      c.tipos.set(t, (c.tipos.get(t) || 0) + 1)
    }
  }
  return campos
}

/** `{ campos, muestra }` de una muestra (`$sample`) de la colección, con `_id` primero; `muestra` = cuántos documentos salieron. */
async function muestrear(coleccion, n = 100, o = {}) {
  const opc = { promoteValues: false }
  if (o.signal) opc.signal = o.signal
  if (o.comment) opc.comment = o.comment
  const docs = await coleccion.aggregate([{ $sample: { size: n } }], opc).toArray()
  const lista = [...contarCampos(docs).values()].sort((a, b) => {
    if (a.nombre === '_id') return -1
    if (b.nombre === '_id') return 1
    return b.presencia - a.presencia || a.orden - b.orden
  })
  return {
    muestra: docs.length,
    campos: lista.map((c) => ({
      nombre: c.nombre,
      tipos: [...c.tipos.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      presencia: c.presencia
    }))
  }
}

/** Solo los campos de `muestrear`. */
async function muestraCampos(coleccion, n = 100, o = {}) {
  return (await muestrear(coleccion, n, o)).campos
}

module.exports = { tipoDe, celda, documento, columnasDe, muestrear, muestraCampos }
