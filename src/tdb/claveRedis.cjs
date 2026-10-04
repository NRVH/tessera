// =============================================================================
// Las claves de Redis: las bases con claves, el SCAN de una página con su tipo y su TTL, y el
// valor de una clave por tipo (el visor). Pieza de `redisComun.cjs`, que reexporta `bases`,
// `escanear` y `valor`. Nunca KEYS; los valores son bytes (`DbKvBytes`).
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

const { errorUso, esRespuestaError } = require('./erroresRedis.cjs')
const { aBuffer, textoDe, num, esUtf8, bytes } = require('./valoresRedis.cjs')
const { estado, BASES_POR_DEFECTO } = require('./clienteRedis.cjs')

const TOPE_STRING_BYTES = 256 * 1024
const TOPE_JSON_CARACTERES = 1024 * 1024
const CUANTOS_POR_DEFECTO = 100
const CUANTOS_MAXIMO = 10000
const CUENTA_MAXIMA = 100000

/** `TYPE` del servidor por cada `DbKvTipo` (para `SCAN … TYPE`). */
const TIPO_SERVIDOR = {
  string: 'string',
  hash: 'hash',
  list: 'list',
  set: 'set',
  zset: 'zset',
  stream: 'stream',
  json: 'ReJSON-RL'
}

/**
 * Varios comandos en un viaje. Devuelve `[{ err, r }]`; un fallo que NO es del servidor (la
 * red) se lanza, porque entonces ninguno de los resultados vale.
 */
async function tuberia(cliente, comandos) {
  const p = cliente.pipeline()
  for (const c of comandos) p.callBuffer(c[0], ...c.slice(1))
  const res = (await p.exec()) || []
  return res.map(([err, r]) => {
    if (err && !esRespuestaError(err)) throw err
    return { err: err || null, r }
  })
}

// --- Árbol: bases y SCAN ------------------------------------------------------------------------

/**
 * Las bases: `{ total, totalDelServidor, conClaves: [{ indice, claves, caducan }],
 * conteosDesconocidos? }`. `CONFIG GET databases` da NOPERM a un usuario de lectura: entonces
 * `total` es `basesPorDefecto` con `totalDelServidor: false`; si `INFO` también, `conteosDesconocidos`.
 */
async function bases(cliente, basesPorDefecto) {
  const porDefecto = Number.isInteger(basesPorDefecto) && basesPorDefecto > 0 ? basesPorDefecto : BASES_POR_DEFECTO
  const [cfg, info] = await tuberia(cliente, [
    ['CONFIG', 'GET', 'databases'],
    ['INFO', 'keyspace']
  ])
  let total = porDefecto
  let totalDelServidor = false
  if (!cfg.err && Array.isArray(cfg.r) && cfg.r.length >= 2) {
    const n = num(cfg.r[1])
    if (Number.isInteger(n) && n > 0) {
      total = n
      totalDelServidor = true
    }
  }
  const salida = { total, totalDelServidor, conClaves: [] }
  if (info.err) {
    salida.conteosDesconocidos = true
    return salida
  }
  const re = /^db(\d+):keys=(\d+),expires=(\d+)/
  for (const linea of textoDe(info.r).split(/\r?\n/)) {
    const m = re.exec(linea.trim())
    if (m) salida.conClaves.push({ indice: Number(m[1]), claves: Number(m[2]), caducan: Number(m[3]) })
  }
  salida.conClaves.sort((a, b) => a.indice - b.indice)
  return salida
}

/** El `TYPE` del servidor como `DbKvTipo`; `ReJSON-RL` es 'json'. */
function tipoDeServidor(t) {
  const s = textoDe(t)
  if (s === 'ReJSON-RL') return { tipo: 'json' }
  if (s === 'string' || s === 'hash' || s === 'list' || s === 'set' || s === 'zset' || s === 'stream') return { tipo: s }
  return { tipo: 'otro', tipoServidor: s }
}

function ttlDe(v) {
  const n = num(v)
  return n === null || n < 0 ? null : n
}

