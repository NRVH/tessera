// =============================================================================
// Celdas de Oracle del proceso de sesión: el `fetchTypeHandler` (números como texto exacto,
// fechas según thin o thick, LOB como locator), el tipo de cada columna y la celda con su
// lectura parcial de LOB. Pieza de `celdas.cjs`. `oracledb` entra como PARÁMETRO: sin drivers
// en la cadena de carga, `test-celdas-trabajador.mts` lo prueba sin base de datos.
// Decisiones: docs/decisiones/bd/celdas-valores-exactos-y-topes.md, celdas-tipos-de-columna-oracle.md
// =============================================================================

'use strict'

const { recortarTexto, hexCorto, celdaNativa } = require('./celdasComun.cjs')
const { textoFechaOracle, textoIntervalo } = require('./fechasOracle.cjs')

// --- Números y objetos ----------------------------------------------------------

/** '.5' -> '0.5' y '-.5' -> '-0.5'. El resto, intacto: el texto ya es exacto. */
function numeroOracleATexto(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return String(v)
  const s = String(v)
  if (s.startsWith('.')) return '0' + s
  if (s.startsWith('-.')) return '-0' + s.slice(1)
  return s
}

/** Objeto, JSON nativo o VECTOR -> texto. Nunca lanza. */
function textoObjeto(v) {
  if (v === null || v === undefined) return null
  if (ArrayBuffer.isView(v) && !Buffer.isBuffer(v)) return '[' + Array.from(v).join(',') + ']'
  try {
    const j = JSON.stringify(v)
    return j === undefined ? String(v) : j
  } catch {
    return String(v)
  }
}

// --- Tipos de Oracle ---------------------------------------------------------------

function claveTipoOracle(meta) {
  return (meta && meta.dbType && meta.dbType.name) || ''
}

const CLASE_FECHA_ORACLE = {
  DB_TYPE_DATE: 'fecha',
  DB_TYPE_TIMESTAMP: 'ts',
  DB_TYPE_TIMESTAMP_TZ: 'tstz',
  DB_TYPE_TIMESTAMP_LTZ: 'tsltz'
}

const LOGICO_ORACLE = {
  DB_TYPE_NUMBER: 'numero',
  DB_TYPE_BINARY_FLOAT: 'numero',
  DB_TYPE_BINARY_DOUBLE: 'numero',
  DB_TYPE_BINARY_INTEGER: 'numero',
  DB_TYPE_DATE: 'fechaHora',
  DB_TYPE_TIMESTAMP: 'fechaHora',
  DB_TYPE_TIMESTAMP_TZ: 'fechaHora',
  DB_TYPE_TIMESTAMP_LTZ: 'fechaHora',
  DB_TYPE_CHAR: 'texto',
  DB_TYPE_NCHAR: 'texto',
  DB_TYPE_VARCHAR: 'texto',
  DB_TYPE_NVARCHAR: 'texto',
  DB_TYPE_LONG: 'texto',
  DB_TYPE_LONG_NVARCHAR: 'texto',
  DB_TYPE_ROWID: 'texto',
  DB_TYPE_UROWID: 'texto',
  DB_TYPE_XMLTYPE: 'texto',
  DB_TYPE_CLOB: 'lob',
  DB_TYPE_NCLOB: 'lob',
  DB_TYPE_BLOB: 'binario',
  DB_TYPE_BFILE: 'binario',
  DB_TYPE_RAW: 'binario',
  DB_TYPE_LONG_RAW: 'binario',
  DB_TYPE_BOOLEAN: 'booleano',
  DB_TYPE_JSON: 'json'
}

function tipoLogicoOracle(meta) {
  return LOGICO_ORACLE[claveTipoOracle(meta)] || 'otro'
}

/**
 * 'TIMESTAMP WITH TIME ZONE' -> 'TIMESTAMP(3) WITH TIME ZONE' (la precisión va tras la palabra
 * TIMESTAMP, como en el catálogo). 0 es una precisión válida; un null o un texto no lo son.
 */
