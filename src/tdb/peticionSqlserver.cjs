// =============================================================================
// Mandar una petición a SQL Server desde `tdb` y recoger lo que devuelve: los conjuntos de
// resultados, las filas afectadas, la salida del servidor y el error, más los valores tal como
// los lee un agente en JSON y los errores como `Error` de `tdb`. Pieza de `sqlserver.cjs`.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-solo-lectura.md
// =============================================================================

'use strict'

const comun = require('./sqlserverComun.cjs')
const celdas = require('./celdas.cjs')

/** Tope de espera por petición (un lote, una consulta del catálogo), como `postgres.cjs`. */
const TOPE_PETICION_MS = 60_000
/** Bytes de un binario que se escriben en hex; por encima, solo su tamaño (como SQLite). */
const TOPE_BINARIO_BYTES = 32 * 1024

// --- Valores --------------------------------------------------------------------------------

function bigintTdb(v) {
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
}

/** ¿Es una columna bigint (que el parche de valores exactos deja en texto)? */
function esBigInt(meta) {
  const tipo = meta && meta.type ? meta.type.name : ''
  return tipo === 'BigInt' || (tipo === 'IntN' && meta.dataLength === 8)
}

function binarioTdb(v) {
  const buf = Buffer.isBuffer(v) ? v : Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  if (buf.length > TOPE_BINARIO_BYTES) return `<binario ${buf.length} bytes>`
  return celdas.hexCorto(buf, 0).valor
}

/**
 * Un valor de tedious como lo recibe el agente en JSON: tinyint/smallint/int/real/float como
 * número; bigint como número si es seguro (±2^53) y si no como texto; decimal, numeric y money
 * como TEXTO EXACTO (el parche de `sqlserverComun`); bit como booleano; binario `0x…` hasta
 * 32 KiB (más, su tamaño).
 */
function valorTdb(v, meta) {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v)
  if (typeof v === 'bigint') return bigintTdb(v)
  if (typeof v === 'string' && esBigInt(meta)) {
    const n = Number(v)
    return /^-?\d+$/.test(v) && Number.isSafeInteger(n) ? n : v
  }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return binarioTdb(v)
  if (v instanceof Date) return comun.celdaSqlServer(v, meta, { catalogo: true }).valor
  return typeof v === 'string' ? v : String(v)
}

/** Nombres de columna sin repetidos (el segundo `id` es `id_2`) y sin vacíos («(sin nombre)»). */
function nombresUnicos(nombres) {
  const usados = new Set()
  return nombres.map((original) => {
    const n = original === '' || original === null || original === undefined ? '(sin nombre)' : String(original)
    let nombre = n
    for (let i = 2; usados.has(nombre); i++) nombre = `${n}_${i}`
    usados.add(nombre)
    return nombre
  })
}

// --- Errores ----------------------------------------------------------------------------------

/** Una línea de «Error N (línea L): …» de un error de tedious ya normalizado. */
function textoDeError(e, desplazarLinea) {
  if (typeof e.codigo === 'string' && e.codigo.startsWith('TESSERA-')) return e.mensaje
  if (e.clase === 'timeout') return `La petición pasó de ${TOPE_PETICION_MS / 1000} s y tdb la canceló (${e.mensaje}).`
  const partes = []
  if (e.codigo && /^\d+$/.test(e.codigo)) partes.push(`Error ${e.codigo}`)
  if (typeof e.linea === 'number') partes.push(`línea ${e.linea + (desplazarLinea || 0)}`)
  if (e.objeto) partes.push(`en ${e.objeto}`)
  const cab = partes.length > 0 ? `${partes.join(', ')}: ` : ''
  return cab + e.mensaje + (e.detalle ? `\n    ${e.detalle.split('\n').join('\n    ')}` : '')
}

/** Un error de tedious como `Error` de `tdb` (con `codigo`), con el servidor en los de conexión. */
function errorTdb(err, con, desplazarLinea) {
  const e = comun.normalizarError(err, con)
  const salida = new Error(textoDeError(e, desplazarLinea))
  if (e.codigo) salida.codigo = e.codigo
  salida.clase = e.clase
  return salida
}

// --- Ejecutar -----------------------------------------------------------------------------------

/**
 * Los manejadores de eventos de UNA petición: arma en `r` los conjuntos (`columnMetadata` y
 * `row`, con el tope `o.limite`, que CANCELA), las filas afectadas y la salida del servidor, y
 * cuenta las sentencias que terminaron DESPUÉS del primer error. El comando del último DONE
 * lo lee de `req.__tesseraCurCmd` (ver `instalarComandoDone`); `ponerPeticion` le da `req`.
 */
