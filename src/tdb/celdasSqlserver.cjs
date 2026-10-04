// =============================================================================
// Las columnas y celdas de SQL Server: el tipo escrito como en T-SQL con su tamaño
// (`nvarchar(50)`, `decimal(38,12)`), el tipo lógico y las celdas con los topes de `celdas.cjs`.
// Números como texto exacto, bit como booleano, fechas `AAAA-MM-DD hh:mm:ss.fffffff` (y `+hh:mm`
// en datetimeoffset) y binario como `0x…` recortado. Pieza de `sqlserverComun.cjs`.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-conexion-y-exactos.md
// =============================================================================

'use strict'

const { dos, hexCorto, recortarTexto } = require('./celdasComun.cjs')

const MAX = 65535

function largo(meta, porCaracter) {
  const n = meta.dataLength
  if (n === MAX || n === undefined || n === null || n < 0) return 'max'
  return String(porCaracter ? Math.floor(n / 2) : n)
}

/** Los tipos cuyo nombre en T-SQL no depende de los metadatos. */
const TIPOS_FIJOS = new Map([
  ['TinyInt', 'tinyint'],
  ['SmallInt', 'smallint'],
  ['Int', 'int'],
  ['BigInt', 'bigint'],
  ['Bit', 'bit'],
  ['BitN', 'bit'],
  ['Real', 'real'],
  ['Float', 'float'],
  ['Money', 'money'],
  ['SmallMoney', 'smallmoney'],
  ['Text', 'text'],
  ['NText', 'ntext'],
  ['Image', 'image'],
  ['UniqueIdentifier', 'uniqueidentifier'],
  ['Xml', 'xml'],
  ['Date', 'date'],
  ['DateTime', 'datetime'],
  ['SmallDateTime', 'smalldatetime'],
  ['Variant', 'sql_variant']
])

const decimal = (meta) => `decimal(${meta.precision},${meta.scale})`
const numeric = (meta) => `numeric(${meta.precision},${meta.scale})`

/** Los tipos cuyo nombre lleva tamaño, precisión o escala, o depende de la longitud de los datos. */
const TIPOS_CON_METADATOS = new Map([
  ['IntN', (m) => (m.dataLength === 1 ? 'tinyint' : m.dataLength === 2 ? 'smallint' : m.dataLength === 8 ? 'bigint' : 'int')],
  ['FloatN', (m) => (m.dataLength === 4 ? 'real' : 'float')],
  ['MoneyN', (m) => (m.dataLength === 4 ? 'smallmoney' : 'money')],
  ['Decimal', decimal],
  ['DecimalN', decimal],
  ['Numeric', numeric],
  ['NumericN', numeric],
  ['Char', (m) => `char(${largo(m, false)})`],
  ['VarChar', (m) => `varchar(${largo(m, false)})`],
  ['NChar', (m) => `nchar(${largo(m, true)})`],
  ['NVarChar', (m) => `nvarchar(${largo(m, true)})`],
  ['Binary', (m) => `binary(${largo(m, false)})`],
  ['VarBinary', (m) => `varbinary(${largo(m, false)})`],
  ['Time', (m) => `time(${m.scale})`],
  ['DateTime2', (m) => `datetime2(${m.scale})`],
  ['DateTimeOffset', (m) => `datetimeoffset(${m.scale})`],
  ['DateTimeN', (m) => (m.dataLength === 4 ? 'smalldatetime' : 'datetime')],
  ['UDT', (m) => (m.udtInfo && m.udtInfo.typeName ? String(m.udtInfo.typeName) : 'udt')]
])

/** El nombre del tipo en SQL Server tal como se escribiría (`nvarchar(50)`, `decimal(38,12)`…). */
function tipoMotorSqlServer(meta) {
  const t = meta && meta.type ? meta.type.name : ''
  if (TIPOS_FIJOS.has(t)) return TIPOS_FIJOS.get(t)
  const conMetadatos = TIPOS_CON_METADATOS.get(t)
  if (conMetadatos) return conMetadatos(meta)
  return t ? t.toLowerCase() : ''
}