function tipoTimestampOracle(meta, nombre) {
  const p = meta.precision
  if (typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 9 && /^TIMESTAMP\b/.test(nombre)) {
    return nombre.replace(/^TIMESTAMP\b/, `TIMESTAMP(${p})`)
  }
  return nombre
}

/** NUMBER con su precisión y su escala, también si es negativa; FLOAT si la escala es -127. */
function tipoNumberOracle(meta) {
  const p = Number(meta.precision) || 0
  const s = Number(meta.scale)
  if (p > 0 && s === -127) return `FLOAT(${p})`
  if (p > 0) return Number.isInteger(s) && s !== 0 ? `NUMBER(${p},${s})` : `NUMBER(${p})`
  return 'NUMBER'
}

/**
 * Los caracteres de una NCHAR/NVARCHAR2 a partir de su `byteSize` (ver `tipoMotorOracle`), o
 * null si no se pueden saber: thin ya da caracteres; thick da bytes, y solo con AL16UTF16 (2
 * bytes por carácter, sin excepción en el juego nacional) se sabe dividir.
 */
function caracteresNacionales(tam, contexto) {
  if (!contexto) return null
  if (contexto.thin === true) return tam
  if (contexto.thin === false && contexto.juegoNacional === 'AL16UTF16' && tam % 2 === 0) return tam / 2
  return null
}

/**
 * El tipo de una columna del RESULTADO: 'NUMBER(10,2)', 'FLOAT(126)', 'NVARCHAR2(20)',
 * 'VARCHAR2', 'TIMESTAMP(6)', 'TIMESTAMP(3) WITH TIME ZONE'… Lo enseñan el tooltip de la
 * cabecera y el visor, y decide qué original compara la rejilla con el ROWID. RAW lleva su
 * tamaño; NCHAR y NVARCHAR2 lo llevan en caracteres si se sabe (`caracteresNacionales`);
 * VARCHAR2 y CHAR van sin tamaño en los dos modos.
 * @param contexto `{ thin, juegoNacional }` de la sesión (`contextoTipos` de `sesionOracle.cjs`);
 *                 sin él no se da tamaño a ningún texto nacional.
 */
function tipoMotorOracle(meta, contexto) {
  const nombre = (meta && meta.dbTypeName) || 'desconocido'
  const clave = claveTipoOracle(meta)
  if (clave === 'DB_TYPE_TIMESTAMP' || clave === 'DB_TYPE_TIMESTAMP_TZ' || clave === 'DB_TYPE_TIMESTAMP_LTZ') {
    return tipoTimestampOracle(meta, nombre)
  }
  if (clave === 'DB_TYPE_NUMBER') return tipoNumberOracle(meta)
  const tam = meta ? Number(meta.byteSize) : NaN
  if (!Number.isInteger(tam) || tam <= 0) return nombre
  if (clave === 'DB_TYPE_RAW') return `${nombre}(${tam})`
  if (clave === 'DB_TYPE_NVARCHAR' || clave === 'DB_TYPE_NCHAR') {
    const n = caracteresNacionales(tam, contexto)
    return n === null ? nombre : `${nombre}(${n})`
  }
  return nombre
}

/**
 * Las columnas de un resultado de Oracle. `contexto` es el de `tipoMotorOracle`: el modo del
 * driver y el juego nacional de la sesión, sin los que un tamaño de texto no se sabe leer.
 */
function columnasOracle(metaData, contexto) {
  return (metaData || []).map((m) => {
    const col = { nombre: String(m.name), tipoLogico: tipoLogicoOracle(m), tipoMotor: tipoMotorOracle(m, contexto) }
    if (typeof m.nullable === 'boolean') col.nullable = m.nullable
    return col
  })
}

// --- El fetchTypeHandler --------------------------------------------------------

/**
 * Un manejador por tipo: `(oracledb, { catalogo, thin })` -> lo que pide al driver. En
 * `catalogo` los números salen como Number de JS y los CLOB enteros (es SQL de Tessera y sus
 * mapeadores quieren valores nativos). Los LOB piden su locator de forma EXPLÍCITA: con
 * `undefined`, oracledb caería al mapa global y, con `fetchAsString`, leería el LOB entero.
 */