/** Valida las opciones de `escanear`: cursor en texto, cuenta >= 1, patrón y tipo. */
function opcionesScan(o) {
  const cursor = typeof o.cursor === 'string' && /^\d+$/.test(o.cursor) ? o.cursor : null
  if (cursor === null) throw errorUso('El cursor de SCAN tiene que ser un número en texto (\'0\' la primera vez).')
  const cuenta = Number.isInteger(o.cuenta) && o.cuenta >= 1 ? Math.min(o.cuenta, CUENTA_MAXIMA) : null
  if (cuenta === null) throw errorUso('«cuenta» tiene que ser un entero >= 1.')
  const patron = typeof o.patron === 'string' && o.patron !== '' ? o.patron : '*'
  const tipo = typeof o.tipo === 'string' ? o.tipo : undefined
  const tipoServidor = tipo && Object.prototype.hasOwnProperty.call(TIPO_SERVIDOR, tipo) ? TIPO_SERVIDOR[tipo] : null
  return { cursor, cuenta, patron, tipo, tipoServidor }
}

/** Una vuelta de SCAN; Redis < 6 no tiene `SCAN … TYPE`: se filtra aquí (ya se pide el TYPE de cada clave). */
async function pedirScan(cliente, e, { cursor, cuenta, patron, tipoServidor }) {
  const args = [cursor, 'MATCH', patron, 'COUNT', String(cuenta)]
  try {
    return await cliente.callBuffer('SCAN', ...args, ...(tipoServidor && !e.sinScanType ? ['TYPE', tipoServidor] : []))
  } catch (err) {
    if (!(tipoServidor && !e.sinScanType && esRespuestaError(err) && /syntax/i.test(String(err.message)))) throw err
    e.sinScanType = true
    return await cliente.callBuffer('SCAN', ...args)
  }
}

/** Las claves de una vuelta con su tipo y su TTL (un TYPE y un PTTL por clave, en una tubería). */
async function clavesDeVuelta(cliente, nombres, tipo) {
  const claves = []
  const cmds = []
  for (const k of nombres) cmds.push(['TYPE', k], ['PTTL', k])
  const res = await tuberia(cliente, cmds)
  for (let i = 0; i < nombres.length; i++) {
    const t = res[2 * i]
    const ttl = res[2 * i + 1]
    // SCAN no filtra por los patrones de claves del ACL (`~app:*`), pero TYPE sí: una clave que
    // el usuario no puede leer sale igual, sin tipo, en vez de romper la página entera.
    const ts = t.err ? '(sin permiso)' : textoDe(t.r)
    // Borrada o caducada entre el SCAN y el TYPE: no se enseña.
    if (ts === 'none' || (!ttl.err && num(ttl.r) === -2)) continue
    const c = tipoDeServidor(ts)
    if (tipo && c.tipo !== tipo) continue
    const clave = { nombre: bytes(nombres[i]), tipo: c.tipo, ttlMs: ttl.err ? null : ttlDe(ttl.r) }
    if (c.tipoServidor) clave.tipoServidor = c.tipoServidor
    claves.push(clave)
  }
  return claves
}

/** Una página de claves con SCAN: `{ cursor, claves, ms }`. */
async function escanear(cliente, o = {}) {
  const opciones = opcionesScan(o)
  const e = estado(cliente)
  const inicio = Date.now()
  const r = await pedirScan(cliente, e, opciones)
  const siguiente = textoDe(r[0])
  const nombres = Array.isArray(r[1]) ? r[1] : []
  const claves = nombres.length > 0 ? await clavesDeVuelta(cliente, nombres, opciones.tipo) : []
  return { cursor: siguiente, claves, ms: Date.now() - inicio }
}

// --- El valor de una clave (el visor) -------------------------------------------------------------

/** Quita del final una secuencia UTF-8 a medias (un GETRANGE que cortó un carácter). */
function recortarUtf8(b) {
  if (esUtf8(b)) return b
  for (let k = 1; k <= 3 && k < b.length; k++) {
    const r = b.subarray(0, b.length - k)
    if (esUtf8(r)) return r
  }
  return b
}

function pares(lista, fn) {
  const salida = []
  if (!Array.isArray(lista)) return salida
  for (let i = 0; i + 1 < lista.length; i += 2) salida.push(fn(lista[i], lista[i + 1]))
  return salida
}

function idSiguiente(id) {
  const m = /^(\d+)-(\d+)$/.exec(id)
  if (!m) return id
  const seq = BigInt(m[2])
  if (seq >= 18446744073709551615n) return `${BigInt(m[1]) + 1n}-0`
  return `${m[1]}-${seq + 1n}`
}

