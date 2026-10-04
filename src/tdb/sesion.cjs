// =============================================================================
// Proceso de sesión del explorador de bases de datos: uno por conexión, lanzado por el main con
// `fork` y ELECTRON_RUN_AS_NODE=1. Aloja sesiones perezosas (`meta`, `datos`, una por consola)
// y habla por el canal IPC, no por stdout; el trabajador ejecuta lo que le mandan.
// Carga el adaptador de cada motor por `motores.cjs`; el protocolo, en `protocoloTrabajador.ts`.
// Decisiones: docs/decisiones/bd/trabajador-ciclo-de-vida.md
// =============================================================================
'use strict'

const util = require('node:util')

// Antes de cualquier `require` de driver: stdout es el canal del protocolo y una escritura
// nativa en el fd 1 lo rompería, así que `console.*` va a stderr (al log del main).
for (const nivel of ['log', 'info', 'debug', 'warn', 'error', 'trace']) {
  console[nivel] = (...args) => {
    try {
      process.stderr.write(util.format(...args) + '\n')
    } catch {
      // stderr cerrado: no hay a quién contarlo
    }
  }
}

const VERSION_PROTOCOLO = 1
// Qué motores hay y el adaptador de sesión de cada uno: el mapa compartido con `tdb.cjs`.
// Sin drivers en su cadena de carga: el adaptador se carga en `cargarMotor`, al abrir.
const motores = require('./motores.cjs')
const { errorDe } = require('./sesionProtocolo.cjs')
/** Plazo total para cerrar todo al salir; el main espera 3 s y luego mata. */
const PLAZO_SALIDA_MS = 2500
/** Plazo de un `cerrar` de sesión (rollback + close) antes de darlo por perdido. */
const PLAZO_CERRAR_MS = 8000

/** id de sesión -> { id, motor, estado, perdida, ocupada, enCurso, avisarPerdida } */
const sesiones = new Map()
let saliendo = false

// --- Canal ------------------------------------------------------------------------------
// Petición {id, op, ...}; respuesta {id, ok: true, r} | {id, ok: false, error}; evento
// {ev: 'perdida', sesion, error} | {ev: 'fatal', mensaje}.

function enviar(mensaje, alEnviar) {
  if (!process.connected || typeof process.send !== 'function') {
    if (alEnviar) alEnviar()
    return
  }
  try {
    process.send(mensaje, alEnviar ? () => alEnviar() : undefined)
  } catch (err) {
    process.stderr.write(`[sesion] no se pudo enviar al main: ${err && err.message}\n`)
    if (alEnviar) alEnviar()
  }
}

/**
 * Cualquier cosa lanzada -> ErrorTrabajador. La salida del servidor que el motor
 * colgó del error (`__salida`: DBMS_OUTPUT, NOTICE) viaja con él: lo que el bloque
 * escribió antes de fallar es lo que explica el fallo.
 */
function aErrorTrabajador(err, motor, sql) {
  if (err && err.trabajador) return err.trabajador
  const e = normalizar(err, motor, sql) || {
    clase: 'servidor',
    mensaje: String((err && err.message) || err || 'Error desconocido')
  }
  if (err && Array.isArray(err.__salida) && err.__salida.length > 0) e.salida = err.__salida
  return e
}

/** El error de protocolo, o el que normaliza el motor (`null` si no sabe o falla al hacerlo). */
function normalizar(err, motor, sql) {
  if (err && err.__protocolo) {
    const e = { clase: 'protocolo', mensaje: String(err.message || err) }
    if (err.code) e.codigo = String(err.code)
    return e
  }
  if (!motor || typeof motor.normalizarError !== 'function') return null
  try {
    return motor.normalizarError(err, sql)
  } catch {
    return null
  }
}

function espera(msPlazo) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, msPlazo)
    if (t && typeof t.unref === 'function') t.unref()
  })
}

function conPlazo(promesa, msPlazo) {
  return Promise.race([Promise.resolve(promesa).catch(() => {}), espera(msPlazo)])
}

// --- Sesiones -----------------------------------------------------------------------------

