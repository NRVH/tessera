// =============================================================================
// Adaptador Oracle de `tdb`: abre la conexión escalando de thin a thick (Instant Client)
// según el error del servidor, impone la solo lectura y ofrece el catálogo.
// `abrir` tiene un 4.º parámetro, `opciones`, que solo pasa `sesionOracle.cjs`: sin él,
// `tdb` fija los globales de oracledb; con él no se toca ninguno.
// La carga del cliente y sus textos viven en `clienteOracle.cjs` y se reexportan aquí.
// Decisiones: docs/decisiones/bd/adaptador-oracle-escalada-y-stop.md
// =============================================================================

'use strict'

const clienteOracle = require('./clienteOracle.cjs')

const { COD_VERSION_NO_SOPORTADA, limiteDeThin, avisoDeSoporte, versionDeNumero, versionDeTexto } = clienteOracle
const { mensajeRequiereCliente, packParaServidor, cargarInstantClient, packCargado } = clienteOracle

/** Tope de espera por sentencia. Una consulta colgada no debe sostener una sesión. */
const CALL_TIMEOUT_MS = 60_000

/** Descriptor de conexión: Easy Connect por servicio, o TNS completo si es por SID. */
function connectString(con) {
  if (con.sid) {
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${con.host})(PORT=${con.port}))(CONNECT_DATA=(SID=${con.sid})))`
  }
  return `${con.host}:${con.port}/${con.database}`
}

/**
 * Tras un error de thin: carga el Instant Client y devuelve su `packId`, o lanza el error
 * original (si no es un límite de thin) o el «falta el cliente» con `requiereDriver`.
 */
function escalarAThick(oracledb, err, con, ctx, explorador) {
  const limite = limiteDeThin(err)
  if (!limite) throw err

  // Solo el error de versión nombra la versión del servidor; en los demás es desconocida.
  const version =
    limite.code === COD_VERSION_NO_SOPORTADA ? versionDeTexto(String(err.message || '')) : null
  const cargado = cargarInstantClient(oracledb, ctx, con.driverId, explorador)
  if (!cargado) {
    const pack = packParaServidor(ctx.packs, version)
    const e = new Error(mensajeRequiereCliente(con.alias, limite, version, pack))
    e.requiereDriver = pack
      ? {
          packId: pack.id,
          versionServidor: version === null ? undefined : String(version),
          motivo: e.message
        }
      : undefined
    throw e
  }
  return cargado.packId
}

/** Quién se conectó, en `v$session`, y el tope de espera por sentencia (0 = sin límite). */
function marcarSesion(conexion, con, ctx, op) {
  try {
    conexion.clientId = `${ctx.usuarioWindows}@${con.alias}`
    conexion.module = op.modulo ? op.modulo : 'Tessera/tdb'
    conexion.action = op.accion ? op.accion : ctx.accion || 'query'
    // 0 es un valor válido (sin límite): se comprueba el tipo, no la verdad.
    conexion.callTimeout =
      Number.isInteger(op.callTimeoutMs) && op.callTimeoutMs >= 0 ? op.callTimeoutMs : CALL_TIMEOUT_MS
  } catch {
    // Metadatos y timeout son un extra; su ausencia no debe impedir trabajar.
  }
}

/** El aviso de soporte del cliente thick cargado para la versión de este servidor, o null. */
function avisoDelCliente(oracledb, conexion, ctx, driverId) {
  if (oracledb.thin || !driverId) return null
  try {
    const pack = ctx.packs.find((p) => p.id === driverId)
    return avisoDeSoporte(pack, versionDeNumero(conexion.oracleServerVersion))
  } catch {
    return null
  }
}

/**
 * Abre una conexión, escalando a thick si la base es anterior a 12.1.
 * Devuelve { conexion, modo, driverId, cerrar }.
 *
 * `opciones` (solo el explorador): { callTimeoutMs, modulo, accion, candadoAlAbrir,
 * atributos }. Sin ella, el comportamiento de `tdb`.
 */
async function abrir(con, secreto, ctx, opciones) {
  const oracledb = require('oracledb')
  const explorador = opciones !== undefined && opciones !== null
  const op = opciones || {}
  if (!explorador) {
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
    // Los CLOB llegan como texto y no como streams: el agente no lidia con Lobs.
    oracledb.fetchAsString = [oracledb.CLOB]
  }

  const credenciales = {
    user: con.user,
    password: secreto,
    connectString: connectString(con)
  }
  // Atributos de conexión del explorador: solo en thin.
  const credencialesThin = op.atributos && oracledb.thin ? { ...credenciales, ...op.atributos } : credenciales

  let driverId = null
  let conexion
  try {
    conexion = await oracledb.getConnection(credencialesThin)
  } catch (err) {
    driverId = escalarAThick(oracledb, err, con, ctx, explorador)
    conexion = await oracledb.getConnection(credenciales)
  }

  marcarSesion(conexion, con, ctx, op)

  // Solo lectura impuesta por el servidor: una transacción read-only rechaza el DML
  // (ORA-01456). No frena un DDL (su COMMIT implícito la termina): eso lo paran las guardas
  // del cliente. El explorador la desactiva (`candadoAlAbrir: false`) y la pone antes de
  // cada sentencia.
  if (op.candadoAlAbrir !== false && con.readonly !== false) {
    await conexion.execute('SET TRANSACTION READ ONLY')
  }

  // Si otra sesión del proceso ya escaló, esta conecta en thick sin escalar: el explorador
  // necesita saber qué pack está en uso.
  if (explorador && driverId === null && !oracledb.thin) driverId = packCargado()

  // Un cliente cuyo soporte de Oracle no llega a esta versión de servidor se AVISA, nunca
  // bloquea: `tdb test` lo enseña y «Probar» lo añade a su mensaje.
  const aviso = avisoDelCliente(oracledb, conexion, ctx, driverId)

  return {
    conexion,
    modo: oracledb.thin ? 'thin' : 'thick',
    driverId,
    ...(aviso ? { aviso } : {}),
    cerrar: async () => {
      try {
        if (con.readonly !== false) await conexion.rollback()
      } catch {
        // Da igual: lo importante es cerrar y no dejar la sesión viva.
      }
      await conexion.close()
    }
  }
}

async function consultar(conexion, sql, limite) {
  const res = await conexion.execute(sql, [], { maxRows: limite })
  return {
    columnas: (res.metaData || []).map((m) => m.name),
    filas: res.rows || []
  }
}

async function banner(conexion) {
  const res = await conexion.execute('SELECT banner FROM v$version WHERE ROWNUM = 1')
  return res.rows && res.rows[0] ? res.rows[0].BANNER : '(desconocido)'
}

/** Tablas del esquema del usuario, con su conteo de columnas y comentario. */
async function tablas(conexion) {
  const res = await conexion.execute(
    `SELECT t.table_name,
            (SELECT COUNT(*) FROM user_tab_columns c WHERE c.table_name = t.table_name) AS columnas,
            (SELECT comments FROM user_tab_comments m WHERE m.table_name = t.table_name) AS comentario
       FROM user_tables t
      ORDER BY t.table_name`
  )
  return res.rows || []
}

/** Columnas de una tabla, con tipo, nulabilidad y si es clave primaria. */
async function columnas(conexion, tabla) {
  const res = await conexion.execute(
    `SELECT c.column_name,
            c.data_type,
            c.data_length,
            c.data_precision,
            c.data_scale,
            c.nullable,
            c.data_default,
            (SELECT comments FROM user_col_comments m
              WHERE m.table_name = c.table_name AND m.column_name = c.column_name) AS comentario,
            CASE WHEN EXISTS (
              SELECT 1 FROM user_constraints k
                JOIN user_cons_columns kc ON kc.constraint_name = k.constraint_name
               WHERE k.table_name = c.table_name AND k.constraint_type = 'P'
                 AND kc.column_name = c.column_name
            ) THEN 'Y' ELSE 'N' END AS es_pk
       FROM user_tab_columns c
      WHERE c.table_name = :t
      ORDER BY c.column_id`,
    { t: tabla }
  )
  return res.rows || []
}

/** Claves foráneas: de qué tabla.columna a qué tabla.columna. */
async function foraneas(conexion, tabla) {
  const binds = tabla ? { t: tabla } : {}
  const filtro = tabla ? 'AND c.table_name = :t' : ''
  const res = await conexion.execute(
    `SELECT c.table_name        AS origen,
            cc.column_name      AS col_origen,
            r.table_name        AS destino,
            rc.column_name      AS col_destino,
            c.constraint_name   AS restriccion
       FROM user_constraints c
       JOIN user_cons_columns cc ON cc.constraint_name = c.constraint_name
       JOIN user_constraints r   ON r.constraint_name  = c.r_constraint_name
       JOIN user_cons_columns rc ON rc.constraint_name = r.constraint_name
                                AND rc.position        = cc.position
      WHERE c.constraint_type = 'R' ${filtro}
      ORDER BY c.table_name, cc.position`,
    binds
  )
  return res.rows || []
}

/** Sesiones abiertas del usuario actual (para comprobar que no dejamos nada colgado). */
async function sesiones(conexion) {
  const res = await conexion.execute(
    `SELECT sid, serial# AS serial, username, module, action, client_identifier, status,
            TO_CHAR(logon_time, 'YYYY-MM-DD HH24:MI:SS') AS desde
       FROM v$session
      WHERE username = USER
      ORDER BY logon_time`
  )
  return res.rows || []
}

module.exports = {
  abrir,
  consultar,
  banner,
  tablas,
  columnas,
  foraneas,
  sesiones,
  versionDeTexto,
  versionDeNumero,
  packParaServidor,
  avisoDeSoporte,
  mensajeRequiereCliente,
  limiteDeThin,
  LIMITES_DE_THIN: clienteOracle.LIMITES_DE_THIN,
  sqlnetDelUsuario: clienteOracle.sqlnetDelUsuario,
  contenidoSqlnetExplorador: clienteOracle.contenidoSqlnetExplorador,
  restaurarClasesThick: clienteOracle.restaurarClasesThick,
  limpiarRutasHost: clienteOracle.limpiarRutasHost,
  // Para las pruebas: la carga del cliente con un `oracledb` de mentira.
  cargarInstantClient
}
