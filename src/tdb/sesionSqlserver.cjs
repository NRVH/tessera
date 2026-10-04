// =============================================================================
// Sesión SQL Server del proceso de sesión del explorador: misma interfaz que los demás
// trabajadores, despachada por `sesion.cjs`. Es TONTA: qué candado poner, si toca Manual, si una
// sentencia es una consulta pura o si hay que leer sin esperar lo decide el main y llega en
// `opciones`. La conexión, los errores y las celdas son de `sqlserverComun.cjs` (compartido con
// `tdb`); aquí va lo que es de UNA sesión con su transacción. Peticiones y conjuntos, en `*SesionSqlserver.cjs`.
// Decisiones: docs/decisiones/bd/trabajador-sqlserver-sesion.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')
const comun = require('./sqlserverComun.cjs')
const { TEXTSIZE_MAXIMO, textsizeDe, errorProtocolo, parametrosDe, valorDeBind, interna } = require('./peticionesSesionSqlserver.cjs')
const { leerPeticion, conjuntoAResultado } = require('./conjuntosSesionSqlserver.cjs')

/** Versión mayor mínima (2012). La misma que `versionMinima` del descriptor. */
const VERSION_MINIMA = 11
/** Idioma y formato de fecha que Tessera fija (los de `opcionesConexion`). */
const SQL_FORMATOS = `SET LANGUAGE N'${comun.IDIOMA}'; SET DATEFORMAT ${comun.FORMATO_FECHA}; SET QUOTED_IDENTIFIER ON`

const { instalarComandoDone } = comun

// --- Errores ---------------------------------------------------------------------------

/**
 * Error del driver → `ErrorTrabajador`, con lo que la sesión colgó del error: la salida
 * (`__salida` lo copia `sesion.cjs`), los conjuntos que llegaron antes de fallar
 * (`anteriores`) y la reversión del servidor.
 */
function normalizarError(err) {
  const e = comun.normalizarError(err, err && err.__con)
  if (err && Array.isArray(err.__anteriores) && err.__anteriores.length > 0) e.anteriores = err.__anteriores
  if (err && err.__revertida) e.revertidaPorServidor = err.__revertida
  return e
}

// --- Estado de la transacción --------------------------------------------------------------

/**
 * `connection.inTransaction` (lo mantienen los ENVCHANGE, gratis y exacto). 'pendiente' frente a
 * 'abierta': por la DMV (registros de log) SOLO si la sesión tiene VIEW SERVER STATE, que se mira
 * al abrir sin provocar ningún error: una sonda que FALLARA por permisos, con XACT_ABORT ON,
 * revertiría la transacción del usuario. Sin el permiso se DEDUCE (`txEscribio`). Equivocarse
 * hacia 'pendiente' solo cuesta un diálogo. 'fallida' no existe en SQL Server: una transacción
 * condenada no sobrevive al lote.
 */
async function estadoTx(s, exacto) {
  if (!s.conexion || !s.conexion.inTransaction) {
    s.txEscribio = false
    return 'ninguna'
  }
  if (s.txEscribio) return 'pendiente'
  if (exacto !== false && s.dmv) {
    try {
      const f = await interna(
        s,
        'SELECT CAST(ISNULL(SUM(d.database_transaction_log_record_count), 0) AS bigint)' +
          ' FROM sys.dm_tran_session_transactions t' +
          ' JOIN sys.dm_tran_database_transactions d ON d.transaction_id = t.transaction_id' +
          ' WHERE t.session_id = @@SPID'
      )
      return Number(f[0] && f[0][0]) > 0 ? 'pendiente' : 'abierta'
    } catch {
      s.dmv = false
    }
  }
  return 'abierta'
}

// --- Interfaz de motor ---------------------------------------------------------------------

/**
 * Para qué es la sesión, en el vocabulario de `sqlInicioSesion`: el árbol ('meta'), la consola,
 * una exportación o los datos (la rejilla, «Enviar», el valor de una celda).
 */