/**
 * El adaptador de sesión del motor. `esMotor` (`hasOwnProperty`) y no `MOTORES[motor]` a pelo:
 * un motor «constructor» o uno que no es texto pero se convierte en clave (`['oracle']`) dan este
 * error de protocolo, no un TypeError del `require` ni el adaptador de otro motor.
 */
function cargarMotor(motor) {
  if (!motores.esMotor(motor)) throw errorDe('protocolo', `Motor desconocido: ${motor}`, 'TESSERA-MOTOR')
  return require(motores.MOTORES[motor].sesion)
}

/** Sesión viva para una operación; lanza `protocolo` o `perdida` si no la hay. */
function sesionParaOperar(id) {
  const e = sesiones.get(id)
  if (!e) throw errorDe('protocolo', `La sesión ${id} no está abierta.`, 'TESSERA-SESION')
  if (e.perdida) throw errorDe('perdida', 'La sesión se perdió; el servidor revirtió la transacción.', e.perdida.codigo)
  return e
}

/** El driver avisó de que una sesión murió (PG, estando ociosa o no). */
function alPerderSesion(id, error) {
  const e = sesiones.get(id)
  if (!e || e.perdida) return
  e.perdida = error
  if (e.ocupada) {
    // La operación en curso va a fallar y su respuesta lo dirá; si por lo que sea
    // no lo dice, se avisa al terminar (ver `operar`).
    e.avisarPerdida = true
    return
  }
  enviar({ ev: 'perdida', sesion: id, error })
  cerrarEnSilencio(e)
}

function cerrarEnSilencio(e) {
  conPlazo(e.motor.cerrar(e.estado), PLAZO_CERRAR_MS).catch(() => {})
}

/**
 * Ejecuta `fn` como LA operación de la sesión: marca ocupada, normaliza el error y
 * gestiona la pérdida.
 */
async function operar(e, sql, fn) {
  if (e.ocupada) throw errorDe('ocupada', 'La sesión ya está ejecutando otra operación.', 'TESSERA-OCUPADA')
  e.ocupada = true
  let respuestaDicePerdida = false
  let terminar
  e.enCurso = new Promise((resolve) => {
    terminar = resolve
  })
  try {
    return await fn()
  } catch (err) {
    const et = aErrorTrabajador(err, e.motor, sql)
    if (e.perdida && et.clase !== 'perdida') {
      // El driver ya avisó: cualquier fallo de ahora es la pérdida.
      et.clase = 'perdida'
    }
    if (et.clase === 'perdida') {
      respuestaDicePerdida = true
      if (!e.perdida) {
        e.perdida = et
        cerrarEnSilencio(e)
      }
    }
    const fallo = new Error(et.mensaje)
    fallo.trabajador = et
    throw fallo
  } finally {
    e.ocupada = false
    terminar()
    e.enCurso = null
    if (e.perdida && e.avisarPerdida && !respuestaDicePerdida) {
      e.avisarPerdida = false
      enviar({ ev: 'perdida', sesion: e.id, error: e.perdida })
      cerrarEnSilencio(e)
    }
  }
}

/** Cierra una sesión aunque esté ocupada: primero Stop, luego rollback + close. */
async function cerrarSesion(e) {
  if (e.ocupada) {
    try {
      await conPlazo(e.motor.cancelar(e.estado), 3000)
    } catch {
      // se cierra igual
    }
    if (e.enCurso) await conPlazo(e.enCurso, 5000)
  }
  await conPlazo(e.motor.cerrar(e.estado), PLAZO_CERRAR_MS)
}

// --- Operaciones -------------------------------------------------------------------------------

function exigirTexto(v, nombre) {
  if (typeof v !== 'string' || !v) throw errorDe('protocolo', `Falta «${nombre}».`, 'TESSERA-MENSAJE')
  return v
}

async function opIniciar(msg) {
  if (msg.v !== VERSION_PROTOCOLO) {
    throw errorDe(
      'protocolo',
      `Versión de protocolo ${msg.v} no soportada (el trabajador habla la ${VERSION_PROTOCOLO}).`,
      'TESSERA-VERSION'
    )
  }
  const versiones = { node: process.versions.node }
  if (process.versions.electron) versiones.electron = process.versions.electron
  return { v: VERSION_PROTOCOLO, pid: process.pid, versiones }
}