const MANEJADORES_FETCH = new Map([
  ['DB_TYPE_NUMBER', (o, { catalogo }) => (catalogo ? undefined : { type: o.DB_TYPE_VARCHAR, converter: numeroOracleATexto })],
  ['DB_TYPE_BINARY_FLOAT', (o, { catalogo }) => (catalogo ? undefined : { type: o.DB_TYPE_VARCHAR })],
  ['DB_TYPE_BINARY_DOUBLE', (o, { catalogo }) => (catalogo ? undefined : { type: o.DB_TYPE_VARCHAR })],
  ['DB_TYPE_INTERVAL_YM', () => ({ converter: textoIntervalo })],
  ['DB_TYPE_INTERVAL_DS', () => ({ converter: textoIntervalo })],
  ['DB_TYPE_ROWID', (o) => ({ type: o.DB_TYPE_VARCHAR })],
  ['DB_TYPE_UROWID', (o) => ({ type: o.DB_TYPE_VARCHAR })],
  ['DB_TYPE_CLOB', (o, { catalogo }) => (catalogo ? { type: o.DB_TYPE_VARCHAR } : { type: o.DB_TYPE_CLOB })],
  ['DB_TYPE_NCLOB', (o, { catalogo }) => (catalogo ? { type: o.DB_TYPE_VARCHAR } : { type: o.DB_TYPE_NCLOB })],
  // En catálogo no hay lectura parcial: un locator se serializaría como objeto.
  ['DB_TYPE_BLOB', (o, { catalogo }) => (catalogo ? { type: o.DB_TYPE_RAW } : { type: o.DB_TYPE_BLOB })],
  ['DB_TYPE_BFILE', (o) => ({ type: o.DB_TYPE_BFILE })],
  ['DB_TYPE_JSON', () => ({ converter: textoObjeto })],
  ['DB_TYPE_OBJECT', () => ({ converter: textoObjeto })]
])

/** Las fechas: en thick las formatea el cliente con el NLS fijado al abrir; en thin, desde los bytes. */
function manejadorFecha(clave) {
  const clase = CLASE_FECHA_ORACLE[clave]
  return (o, { thin }) => (thin ? { converter: (v) => textoFechaOracle(v, clase) } : { type: o.DB_TYPE_VARCHAR })
}
for (const clave of Object.keys(CLASE_FECHA_ORACLE)) MANEJADORES_FETCH.set(clave, manejadorFecha(clave))

/**
 * `fetchTypeHandler` de Oracle para una ejecución. `oracledb` entra como parámetro (el módulo
 * real, o uno falso en el test); `thin` decide cómo salen las fechas. Los tipos sin manejador
 * (XMLTYPE, VECTOR, CURSOR…) van al valor: thin ya convierte XMLTYPE con un conversor asíncrono
 * y encadenar otro le pasaría una promesa.
 */
function manejadorFetchOracle(oracledb, { thin, proposito } = {}) {
  const ajustes = { thin, catalogo: proposito === 'catalogo' }
  return function manejador(meta) {
    const f = MANEJADORES_FETCH.get(claveTipoOracle(meta))
    return f ? f(oracledb, ajustes) : undefined
  }
}

// --- LOB y celdas ----------------------------------------------------------------

/** ¿Es un LOB de oracledb (locator)? Sin `instanceof`, para no cargar el driver. */
function esLob(v) {
  return Boolean(v) && typeof v === 'object' && typeof v.getData === 'function' && 'type' in v
}

/** ¿Es un ResultSet anidado (columna CURSOR)? */
function esCursorAnidado(v) {
  return Boolean(v) && typeof v === 'object' && typeof v.getRows === 'function' && typeof v.close === 'function'
}

/** Libera un LOB sin esperar ni lanzar. */
function soltarLob(v) {
  try {
    if (typeof v.destroy === 'function') v.destroy()
    else if (typeof v.close === 'function') v.close().catch(() => {})
  } catch {
    // nada: liberar es un extra
  }
}