function propositoDe(rol, accion) {
  if (rol === 'meta') return 'meta'
  if (rol === 'consola') return 'consola'
  if (accion === 'exportar') return 'exportar'
  return 'datos'
}

const { textoONulo } = celdas

function nuevaSesion(con, tedious, op, ganchos, proposito, textsize) {
  return {
    motor: 'sqlserver',
    con,
    tedious,
    conexion: null,
    peticion: null,
    txManual: op.autoCommit === false,
    implicitas: false,
    textsize,
    aislamiento: proposito === 'meta' ? 'READ UNCOMMITTED' : 'READ COMMITTED',
    base: null,
    dmv: false,
    txEscribio: false,
    enCursoUsuario: false,
    cancelPedido: false,
    cortePropio: false,
    revertida: false,
    escucharReversion: false,
    perdida: false,
    cerrando: false,
    ganchos: ganchos || {}
  }
}

/** La base nueva tras un USE la dice `databaseChange` (en SQL Server el selector de la consola elige la BASE); el servidor avisa de sus reversiones con `rollbackTransaction`. */
function vigilarConexion(s, alPerder) {
  s.conexion.on('end', () => alPerder(Object.assign(new Error('La conexión con SQL Server se cerró.'), { code: 'ESOCKET' })))
  s.conexion.on('error', (err) => alPerder(err))
  s.conexion.on('databaseChange', (nombre) => {
    s.base = textoONulo(nombre)
  })
  s.conexion.on('rollbackTransaction', () => {
    if (s.escucharReversion) s.revertida = true
  })
}

/** Lo de la sesión en el mismo viaje que la versión: base, usuario, si tiene VIEW SERVER STATE (`HAS_PERMS_BY_NAME`, sin provocar error) y el SPID. */
async function leerInfoSesion(s, proposito) {
  const inicio = comun.sqlInicioSesion(proposito)
  const previas = []
  if (inicio) previas.push(inicio)
  if (s.txManual) previas.push('SET IMPLICIT_TRANSACTIONS ON')
  const f = await interna(
    s,
    (previas.length ? previas.join('; ') + '; ' : '') +
      "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)), DB_NAME(), SUSER_SNAME(), " +
      "HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE'), @@SPID"
  )
  if (s.txManual) s.implicitas = true
  return f[0] || []
}

/** Por debajo de la versión mínima (2012) se cierra con un error que lo dice. */
function exigirVersion(version) {
  const mayor = parseInt(version, 10)
  if (Number.isFinite(mayor) && mayor < VERSION_MINIMA) {
    throw comun.errorSqlServer(
      'VERSION',
      `El servidor es SQL Server ${version}: Tessera necesita SQL Server 2012 (versión ${VERSION_MINIMA}) o posterior.`
    )
  }
}

/**
 * Abre una sesión. `opciones`: { rol, timeoutMs, autoCommit, accion }.
 * `ganchos.alPerder(errorTrabajador)`: la sesión murió estando ociosa.
 */