function cursorDe(desde) {
  if (desde === undefined || desde === null || desde === '') return '0'
  if (typeof desde !== 'string' || !/^\d+$/.test(desde)) throw errorUso('«desde» tiene que ser un cursor numérico en texto.')
  return desde
}

/** Lanza el error de la primera respuesta de la tubería que fue del servidor. */
function lanzarSiError(...respuestas) {
  for (const r of respuestas) if (r.err) throw r.err
}

/** string: STRLEN + GETRANGE hasta `TOPE_STRING_BYTES`. */
async function contenidoString(cliente, clave) {
  const [len, trozo] = await tuberia(cliente, [
    ['STRLEN', clave],
    ['GETRANGE', clave, '0', String(TOPE_STRING_BYTES - 1)]
  ])
  lanzarSiError(len, trozo)
  const total = num(len.r) || 0
  const truncado = total > TOPE_STRING_BYTES
  const b = aBuffer(trozo.r)
  return { tipo: 'string', valor: bytes(truncado ? recortarUtf8(b) : b), bytes: total, truncado }
}

const COMANDOS_COLECCION = { hash: ['HLEN', 'HSCAN'], set: ['SCARD', 'SSCAN'], zset: ['ZCARD', 'ZSCAN'] }

/** hash, set y zset: HSCAN/SSCAN/ZSCAN (`desde` = cursor) con el total de HLEN/SCARD/ZCARD. */
async function contenidoColeccion(cliente, clave, tipo, cuantos, desde) {
  const cursor = cursorDe(desde)
  const cmd = COMANDOS_COLECCION[tipo]
  const [len, scan] = await tuberia(cliente, [
    [cmd[0], clave],
    [cmd[1], clave, cursor, 'COUNT', String(cuantos)]
  ])
  lanzarSiError(len, scan)
  const sig = textoDe(scan.r[0])
  const siguiente = sig === '0' ? null : sig
  const total = num(len.r) || 0
  const lista = Array.isArray(scan.r[1]) ? scan.r[1] : []
  if (tipo === 'hash') return { tipo, pares: pares(lista, (campo, valor) => ({ campo: bytes(campo), valor: bytes(valor) })), total, siguiente }
  if (tipo === 'zset') return { tipo, miembros: pares(lista, (miembro, p) => ({ miembro: bytes(miembro), puntuacion: textoDe(p) })), total, siguiente }
  return { tipo, miembros: lista.map(bytes), total, siguiente }
}

/** list: LRANGE (`desde` = índice) con el total de LLEN. */
async function contenidoLista(cliente, clave, cuantos, desde) {
  const d = desde === undefined || desde === null || desde === '' ? 0 : /^\d+$/.test(String(desde)) ? Number(desde) : NaN
  if (!Number.isSafeInteger(d)) throw errorUso('«desde» tiene que ser un índice (un entero >= 0 en texto).')
  const [len, rango] = await tuberia(cliente, [
    ['LLEN', clave],
    ['LRANGE', clave, String(d), String(d + cuantos - 1)]
  ])
  lanzarSiError(len, rango)
  const total = num(len.r) || 0
  const elementos = (Array.isArray(rango.r) ? rango.r : []).map(bytes)
  const fin = d + elementos.length
  return { tipo: 'list', elementos, total, siguiente: elementos.length > 0 && fin < total ? String(fin) : null }
}

/** stream: XRANGE (`desde` = id exclusivo) con el total de XLEN. */
async function contenidoStream(cliente, clave, cuantos, desde) {
  let inicio = '-'
  if (desde !== undefined && desde !== null && desde !== '') {
    if (typeof desde !== 'string' || !/^\d+-\d+$/.test(desde)) throw errorUso('«desde» tiene que ser un id de stream (1700000000000-0).')
    // Exclusivo sin `(` (Redis 6.2+): el id siguiente, que vale en cualquier versión.
    inicio = idSiguiente(desde)
  }
  // Uno de más, para saber si queda algo sin otra vuelta.
  const [len, rango] = await tuberia(cliente, [
    ['XLEN', clave],
    ['XRANGE', clave, inicio, '+', 'COUNT', String(cuantos + 1)]
  ])
  lanzarSiError(len, rango)
  const crudas = Array.isArray(rango.r) ? rango.r : []
  const hayMas = crudas.length > cuantos
  const entradas = crudas.slice(0, cuantos).map((x) => ({
    id: textoDe(x[0]),
    campos: pares(x[1], (campo, valor) => ({ campo: bytes(campo), valor: bytes(valor) }))
  }))
  return { tipo: 'stream', entradas, total: num(len.r) || 0, siguiente: hayMas && entradas.length > 0 ? entradas[entradas.length - 1].id : null }
}