function recolector(tds, r, o) {
  let req = null
  let actual = null
  let huboError = false
  // El DONE que llega justo detrás de un error es el de la sentencia que falló: no cuenta como
  // «terminó después del error».
  let doneDelError = false
  return {
    /** La petición, que se crea DESPUÉS del recolector (su callback usa los manejadores). */
    ponerPeticion(peticion) {
      req = peticion
    },
    alInfo(info) {
      const l = comun.lineaDeInfo(info)
      if (l) r.salida.push(l.texto)
    },
    alErrorMsg() {
      huboError = true
      doneDelError = true
    },
    alColumnas(metas) {
      const lista = Array.isArray(metas) ? metas : Object.values(metas || {})
      actual = { metas: lista, columnas: nombresUnicos(lista.map((m) => m.colName)), filas: [], recortado: false }
      r.conjuntos.push(actual)
    },
    alFila(cols) {
      if (!actual || r.cancelado) return
      if (o.limite !== undefined && actual.filas.length >= o.limite) {
        actual.recortado = true
        r.cancelado = true
        tds.cancel()
        return
      }
      const fila = {}
      for (let i = 0; i < actual.columnas.length; i++) {
        const col = cols[i]
        fila[actual.columnas[i]] = valorTdb(col ? col.value : null, col ? col.metadata : actual.metas[i])
      }
      actual.filas.push(fila)
    },
    alTerminar(rowCount) {
      const deLaQueFallo = doneDelError
      doneDelError = false
      if (actual) {
        actual = null
        if (huboError && !deLaQueFallo) r.trasError++
      } else if (rowCount !== undefined && rowCount !== null && comun.esCuentaDeEscritura(req.__tesseraCurCmd)) {
        // La asignación de una variable (`DECLARE @x int = 5`, `SET @x = 3`) llega como un
        // SELECT de 1 fila sin columnas (curCmd 193): no es una fila afectada.
        r.afectadas.push(Number(rowCount))
        if (huboError && !deLaQueFallo) r.trasError++
      }
    }
  }
}

/**
 * Manda UNA petición y recoge lo que devuelve. `o`: { lote (execSqlBatch; si no, execSql con
 * `parametros` [{nombre, tipo, valor}]), limite (filas por conjunto; al pasarlo, CANCELA) }.
 * Resuelve SIEMPRE (nunca rechaza): `{ conjuntos: [{columnas, filas, recortado}], afectadas,
 * salida, error, cancelado, trasError }`. `trasError` cuenta las sentencias que terminaron
 * DESPUÉS del primer error: SQL Server sigue con el lote tras muchos errores.
 */
function ejecutar(tds, sql, o = {}) {
  const tedious = comun.cargarTedious()
  // Una vez por proceso: deja el `curCmd` de cada DONE en la petición.
  comun.instalarComandoDone()
  return new Promise((resolve) => {
    const r = { conjuntos: [], afectadas: [], salida: [], error: null, cancelado: false, trasError: 0 }
    const h = recolector(tds, r, o)
    tds.on('infoMessage', h.alInfo)
    tds.on('errorMessage', h.alErrorMsg)
    const req = new tedious.Request(sql, (err) => {
      tds.removeListener('infoMessage', h.alInfo)
      tds.removeListener('errorMessage', h.alErrorMsg)
      // El ECANCEL de NUESTRO tope no es un error: es el tope (y se avisa).
      if (err && !(r.cancelado && err.code === 'ECANCEL')) r.error = err
      resolve(r)
    })
    h.ponerPeticion(req)
    req.on('columnMetadata', h.alColumnas)
    req.on('row', h.alFila)
    req.on('doneInProc', h.alTerminar)
    req.on('done', h.alTerminar)
    for (const p of o.parametros || []) req.addParameter(p.nombre, p.tipo === 'int' ? tedious.TYPES.Int : tedious.TYPES.NVarChar, p.valor)
    if (o.lote) tds.execSqlBatch(req)
    else tds.execSql(req)
  })
}

/** ¿Sigue abierta una transacción? Si sí, la revierte (ignora el error: cerrar también revierte). */
async function revertirSiAbierta(tds) {
  if (!tds.inTransaction) return false
  await ejecutar(tds, 'IF @@TRANCOUNT>0 ROLLBACK', { lote: true })
  return true
}

module.exports = { TOPE_PETICION_MS, valorTdb, nombresUnicos, textoDeError, errorTdb, ejecutar, revertirSiAbierta }