async function abrir(con, secreto, ctx, opciones, ganchos) {
  const op = opciones || {}
  const tedious = comun.cargarTedious()
  instalarComandoDone()
  const accion = op.accion || op.rol || 'explorador'
  const proposito = propositoDe(op.rol, accion)
  const textsize = proposito === 'meta' ? TEXTSIZE_MAXIMO : textsizeDe(celdas.topesDe({ proposito: 'usuario' }))
  const config = comun.opcionesConexion(con, secreto, {
    requestTimeoutMs: Number.isInteger(op.timeoutMs) && op.timeoutMs > 0 ? op.timeoutMs : 0,
    textsize,
    cas: comun.certificadosDeConfianza(),
    appName: `Tessera/explorador ${accion} ${(ctx && ctx.usuarioWindows) || 'tessera'}@${con.alias}`.slice(0, 128)
  })
  const s = nuevaSesion(con, tedious, op, ganchos, proposito, textsize)
  const alPerder = (err) => {
    if (s.cerrando || s.perdida) return
    s.perdida = true
    const e = normalizarError(err || new Error('La conexión con SQL Server se cerró.'))
    e.clase = 'perdida'
    if (typeof s.ganchos.alPerder === 'function') s.ganchos.alPerder(e)
  }
  s.conexion = await comun.conectar(config, { tedious })
  vigilarConexion(s, alPerder)
  try {
    const fila = await leerInfoSesion(s, proposito)
    const version = textoONulo(fila[0]) ?? ''
    exigirVersion(version)
    s.base = textoONulo(fila[1])
    s.dmv = Number(fila[3]) === 1
    return {
      sesion: s,
      respuesta: {
        modo: 'nativo',
        driverId: null,
        version,
        // En SQL Server la «posición» de la sesión es la BASE (el USE de la consola).
        esquema: s.base,
        usuario: textoONulo(fila[2]),
        pidServidor: Number(fila[4]) || undefined
      }
    }
  } catch (err) {
    await cerrar(s)
    throw err
  }
}

/**
 * Lo que se fija ANTES de la sentencia, en un solo viaje y solo si cambia: el ROLLBACK de una
 * sesión de solo lectura que quedó en una transacción (el envoltorio necesita empezar limpio), el
 * TEXTSIZE, `IMPLICIT_TRANSACTIONS` y, con `sinEsperar`, READ UNCOMMITTED. MANUAL es
 * `SET IMPLICIT_TRANSACTIONS ON` (la semántica de `setAutoCommit(false)` de JDBC), puesto de forma
 * PEREZOSA y quitado para las sentencias que el main marca `sinBegin` cuando no hay transacción:
 * con él puesto, un BEGIN TRAN deja @@TRANCOUNT en 2 y una sonda que lee una tabla abre ELLA MISMA
 * una transacción. El estado real del servidor se lleva en `s.implicitas`.
 */
function previasDe(s, op, d) {
  const lista = []
  if (d.envolver && d.txAntes) lista.push('IF @@TRANCOUNT > 0 ROLLBACK')
  const ts = textsizeDe(d.topes)
  if (ts !== s.textsize) lista.push(`SET TEXTSIZE ${ts}`)
  const quiereImplicitas = d.manual && !d.envolver && !(op.sinBegin === true && !d.txAntes)
  if (quiereImplicitas !== s.implicitas) lista.push(`SET IMPLICIT_TRANSACTIONS ${quiereImplicitas ? 'ON' : 'OFF'}`)
  const sinEsperar = op.sinEsperar === true && s.aislamiento !== 'READ UNCOMMITTED'
  if (sinEsperar) lista.push('SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED')
  return { lista, ts, quiereImplicitas, sinEsperar }
}

/** Lo de después: el ROLLBACK de repuesto del envoltorio y volver al aislamiento y los formatos de la sesión. */
function posterioresDe(s, op, d) {
  const lista = []
  if (d.envolver && s.conexion.inTransaction) lista.push('IF @@TRANCOUNT > 0 ROLLBACK')
  if (d.sinEsperar) lista.push(`SET TRANSACTION ISOLATION LEVEL ${s.aislamiento}`)
  if (!d.fallo && op.refijarFormatos) {
    lista.push(SQL_FORMATOS, `SET TEXTSIZE ${s.textsize}`, `SET IMPLICIT_TRANSACTIONS ${s.implicitas ? 'ON' : 'OFF'}`)
  }
  return lista
}

/** La transacción: una sentencia que no es una consulta pura la hace «pendiente». `sinBegin` es la clase `tx` y las sondas: no escriben datos. */
function seguirEscritura(s, op, d) {
  if (s.conexion.inTransaction) {
    if (!d.txAntes) s.txEscribio = false
    if (op.consultaPura !== true && op.sinBegin !== true && !d.envolver && d.usuario) s.txEscribio = true
  } else {
    s.txEscribio = false
  }
}

