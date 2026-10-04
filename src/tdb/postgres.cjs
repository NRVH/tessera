// =============================================================================
// Adaptador PostgreSQL de `tdb`: abre el cliente `pg` (JavaScript puro, empaquetado),
// impone la solo lectura en el servidor y consulta con tope de filas.
// El 4.º parámetro de `abrir` (`opciones`) solo lo pasa `sesionPostgres.cjs`: van al
// constructor del `Client` y `alError` se engancha antes de conectar.
// Lo cargan `tdb.cjs` y `sesionPostgres.cjs` por `MOTORES.postgres` (`motores.cjs`).
// Decisiones: docs/decisiones/bd/adaptador-postgres-arranque-de-sesion.md
// =============================================================================

'use strict'

/** Tope de espera por sentencia, impuesto por el servidor. */
const STATEMENT_TIMEOUT_MS = 60_000

/**
 * `opciones` (solo el explorador): { statement_timeout (0 = sin límite), application_name,
 * keepAlive, keepAliveInitialDelayMillis, alError }.
 */
async function abrir(con, secreto, ctx, opciones) {
  const { Client } = require('pg')
  const explorador = opciones !== undefined && opciones !== null
  const op = opciones || {}
  const config = {
    host: con.host,
    port: con.port,
    database: con.database,
    user: con.user,
    password: secreto,
    // Sale en pg_stat_activity: el DBA ve que es Tessera y quién, no una conexión
    // anónima. Equivalente al module/client_identifier de Oracle.
    application_name:
      explorador && op.application_name ? op.application_name : `Tessera/tdb ${ctx.usuarioWindows}@${con.alias}`,
    connectionTimeoutMillis: 20_000,
    // 0 es válido (sin límite): `pg` no lo envía y rige el del servidor.
    statement_timeout:
      explorador && Number.isInteger(op.statement_timeout) && op.statement_timeout >= 0
        ? op.statement_timeout
        : STATEMENT_TIMEOUT_MS
  }
  if (explorador && op.keepAlive) {
    config.keepAlive = true
    config.keepAliveInitialDelayMillis = Number.isInteger(op.keepAliveInitialDelayMillis)
      ? op.keepAliveInitialDelayMillis
      : 30_000
  }
  const cliente = new Client(config)
  if (explorador && typeof op.alError === 'function') cliente.on('error', op.alError)
  await cliente.connect()

  // Candado de solo lectura del servidor: rechaza INSERT/UPDATE/DELETE/DDL (error 25006).
  if (con.readonly !== false) {
    await cliente.query('SET default_transaction_read_only = on')
    await cliente.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  }

  return {
    conexion: cliente,
    modo: 'nativo',
    driverId: null,
    cerrar: async () => {
      await cliente.end()
    }
  }
}

/**
 * Consulta con tope de filas: envuelve la consulta en `SELECT * FROM (…) LIMIT n` para que
 * el servidor aplique el tope; si no es envolvible (un `SHOW`), la ejecuta pelada y recorta.
 */
async function consultar(cliente, sql, limite) {
  const limpio = sql.replace(/;\s*$/, '')

  // Con `;` en medio (varias sentencias) no se envuelve ni se reintenta: un reintento ciego
  // ejecutaría dos veces una consulta cara.
  const multiSentencia = /;/.test(limpio)
  if (!multiSentencia) {
    try {
      const res = await cliente.query(`SELECT * FROM (${limpio}) AS _tdb LIMIT ${limite}`)
      return { columnas: res.fields.map((f) => f.name), filas: res.rows }
    } catch (err) {
      // El error del envoltorio queda como `cause`: si el intento pelado también falla, se
      // ve el suyo y no uno sobre `_tdb`.
      return directa(cliente, limpio, limite, err)
    }
  }
  return directa(cliente, limpio, limite, null)
}

/**
 * Ejecuta la sentencia tal cual y recorta en cliente; con varias sentencias `pg` devuelve
 * un array de resultados y se toma el último.
 */
async function directa(cliente, sql, limite, errorPrevio) {
  try {
    const res = await cliente.query(sql)
    const uno = Array.isArray(res) ? res[res.length - 1] : res
    if (!uno || !uno.fields) return { columnas: [], filas: [] } // p.ej. un SET: sin filas
    return { columnas: uno.fields.map((f) => f.name), filas: (uno.rows || []).slice(0, limite) }
  } catch (err) {
    if (errorPrevio) err.cause = errorPrevio
    throw err
  }
}

async function banner(cliente) {
  const res = await cliente.query('SELECT version() AS v')
  return res.rows[0] ? res.rows[0].v : '(desconocido)'
}

async function tablas(cliente) {
  const res = await cliente.query(
    `SELECT c.relname AS "TABLE_NAME",
            (SELECT COUNT(*) FROM information_schema.columns col
              WHERE col.table_name = c.relname AND col.table_schema = n.nspname) AS "COLUMNAS",
            obj_description(c.oid) AS "COMENTARIO"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY c.relname`
  )
  return res.rows
}

async function columnas(cliente, tabla) {
  const res = await cliente.query(
    `SELECT c.column_name          AS "COLUMN_NAME",
            c.data_type            AS "DATA_TYPE",
            c.character_maximum_length AS "DATA_LENGTH",
            c.numeric_precision    AS "DATA_PRECISION",
            c.numeric_scale        AS "DATA_SCALE",
            CASE c.is_nullable WHEN 'YES' THEN 'Y' ELSE 'N' END AS "NULLABLE",
            c.column_default       AS "DATA_DEFAULT",
            col_description(cls.oid, c.ordinal_position) AS "COMENTARIO",
            CASE WHEN pk.column_name IS NOT NULL THEN 'Y' ELSE 'N' END AS "ES_PK"
       FROM information_schema.columns c
       JOIN pg_class cls ON cls.relname = c.table_name
       JOIN pg_namespace n ON n.oid = cls.relnamespace AND n.nspname = c.table_schema
       LEFT JOIN (
            SELECT kcu.column_name
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON kcu.constraint_name = tc.constraint_name
             WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
       ) pk ON pk.column_name = c.column_name
      WHERE c.table_name = $1
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY c.ordinal_position`,
    [tabla]
  )
  return res.rows
}

async function foraneas(cliente, tabla) {
  const res = await cliente.query(
    `SELECT tc.table_name    AS "ORIGEN",
            kcu.column_name  AS "COL_ORIGEN",
            ccu.table_name   AS "DESTINO",
            ccu.column_name  AS "COL_DESTINO",
            tc.constraint_name AS "RESTRICCION"
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ($1::text IS NULL OR tc.table_name = $1)
      ORDER BY tc.table_name`,
    [tabla || null]
  )
  return res.rows
}

async function sesiones(cliente) {
  const res = await cliente.query(
    `SELECT pid AS "SID", usename AS "USERNAME", application_name AS "MODULE",
            state AS "STATUS", TO_CHAR(backend_start, 'YYYY-MM-DD HH24:MI:SS') AS "DESDE"
       FROM pg_stat_activity
      WHERE usename = current_user
      ORDER BY backend_start`
  )
  return res.rows
}

module.exports = { abrir, consultar, banner, tablas, columnas, foraneas, sesiones }
