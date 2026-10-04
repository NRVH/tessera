// =============================================================================
// Adaptador SQLite de `tdb`: la interfaz de los demás adaptadores más `indices`.
// Abrir y la guardia (el autorizador de node:sqlite) viven en `sqliteComun.cjs`. La ruta sale
// del registro y no se le enseña al agente; sin secreto (`credenciales: 'ninguna'`).
// Varias sentencias se preparan y guardan una a una y devuelve el resultado de la última.
// Decisiones: docs/decisiones/bd/adaptador-sqlite-guardia-y-sentencias.md
// =============================================================================

'use strict'

const path = require('node:path')
const comun = require('./sqliteComun.cjs')
const celdas = require('./celdas.cjs')

/** Bytes de un BLOB que se escriben en hex; por encima, solo su tamaño. */
const TOPE_BLOB_BYTES = 32 * 1024

// --- Rutas ------------------------------------------------------------------------------

/** El nombre del archivo de una ruta del registro, con el `path` de su FORMA (una de Windows leída en un Mac). */
function nombreDeRuta(ruta) {
  return /^[A-Za-z]:[\\/]|^[\\/]{2}/.test(ruta) ? path.win32.basename(ruta) : path.posix.basename(ruta)
}

/**
 * El error de abrir, dicho para el agente: con el alias y el nombre, sin la ruta, y con el remedio.
 * Los que no llevan ruta (cabecera no válida, journal caliente, permiso, sin autorizador…)
 * pasan tal cual: su texto ya es el de Tessera.
 */
function errorDeApertura(e, con) {
  const codigo = e && typeof e.codigo === 'string' ? e.codigo : ''
  const nombre = nombreDeRuta(con.archivo)
  let mensaje = null
  if (codigo === 'TESSERA-SQLITE-DESCONECTADO') {
    // El desempate (¿falta el archivo o el volumen entero?) lo hace ya `sqliteComun`.
    mensaje =
      `El archivo de "${con.alias}" (${nombre}) está en un disco o unidad que no está conectado (${comun.raizDeVolumen(con.archivo)}).\n` +
      '    Conéctalo y vuelve a intentarlo.'
  } else if (codigo === 'TESSERA-SQLITE-NO-EXISTE') {
    mensaje =
      `No se encuentra el archivo de "${con.alias}" (${nombre}): se movió, se renombró o se borró.\n` +
      '    Pide al usuario que lo vuelva a elegir en Tessera (Editar conexión…).'
  } else if (codigo === 'TESSERA-SQLITE-RUTA-CAMBIADA') {
    mensaje =
      `La ruta del archivo de "${con.alias}" (${nombre}) ya no lleva al mismo sitio: pasa por un enlace.\n` +
      '    Tessera no la abre así. Pide al usuario que vuelva a elegir el archivo en Tessera.'
  }
  if (mensaje === null) return e
  const err = new Error(mensaje)
  err.codigo = codigo
  return err
}

// --- Abrir ------------------------------------------------------------------------------

/**
 * Abre la base de `con.archivo` con la guardia de `sqliteComun` (solo lectura salvo que la
 * conexión diga `readonly: false`). Sin secreto: de la firma común `(con, secreto, ctx)` solo
 * se usa `con`.
 */
async function abrir(con) {
  if (typeof con.archivo !== 'string' || con.archivo === '') {
    throw new Error(`"${con.alias}" no tiene archivo guardado. Pide al usuario que lo elija en Tessera (Editar conexión…).`)
  }
  let c
  try {
    c = comun.abrirSqlite(con.archivo, { soloLectura: con.readonly !== false })
  } catch (e) {
    throw errorDeApertura(e, con)
  }
  return {
    conexion: c,
    // `tdb test` lo pinta entre paréntesis, como el 'nativo'/'thick' de los otros motores.
    modo: c.modo === 'inmutable' ? 'nativo, inmutable' : 'nativo',
    driverId: null,
    cerrar: async () => {
      comun.cerrarSqlite(c)
    }
  }
}

