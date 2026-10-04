// =============================================================================
// Sesión Redis del proceso de sesión del explorador: una conexión por sesión, con su base, su
// MULTI y su `CLIENT ID` (lo que hace falta para soltarla con `CLIENT UNBLOCK` desde otra).
// `sesion.cjs` despacha aquí `abrir`, `cancelar`, `cerrar` y la op `claves`; las operaciones SQL
// del protocolo responden `protocolo`. Conectar, partir, clasificar y leer valores es de
// `redisComun.cjs`, compartido con `tdb`. La política de solo lectura la aplica el trabajador.
// Decisiones: docs/decisiones/bd/trabajador-redis-cancelar.md
// =============================================================================
'use strict'

const comun = require('./redisComun.cjs')
const { errorDe: errorTrabajador } = require('./sesionProtocolo.cjs')

const TIPOS = new Set(['string', 'hash', 'list', 'set', 'zset', 'stream', 'json', 'otro'])
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const PLAZO_AUXILIAR_MS = 3000
const MENSAJE_CANCELADA = 'Operación cancelada.'
const MENSAJE_ABANDONADA =
  'Operación cancelada: Redis no interrumpe un comando en curso, así que el servidor puede haberlo terminado igual.'

function protocolo(mensaje) {
  return errorTrabajador('protocolo', mensaje, 'TESSERA-MENSAJE')
}

function baseDe(v) {
  if (!Number.isInteger(v) || v < 0 || v > 9999) throw protocolo('«base» tiene que ser un entero de 0 a 9999.')
  return v
}

function politicaDe(a) {
  const p = a.politica
  if (!p || typeof p !== 'object') throw protocolo('Falta «politica».')
  return {
    soloLectura: p.soloLectura !== false,
    produccion: p.produccion !== false,
    confirmado: p.confirmado === true,
    confirmadoPeligroso: p.confirmadoPeligroso === true
  }
}

// --- Conexión de la sesión ------------------------------------------------------------------------

/** Las conexiones que cerramos NOSOTROS (cancelar, cerrar): su cierre no es una pérdida. */
const cerradasPorNosotros = new WeakSet()

async function idDe(cliente) {
  try {
    const r = await cliente.callBuffer('CLIENT', 'ID')
    return r === null || r === undefined ? null : String(r)
  } catch (err) {
    if (comun.esRespuestaError(err)) return null
    throw err
  }
}

function instalar(s, cliente) {
  s.cliente = cliente
  s.plantilla = cliente
  cliente.once('end', () => {
    if (cerradasPorNosotros.has(cliente) || s.cerrando || s.cliente !== cliente) return
    if (typeof s.ganchos.alPerder === 'function') {
      s.ganchos.alPerder({ clase: 'perdida', mensaje: 'La conexión con Redis se cerró.' })
    }
  })
}

function soltarConexion(s) {
  const c = s.cliente
  if (!c) return
  cerradasPorNosotros.add(c)
  s.cliente = null
  s.clienteId = null
  comun.desconectar(c)
}

/** La conexión de la sesión, reabierta si se abandonó al cancelar. */
async function asegurar(s) {
  if (s.cliente) {
    if (s.cliente.status === 'end') throw errorTrabajador('perdida', 'La conexión con Redis se cerró.')
    return s.cliente
  }
  const c = await comun.reconectar(s.plantilla)
  instalar(s, c)
  s.clienteId = await idDe(c)
  return c
}

