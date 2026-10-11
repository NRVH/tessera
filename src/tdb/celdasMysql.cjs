// =============================================================================
// Las columnas y celdas de MySQL y MariaDB: el `typeCast` de mysql2 que deja cada valor como su TEXTO
// exacto (números, fechas con cero, horas negativas), el binario en `Buffer` y la geometría como WKT;
// el tipo escrito (`int unsigned`, `varchar(50)`, `decimal(30,10)`) y el lógico de cada columna.
// Pieza de `mysqlComun.cjs`; sin E/S.
// Decisiones: docs/decisiones/bd/adaptador-mysql-conexion-y-celdas.md
// =============================================================================

'use strict'

const { hexCorto, recortarTexto } = require('./celdasComun.cjs')

/** El juego de caracteres «binary»: el de BLOB, BINARY, VARBINARY y JSON en MySQL. */
const BINARIO = 63
/** Bytes por carácter con que el servidor da la longitud de una columna de texto (utf8mb4). */
const BYTES_POR_CARACTER = 4

const FLAG_NO_NULL = 1
const FLAG_UNSIGNED = 32
const FLAG_ENUM = 256
const FLAG_SET = 2048

/** Los tipos numéricos de mysql2 (`field.type` en `typeCast`, `columnType` en los campos). */
const NUMERICOS = new Set(['TINY', 'SHORT', 'LONG', 'INT24', 'LONGLONG', 'DECIMAL', 'NEWDECIMAL', 'FLOAT', 'DOUBLE', 'YEAR'])
const FECHAS = new Set(['DATE', 'NEWDATE', 'DATETIME', 'DATETIME2', 'TIMESTAMP', 'TIMESTAMP2', 'TIME', 'TIME2'])
const CADENAS = new Set(['VARCHAR', 'VAR_STRING', 'STRING', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB', 'ENUM', 'SET'])

/** Los ids de tipo del protocolo (`columnType`) y su nombre en mysql2. */
const NOMBRE_TIPO = new Map([
  [0, 'DECIMAL'],
  [1, 'TINY'],
  [2, 'SHORT'],
  [3, 'LONG'],
  [4, 'FLOAT'],
  [5, 'DOUBLE'],
  [6, 'NULL'],
  [7, 'TIMESTAMP'],
  [8, 'LONGLONG'],
  [9, 'INT24'],
  [10, 'DATE'],
  [11, 'TIME'],
  [12, 'DATETIME'],
  [13, 'YEAR'],
  [14, 'NEWDATE'],
  [15, 'VARCHAR'],
  [16, 'BIT'],
  [242, 'VECTOR'],
  [245, 'JSON'],
  [246, 'NEWDECIMAL'],
  [247, 'ENUM'],
  [248, 'SET'],
  [249, 'TINY_BLOB'],
  [250, 'MEDIUM_BLOB'],
  [251, 'LONG_BLOB'],
  [252, 'BLOB'],
  [253, 'VAR_STRING'],
  [254, 'STRING'],
  [255, 'GEOMETRY']
])

/**
 * El nombre del tipo en mysql2. MariaDB manda el JSON como LONGTEXT con el formato extendido `json`
 * (`extendedFormat`): se trata como el JSON de MySQL.
 */
function nombreTipo(campo) {
  if (campo && String(campo.extendedFormat || campo.extendedTypeName || '').toLowerCase() === 'json') return 'JSON'
  if (campo && typeof campo.type === 'string') return campo.type
  return NOMBRE_TIPO.get(campo ? campo.columnType : -1) || ''
}

function esBinario(campo) {
  return Number(campo.characterSet) === BINARIO
}

// --- Geometría: WKB (con el SRID delante) a WKT ------------------------------------------------

/** Lee la geometría WKB de `b` desde `o`; devuelve `{ wkt, fin }`. Lanza si no se entiende. */
function leerWkb(b, o) {
  const le = b[o] === 1
  const u32 = (p) => (le ? b.readUInt32LE(p) : b.readUInt32BE(p))
  const f64 = (p) => (le ? b.readDoubleLE(p) : b.readDoubleBE(p))
  const tipo = u32(o + 1) % 1000
  let p = o + 5
  const punto = () => {
    const s = `${f64(p)} ${f64(p + 8)}`
    p += 16
    return s
  }
  const puntos = () => {
    const n = u32(p)
    p += 4
    const l = []
    for (let i = 0; i < n; i++) l.push(punto())
    return `(${l.join(', ')})`
  }
  const anillos = () => {
    const n = u32(p)
    p += 4
    const l = []
    for (let i = 0; i < n; i++) l.push(puntos())
    return `(${l.join(', ')})`
  }
  const varias = (nombre) => {
    const n = u32(p)
    p += 4
    const l = []
    for (let i = 0; i < n; i++) {
      const g = leerWkb(b, p)
      l.push(nombre === 'GEOMETRYCOLLECTION' ? g.wkt : g.wkt.replace(/^[A-Z]+\s*/, ''))
      p = g.fin
    }
    return `${nombre}(${l.join(', ')})`
  }
  switch (tipo) {
    case 1:
      return { wkt: `POINT(${punto()})`, fin: p }
    case 2:
      return { wkt: `LINESTRING${puntos()}`, fin: p }
    case 3:
      return { wkt: `POLYGON${anillos()}`, fin: p }
    case 4:
      return { wkt: varias('MULTIPOINT'), fin: p }
    case 5:
      return { wkt: varias('MULTILINESTRING'), fin: p }
    case 6:
      return { wkt: varias('MULTIPOLYGON'), fin: p }
    case 7:
      return { wkt: varias('GEOMETRYCOLLECTION'), fin: p }
    default:
      throw new Error(`Geometría de tipo ${tipo}`)
  }
}

/** Una geometría de MySQL (4 bytes de SRID y el WKB) como texto WKT, con su SRID si no es 0; null si no se entiende. */
function wktDe(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 9) return null
  try {
    const srid = buf.readUInt32LE(0)
    const g = leerWkb(buf, 4)
    return srid ? `SRID=${srid};${g.wkt}` : g.wkt
  } catch {
    return null
  }
}

// --- typeCast ---------------------------------------------------------------------------------

/**
 * El `typeCast` de mysql2 para el protocolo de texto: cada valor como lo escribió el servidor
 * (números y fechas exactos, también `0000-00-00` y `-12:34:56`), lo binario (BLOB, BINARY,
 * BIT, VECTOR) como `Buffer`, el JSON como su texto y la geometría como WKT.
 */
function typeCast(campo, siguiente) {
  const t = nombreTipo(campo)
  if (t === 'GEOMETRY') {
    const b = campo.buffer()
    return b === null ? null : (wktDe(b) ?? b)
  }
  if (t === 'BIT' || t === 'VECTOR') return campo.buffer()
  if (t === 'JSON') {
    const b = campo.buffer()
    return b === null ? null : b.toString('utf8')
  }
  if (NUMERICOS.has(t) || FECHAS.has(t)) return campo.string()
  // Las cadenas, como las lee mysql2: texto en su juego de caracteres, o `Buffer` si son binarias
  // (el campo de `typeCast` no trae el juego de caracteres para decidirlo aquí).
  return siguiente()
}

// --- Columnas ---------------------------------------------------------------------------------

/** Los caracteres de una columna de texto (la longitud llega en bytes de utf8mb4). */
function caracteres(campo) {
  const n = Number(campo.columnLength) || 0
  return esBinario(campo) ? n : Math.floor(n / BYTES_POR_CARACTER)
}

/** El nombre de un BLOB o un TEXT por su tamaño máximo. */
function nombreLargo(campo, raiz) {
  const n = Number(campo.columnLength) || 0
  const bytes = esBinario(campo) ? n : n / BYTES_POR_CARACTER
  if (bytes <= 255) return `tiny${raiz}`
  if (bytes <= 65535) return raiz
  if (bytes <= 16777215) return `medium${raiz}`
  return `long${raiz}`
}

const ENTEROS = new Map([
  ['TINY', 'tinyint'],
  ['SHORT', 'smallint'],
  ['INT24', 'mediumint'],
  ['LONG', 'int'],
  ['LONGLONG', 'bigint']
])

/** El tipo de una cadena: enum, set, char, varchar, binary, varbinary, text o blob. */
function tipoCadena(campo, t) {
  const flags = Number(campo.flags) || 0
  if (t === 'ENUM' || flags & FLAG_ENUM) return 'enum'
  if (t === 'SET' || flags & FLAG_SET) return 'set'
  if (t === 'STRING') return esBinario(campo) ? `binary(${caracteres(campo)})` : `char(${caracteres(campo)})`
  if (t === 'VAR_STRING' || t === 'VARCHAR') return esBinario(campo) ? `varbinary(${caracteres(campo)})` : `varchar(${caracteres(campo)})`
  return nombreLargo(campo, esBinario(campo) ? 'blob' : 'text')
}

/** El tipo de una fecha u hora, con sus decimales de segundo si los lleva. */
function tipoFecha(campo, t) {
  const dec = Number(campo.decimals) || 0
  const conDecimales = (base) => (dec > 0 && dec <= 6 ? `${base}(${dec})` : base)
  if (t === 'DATE' || t === 'NEWDATE') return 'date'
  if (t.startsWith('DATETIME')) return conDecimales('datetime')
  if (t.startsWith('TIMESTAMP')) return conDecimales('timestamp')
  return conDecimales('time')
}

/** El DECIMAL con su precisión y escala (la longitud cuenta el punto y, con signo, el signo). */
function tipoDecimal(campo, unsigned) {
  const escala = Number(campo.decimals) || 0
  const precision = Math.max(1, (Number(campo.columnLength) || 0) - (escala > 0 ? 1 : 0) - (unsigned ? 0 : 1))
  return `decimal(${precision},${escala})${unsigned}`
}

/** Los tipos numéricos y los de nombre fijo, por su nombre en mysql2 (`unsigned` va detrás si lo lleva). */
const TIPOS_ESCRITOS = new Map([
  ['DECIMAL', tipoDecimal],
  ['NEWDECIMAL', tipoDecimal],
  ['FLOAT', (_c, u) => 'float' + u],
  ['DOUBLE', (_c, u) => 'double' + u],
  ['YEAR', () => 'year'],
  ['BIT', (c) => `bit(${Number(c.columnLength) || 1})`],
  ['JSON', () => 'json'],
  ['GEOMETRY', () => 'geometry'],
  ['VECTOR', () => 'vector']
])

/** El tipo como lo escribiría el usuario (`int unsigned`, `decimal(30,10)`, `varchar(50)`). */
function tipoMotorMysql(campo) {
  const t = nombreTipo(campo)
  const unsigned = (Number(campo.flags) || 0) & FLAG_UNSIGNED ? ' unsigned' : ''
  if (ENTEROS.has(t)) return (t === 'TINY' && Number(campo.columnLength) === 1 ? 'tinyint(1)' : ENTEROS.get(t)) + unsigned
  const escrito = TIPOS_ESCRITOS.get(t)
  if (escrito) return escrito(campo, unsigned)
  if (FECHAS.has(t)) return tipoFecha(campo, t)
  if (CADENAS.has(t)) return tipoCadena(campo, t)
  return t.toLowerCase()
}

/** El tipo LÓGICO (`DbTipoLogico`) de una columna. */
function tipoLogicoMysql(campo) {
  const t = nombreTipo(campo)
  if (NUMERICOS.has(t) || t === 'BIT') return 'numero'
  if (t === 'DATE' || t === 'NEWDATE') return 'fecha'
  if (t.startsWith('DATETIME') || t.startsWith('TIMESTAMP')) return 'fechaHora'
  if (t === 'JSON') return 'json'
  if (t === 'VECTOR') return 'binario'
  if (t === 'GEOMETRY') return 'otro'
  if (CADENAS.has(t)) return esBinario(campo) ? 'binario' : 'texto'
  return 'texto'
}

/** Los campos de un resultado de mysql2 como `DbColumnaResultado`. */
function columnasMysql(campos) {
  return (campos || []).map((c) => ({
    nombre: String(c.name === undefined || c.name === null ? '' : c.name),
    tipoLogico: tipoLogicoMysql(c),
    tipoMotor: tipoMotorMysql(c),
    nullable: ((Number(c.flags) || 0) & FLAG_NO_NULL) === 0
  }))
}

// --- Celdas -----------------------------------------------------------------------------------

/** Un BIT como número sin signo (en texto): `b'10100101'` es `165`. */
function numeroDeBits(b) {
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  return n.toString()
}

/** Una celda (ya pasada por `typeCast`) como `DbCelda` con su longitud original si se recortó. */
function celdaMysql(v, campo, topes) {
  if (v === null || v === undefined) return { valor: null, original: null }
  if (Buffer.isBuffer(v)) {
    const t = nombreTipo(campo)
    if (t === 'BIT') return { valor: numeroDeBits(v), original: null }
    if (topes.catalogo) return { valor: '0x' + v.toString('hex').toUpperCase(), original: null }
    return hexCorto(v, topes.topeBinario)
  }
  const texto = typeof v === 'string' ? v : String(v)
  return topes.catalogo ? { valor: texto, original: null } : recortarTexto(texto, topes.topeCelda)
}

/** Una fila (`rowsAsArray`) como `{celdas, recortes}`. */
function filaMysql(fila, campos, topes) {
  const out = new Array(campos.length)
  let recortes = null
  for (let c = 0; c < campos.length; c++) {
    const r = celdaMysql(fila[c], campos[c], topes)
    out[c] = r.valor
    if (r.original !== null && r.original !== undefined) {
      if (!recortes) recortes = []
      recortes.push([c, r.original])
    }
  }
  return { celdas: out, recortes }
}

module.exports = { typeCast, columnasMysql, tipoMotorMysql, tipoLogicoMysql, celdaMysql, filaMysql, wktDe, numeroDeBits }
