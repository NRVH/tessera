// =============================================================================
// Celdas de PostgreSQL del proceso de sesión: la tabla de OIDs integrados, el nombre del tipo
// con su typmod, bytea en hex y la celda. El trabajador pide texto crudo del servidor (salvo
// bool, `TIPOS_CRUDOS_PG`); los tipos de usuario los resuelve la sesión con `format_type`.
// Pieza de `celdas.cjs`.
// Decisiones: docs/decisiones/bd/celdas-valores-exactos-y-topes.md
// =============================================================================

'use strict'

const { recortarTexto, celdaNativa } = require('./celdasComun.cjs')

/**
 * bytea de PG en texto (`bytea_output='hex'`: '\x0a0b…') -> '0x0A0B…'. Sin
 * convertir a Buffer: se recorta sobre el propio texto. Si no viene en hex (alguien
 * cambió bytea_output pese a la guardia), se trata como texto normal.
 */
function byteaPgAHex(texto, topeBytes) {
  if (typeof texto !== 'string' || !texto.startsWith('\\x')) return null
  const hex = texto.slice(2)
  const bytes = Math.floor(hex.length / 2)
  if (topeBytes && bytes > topeBytes) {
    return { valor: '0x' + hex.slice(0, topeBytes * 2).toUpperCase(), original: bytes }
  }
  return { valor: '0x' + hex.toUpperCase(), original: null }
}

/** OIDs integrados: [nombre, tipoLógico]. Los de usuario los resuelve la sesión. */
const TIPOS_PG = {
  16: ['bool', 'booleano'],
  17: ['bytea', 'binario'],
  18: ['char', 'texto'],
  19: ['name', 'texto'],
  20: ['int8', 'numero'],
  21: ['int2', 'numero'],
  23: ['int4', 'numero'],
  24: ['regproc', 'texto'],
  25: ['text', 'texto'],
  26: ['oid', 'numero'],
  28: ['xid', 'texto'],
  114: ['json', 'json'],
  142: ['xml', 'texto'],
  194: ['pg_node_tree', 'texto'],
  650: ['cidr', 'texto'],
  700: ['float4', 'numero'],
  701: ['float8', 'numero'],
  705: ['unknown', 'texto'],
  790: ['money', 'texto'],
  829: ['macaddr', 'texto'],
  869: ['inet', 'texto'],
  1042: ['bpchar', 'texto'],
  1043: ['varchar', 'texto'],
  1082: ['date', 'fecha'],
  1083: ['time', 'texto'],
  1114: ['timestamp', 'fechaHora'],
  1184: ['timestamptz', 'fechaHora'],
  1186: ['interval', 'otro'],
  1266: ['timetz', 'texto'],
  1560: ['bit', 'texto'],
  1562: ['varbit', 'texto'],
  1700: ['numeric', 'numero'],
  2205: ['regclass', 'texto'],
  2206: ['regtype', 'texto'],
  2249: ['record', 'otro'],
  2278: ['void', 'otro'],
  2950: ['uuid', 'texto'],
  3220: ['pg_lsn', 'texto'],
  3614: ['tsvector', 'texto'],
  3615: ['tsquery', 'texto'],
  3802: ['jsonb', 'json'],
  3904: ['int4range', 'otro'],
  3906: ['numrange', 'otro'],
  3908: ['tsrange', 'otro'],
  3910: ['tstzrange', 'otro'],
  3912: ['daterange', 'otro'],
  3926: ['int8range', 'otro'],
  4089: ['regnamespace', 'texto'],
  // Arrays: su texto es '{…}', no un número ni una fecha.
  199: ['json[]', 'otro'],
  1000: ['bool[]', 'otro'],
  1001: ['bytea[]', 'otro'],
  1003: ['name[]', 'otro'],
  1005: ['int2[]', 'otro'],
  1007: ['int4[]', 'otro'],
  1009: ['text[]', 'otro'],
  1014: ['bpchar[]', 'otro'],
  1015: ['varchar[]', 'otro'],
  1016: ['int8[]', 'otro'],
  1021: ['float4[]', 'otro'],
  1022: ['float8[]', 'otro'],
  1028: ['oid[]', 'otro'],
  1115: ['timestamp[]', 'otro'],
  1182: ['date[]', 'otro'],
  1185: ['timestamptz[]', 'otro'],
  1231: ['numeric[]', 'otro'],
  2951: ['uuid[]', 'otro'],
  3807: ['jsonb[]', 'otro']
}