/** El código del error con que el servidor revirtió (el número del primero). */
function revertidaDe(err) {
  const primero = err && Array.isArray(err.errors) && err.errors.length ? err.errors[0] : err
  return primero && typeof primero.number === 'number' ? { codigo: String(primero.number) } : {}
}

/** Lanza el error de la sentencia con lo que la sesión colgó de él (conexión, salida, conjuntos previos, reversión). */
function lanzarFallo(s, fallo, leido, extras, revertida) {
  if (typeof fallo === 'object') {
    fallo.__con = s.con
    if (leido.salida) fallo.__salida = leido.salida
    if (extras.length > 0) fallo.__anteriores = extras
    if (revertida) fallo.__revertida = revertidaDe(fallo)
  }
  throw fallo
}

/** El primer conjunto es el resultado y los demás van en `siguientes`, cada uno con sus filas o sus afectadas. */
function resultadoDe(s, op, leido, extras, revertida) {
  let resultado
  if (extras.length === 0) {
    resultado = { tipo: 'hecho', comando: null, ms: leido.msEjecucion }
  } else {
    resultado = extras[0]
    if (resultado.tipo === 'filas') {
      resultado.msEjecucion = leido.msEjecucion
      if (Number.isInteger(op.saltarFilas) && op.saltarFilas > 0) resultado.saltadas = leido.saltadas
    } else {
      resultado.ms = leido.msEjecucion
    }
    if (extras.length > 1) resultado.siguientes = extras.slice(1)
  }
  if (leido.salida) resultado.salida = leido.salida
  if (revertida) resultado.revertidaPorServidor = {}
  if (op.leerEsquema) resultado.esquema = s.base
  return resultado
}

/** El error de la petición; el corte propio de `maxFilas` (nuestro `cancel()`, no el del usuario) no lo es. */
function falloDe(s, leido) {
  const f = leido.err
  return f && s.cortePropio && f.code === 'ECANCEL' && !s.cancelPedido ? null : f
}

/** ¿Hay algo que mandar tras la sentencia y una sesión viva a la que mandarlo? */
function debenCorrerPosteriores(s, lista, fallo) {
  return lista.length > 0 && !s.perdida && !comun.esPerdida(fallo)
}

/**
 * Los conjuntos leídos como resultados. La sentencia que falla manda sus columnas ANTES del error:
 * ese último conjunto vacío es suyo, no un resultado que enseñar.
 */
function extrasDe(leido, op, fallo) {
  const extras = leido.conjuntos.map((c, i) => conjuntoAResultado(c, op.maxFilas, i > 0))
  if (fallo && extras.length > 0) {
    const ultimo = extras[extras.length - 1]
    if (ultimo.tipo === 'filas' && ultimo.nFilas === 0) extras.pop()
  }
  return extras
}

/** Ejecuta UNA sentencia (ver `OpcionesEjecucion` en protocoloTrabajador.ts). */
async function ejecutar(s, sql, binds, opciones) {
  const op = opciones || {}
  if (typeof sql !== 'string' || sql === '') throw errorProtocolo('TESSERA-MENSAJE', 'Falta el SQL.')
  const topes = celdas.topesDe(op)
  const parametros = parametrosDe(s.tedious, binds)
  const envolver = op.candadoRO === true && op.fueraDeEnvoltorio !== true
  const manual = typeof op.txManual === 'boolean' ? op.txManual : s.txManual
  const txAntes = s.conexion.inTransaction

  const previas = previasDe(s, op, { topes, envolver, manual, txAntes })
  if (previas.lista.length > 0) {
    await interna(s, previas.lista.join('; '))
    s.textsize = previas.ts
    s.implicitas = previas.quiereImplicitas
  }

  const texto = envolver ? `BEGIN TRAN; ${sql}\nIF @@TRANCOUNT > 0 ROLLBACK` : sql
  const usuario = op.proposito !== 'catalogo'
  s.cancelPedido = false
  s.cortePropio = false
  s.revertida = false
  s.escucharReversion = usuario && !envolver
  s.enCursoUsuario = usuario
  let leido
  try {
    leido = await leerPeticion(s, texto, parametros, op, topes)
  } finally {
    s.enCursoUsuario = false
    s.escucharReversion = false
  }
  // Solo cuenta si había una transacción ANTES: la que la propia sentencia abrió y el servidor
  // deshizo no se lleva nada del usuario (un 245 en Auto).
  const revertida = s.revertida && txAntes
  let fallo = falloDe(s, leido)

  const posteriores = posterioresDe(s, op, { envolver, sinEsperar: previas.sinEsperar, fallo })
  if (debenCorrerPosteriores(s, posteriores, fallo)) {
    try {
      await interna(s, posteriores.join('; '))
    } catch (err) {
      if (!fallo) fallo = err
    }
  }
  seguirEscritura(s, op, { txAntes, envolver, usuario })

  const extras = extrasDe(leido, op, fallo)
  if (fallo) lanzarFallo(s, fallo, leido, extras, revertida)

  const resultado = resultadoDe(s, op, leido, extras, revertida)
  resultado.tx = await estadoTx(s, op.comprobarTx !== false)
  return resultado
}