async function abrir(con, secreto, ctx, opciones, ganchos) {
  const op = opciones || {}
  const rol = op.rol || 'explorador'
  const appName = `Tessera/explorador-${rol}-${(ctx && ctx.usuarioWindows) || 'tessera'}@${(con && con.alias) || ''}`
  const { cliente, version } = await comun.conectar(con, typeof secreto === 'string' ? secreto : '', { appName })
  const s = {
    motor: 'redis',
    con,
    cliente: null,
    plantilla: null,
    clienteId: null,
    cache: new Map(),
    enCurso: null,
    cancelada: null,
    cerrando: false,
    ganchos: ganchos || {}
  }
  instalar(s, cliente)
  try {
    s.clienteId = await idDe(cliente)
  } catch (err) {
    soltarConexion(s)
    throw err
  }
  return {
    sesion: s,
    respuesta: {
      modo: 'nativo',
      driverId: null,
      version,
      esquema: null,
      usuario: con && con.user ? String(con.user) : null
    }
  }
}

async function cerrar(s) {
  if (!s) return
  s.cerrando = true
  soltarConexion(s)
}

// --- Cancelar -------------------------------------------------------------------------------------

function puedeBloquear(s, nombre) {
  if (comun.BLOQUEANTES.has(nombre)) return true
  const info = s.cache.get(nombre)
  return Boolean(info && Array.isArray(info.marcas) && (info.marcas.includes('blocking') || info.marcas.includes('@blocking')))
}

/** CLIENT UNBLOCK / SCRIPT KILL desde otra conexión. true = el comando se soltó. */
async function soltar(s, en) {
  const nombre = en.nombre || ''
  const esLua = comun.LUA.has(nombre)
  if (!en.cliente || s.clienteId === null || !(esLua || puedeBloquear(s, nombre))) return false
  let aux = null
  try {
    // `commandTimeout`: una auxiliar que conecta pero no contesta el UNBLOCK no puede colgar la
    // cancelación, ni a `claves`, que espera a saber cómo acabó antes de elegir el mensaje.
    aux = await comun.reconectar(en.cliente, {
      connectTimeout: PLAZO_AUXILIAR_MS,
      commandTimeout: PLAZO_AUXILIAR_MS,
      connectionName: 'Tessera-cancelar'
    })
    if (s.enCurso !== en) return false
    if (esLua) {
      await aux.callBuffer(nombre.startsWith('fcall') ? 'FUNCTION' : 'SCRIPT', 'KILL')
      return true
    }
    const r = await aux.callBuffer('CLIENT', 'UNBLOCK', s.clienteId, 'ERROR')
    return Number(r) === 1
  } catch {
    // Sin permiso (un ACL de lectura no tiene CLIENT UNBLOCK), NOTBUSY, UNKILLABLE…: se abandona.
    return false
  } finally {
    comun.desconectar(aux)
  }
}

async function cancelar(s) {
  if (!s || !s.enCurso) return { cancelada: false }
  const en = s.enCurso
  s.cancelada = en
  // La promesa queda en el testigo: el error del comando soltado (`UNBLOCKED`) llega por la
  // conexión de la sesión, a menudo ANTES que el `:1` del UNBLOCK por la auxiliar, y `claves`
  // tiene que esperar a saber si se soltó para no decir «abandonada» de algo que se soltó.
  en.soltando = soltar(s, en)
  en.soltada = await en.soltando
  // Solo si sigue siendo la MISMA operación: cada una lleva su testigo (`enCurso`), y una
  // cancelación tardía no debe tocar la que empezó después.
  if (!en.soltada && s.enCurso === en && s.cliente === en.cliente) soltarConexion(s)
  return { cancelada: true }
}

// --- Suboperaciones de `claves` ------------------------------------------------------------------

async function bases(s) {
  return comun.bases(s.cliente, comun.BASES_POR_DEFECTO)
}

async function escanear(s, a) {
  const base = baseDe(a.base)
  if (typeof a.patron !== 'string') throw protocolo('Falta «patron».')
  if (typeof a.cursor !== 'string' || !/^\d+$/.test(a.cursor)) throw protocolo('«cursor» tiene que ser un número en texto.')
  if (!Number.isInteger(a.cuenta) || a.cuenta < 1) throw protocolo('«cuenta» tiene que ser un entero >= 1.')
  if (a.tipo !== undefined && !TIPOS.has(a.tipo)) throw protocolo(`Tipo desconocido: ${String(a.tipo)}`)
  await comun.seleccionar(s.cliente, base)
  return comun.escanear(s.cliente, { patron: a.patron, cursor: a.cursor, cuenta: a.cuenta, tipo: a.tipo })
}