/**
 * json: `JSON.GET $` hasta `TOPE_JSON_CARACTERES`. Va COMPACTO, como lo da el servidor (sin los
 * corchetes del `$`): reindentarlo exigiría JSON.parse, que redondea los enteros de más de 2^53.
 */
async function contenidoJson(cliente, clave) {
  let t = textoDe(await cliente.callBuffer('JSON.GET', clave, '$'))
  // `$` devuelve la lista de coincidencias: la raíz sola, entre corchetes.
  if (t.startsWith('[') && t.endsWith(']')) t = t.slice(1, -1)
  const truncado = t.length > TOPE_JSON_CARACTERES
  if (truncado) {
    t = t.slice(0, TOPE_JSON_CARACTERES)
    const u = t.charCodeAt(t.length - 1)
    if (u >= 0xd800 && u <= 0xdbff) t = t.slice(0, -1)
  }
  return { tipo: 'json', texto: t, truncado }
}

async function contenidoDe(cliente, clave, tipo, tipoServidor, cuantos, desde) {
  switch (tipo) {
    case 'string':
      return contenidoString(cliente, clave)
    case 'hash':
    case 'set':
    case 'zset':
      return contenidoColeccion(cliente, clave, tipo, cuantos, desde)
    case 'list':
      return contenidoLista(cliente, clave, cuantos, desde)
    case 'stream':
      return contenidoStream(cliente, clave, cuantos, desde)
    case 'json':
      return contenidoJson(cliente, clave)
    default:
      return { tipo: 'otro', tipoServidor }
  }
}

/** Cuántos elementos por página: el pedido, con tope, o el de por defecto. */
function cuantosDe(o) {
  if (o.cuantos === undefined || o.cuantos === null) return CUANTOS_POR_DEFECTO
  if (!Number.isInteger(o.cuantos) || o.cuantos < 1) throw errorUso('«cuantos» tiene que ser un entero >= 1.')
  return Math.min(o.cuantos, CUANTOS_MAXIMO)
}

/**
 * El valor de una clave por tipo, con `ttlMs` (PTTL), `memoria` (MEMORY USAGE) y `codificacion`
 * (OBJECT ENCODING) si se pueden leer; una clave inexistente da `{ tipo: 'noExiste' }`. `desde`
 * es el cursor, el índice o el id de la página siguiente según el tipo.
 */
async function valor(cliente, claveBuffer, o = {}) {
  const clave = aBuffer(claveBuffer)
  const cuantos = cuantosDe(o)
  const inicio = Date.now()
  const [t, ttl, mem, cod] = await tuberia(cliente, [
    ['TYPE', clave],
    ['PTTL', clave],
    ['MEMORY', 'USAGE', clave],
    ['OBJECT', 'ENCODING', clave]
  ])
  if (t.err) throw t.err
  const ts = textoDe(t.r)
  if (ts === 'none' || (!ttl.err && num(ttl.r) === -2)) return { contenido: { tipo: 'noExiste' }, ttlMs: null, ms: Date.now() - inicio }
  const c = tipoDeServidor(ts)
  const contenido = await contenidoDe(cliente, clave, c.tipo, c.tipoServidor || ts, cuantos, o.desde)
  const salida = { contenido, ttlMs: ttl.err ? null : ttlDe(ttl.r), ms: 0 }
  const m = mem.err ? null : num(mem.r)
  if (m !== null) salida.memoria = m
  if (!cod.err && cod.r !== null && cod.r !== undefined) salida.codificacion = textoDe(cod.r)
  salida.ms = Date.now() - inicio
  return salida
}

module.exports = { TOPE_STRING_BYTES, TOPE_JSON_CARACTERES, bases, escanear, valor }