/** El tipo lógico (`DbTipoLogico`) de cada tipo de tedious; el resto es 'otro'. */
const TIPO_LOGICO = new Map([
  ...['TinyInt', 'SmallInt', 'Int', 'BigInt', 'IntN', 'Real', 'Float', 'FloatN', 'Money', 'SmallMoney', 'MoneyN', 'Decimal', 'DecimalN', 'Numeric', 'NumericN'].map((t) => [t, 'numero']),
  ...['Bit', 'BitN'].map((t) => [t, 'booleano']),
  ['Date', 'fecha'],
  ...['DateTime', 'DateTimeN', 'SmallDateTime', 'DateTime2', 'DateTimeOffset'].map((t) => [t, 'fechaHora']),
  ...['Binary', 'VarBinary', 'Image', 'UDT'].map((t) => [t, 'binario']),
  ...['Char', 'VarChar', 'NChar', 'NVarChar', 'Text', 'NText', 'UniqueIdentifier', 'Xml', 'Time'].map((t) => [t, 'texto'])
])

/** El tipo LÓGICO (`DbTipoLogico`) de una columna de SQL Server. */
function tipoLogicoSqlServer(meta) {
  const t = meta && meta.type ? meta.type.name : ''
  return TIPO_LOGICO.get(t) ?? 'otro'
}

/** Las columnas de un conjunto (`columnMetadata` de tedious) como `DbColumnaResultado`. */
function columnasSqlServer(metadatos) {
  return (metadatos || []).map((m) => ({
    nombre: String(m.colName === undefined || m.colName === null ? '' : m.colName),
    tipoLogico: tipoLogicoSqlServer(m),
    tipoMotor: tipoMotorSqlServer(m),
    // Bit 0 de `flags`: la columna admite NULL (TDS COLMETADATA).
    nullable: (Number(m.flags) & 1) === 1
  }))
}

/** Un `Date` de tedious (date, datetime, smalldatetime; `useUTC`) como texto de pared. */
function textoDeDate(d, tipo) {
  if (Number.isNaN(d.getTime())) return null
  const a = String(d.getUTCFullYear()).padStart(4, '0')
  const fecha = `${a}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`
  if (tipo === 'date') return fecha
  const hora = `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}:${dos(d.getUTCSeconds())}`
  if (tipo === 'smalldatetime') return `${fecha} ${hora}`
  return `${fecha} ${hora}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`
}

/**
 * Una celda de SQL Server como `DbCelda` con su longitud original si se recortó (`{valor,
 * original}`, como las de `celdas.cjs`). `topes` de `celdas.topesDe`; en el catálogo no se
 * recorta nada.
 */
function celdaSqlServer(v, meta, topes) {
  if (v === null || v === undefined) return { valor: null, original: null }
  if (typeof v === 'boolean') return { valor: v, original: null }
  if (typeof v === 'number') return { valor: Number.isFinite(v) ? String(v) : null, original: null }
  if (typeof v === 'bigint') return { valor: v.toString(), original: null }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    const b = Buffer.isBuffer(v) ? v : Buffer.from(v.buffer, v.byteOffset, v.byteLength)
    if (topes.catalogo) return { valor: '0x' + b.toString('hex').toUpperCase(), original: null }
    return hexCorto(b, topes.topeBinario)
  }
  if (v instanceof Date) return { valor: textoDeDate(v, tipoMotorSqlServer(meta)), original: null }
  const texto = typeof v === 'string' ? v : String(v)
  return topes.catalogo ? { valor: texto, original: null } : recortarTexto(texto, topes.topeCelda)
}

/** Una fila de tedious (`useColumnNames: false`: `[{value, metadata}]`) como `{celdas, recortes}`. */
function filaSqlServer(columnas, topes) {
  const out = new Array(columnas.length)
  let recortes = null
  for (let c = 0; c < columnas.length; c++) {
    const col = columnas[c]
    const r = celdaSqlServer(col ? col.value : null, col ? col.metadata : null, topes)
    out[c] = r.valor
    if (r.original !== null && r.original !== undefined) {
      if (!recortes) recortes = []
      recortes.push([c, r.original])
    }
  }
  return { celdas: out, recortes }
}

module.exports = { tipoMotorSqlServer, tipoLogicoSqlServer, columnasSqlServer, celdaSqlServer, filaSqlServer }
