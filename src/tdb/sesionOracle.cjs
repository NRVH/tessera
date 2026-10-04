// =============================================================================
// Sesión Oracle del proceso de sesión del explorador: misma interfaz que los demás trabajadores
// (abrir, ejecutar, leer, cerrarLector, cancelar, tx, autoCommit, cerrar, esPerdida,
// normalizarError), despachada por `sesion.cjs`. Reutiliza `oracle.cjs` con su escalada
// thin -> thick. Sus errores, lectores, binds y DBMS_OUTPUT viven en `*SesionOracle.cjs`.
// Decisiones: docs/decisiones/bd/trabajador-oracle-sesion.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')
const { ahora, ms } = require('./sesionTiempo.cjs')
const { esPerdida, advertenciaOracle, bytesAPuntosDeCodigo, normalizarError, limpiarRutasHost } = require('./erroresSesionOracle.cjs')
const { MAX_LECTORES, soltarLector, leerPagina, saltarFilas, registrarLector, errorLectorDesconocido } = require('./cursorSesionOracle.cjs')
const { prepararBinds, leerSalidasTexto } = require('./bindsSesionOracle.cjs')
const { leerSalida, activarSalida } = require('./salidaSesionOracle.cjs')

/** Los 4 NLS que Tessera fija al abrir (el main rechaza cambiarlos): mismo formato en thin y en thick. */
const SQL_NLS =
  "ALTER SESSION SET NLS_DATE_FORMAT='YYYY-MM-DD HH24:MI:SS' NLS_TIMESTAMP_FORMAT='YYYY-MM-DD HH24:MI:SS.FF6' " +
  "NLS_TIMESTAMP_TZ_FORMAT='YYYY-MM-DD HH24:MI:SS.FF6 TZH:TZM' NLS_NUMERIC_CHARACTERS='.,'"
/**
 * Solo lectura sentencia a sentencia, en UN viaje, con autoCommit apagado (el commit del propio
 * execute cerraría la tx read-only). Sin eso, un COMMIT o un DDL (que confirma implícitamente)
 * escaparía al candado puesto al abrir.
 */
const SQL_CANDADO_RO = 'BEGIN ROLLBACK; SET TRANSACTION READ ONLY; END;'
const SQL_ESQUEMA = "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') FROM dual"

// --- Estado de la transacción --------------------------------------------------------------

/**
 * `connection.transactionInProgress` (thin y thick, sin viaje) y, si no existe o lanza,
 * `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID`. Una tx READ ONLY del candado no tiene cambios que perder.
 */
async function estadoTx(s, exacto) {
  if (s.roActiva) return 'ninguna'
  try {
    const v = s.conexion.transactionInProgress
    if (typeof v === 'boolean') return v ? 'pendiente' : 'ninguna'
  } catch {
    // respaldo abajo
  }
  if (exacto === false) return s.txManual ? 'pendiente' : 'ninguna'
  try {
    const r = await s.conexion.execute('SELECT DBMS_TRANSACTION.LOCAL_TRANSACTION_ID FROM dual', [], {
      outFormat: s.oracledb.OUT_FORMAT_ARRAY
    })
    return r.rows && r.rows[0] && r.rows[0][0] ? 'pendiente' : 'ninguna'
  } catch {
    // Sin forma de saberlo: en Manual se supone que hay algo (no cerrar a ciegas).
    return s.txManual ? 'pendiente' : 'ninguna'
  }
}

// --- Interfaz de motor ---------------------------------------------------------------------

const { textoONulo } = celdas

/**
 * El esquema, el usuario y el JUEGO NACIONAL en el mismo viaje: en thick el tamaño de una
 * NCHAR/NVARCHAR2 llega en bytes, y solo sabiendo que es AL16UTF16 se puede decir en caracteres
 * (`tipoMotorOracle` de celdas.cjs). `NLS_CHARSET_ID` es una función, no una vista: no pide
 * ningún privilegio.
 */
async function leerInfoSesion(s) {
  const info = await s.conexion.execute(
    `SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA'), USER, NLS_CHARSET_NAME(NLS_CHARSET_ID('NCHAR_CS')) FROM dual`,
    [],
    { outFormat: s.oracledb.OUT_FORMAT_ARRAY }
  )
  return (info.rows && info.rows[0]) || []
}

