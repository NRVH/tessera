// =============================================================================
// Conjuntos de resultados de la sesión SQL Server: lee UNA petición del usuario entera (todos los
// conjuntos, las afectadas de cada sentencia, el corte de `maxFilas` y la salida PRINT) y los
// convierte a resultados del protocolo. Depende de `celdas.cjs`, `sqlserverComun.cjs` y
// `peticionesSesionSqlserver.cjs`; lo usa `sesionSqlserver.cjs`.
// Decisiones: docs/decisiones/bd/trabajador-sqlserver-sesion.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')
const comun = require('./sqlserverComun.cjs')
const { ahora, ms } = require('./sesionTiempo.cjs')
const { peticion } = require('./peticionesSesionSqlserver.cjs')

// El `curCmd` de cada DONE (193 = SELECT o asignación de una variable) y su enganche viven en
// `sqlserverComun.cjs`: `tdb` filtra igual sus afectadas.
const { COMANDOS_DONE } = comun

/** El aviso de un conjunto EXTRA con más filas de las que se enseñan (no se pagina). */
const AVISO_CONJUNTO_CORTADO = (n) => `Este conjunto tiene más de ${n} filas: solo se enseñan las primeras.`

function cerrarActual(est) {
  if (!est.actual) return
  const c = est.actual
  est.actual = null
  c.msLectura = ms(c.t1)
  est.conjuntos.push(c)
}

function alMetadata(est, topes, metas) {
  cerrarActual(est)
  const primero = est.conjuntos.length === 0 && !est.primeraFilaLeida
  est.actual = {
    tipo: 'filas',
    metas,
    acc: new celdas.AcumuladorPagina(topes.topeRespuesta),
    vistas: 0,
    hayMas: false,
    saltar: primero ? est.saltar : 0,
    t1: ahora(),
    msLectura: 0
  }
  est.primeraFilaLeida = true
}

/**
 * Una fila del conjunto actual. Con `cortarAlLlenar` (una consulta PURA, lo decide el main) y SIN
 * transacción abierta antes de la sentencia, al llegar la fila `maxFilas + 1` se corta con
 * `cancel()` (el attention de TDS; la conexión queda libre en 11-23 ms): es el equivalente del
 * read + close de un cursor. En cualquier otro caso se DESCARTAN las filas que sobran sin cortar:
 * un attention corta el LOTE entero y con XACT_ABORT ON REVIERTE la transacción del usuario.
 */
function alFila(s, est, op, topes, cols) {
  const c = est.actual
  if (!c) return
  if (c.saltar > 0) {
    c.saltar--
    est.saltadas++
    return
  }
  if (c.hayMas) return
  if (c.vistas >= op.maxFilas) {
    c.hayMas = true
    // Solo el PRIMER conjunto corta: los extra se leen enteros y se descartan.
    if (est.puedeCortar && est.conjuntos.length === 0 && !s.cortePropio) {
      s.cortePropio = true
      s.conexion.cancel()
    }
    return
  }
  const f = comun.filaSqlServer(cols, topes)
  if (!c.acc.agregar(f.celdas, f.recortes)) {
    c.hayMas = true
    return
  }
  c.vistas++
}

/**
 * En un lote 'done' es cada sentencia; 'doneInProc' es lo de dentro de un EXEC o de un disparador:
 * sus conjuntos cuentan, sus cuentas no. Las AFECTADAS salen del token DONE de la SENTENCIA, no del
 * `rowCount` del callback, que SUMA las del disparador. Una cuenta sin columnas solo es una
 * escritura si su `curCmd` no es el de SELECT: la asignación de una variable llega como un SELECT.
 */
function alDone(est, req, rowCount) {
  if (est.actual) {
    cerrarActual(est)
    return
  }
  const cmd = req.__tesseraCurCmd
  if (typeof rowCount === 'number' && comun.esCuentaDeEscritura(cmd)) {
    est.conjuntos.push({ tipo: 'afectadas', filas: rowCount, comando: COMANDOS_DONE.get(cmd) ?? null })
  }
}

/** Por RPC (sp_executesql, la DML de «Enviar») las sentencias llegan como 'doneInProc', y el disparador también: vale la ÚLTIMA cuenta, que es la de la sentencia. */
function engancharRpc(req, est) {
  req.on('doneInProc', (rowCount) => {
    const cmd = req.__tesseraCurCmd
    if (est.actual) cerrarActual(est)
    else if (typeof rowCount === 'number' && comun.esCuentaDeEscritura(cmd)) est.ultimoConteo = { filas: rowCount, cmd }
  })
  req.on('doneProc', () => {
    cerrarActual(est)
    const u = est.ultimoConteo
    if (u !== undefined && !est.conjuntos.some((c) => c.tipo === 'afectadas')) {
      est.conjuntos.push({ tipo: 'afectadas', filas: u.filas, comando: COMANDOS_DONE.get(u.cmd) ?? null })
    }
    est.ultimoConteo = undefined
  })
}

function engancharLote(req, est) {
  req.on('done', (rowCount) => alDone(est, req, rowCount))
  req.on('doneInProc', () => cerrarActual(est))
  req.on('doneProc', () => cerrarActual(est))
}

/**
 * Lee UNA petición del usuario entera. Resuelve `{ err, conjuntos, salida, saltadas, msEjecucion }`;
 * no lanza. PRINT y RAISERROR ≤ 10 llegan como `infoMessage` mientras corre la petición
 * (`lineaDeInfo`, que filtra el 5701 del USE y el 5703 del idioma).
 */
function leerPeticion(s, sql, parametros, op, topes) {
  const est = {
    conjuntos: [],
    actual: null,
    saltar: Number.isInteger(op.saltarFilas) && op.saltarFilas > 0 ? op.saltarFilas : 0,
    saltadas: 0,
    ultimoConteo: undefined,
    primeraFilaLeida: false,
    // Cortar con attention solo si no hay nada que perder.
    puedeCortar: op.cortarAlLlenar === true && !s.conexion.inTransaction
  }
  const salida = op.salidaServidor === true ? new celdas.AcumuladorSalida() : null
  const t0 = ahora()
  const alInfo = (info) => {
    if (!salida) return
    const l = comun.lineaDeInfo(info)
    if (l) salida.agregar(l.texto, l.aviso === true)
  }
  s.conexion.on('infoMessage', alInfo)
  return peticion(s, sql, parametros, (req) => {
    req.on('columnMetadata', (metas) => alMetadata(est, topes, metas))
    req.on('row', (cols) => alFila(s, est, op, topes, cols))
    if (parametros !== null) engancharRpc(req, est)
    else engancharLote(req, est)
  }).then((err) => {
    s.conexion.removeListener('infoMessage', alInfo)
    cerrarActual(est)
    const lineas = salida ? salida.lineas() : []
    return { err, conjuntos: est.conjuntos, salida: lineas.length > 0 ? lineas : undefined, saltadas: est.saltadas, msEjecucion: ms(t0) }
  })
}

/** Un conjunto leído como resultado del protocolo (sin `tx`: la pone quien lo devuelve). */
function conjuntoAResultado(c, maxFilas, extra) {
  if (c.tipo === 'afectadas') return { tipo: 'afectadas', filas: c.filas, comando: c.comando ?? null, ms: 0 }
  const r = {
    tipo: 'filas',
    columnas: comun.columnasSqlServer(c.metas),
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

module.exports = { leerPeticion, conjuntoAResultado }