async function opAbrir(msg) {
  const id = exigirTexto(msg.sesion, 'sesion')
  const conexion = msg.conexion
  if (!conexion || typeof conexion !== 'object') throw errorDe('protocolo', 'Falta «conexion».', 'TESSERA-MENSAJE')
  if (typeof msg.secreto !== 'string') throw errorDe('protocolo', 'Falta «secreto».', 'TESSERA-MENSAJE')
  const previa = sesiones.get(id)
  if (previa && !previa.perdida) throw errorDe('protocolo', `La sesión ${id} ya está abierta.`, 'TESSERA-SESION')
  if (previa) sesiones.delete(id)
  const motor = cargarMotor(conexion.motor)
  const ctx = msg.ctx || { packs: [], externos: {}, driversDir: '', usuarioWindows: 'tessera' }
  const opciones = { ...(msg.opciones || {}), rol: msg.rol }
  const ganchos = { alPerder: (error) => alPerderSesion(id, error) }
  try {
    const { sesion, respuesta } = await motor.abrir(conexion, msg.secreto, ctx, opciones, ganchos)
    sesiones.set(id, {
      id,
      motor,
      estado: sesion,
      perdida: null,
      ocupada: false,
      enCurso: null,
      avisarPerdida: false
    })
    return respuesta
  } catch (err) {
    const et = aErrorTrabajador(err, motor, null)
    // Una apertura que falla no es una sesión perdida: nunca existió.
    if (et.clase === 'perdida') et.clase = 'servidor'
    const fallo = new Error(et.mensaje)
    fallo.trabajador = et
    throw fallo
  }
}

async function opCerrar(msg) {
  const id = exigirTexto(msg.sesion, 'sesion')
  const e = sesiones.get(id)
  if (!e) return { cerrada: false }
  sesiones.delete(id)
  await cerrarSesion(e)
  return { cerrada: true }
}

async function opCancelar(msg) {
  const e = sesiones.get(exigirTexto(msg.sesion, 'sesion'))
  if (!e || e.perdida || !e.ocupada) return { cancelada: false }
  return e.motor.cancelar(e.estado)
}

function opEjecutar(msg) {
  const e = sesionParaOperar(exigirTexto(msg.sesion, 'sesion'))
  if (typeof msg.sql !== 'string') throw errorDe('protocolo', 'Falta «sql».', 'TESSERA-MENSAJE')
  const opciones = msg.opciones || {}
  if (!Number.isInteger(opciones.maxFilas) || opciones.maxFilas < 0) {
    throw errorDe('protocolo', '«maxFilas» tiene que ser un entero >= 0.', 'TESSERA-MENSAJE')
  }
  return operar(e, msg.sql, () => e.motor.ejecutar(e.estado, msg.sql, msg.binds, opciones))
}

function opLeer(msg) {
  const e = sesionParaOperar(exigirTexto(msg.sesion, 'sesion'))
  const lector = exigirTexto(msg.lector, 'lector')
  if (!Number.isInteger(msg.maxFilas) || msg.maxFilas < 1) {
    throw errorDe('protocolo', '«maxFilas» tiene que ser un entero >= 1.', 'TESSERA-MENSAJE')
  }
  return operar(e, null, () => e.motor.leer(e.estado, lector, msg.maxFilas))
}

function opCerrarLector(msg) {
  const e = sesiones.get(exigirTexto(msg.sesion, 'sesion'))
  if (!e || e.perdida) return { cerrado: false }
  const lector = exigirTexto(msg.lector, 'lector')
  return operar(e, null, () => e.motor.cerrarLector(e.estado, lector))
}

function opTx(msg) {
  const e = sesionParaOperar(exigirTexto(msg.sesion, 'sesion'))
  if (msg.accion !== 'commit' && msg.accion !== 'rollback' && msg.accion !== 'estado') {
    throw errorDe('protocolo', `Acción de transacción desconocida: ${msg.accion}`, 'TESSERA-MENSAJE')
  }
  return operar(e, null, () => e.motor.tx(e.estado, msg.accion))
}

function opAutoCommit(msg) {
  const e = sesionParaOperar(exigirTexto(msg.sesion, 'sesion'))
  return operar(e, null, () => e.motor.autoCommit(e.estado, msg.valor !== false))
}