function tipoLogicoPg(oid) {
  const t = TIPOS_PG[oid]
  // Tipo de usuario (enum, dominio…): se pinta como texto.
  return t ? t[1] : 'texto'
}

/** ¿Hace falta preguntar al servidor el nombre de este OID? */
function oidDesconocidoPg(oid) {
  return !TIPOS_PG[oid]
}

/** El typmod de un tipo con longitud, precisión o escala: `(40)`, `(10,2)`; null si el tipo no lo lleva. */
function modificadorPg(oid, m, nombre) {
  if (oid === 1043 || oid === 1042) return `${oid === 1042 ? 'char' : 'varchar'}(${m - 4})`
  if (oid === 1700 && m >= 4) {
    const precision = ((m - 4) >> 16) & 0xffff
    const escala = (m - 4) & 0xffff
    return escala ? `numeric(${precision},${escala})` : `numeric(${precision})`
  }
  if (oid === 1114 || oid === 1184 || oid === 1083 || oid === 1266) return `${nombre}(${m})`
  return null
}

/** Nombre del tipo con su typmod: varchar(40), numeric(10,2), timestamp(3). */
function nombreTipoPg(oid, typmod, nombresExtra) {
  const t = TIPOS_PG[oid]
  if (!t) {
    const extra = nombresExtra && (nombresExtra.get ? nombresExtra.get(oid) : nombresExtra[oid])
    return extra || `oid ${oid}`
  }
  const nombre = t[0]
  const m = Number(typmod)
  if (!(m >= 0)) return nombre
  return modificadorPg(oid, m, nombre) ?? nombre
}

function columnasPg(fields, nombresExtra) {
  return (fields || []).map((f) => ({
    nombre: String(f.name),
    tipoLogico: tipoLogicoPg(f.dataTypeID),
    tipoMotor: nombreTipoPg(f.dataTypeID, f.dataTypeModifier, nombresExtra)
  }))
}

/**
 * Parsers de tipo de la sesión de usuario: TEXTO CRUDO del servidor para todo
 * menos bool. Así numeric/int8 llegan exactos y timestamptz con la zona de la
 * sesión, sin pasar por un `Date` de JS.
 */
const TIPOS_CRUDOS_PG = {
  getTypeParser(oid) {
    if (oid === 16) return (v) => (v === null ? null : v === 't')
    return (v) => v
  }
}

/** Celda de PG (valor crudo del servidor, o bool). */
function celdaPg(v, oid, topes) {
  if (v === null || v === undefined) return { valor: null, original: null }
  if (typeof v === 'boolean') return { valor: v, original: null }
  if (oid === 17) {
    const hex = byteaPgAHex(v, topes.topeBinario)
    if (hex) return hex
  }
  return recortarTexto(typeof v === 'string' ? v : String(v), topes.topeCelda)
}

/** Convierte una fila de PG. `oids[c]` = dataTypeID de la columna c. */
function filaPg(fila, oids, topes) {
  const celdas = new Array(fila.length)
  let recortes = null
  for (let c = 0; c < fila.length; c++) {
    const r = topes.catalogo ? { valor: celdaNativa(fila[c]), original: null } : celdaPg(fila[c], oids[c], topes)
    celdas[c] = r.valor
    if (r.original !== null && r.original !== undefined) {
      if (!recortes) recortes = []
      recortes.push([c, r.original])
    }
  }
  return { celdas, recortes }
}

module.exports = {
  TIPOS_CRUDOS_PG,
  byteaPgAHex,
  tipoLogicoPg,
  oidDesconocidoPg,
  nombreTipoPg,
  columnasPg,
  celdaPg,
  filaPg
}