// --- Valores ----------------------------------------------------------------------------

/**
 * Un valor de SQLite como lo recibe el agente: un entero como número si es seguro (±2^53) y
 * si no como texto; un REAL como número (`Inf` como texto); un BLOB en hex hasta 32 KiB.
 */
function valorTdb(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') {
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : comun.textoReal(v)
  if (v instanceof Uint8Array) {
    const buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength)
    if (buf.length > TOPE_BLOB_BYTES) return `<binario ${buf.length} bytes>`
    return celdas.hexCorto(buf, 0).valor
  }
  return v
}

/** Nombres de columna sin repetidos: el segundo `id` es `id_2`, para que no se tapen en el objeto. */
function nombresUnicos(nombres) {
  const usados = new Set()
  return nombres.map((n) => {
    let nombre = n
    for (let i = 2; usados.has(nombre); i++) nombre = `${n}_${i}`
    usados.add(nombre)
    return nombre
  })
}

/** Una fila (array u objeto) como objeto con los nombres únicos. */
function objetoDeFila(nombres, fila) {
  const valores = Array.isArray(fila) ? fila : Object.values(fila)
  const o = {}
  for (let i = 0; i < nombres.length; i++) o[nombres[i]] = valorTdb(valores[i])
  return o
}

// --- Consultar --------------------------------------------------------------------------

// `soloRelleno` (¿solo quedan blancos, comentarios y `;`?) y `empiezaPorExplain` son de
// `sqliteComun`, compartidas con el trabajador.

/** El error de node:sqlite de un texto sin ninguna sentencia («contains no statements»). */
function esSinSentencias(e) {
  return Boolean(e) && e.code === 'ERR_INVALID_ARG_VALUE' && /no statements/i.test(String(e.message))
}

/**
 * Ejecuta UNA sentencia ya preparada (y guardada) y devuelve `{ columnas, filas, lector,
 * afectadas }`. `perfil` es el que se usó al preparar si no es el de la conexión ('explain').
 */
function ejecutarUna(c, p, limite, perfil) {
  if (p.vacuum) {
    comun.conVacuum(c, () => p.stmt.run())
    return { columnas: [], filas: [], lector: false, afectadas: 0 }
  }
  const conSuPerfil = (fn) => (perfil ? comun.conPerfil(c, perfil, fn) : fn())
  if (!p.lector) {
    const r = conSuPerfil(() => p.stmt.run())
    return { columnas: [], filas: [], lector: false, afectadas: Number(r && r.changes !== undefined ? r.changes : 0) }
  }
  return conSuPerfil(() => {
    const columnas = nombresUnicos(p.stmt.columns().map((x) => String(x.name)))
    if (typeof p.stmt.setReturnArrays === 'function') p.stmt.setReturnArrays(true)
    const filas = []
    // `for…of` con `break` cierra el iterador (su `return()`): nunca queda un cursor vivo.
    for (const fila of p.stmt.iterate()) {
      if (filas.length >= limite) break
      filas.push(objetoDeFila(columnas, fila))
    }
    return { columnas, filas, lector: true, afectadas: 0 }
  })
}

/** El error de la sentencia `n`, con lo que pasó con las anteriores (confirmadas o revertidas). */
function errorDeSentencia(e, n, c) {
  if (n <= 1) return e
  const base = e && e.message ? e.message : String(e)
  const anteriores =
    c.soloLectura
      ? ''
      : c.db.isTransaction
        ? `\n    Las ${n - 1} anteriores iban en una transacción abierta y se revierten al cerrar.`
        : `\n    Las ${n - 1} anteriores ya se ejecutaron y quedaron confirmadas.`
  const err = new Error(`Falló la sentencia ${n}: ${base}${anteriores}`)
  if (e && e.codigo) err.codigo = e.codigo
  return err
}