/** `v$version` puede estar vetada; esta propiedad no cuesta un viaje. */
function versionDelServidor(s) {
  try {
    return String(s.conexion.oracleServerVersionString || '')
  } catch {
    return ''
  }
}

/**
 * Abre una sesión. `opciones`: { rol, timeoutMs, autoCommit, accion }.
 * `ganchos` no se usa en Oracle: el driver no avisa de una sesión muerta mientras
 * está ociosa; la pérdida se descubre en la siguiente llamada (`esPerdida`).
 */
async function abrir(con, secreto, ctx, opciones, ganchos) {
  const oracle = require('./oracle.cjs')
  const oracledb = require('oracledb')
  // Antes de la primera lectura: el gancho que conserva los bytes de las fechas.
  celdas.parchearFechasThin()
  const op = opciones || {}
  const r = await oracle.abrir(con, secreto, ctx, {
    callTimeoutMs: Number.isInteger(op.timeoutMs) && op.timeoutMs > 0 ? op.timeoutMs : 0,
    modulo: 'Tessera/explorador',
    accion: op.accion || op.rol || 'explorador',
    candadoAlAbrir: false,
    atributos: { expireTime: 2 }
  })
  const s = {
    motor: 'oracle',
    oracledb,
    conexion: r.conexion,
    txManual: op.autoCommit === false,
    lectores: new Map(),
    siguienteLector: 1,
    enCursoUsuario: false,
    cancelPedido: false,
    roActiva: false,
    cerrando: false,
    salidaActiva: false,
    /** El juego de caracteres NACIONAL de la base ('AL16UTF16'), o null (ver `contextoTipos`). */
    juegoNacional: null,
    ganchos: ganchos || {}
  }
  try {
    await s.conexion.execute(SQL_NLS)
    // Solo las consolas: `meta` y `datos` no ejecutan PL/SQL del usuario.
    if (op.rol === 'consola') s.salidaActiva = await activarSalida(s)
    const fila = await leerInfoSesion(s)
    s.juegoNacional = typeof fila[2] === 'string' && fila[2] !== '' ? fila[2] : null
    return {
      sesion: s,
      respuesta: {
        modo: r.modo,
        driverId: r.driverId,
        version: versionDelServidor(s),
        esquema: textoONulo(fila[0]),
        usuario: textoONulo(fila[1])
      }
    }
  } catch (err) {
    await cerrar(s)
    throw err
  }
}

/**
 * Lo que `celdas.columnasOracle` necesita para leer el tamaño de un texto (ver
 * `tipoMotorOracle`): el modo del driver, que cambia qué quiere decir `byteSize`, y el juego
 * nacional que la sesión leyó al abrir.
 */
function contextoTipos(s) {
  return { thin: s.oracledb.thin === true, juegoNacional: s.juegoNacional }
}

/** Pone el candado de solo lectura; su offset sería del bloque del candado, no del SQL del usuario. */
async function ponerCandado(s) {
  try {
    await s.conexion.execute(SQL_CANDADO_RO)
  } catch (err) {
    if (err && typeof err === 'object') err.offset = 0
    throw err
  }
}

/** La consulta de usuario: un lector con el cursor vivo, `saltarFilas` descartadas y la primera página. */
async function resultadoDeCursor(s, res, op, topes, msEjecucion) {
  const lector = {
    id: op.lector || `l${s.siguienteLector++}`,
    rs: res.resultSet,
    pendiente: [],
    agotado: false,
    topes,
    quitarUltima: op.quitarUltimaColumna === true
  }
  try {
    const saltar = Number.isInteger(op.saltarFilas) && op.saltarFilas > 0 ? op.saltarFilas : 0
    const saltadas = saltar > 0 ? await saltarFilas(lector, saltar) : 0
    const t1 = ahora()
    const pagina = await leerPagina(lector, op.maxFilas)
    let columnas = celdas.columnasOracle(res.metaData, contextoTipos(s))
    if (lector.quitarUltima) columnas = columnas.slice(0, -1)
    const resultado = {
      tipo: 'filas',
      columnas,
      filasJson: pagina.filasJson,
      nFilas: pagina.nFilas,
      hayMas: pagina.hayMas,
      lector: null,
      comando: null,
      msEjecucion,
      msLectura: ms(t1)
    }
    if (pagina.recortes) resultado.recortes = pagina.recortes
    if (saltar) resultado.saltadas = saltadas
    if (pagina.hayMas) {
      resultado.lector = lector.id
      const expulsados = registrarLector(s, lector)
      if (expulsados.length) resultado.lectoresExpulsados = expulsados
    } else {
      soltarLector(lector)
    }
    return resultado
  } catch (err) {
    soltarLector(lector)
    throw err
  }
}