/**
 * `docs` (MongoDB) y `claves` (Redis) llevan una suboperación que resuelve el adaptador del
 * motor con la misma regla de una operación por sesión, pérdida y normalización de errores.
 * Un motor que no la tiene es un error de protocolo (el main enruta mal), no del servidor.
 */
function opDeFamilia(msg, familia, descripcion) {
  const e = sesionParaOperar(exigirTexto(msg.sesion, 'sesion'))
  const operacion = exigirTexto(msg.operacion, 'operacion')
  if (typeof e.motor[familia] !== 'function') {
    throw errorDe('protocolo', `Este motor no admite operaciones de ${descripcion}.`, 'TESSERA-OP')
  }
  return operar(e, null, () => e.motor[familia](e.estado, operacion, msg))
}

async function despacharOp(msg) {
  switch (msg.op) {
    case 'iniciar':
      return opIniciar(msg)
    case 'abrir':
      return opAbrir(msg)
    case 'cerrar':
      return opCerrar(msg)
    case 'cancelar':
      return opCancelar(msg)
    case 'ejecutar':
      return opEjecutar(msg)
    case 'leer':
      return opLeer(msg)
    case 'cerrarLector':
      return opCerrarLector(msg)
    case 'tx':
      return opTx(msg)
    case 'autoCommit':
      return opAutoCommit(msg)
    case 'docs':
      return opDeFamilia(msg, 'docs', 'documentos')
    case 'claves':
      return opDeFamilia(msg, 'claves', 'claves')
    default:
      throw errorDe('protocolo', `Operación desconocida: ${msg.op}`, 'TESSERA-OP')
  }
}

async function despachar(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number' || typeof msg.op !== 'string') {
    process.stderr.write('[sesion] mensaje ignorado: sin id u op\n')
    return
  }
  if (msg.op === 'salir') {
    // Se responde ANTES de cerrar: el main espera el `exit`, no esta respuesta.
    enviar({ id: msg.id, ok: true, r: { saliendo: true } }, () => {
      cerrarTodoYSalir(0)
    })
    return
  }
  if (saliendo) {
    enviar({ id: msg.id, ok: false, error: { clase: 'protocolo', mensaje: 'El proceso está saliendo.', codigo: 'TESSERA-SALIENDO' } })
    return
  }
  try {
    const r = await despacharOp(msg)
    enviar({ id: msg.id, ok: true, r })
  } catch (err) {
    enviar({ id: msg.id, ok: false, error: aErrorTrabajador(err, null, null) })
  }
}

// --- Salida ---------------------------------------------------------------------------------------

async function cerrarTodoYSalir(codigo) {
  if (saliendo) return
  saliendo = true
  const plazo = setTimeout(() => process.exit(codigo), PLAZO_SALIDA_MS)
  if (plazo && typeof plazo.unref === 'function') plazo.unref()
  const todas = [...sesiones.values()]
  sesiones.clear()
  await Promise.allSettled(todas.map((e) => cerrarSesion(e)))
  process.exit(codigo)
}

function fatal(err) {
  const mensaje = String((err && err.message) || err || 'error desconocido').slice(0, 500)
  try {
    process.stderr.write(`[sesion] fatal: ${mensaje}\n`)
  } catch {
    // nada
  }
  const reloj = setTimeout(() => process.exit(70), 1000)
  if (reloj && typeof reloj.unref === 'function') reloj.unref()
  enviar({ ev: 'fatal', mensaje }, () => process.exit(70))
}

process.on('uncaughtException', fatal)
process.on('unhandledRejection', (motivo) => {
  const texto = String((motivo && motivo.message) || motivo).slice(0, 300)
  process.stderr.write(`[sesion] promesa rechazada sin manejar: ${texto}\n`)
})
process.on('disconnect', () => {
  cerrarTodoYSalir(0)
})
process.on('message', (msg) => {
  despachar(msg).catch((err) => fatal(err))
})

if (typeof process.send !== 'function') {
  process.stderr.write('[sesion] sin canal IPC: este proceso solo se lanza con fork() desde Tessera.\n')
  process.exit(64)
}