/**
 * Prepara la siguiente sentencia de `resto` (con el perfil 'explain' si es un EXPLAIN en solo
 * lectura); null si no queda ninguna. Un texto sin sentencias no es un error.
 */
function prepararSiguiente(c, resto, n) {
  const perfil = c.soloLectura && comun.empiezaPorExplain(resto) ? 'explain' : undefined
  let p
  try {
    p = comun.prepararUna(c, resto, perfil ? { perfil } : {})
  } catch (e) {
    if (esSinSentencias(e)) return null
    throw errorDeSentencia(e, n, c)
  }
  return p ? { p, perfil } : null
}

/**
 * Revierte lo que el texto dejó abierto y arma los avisos de una consulta de `n` sentencias.
 * Una transacción abierta (BEGIN sin COMMIT) se revierte: `tdb` abre y cierra la base en cada
 * comando y no hay un «después» donde confirmarla.
 */
function avisosDeConsulta(c, n, ultimo) {
  const avisos = []
  if (!c.soloLectura && c.db.isTransaction) {
    try {
      c.db.exec('ROLLBACK')
    } catch {
      // Se cerrará igual, y cerrar también revierte.
    }
    avisos.push('El texto dejó una transacción abierta (BEGIN sin COMMIT) y se revirtió: tdb abre y cierra la base en cada comando.')
  }
  if (n > 1) avisos.push(`Se ejecutaron ${n} sentencias; el resultado es el de la última.`)
  if (!ultimo.lector) avisos.push(`La última sentencia no devuelve filas; cambió ${ultimo.afectadas} fila(s).`)
  return avisos
}

/**
 * Ejecuta `sql` (una o varias sentencias, una a una) y devuelve el resultado de la ÚLTIMA,
 * con el tope de filas, como `{ columnas, filas, avisos? }`.
 */
async function consultar(c, sql, limite) {
  let resto = String(sql)
  let n = 0
  let ultimo = null
  while (!comun.soloRelleno(resto)) {
    n++
    const sig = prepararSiguiente(c, resto, n)
    if (!sig) {
      n--
      break
    }
    try {
      ultimo = ejecutarUna(c, sig.p, limite, sig.perfil)
    } catch (e) {
      throw errorDeSentencia(e, n, c)
    }
    resto = sig.p.cola
  }
  if (n === 0 || ultimo === null) throw new Error('No hay ninguna sentencia que ejecutar.')
  const avisos = avisosDeConsulta(c, n, ultimo)
  return { columnas: ultimo.columnas, filas: ultimo.filas, ...(avisos.length > 0 ? { avisos } : {}) }
}

// --- Catálogo -----------------------------------------------------------------------------

/** Las filas de una consulta INTERNA del catálogo (con la guardia puesta, como todo). */
function filasDe(c, sql, ...params) {
  const stmt = c.db.prepare(sql)
  return stmt.all(...params).map((f) => {
    const o = {}
    for (const k of Object.keys(f)) o[k] = valorTdb(f[k])
    return o
  })
}

async function banner(c) {
  const [f] = filasDe(c, 'SELECT sqlite_version() AS V')
  const partes = [
    `SQLite ${f ? f.V : '(desconocida)'}`,
    c.nombre,
    c.wal ? 'WAL' : 'rollback',
    c.soloLectura ? 'solo lectura (la impone Tessera)' : 'lectura y escritura'
  ]
  if (c.modo === 'inmutable') partes.push('abierta inmutable: no ve lo que otros escriban mientras tanto')
  return partes.join(' · ')
}

