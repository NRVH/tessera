// =============================================================================
// Sesión MySQL y MariaDB del proceso de sesión del explorador: misma interfaz que los demás
// trabajadores, despachada por `sesion.cjs`. Es TONTA: qué candado poner, si toca Manual o si hay que
// leer el esquema lo decide el main y llega en `opciones`. Conexión, errores y celdas son de
// `mysqlComun.cjs`; aquí va lo que es de UNA sesión: su transacción, Detener (KILL QUERY desde otra
// conexión) y la lectura de los conjuntos de una sentencia.
// Decisiones: docs/decisiones/bd/trabajador-mysql-sesion.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')
const comun = require('./mysqlComun.cjs')
const { ahora, ms } = require('./sesionTiempo.cjs')

const { textoONulo } = celdas
/** El bit de «hay una transacción abierta» del estado del servidor (SERVER_STATUS_IN_TRANS). */
const EN_TRANSACCION = 1
/** Una sentencia que empieza por una consulta (tras paréntesis): la única que se corta al llenar la página. */
const EMPIEZA_CONSULTA = /^[\s(]*(select|with|table|values|show)\b/i
/** El aviso de un conjunto EXTRA con más filas de las que se enseñan (no se pagina). */
const AVISO_CONJUNTO_CORTADO = (n) => `Este conjunto tiene más de ${n} filas: solo se enseñan las primeras.`

function errorProtocolo(codigo, mensaje) {
  const e = new Error(mensaje)
  e.code = codigo
  e.__protocolo = true
  return e
}

function nuevaSesion(con, secreto, op, ganchos) {
  return {
    motor: 'mysql',
    con,
    secreto,
    c: null,
    id: undefined,
    mariadb: false,
    txManual: op.autoCommit === false,
    enTx: false,
    txEscribio: false,
    base: null,
    enCursoUsuario: false,
    cancelPedido: false,
    cortePropio: false,
    perdida: false,
    cerrando: false,
    ganchos: ganchos || {}
  }
}

/** El estado del servidor que trae una cabecera de OK (`ResultSetHeader`): ¿hay transacción? */
function anotarEstado(s, cabecera) {
  if (cabecera && typeof cabecera.serverStatus === 'number') s.enTx = (cabecera.serverStatus & EN_TRANSACCION) !== 0
}

/** Una sentencia interna (de Tessera): sus filas, y el estado de la transacción si trae una cabecera. */
function interna(s, sql) {
  return new Promise((resolve, reject) => {
    s.c.query({ sql, rowsAsArray: true }, (err, r) => {
      if (err) return reject(err)
      if (r && !Array.isArray(r)) {
        anotarEstado(s, r)
        return resolve([])
      }
      resolve(Array.isArray(r) ? r : [])
    })
  })
}

/** El estado de la transacción: 'pendiente' si algo escribió en ella (deducido), 'abierta' si no. */
function estadoTx(s) {
  if (!s.enTx) {
    s.txEscribio = false
    return 'ninguna'
  }
  return s.txEscribio ? 'pendiente' : 'abierta'
}

/**
 * Abre una sesión. `opciones`: { rol, timeoutMs, autoCommit, accion }. `ganchos.alPerder`: la
 * sesión murió estando ociosa. La contraseña se queda en la sesión: Detener abre otra conexión
 * para el KILL QUERY.
 */
async function abrir(con, secreto, ctx, opciones, ganchos) {
  const op = opciones || {}
  const accion = op.accion || op.rol || 'explorador'
  const s = nuevaSesion(con, secreto, op, ganchos)
  const config = comun.opcionesConexion(con, secreto, {
    appName: `Tessera/explorador ${accion} ${(ctx && ctx.usuarioWindows) || 'tessera'}@${con.alias}`,
    keepAlive: true
  })
  s.config = config
  let c
  try {
    c = await comun.conectar(config)
  } catch (e) {
    throw comun.errorAlConectar(e, con)
  }
  s.c = c
  const alPerder = (err) => {
    if (s.cerrando || s.perdida) return
    s.perdida = true
    const e = normalizarError(err || Object.assign(new Error('La conexión con el servidor se cerró.'), { code: 'PROTOCOL_CONNECTION_LOST' }))
    e.clase = 'perdida'
    if (typeof s.ganchos.alPerder === 'function') s.ganchos.alPerder(e)
  }
  c.on('error', alPerder)
  c.on('end', () => alPerder(null))
  try {
    const info = await comun.prepararSesion(c, con.readonly !== false)
    s.mariadb = comun.esMariaDb(info.version)
    s.id = info.id
    s.base = textoONulo(info.base)
    if (Number.isInteger(op.timeoutMs) && op.timeoutMs > 0) {
      await interna(s, s.mariadb ? `SET SESSION max_statement_time = ${op.timeoutMs / 1000}` : `SET SESSION max_execution_time = ${op.timeoutMs}`)
    }
    return {
      sesion: s,
      respuesta: { modo: 'nativo', driverId: null, version: info.version, esquema: s.base, usuario: textoONulo(info.usuario), pidServidor: s.id }
    }
  } catch (err) {
    await cerrar(s)
    throw err
  }
}

/** Error del driver -> `ErrorTrabajador`, con la posición de un error de sintaxis en el texto enviado. */
function normalizarError(err, sql) {
  const original = err && typeof err.__sql === 'string' ? err.__sql : sql
  return comun.normalizarError(err, original, err && err.__envio ? err.__envio : null)
}

// --- Lectura de una sentencia ---------------------------------------------------------------

function cerrarActual(est) {
  if (!est.actual) return
  est.actual.msLectura = ms(est.actual.t1)
  est.conjuntos.push(est.actual)
  est.actual = null
}

/** Una fila del conjunto actual: salta las de `saltarFilas` (solo el primero), llena la página y marca `hayMas`. */
function alFila(s, est, op, topes, fila) {
  const c = est.actual
  if (c.saltar > 0) {
    c.saltar--
    est.saltadas++
    return
  }
  if (c.hayMas) return
  if (c.vistas >= op.maxFilas) {
    c.hayMas = true
    // Solo el PRIMER conjunto de una sentencia sin transacción abierta se corta con KILL QUERY:
    // en una transacción, cortar la sentencia no la deshace, pero tampoco hace falta arriesgar nada.
    if (est.puedeCortar && est.conjuntos.length === 0 && !s.cortePropio) {
      s.cortePropio = true
      lanzarKill(s)
    }
    return
  }
  const f = comun.celdas.filaMysql(fila, c.campos, topes)
  if (!c.acc.agregar(f.celdas, f.recortes)) {
    c.hayMas = true
    return
  }
  c.vistas++
}

/**
 * Corre UNA sentencia del usuario y lee todos sus conjuntos (un CALL devuelve varios) y las
 * cabeceras de OK (afectadas y aviso del servidor). Resuelve `{ err, conjuntos, cabeceras, saltadas,
 * msEjecucion }`; no lanza.
 */
function leerSentencia(s, sql, op, topes) {
  const est = {
    conjuntos: [],
    cabeceras: [],
    actual: null,
    saltadas: 0,
    // Solo una consulta sin transacción abierta: cortarla no se lleva nada por delante.
    puedeCortar: op.proposito !== 'catalogo' && !s.enTx && op.esDml !== true && EMPIEZA_CONSULTA.test(sql)
  }
  const saltar = Number.isInteger(op.saltarFilas) && op.saltarFilas > 0 ? op.saltarFilas : 0
  const t0 = ahora()
  return new Promise((resolve) => {
    const q = s.c.query({ sql, rowsAsArray: true })
    q.on('fields', (campos) => {
      cerrarActual(est)
      if (!campos) return
      est.actual = {
        campos,
        acc: new celdas.AcumuladorPagina(topes.topeRespuesta),
        vistas: 0,
        hayMas: false,
        saltar: est.conjuntos.length === 0 ? saltar : 0,
        t1: ahora(),
        msLectura: 0
      }
    })
    q.on('result', (fila) => {
      if (Array.isArray(fila)) {
        if (est.actual) alFila(s, est, op, topes, fila)
        return
      }
      cerrarActual(est)
      anotarEstado(s, fila)
      est.cabeceras.push(fila)
    })
    let err = null
    q.on('error', (e) => {
      err = e
    })
    q.on('end', () => {
      cerrarActual(est)
      // El corte propio (KILL QUERY al llenar la página) no es un error del usuario.
      const corte = err && s.cortePropio && !s.cancelPedido && err.errno === 1317
      resolve({ err: corte ? null : err, conjuntos: est.conjuntos, cabeceras: est.cabeceras, saltadas: est.saltadas, msEjecucion: ms(t0) })
    })
  })
}

/** Un conjunto leído como resultado del protocolo (sin `tx`: la pone quien lo devuelve). */
function conjuntoAResultado(c, maxFilas, extra) {
  const r = {
    tipo: 'filas',
    columnas: comun.celdas.columnasMysql(c.campos),
    filasJson: c.acc.json(),
    nFilas: c.acc.n,
    hayMas: c.hayMas,
    lector: null,
    comando: null,
    msEjecucion: 0,
    msLectura: c.msLectura
  }
  if (c.acc.recortes.length) r.recortes = c.acc.recortes
  if (extra && c.hayMas) r.avisos = [AVISO_CONJUNTO_CORTADO(maxFilas)]
  return r
}

/** El resultado de una sentencia sin conjuntos: las afectadas de un DML, o «hecho». */
function resultadoSinFilas(op, leido) {
  const cab = leido.cabeceras[leido.cabeceras.length - 1]
  const afectadas = cab && typeof cab.affectedRows === 'number' ? cab.affectedRows : 0
  if (op.esDml === true) return { tipo: 'afectadas', filas: afectadas, comando: null, ms: leido.msEjecucion }
  return { tipo: 'hecho', comando: null, ms: leido.msEjecucion }
}

/** El primer conjunto es el resultado y los demás van en `siguientes`. */
function resultadoDe(s, op, leido) {
  const extras = leido.conjuntos.map((c, i) => conjuntoAResultado(c, op.maxFilas, i > 0))
  if (extras.length === 0) return resultadoSinFilas(op, leido)
  const r = extras[0]
  r.msEjecucion = leido.msEjecucion
  if (Number.isInteger(op.saltarFilas) && op.saltarFilas > 0) r.saltadas = leido.saltadas
  if (extras.length > 1) r.siguientes = extras.slice(1)
  return r
}

/** Los avisos del servidor de la sentencia (SHOW WARNINGS), si la cabecera dice que los hay. */
async function avisosDelServidor(s, leido) {
  const hay = leido.cabeceras.some((c) => c && Number(c.warningStatus) > 0)
  if (!hay) return undefined
  const salida = new celdas.AcumuladorSalida()
  try {
    for (const f of await interna(s, 'SHOW WARNINGS')) {
      salida.agregar(`${textoONulo(f[0]) ?? ''} ${textoONulo(f[1]) ?? ''}: ${textoONulo(f[2]) ?? ''}`, String(f[0]).toLowerCase() !== 'note')
    }
  } catch {
    return undefined
  }
  const lineas = salida.lineas()
  return lineas.length > 0 ? lineas : undefined
}

/**
 * Lo de ANTES de la sentencia: el envoltorio de solo lectura (`START TRANSACTION READ ONLY`, tras
 * soltar lo que quedara abierto) o, en Manual, la transacción perezosa (`START TRANSACTION` si no
 * hay una y la sentencia no es de las que no la llevan, `sinBegin`).
 */
async function antesDe(s, op, d) {
  if (d.envolver) {
    if (s.enTx) await interna(s, 'ROLLBACK')
    await interna(s, 'START TRANSACTION READ ONLY')
  } else if (d.manual && !s.enTx && op.sinBegin !== true && op.proposito !== 'catalogo') {
    await interna(s, 'START TRANSACTION')
    s.txEscribio = false
  }
}

/** La transacción tras la sentencia: lo que escribe dentro de una la deja 'pendiente' (ver la cabecera del ADR). */
function seguirEscritura(s, op, d, leido) {
  if (!s.enTx) {
    s.txEscribio = false
    return
  }
  const abrioLaTx = !d.txAntes && !d.manual
  const escribio = leido.cabeceras.length > 0 && op.sinBegin !== true && op.proposito !== 'catalogo' && !d.envolver
  if (escribio && !abrioLaTx) s.txEscribio = true
}

/**
 * Lo que viaja: el SQL con los `?` sustituidos por sus literales (va por el protocolo de TEXTO) y
 * el mapa de las sustituciones, o null sin binds. Lanza si los binds no son posicionales.
 */
function envioDe(sql, binds) {
  if (typeof sql !== 'string' || sql === '') throw errorProtocolo('TESSERA-MENSAJE', 'Falta el SQL.')
  if (binds !== undefined && binds !== null && !Array.isArray(binds)) {
    throw errorProtocolo('TESSERA-BINDS', 'MySQL solo admite binds posicionales (?).')
  }
  return Array.isArray(binds) && binds.length > 0 ? comun.sustituirConMapa(sql, binds) : null
}

/** Corre la sentencia marcando que es del usuario (lo que Detener puede cortar). */
async function correrDelUsuario(s, texto, op) {
  const usuario = op.proposito !== 'catalogo'
  s.cancelPedido = false
  s.cortePropio = false
  s.enCursoUsuario = usuario
  try {
    return await leerSentencia(s, texto, op, celdas.topesDe(op))
  } finally {
    s.enCursoUsuario = false
  }
}

/** Lanza el error de la sentencia con lo que `normalizarError` necesita para situarlo. */
function lanzarFallo(s, fallo, sql, envio, salida) {
  if (fallo !== null && typeof fallo === 'object') {
    // La posición se busca en lo que viajó y se devuelve al texto del usuario (`normalizarError`).
    fallo.__sql = sql
    fallo.__envio = envio
    if (salida) fallo.__salida = salida
    fallo.__cancelPedido = s.cancelPedido
  }
  throw fallo
}

/** Ejecuta UNA sentencia (ver `OpcionesEjecucion` en protocoloTrabajador.ts). */
async function ejecutar(s, sql, binds, opciones) {
  const op = opciones || {}
  const envio = envioDe(sql, binds)
  if (s.killEnVuelo) await s.killEnVuelo
  const d = {
    envolver: op.candadoRO === true && op.fueraDeEnvoltorio !== true,
    manual: typeof op.txManual === 'boolean' ? op.txManual : s.txManual,
    txAntes: s.enTx
  }
  await antesDe(s, op, d)
  const leido = await correrDelUsuario(s, envio ? envio.texto : sql, op)
  seguirEscritura(s, op, d, leido)
  const quiereSalida = op.proposito !== 'catalogo' && op.salidaServidor === true && !s.perdida
  const salida = quiereSalida ? await avisosDelServidor(s, leido) : undefined
  if (d.envolver && s.enTx && !s.perdida) await interna(s, 'ROLLBACK').catch(() => {})
  if (leido.err) lanzarFallo(s, leido.err, sql, envio, salida)
  return terminar(s, op, leido, salida)
}

/** Lo de después de una ejecución buena: el modo SQL tras una rutina, la base y el estado de la transacción. */
async function terminar(s, op, leido, salida) {
  const resultado = resultadoDe(s, op, leido)
  if (op.refijarFormatos) await comun.refijarModo(s.c).catch(() => {})
  if (op.leerEsquema) {
    try {
      const [f] = await interna(s, 'SELECT DATABASE()')
      s.base = textoONulo(f && f[0])
    } catch {
      // se queda la que había
    }
    resultado.esquema = s.base
  }
  if (salida) resultado.salida = salida
  resultado.tx = estadoTx(s)
  return resultado
}

/** MySQL no mantiene lectores abiertos (`lectorPorId` y `mantenerCursor` a false). */
async function leer() {
  throw errorProtocolo('TESSERA-LECTOR', 'MySQL no mantiene lectores abiertos: vuelve a ejecutar con saltarFilas.')
}

async function cerrarLector() {
  return { cerrado: false }
}

/**
 * Lanza el KILL QUERY y lo deja anotado: la sentencia SIGUIENTE espera a que termine, porque uno que
 * llegara tarde podría cortarla a ella.
 */
function lanzarKill(s) {
  const p = matarConsulta(s)
    .catch(() => false)
    .finally(() => {
      if (s.killEnVuelo === p) s.killEnVuelo = null
    })
  s.killEnVuelo = p
  return p
}

/** `KILL QUERY <id>` desde una conexión aparte: corta la sentencia y la sesión sigue (con su transacción). */
async function matarConsulta(s) {
  if (!s.id || !s.config) return false
  let otra
  try {
    otra = await comun.conectar({ ...s.config, database: undefined })
    await comun.interna(otra, `KILL QUERY ${Number(s.id)}`)
    return true
  } finally {
    if (otra) await comun.cerrar(otra, 2000)
  }
}

/** Stop = KILL QUERY de la sentencia en curso (error 1317 en ella). */
async function cancelar(s) {
  if (!s || !s.enCursoUsuario || !s.c || s.perdida) return { cancelada: false }
  s.cancelPedido = true
  return { cancelada: await lanzarKill(s) }
}

async function tx(s, accion) {
  if (accion === 'estado') return { tx: estadoTx(s) }
  await interna(s, accion === 'commit' ? 'COMMIT' : 'ROLLBACK')
  s.enTx = false
  s.txEscribio = false
  return { tx: estadoTx(s) }
}

async function autoCommit(s, valor) {
  s.txManual = !valor
  return { autoCommit: Boolean(valor), tx: estadoTx(s) }
}

/** ROLLBACK + cierre. Nunca lanza: cerrar es la última línea de defensa. */
async function cerrar(s) {
  if (!s || !s.c || s.cerrando) return
  s.cerrando = true
  if (!s.perdida && s.enTx) {
    try {
      await Promise.race([interna(s, 'ROLLBACK'), new Promise((r) => setTimeout(r, 3000))])
    } catch {
      // se cierra igual: el servidor revierte al perder la sesión
    }
  }
  await comun.cerrar(s.c, 3000)
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
  // Para las pruebas.
  estadoTx,
  conjuntoAResultado
}