async function valor(s, a) {
  const base = baseDe(a.base)
  if (typeof a.clave !== 'string' || a.clave.length % 4 !== 0 || !BASE64.test(a.clave)) throw protocolo('«clave» tiene que ir en base64.')
  if (a.desde !== undefined && typeof a.desde !== 'string') throw protocolo('«desde» tiene que ser texto.')
  if (a.cuantos !== undefined && (!Number.isInteger(a.cuantos) || a.cuantos < 1)) throw protocolo('«cuantos» tiene que ser un entero >= 1.')
  await comun.seleccionar(s.cliente, base)
  return comun.valor(s.cliente, Buffer.from(a.clave, 'base64'), { desde: a.desde, cuantos: a.cuantos })
}

async function consola(s, a, en) {
  const politica = politicaDe(a)
  const base = baseDe(a.base)
  if (typeof a.texto !== 'string') throw protocolo('Falta «texto».')
  // Partir y clasificar ANTES de tocar el servidor (el orden de las barreras, en redisComun).
  const argv = comun.partirComando(a.texto)
  en.nombre = comun.nombreComando(argv)
  await comun.aplicarPolitica(s.cliente, argv, politica, s.cache)
  await comun.seleccionar(s.cliente, base)
  const inicio = Date.now()
  const respuesta = await comun.ejecutar(s.cliente, argv)
  return { respuesta, base: comun.baseActual(s.cliente), ms: Date.now() - inicio }
}

const OPERACIONES = new Map([
  ['bases', bases],
  ['escanear', escanear],
  ['valor', valor],
  ['consola', consola]
])

/** La op `claves` de `sesion.cjs` (dentro de `operar`: una a la vez por sesión). */
async function claves(s, operacion, args) {
  const fn = OPERACIONES.get(operacion)
  if (!fn) throw errorTrabajador('protocolo', `Operación de claves desconocida: ${String(operacion)}`, 'TESSERA-OP')
  const en = { nombre: null, cliente: null, soltada: false, soltando: null }
  s.enCurso = en
  s.cancelada = null
  try {
    en.cliente = await asegurar(s)
    // Cancelada mientras se reabría la conexión: no se manda nada.
    if (s.cancelada === en) throw errorTrabajador('cancelada', MENSAJE_CANCELADA)
    return await fn(s, args || {}, en)
  } catch (err) {
    const t = err && err.trabajador
    if (s.cancelada === en && !(t && (t.clase === 'protocolo' || t.clase === 'soloLectura'))) {
      if (en.soltando) await en.soltando
      throw errorTrabajador('cancelada', en.soltada ? MENSAJE_CANCELADA : MENSAJE_ABANDONADA)
    }
    throw err
  } finally {
    if (s.enCurso === en) s.enCurso = null
    if (s.cancelada === en) s.cancelada = null
  }
}

// --- Las operaciones SQL del protocolo: no son de este motor --------------------------------------

function noEsSql(op) {
  return async () => {
    throw errorTrabajador('protocolo', `Redis no tiene la operación «${op}» (es de SQL): se usa la op «claves».`, 'TESSERA-OP')
  }
}

function esPerdida(err) {
  return comun.esPerdida(err)
}

function normalizarError(err) {
  return comun.normalizarError(err)
}

module.exports = {
  abrir,
  claves,
  ejecutar: noEsSql('ejecutar'),
  leer: noEsSql('leer'),
  cerrarLector: noEsSql('cerrarLector'),
  tx: noEsSql('tx'),
  autoCommit: noEsSql('autoCommit'),
  cancelar,
  cerrar,
  esPerdida,
  normalizarError
}