/** Tablas, vistas y tablas virtuales de `main` (sin las internas `sqlite_*` ni las shadow). */
async function tablas(c) {
  return filasDe(
    c,
    `SELECT t.name AS TABLE_NAME,
            t.ncol AS COLUMNAS,
            CASE t.type WHEN 'view' THEN 'vista' WHEN 'virtual' THEN 'tabla virtual' ELSE '' END AS COMENTARIO,
            t.type AS TIPO
       FROM pragma_table_list AS t
      WHERE t.schema = 'main'
        AND t.type IN ('table', 'view', 'virtual')
        AND substr(t.name, 1, 7) <> 'sqlite_'
      ORDER BY t.name`
  )
}

/** Columnas de una tabla o vista, con la forma de los otros adaptadores (`tipoLegible` de tdb). */
async function columnas(c, tabla) {
  return filasDe(
    c,
    `SELECT x.name AS COLUMN_NAME,
            x.type AS DATA_TYPE,
            CASE WHEN x."notnull" = 0 THEN 'Y' ELSE 'N' END AS NULLABLE,
            x.dflt_value AS DATA_DEFAULT,
            CASE x.hidden WHEN 1 THEN 'oculta' WHEN 2 THEN 'generada (virtual)' WHEN 3 THEN 'generada (almacenada)' ELSE '' END AS COMENTARIO,
            CASE WHEN x.pk > 0 THEN 'Y' ELSE 'N' END AS ES_PK
       FROM pragma_table_xinfo(?1, 'main') AS x
      ORDER BY x.cid`,
    tabla
  )
}

/** Claves foráneas de `main` (de una tabla, o de todas con `tabla` null), columna a columna. */
async function foraneas(c, tabla) {
  return filasDe(
    c,
    `SELECT t.name AS ORIGEN,
            f."from" AS COL_ORIGEN,
            f."table" AS DESTINO,
            COALESCE(f."to", (SELECT p.name FROM pragma_table_info(f."table", 'main') AS p WHERE p.pk = f.seq + 1)) AS COL_DESTINO,
            f.on_delete AS AL_BORRAR
       FROM pragma_table_list AS t, pragma_foreign_key_list(t.name, 'main') AS f
      WHERE t.schema = 'main'
        AND t.type = 'table'
        AND (?1 IS NULL OR t.name = ?1 COLLATE NOCASE)
      ORDER BY t.name, f.id, f.seq`,
    tabla === undefined ? null : tabla
  )
}

/** Índices de una tabla, con sus columnas en orden (una expresión sale como «(expresión)»). */
async function indices(c, tabla) {
  return filasDe(
    c,
    `SELECT il.name AS INDICE,
            (SELECT group_concat(COALESCE(x.name, '(expresión)') || CASE WHEN x."desc" THEN ' DESC' ELSE '' END, ', ')
               FROM (SELECT * FROM pragma_index_xinfo(il.name, 'main') WHERE key = 1 ORDER BY seqno) AS x) AS COLUMNAS,
            CASE WHEN il."unique" THEN 'sí' ELSE '' END AS UNICO,
            CASE il.origin WHEN 'pk' THEN 'PRIMARY KEY' WHEN 'u' THEN 'UNIQUE' ELSE 'CREATE INDEX' END AS ORIGEN,
            CASE WHEN il.partial THEN 'sí' ELSE '' END AS PARCIAL
       FROM pragma_index_list(?1, 'main') AS il
      ORDER BY il.name`,
    tabla
  )
}

async function sesiones() {
  throw new Error('SQLite no tiene sesiones de servidor: la base es un archivo, y cada comando de tdb lo abre y lo cierra.')
}

module.exports = {
  abrir,
  consultar,
  banner,
  tablas,
  columnas,
  foraneas,
  indices,
  sesiones,
  // Para `test-sqlite-tdb`: viven en `sqliteComun` y se reexportan.
  raizDeVolumen: comun.raizDeVolumen,
  volumenDesconectado: comun.volumenDesconectado,
  nombreDeRuta,
  errorDeApertura,
  valorTdb,
  nombresUnicos,
  soloRelleno: comun.soloRelleno,
  empiezaPorExplain: comun.empiezaPorExplain
}