/** SQL Server no mantiene lectores abiertos (`lectorPorId` y `mantenerCursor` a false). */
async function leer() {
  throw errorProtocolo('TESSERA-LECTOR', 'SQL Server no mantiene lectores abiertos: vuelve a ejecutar con saltarFilas.')
}

async function cerrarLector() {
  return { cerrado: false }
}

/** Stop = `connection.cancel()` (attention): corta la petición en vuelo y la conexión sigue. Con XACT_ABORT ON el servidor revierte la transacción y el evento lo dice. */
async function cancelar(s) {
  if (!s || !s.enCursoUsuario || !s.conexion || s.perdida || !s.peticion) return { cancelada: false }
  s.cancelPedido = true
  return { cancelada: s.conexion.cancel() === true }
}

/** COMMIT = `WHILE @@TRANCOUNT > 0 COMMIT`, con aviso si había anidamiento; ROLLBACK revierte todo el anidamiento. */
async function tx(s, accion) {
  if (accion === 'estado') return { tx: await estadoTx(s, true) }
  const avisos = []
  if (accion === 'commit') {
    const f = await interna(s, 'DECLARE @n int = @@TRANCOUNT; WHILE @@TRANCOUNT > 0 COMMIT; SELECT @n')
    const n = Number(f[0] && f[0][0])
    if (n > 1) {
      avisos.push(`Había ${n} transacciones anidadas (BEGIN TRAN dentro de otra): se confirmaron todas.`)
    }
  } else {
    await interna(s, 'IF @@TRANCOUNT > 0 ROLLBACK')
  }
  s.txEscribio = false
  const resultado = { tx: await estadoTx(s, true) }
  if (avisos.length) resultado.avisos = avisos
  return resultado
}

async function autoCommit(s, valor) {
  s.txManual = !valor
  return { autoCommit: Boolean(valor), tx: await estadoTx(s, true) }
}

/** ROLLBACK + close. Nunca lanza: cerrar es la última línea de defensa. */
async function cerrar(s) {
  if (!s || !s.conexion || s.cerrando) return
  s.cerrando = true
  const conexion = s.conexion
  if (!s.perdida && conexion.inTransaction && !s.peticion) {
    try {
      await Promise.race([interna(s, 'IF @@TRANCOUNT > 0 ROLLBACK'), new Promise((r) => setTimeout(r, 3000))])
    } catch {
      // se cierra igual: el servidor revierte al perder la sesión
    }
  }
  await comun.cerrar(conexion, 3000)
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
  esPerdida: comun.esPerdida,
  normalizarError,
  valorDeBind,
  SQL_FORMATOS,
  // Para las pruebas.
  textsizeDe,
  propositoDe,
  instalarComandoDone,
  comandoDone: comun.comandoDone
}