/** Catálogo: filas ya materializadas (`maxRows` = maxFilas + 1). */
async function resultadoDeCatalogo(s, res, op, topes, msEjecucion) {
  const t1 = ahora()
  const acc = new celdas.AcumuladorPagina(topes.topeRespuesta)
  const tope = Math.min(res.rows.length, op.maxFilas)
  let cortada = false
  for (let i = 0; i < tope; i++) {
    const f = await celdas.filaOracle(res.rows[i], topes)
    if (!acc.agregar(f.celdas, f.recortes)) {
      cortada = true
      break
    }
  }
  return {
    tipo: 'filas',
    columnas: celdas.columnasOracle(res.metaData, contextoTipos(s)),
    filasJson: acc.json(),
    nFilas: acc.n,
    hayMas: cortada || res.rows.length > op.maxFilas,
    lector: null,
    comando: null,
    msEjecucion,
    msLectura: ms(t1)
  }
}

/**
 * Sin filas: DML (`afectadas`) o `hecho`. Thin pone rowsAffected (0) también a un DDL, así que
 * solo cuenta si el main dice que es DML; sin esa pista, solo si hubo filas.
 */
function resultadoDeComando(res, op, msEjecucion) {
  const n = typeof res.rowsAffected === 'number' ? res.rowsAffected : null
  const esDml = typeof op.esDml === 'boolean' ? op.esDml : n !== null && n > 0
  const resultado =
    esDml && n !== null
      ? { tipo: 'afectadas', filas: n, comando: null, ms: msEjecucion }
      : { tipo: 'hecho', comando: null, ms: msEjecucion }
  if (res.warning) resultado.advertencia = advertenciaOracle(res.warning)
  return resultado
}

/** Ejecuta la sentencia y lee su resultado según lo que devolvió el driver (cursor, filas o nada). */
async function ejecutarSentencia(s, sql, preparados, op, c) {
  const oracledb = s.oracledb
  const tamano = Math.min(Math.max(op.maxFilas + 1, 2), 1000)
  const res = await s.conexion.execute(sql, preparados.binds, {
    outFormat: oracledb.OUT_FORMAT_ARRAY,
    fetchTypeHandler: celdas.manejadorFetchOracle(oracledb, { thin: oracledb.thin, proposito: op.proposito }),
    resultSet: c.usuario,
    autoCommit: c.candado ? false : !c.manual,
    fetchArraySize: tamano,
    prefetchRows: tamano,
    ...(c.usuario ? {} : { maxRows: op.maxFilas + 1 })
  })
  const msEjecucion = ms(c.t0)
  if (res.resultSet) return resultadoDeCursor(s, res, op, c.topes, msEjecucion)
  if (res.rows) return resultadoDeCatalogo(s, res, op, c.topes, msEjecucion)
  const resultado = resultadoDeComando(res, op, msEjecucion)
  if (preparados.salidas) resultado.salidas = await leerSalidasTexto(res, preparados.salidas)
  return resultado
}

/** La salida del servidor se lee también tras un error o un Stop: lo que el bloque escribió antes de fallar explica el fallo. */
async function adjuntarSalida(s, fallo, resultado) {
  const salida = await leerSalida(s)
  if (!salida) return
  if (fallo && typeof fallo === 'object') fallo.__salida = salida
  else if (resultado) resultado.salida = salida
}

/** Lo que se hace tras una ejecución buena: reaplicar los formatos, leer el esquema y el estado de la tx. */
async function terminarEjecucion(s, op, resultado) {
  if (op.refijarFormatos) {
    try {
      await s.conexion.execute(SQL_NLS)
    } catch {
      // segunda capa: el main ya rechaza cambiar estos formatos
    }
  }
  if (op.leerEsquema) {
    try {
      const r = await s.conexion.execute(SQL_ESQUEMA, [], { outFormat: s.oracledb.OUT_FORMAT_ARRAY })
      resultado.esquema = r.rows && r.rows[0] ? textoONulo(r.rows[0][0]) : null
    } catch {
      resultado.esquema = null
    }
  }
  resultado.tx = await estadoTx(s, op.comprobarTx !== false)
}