/** Suelta los LOB y cursores anidados de filas que no se van a enviar. */
function soltarFilas(filas) {
  for (const fila of filas || []) {
    for (const v of fila || []) {
      if (esLob(v)) soltarLob(v)
      else if (esCursorAnidado(v)) v.close().catch(() => {})
    }
  }
}

/** La longitud total de un LOB, o 0 si no se sabe leer. */
function longitudLob(lob) {
  try {
    return Number(lob.length) || 0
  } catch {
    return 0
  }
}

/** Cómo se describe un BFILE, que no se lee: `BFILENAME('dir', 'archivo')`. */
function descripcionBfile(lob) {
  try {
    const f = lob.getDirFileName()
    return `BFILENAME('${f.dirName}', '${f.fileName}')`
  } catch {
    return 'BFILE'
  }
}

/**
 * Lee el principio de un LOB: 64 KiB (unidades UTF-16 en CLOB, bytes en BLOB) más
 * su longitud total. BFILE no se lee: se describe.
 */
async function leerLob(lob, topes) {
  try {
    const total = longitudLob(lob)
    const binario = lob.type && lob.type.name === 'DB_TYPE_BLOB'
    const bfile = lob.type && lob.type.name === 'DB_TYPE_BFILE'
    if (bfile) return { valor: descripcionBfile(lob), original: null }
    if (total === 0) return binario ? { valor: '0x', original: null } : { valor: '', original: null }
    const tope = binario ? topes.topeBinario : topes.topeCelda
    const leer = tope ? Math.min(total, tope) : total
    const datos = await lob.getData(1, leer)
    if (binario) {
      const r = hexCorto(Buffer.isBuffer(datos) ? datos : Buffer.from(datos || []), tope)
      return { valor: r.valor, original: total > leer ? total : r.original }
    }
    const texto = String(datos === null || datos === undefined ? '' : datos)
    const r = recortarTexto(texto, tope)
    return { valor: r.valor, original: total > leer ? total : r.original }
  } finally {
    soltarLob(lob)
  }
}

/**
 * Celda de Oracle ya pasada por el `fetchTypeHandler`. Asíncrona solo por los LOB.
 * Devuelve { valor, original }: `original` no nulo = recortada.
 */
async function celdaOracle(v, topes) {
  if (v === null || v === undefined) return { valor: null, original: null }
  if (typeof v === 'string') return recortarTexto(v, topes.topeCelda)
  if (typeof v === 'boolean') return { valor: v, original: null }
  if (typeof v === 'number') return { valor: String(v), original: null }
  if (typeof v === 'bigint') return { valor: v.toString(), original: null }
  if (Buffer.isBuffer(v)) return hexCorto(v, topes.topeBinario)
  if (v instanceof Date) return { valor: textoFechaOracle(v, 'ts'), original: null }
  if (esLob(v)) return leerLob(v, topes)
  if (esCursorAnidado(v)) {
    v.close().catch(() => {})
    return { valor: '(cursor)', original: null }
  }
  const texto = textoObjeto(v)
  return texto === null ? { valor: null, original: null } : recortarTexto(texto, topes.topeCelda)
}

/** Convierte una fila de Oracle (async por los LOB). */
async function filaOracle(fila, topes) {
  const celdas = new Array(fila.length)
  let recortes = null
  for (let c = 0; c < fila.length; c++) {
    const r = topes.catalogo ? { valor: celdaNativa(fila[c]), original: null } : await celdaOracle(fila[c], topes)
    celdas[c] = r.valor
    if (r.original !== null && r.original !== undefined) {
      if (!recortes) recortes = []
      recortes.push([c, r.original])
    }
  }
  return { celdas, recortes }
}

module.exports = {
  numeroOracleATexto,
  textoObjeto,
  tipoLogicoOracle,
  tipoMotorOracle,
  columnasOracle,
  manejadorFetchOracle,
  esLob,
  soltarFilas,
  leerLob,
  celdaOracle,
  filaOracle
}