/** Ejecuta UNA sentencia (ver `OpcionesEjecucion` en protocoloTrabajador.ts). */
async function ejecutar(s, sql, binds, opciones) {
  const op = opciones || {}
  const usuario = op.proposito !== 'catalogo'
  const candado = op.candadoRO === true
  const topes = celdas.topesDe(op)
  const manual = typeof op.txManual === 'boolean' ? op.txManual : s.txManual
  const preparados = prepararBinds(s.oracledb, binds)

  if (candado) {
    await ponerCandado(s)
    s.roActiva = true
  } else {
    s.roActiva = false
  }

  const c = { topes, usuario, candado, manual, t0: ahora() }
  let resultado
  let fallo = null
  s.cancelPedido = false
  s.enCursoUsuario = usuario
  try {
    resultado = await ejecutarSentencia(s, sql, preparados, op, c)
  } catch (err) {
    if (err && typeof err === 'object') err.__cancelPedido = s.cancelPedido
    fallo = err
  } finally {
    s.enCursoUsuario = false
  }

  // Tras una pérdida no hay sesión de la que leer.
  if (op.salidaServidor && !(fallo && esPerdida(fallo))) await adjuntarSalida(s, fallo, resultado)
  if (fallo) throw fallo
  await terminarEjecucion(s, op, resultado)
  return resultado
}

/** Siguiente página de un cursor vivo. Un fallo (o Stop) deja el lector cerrado. */
async function leer(s, id, maxFilas) {
  const l = s.lectores.get(id)
  if (!l) throw errorLectorDesconocido(id)
  // LRU: el recién usado pasa al final.
  s.lectores.delete(id)
  s.lectores.set(id, l)
  const t0 = ahora()
  s.cancelPedido = false
  s.enCursoUsuario = true
  try {
    const pagina = await leerPagina(l, maxFilas)
    if (!pagina.hayMas) {
      s.lectores.delete(id)
      soltarLector(l)
    }
    const r = {
      filasJson: pagina.filasJson,
      nFilas: pagina.nFilas,
      hayMas: pagina.hayMas,
      lector: pagina.hayMas ? id : null,
      ms: ms(t0)
    }
    if (pagina.recortes) r.recortes = pagina.recortes
    return r
  } catch (err) {
    s.lectores.delete(id)
    soltarLector(l)
    if (err && typeof err === 'object') err.__cancelPedido = s.cancelPedido
    throw err
  } finally {
    s.enCursoUsuario = false
  }
}

async function cerrarLector(s, id) {
  const l = s.lectores.get(id)
  if (!l) return { cerrado: false }
  s.lectores.delete(id)
  soltarLector(l)
  return { cerrado: true }
}

/** Stop = `connection.break()` -> ORA-01013, solo con una sentencia de USUARIO en curso. */
async function cancelar(s) {
  if (!s.enCursoUsuario || s.cerrando) return { cancelada: false }
  s.cancelPedido = true
  try {
    await s.conexion.break()
  } catch {
    // Si ya había terminado, no hay nada que interrumpir.
  }
  return { cancelada: true }
}

async function tx(s, accion) {
  if (accion === 'estado') return { tx: await estadoTx(s, true) }
  if (accion === 'commit') await s.conexion.commit()
  else await s.conexion.rollback()
  s.roActiva = false
  return { tx: await estadoTx(s, true) }
}

async function autoCommit(s, valor) {
  s.txManual = !valor
  return { autoCommit: Boolean(valor), tx: await estadoTx(s, true) }
}

/** Rollback + close. Nunca lanza. */
async function cerrar(s) {
  if (!s || s.cerrando) return
  s.cerrando = true
  for (const l of s.lectores.values()) soltarLector(l)
  s.lectores.clear()
  try {
    await s.conexion.rollback()
  } catch {
    // el servidor revierte igualmente al cerrar la sesión
  }
  try {
    await s.conexion.close()
  } catch {
    // sesión ya perdida
  }
}

module.exports = {
  abrir,
  ejecutar,
  leer,
  cerrarLector,
  cancelar,
  tx,
  autoCommit,
  cerrar,
  esPerdida,
  normalizarError,
  advertenciaOracle,
  limpiarRutasHost,
  bytesAPuntosDeCodigo,
  prepararBinds,
  SQL_NLS,
  SQL_CANDADO_RO,
  MAX_LECTORES
}
