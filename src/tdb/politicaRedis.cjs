// =============================================================================
// La política de Redis: las marcas de `COMMAND` (una vez por conexión), qué es lectura y las
// barreras (no admitido, solo lectura, peligroso, producción) que pasa cada comando antes de
// mandarse. Pieza de `redisComun.cjs`, que reexporta `marcasDe`, `clasificar` y `aplicarPolitica`.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

const { CODIGO_PELIGROSO, CODIGO_NO_ADMITIDO, CODIGO_SOLO_LECTURA, CODIGO_PRODUCCION, errorPolitica, esRespuestaError } = require('./erroresRedis.cjs')
const { NO_ADMITIDOS, LECTURA_SIN_MARCA, esPeligroso, nombreVisible, nombreComando } = require('./comandosRedis.cjs')
const { aBuffer, textoDe } = require('./valoresRedis.cjs')
const { estado } = require('./clienteRedis.cjs')

/** Clave de la caché: ¿se cargó la tabla entera? (true / false = no se pudo). */
const TABLA = Symbol('tabla')

function infoDeEntrada(entrada) {
  // [nombre, aridad, marcas[], primera, última, paso, categorías[]?, pistas?, claves?, subcomandos?]
  const marcas = []
  if (Array.isArray(entrada[2])) for (const m of entrada[2]) marcas.push(textoDe(m).toLowerCase())
  if (Array.isArray(entrada[6])) for (const m of entrada[6]) marcas.push(textoDe(m).toLowerCase())
  return { conocido: true, marcas }
}

function llenarTabla(cache, lista) {
  if (!Array.isArray(lista)) return
  for (const entrada of lista) {
    if (!Array.isArray(entrada) || entrada.length < 3) continue
    cache.set(textoDe(entrada[0]).toLowerCase(), infoDeEntrada(entrada))
    if (Array.isArray(entrada[9])) llenarTabla(cache, entrada[9])
  }
}

/**
 * Pide todas las marcas de una vez (`COMMAND` sin argumentos) y las guarda en la caché de la
 * conexión: así los subcomandos se resuelven con lo que el servidor dice que existe y no se
 * pide nada dentro de un MULTI (lo que se mandara ahí quedaría ENCOLADO).
 */
async function cargarTabla(cliente, cache) {
  if (cache.has(TABLA)) return cache.get(TABLA)
  if (estado(cliente).multi) {
    const err = new Error('Con una transacción (MULTI) abierta no se pueden consultar las marcas de los comandos: termina con EXEC o DISCARD.')
    err.code = 'TESSERA-MULTI'
    throw err
  }
  try {
    llenarTabla(cache, await cliente.callBuffer('COMMAND'))
    cache.set(TABLA, true)
  } catch (err) {
    if (!esRespuestaError(err)) throw err
    cache.set(TABLA, false)
  }
  return cache.get(TABLA)
}

/**
 * Las lecturas de siempre (marca `readonly` en Redis 7 y 8), para cuando el servidor NO deja
 * leer sus marcas: un ACL de lectura a secas (`+@read`, sin `+@connection`) da NOPERM en
 * `COMMAND` y en `COMMAND INFO`, y sin esta lista todo, GET incluido, contaría como desconocido.
 * Solo se consulta cuando la tabla del servidor no se pudo cargar; lo que no esté aquí sigue
 * siendo NO lectura. `COMMAND INFO` por comando no sirve en ese caso: el mismo ACL lo niega y,
 * dentro de un MULTI, quedaría ENCOLADO y desalinearía el EXEC.
 */
const LECTURA_CONOCIDA = new Set([
  'get', 'mget', 'getrange', 'substr', 'strlen', 'exists', 'type', 'ttl', 'pttl', 'expiretime',
  'pexpiretime', 'scan', 'dbsize', 'randomkey', 'dump', 'lcs', 'getbit', 'bitcount', 'bitpos',
  'bitfield_ro', 'object|encoding', 'object|freq', 'object|idletime', 'object|refcount',
  'memory|usage', 'hget', 'hmget', 'hgetall', 'hkeys', 'hvals', 'hlen', 'hexists', 'hstrlen',
  'hscan', 'hrandfield', 'lrange', 'llen', 'lindex', 'lpos', 'smembers', 'scard', 'sismember',
  'smismember', 'sscan', 'srandmember', 'sinter', 'sunion', 'sdiff', 'sintercard', 'zrange',
  'zrangebyscore', 'zrangebylex', 'zrevrange', 'zrevrangebyscore', 'zrevrangebylex', 'zscore',
  'zmscore', 'zcard', 'zcount', 'zlexcount', 'zrank', 'zrevrank', 'zscan', 'zrandmember',
  'zinter', 'zunion', 'zdiff', 'zintercard', 'xrange', 'xrevrange', 'xlen', 'xread',
  'xinfo|stream', 'xinfo|groups', 'xinfo|consumers', 'xpending', 'geopos', 'geodist', 'geohash',
  'geosearch', 'georadius_ro', 'georadiusbymember_ro', 'sort_ro', 'json.get', 'json.mget',
  'json.type', 'json.strlen', 'json.arrlen', 'json.objkeys', 'json.objlen', 'json.resp'
])

/** Las marcas de un comando con la caché de la conexión: `{ conocido, marcas }`. Resuelve 'config|get'. */
async function marcasDe(cliente, nombre, cache) {
  const tabla = await cargarTabla(cliente, cache)
  if (cache.has(nombre)) return cache.get(nombre)
  if (!tabla) {
    let info = { conocido: false, marcas: [] }
    // Dentro de un MULTI no se manda nada (quedaría encolado): solo la lista conocida.
    if (!estado(cliente).multi) {
      try {
        const r = await cliente.callBuffer('COMMAND', 'INFO', nombre)
        if (Array.isArray(r) && Array.isArray(r[0])) info = infoDeEntrada(r[0])
      } catch (err) {
        if (!esRespuestaError(err)) throw err
      }
    }
    if (!info.conocido && LECTURA_CONOCIDA.has(nombre)) info = { conocido: true, marcas: ['readonly'] }
    if (info.conocido || !nombre.includes('|')) {
      // Un «desconocido» decidido dentro de un MULTI (sin preguntar) no se recuerda.
      if (info.conocido || !estado(cliente).multi) cache.set(nombre, info)
      return info
    }
  }
  // Un servidor < 7 no tiene subcomandos en la tabla: las marcas del contenedor.
  if (nombre.includes('|')) return marcasDe(cliente, nombre.split('|')[0], cache)
  return { conocido: false, marcas: [] }
}

/**
 * Clasifica un comando: lectura = la marca `readonly` y no estar en `PELIGROSOS` (KEYS es
 * `readonly`). Un comando que el servidor no conoce NO es de lectura. Devuelve `{ lectura,
 * peligroso, noAdmitido, motivo? }`. Pura.
 */
function clasificar(nombre, info) {
  const n = String(nombre || '')
  const base = n.split('|')[0]
  const visible = nombreVisible(n)
  const peligroso = esPeligroso(n)
  if (NO_ADMITIDOS.has(base) || NO_ADMITIDOS.has(n)) {
    return { lectura: false, peligroso, noAdmitido: true, motivo: `${visible} no se admite: deja la conexión escuchando o cambia su protocolo` }
  }
  if (peligroso) return { lectura: false, peligroso: true, noAdmitido: false, motivo: `${visible} es un comando peligroso` }
  if (LECTURA_SIN_MARCA.has(n)) return { lectura: true, peligroso: false, noAdmitido: false }
  if (!info || info.conocido !== true) {
    return { lectura: false, peligroso: false, noAdmitido: false, motivo: `${visible} no es un comando que este servidor conozca` }
  }
  if (Array.isArray(info.marcas) && info.marcas.includes('readonly')) return { lectura: true, peligroso: false, noAdmitido: false }
  return { lectura: false, peligroso: false, noAdmitido: false, motivo: `${visible} puede escribir (el servidor no lo marca como de solo lectura)` }
}

function politicaNormal(p) {
  if (!p || typeof p !== 'object') return { soloLectura: true, produccion: false, confirmado: false, confirmadoPeligroso: false }
  // Un campo que no es booleano cuenta como el caso SEGURO.
  return {
    soloLectura: p.soloLectura !== false,
    produccion: p.produccion !== false,
    confirmado: p.confirmado === true,
    confirmadoPeligroso: p.confirmadoPeligroso === true
  }
}

/** Clasifica el comando con las marcas del servidor; un subcomando que el servidor conoce (un módulo) lo resuelve. */
async function clasificarConMarcas(cliente, argv, nombre, cache) {
  const c = cache instanceof Map ? cache : new Map()
  await cargarTabla(cliente, c)
  let n = nombre
  if (!n.includes('|') && argv.length > 1) {
    const sub = `${n}|${aBuffer(argv[1]).toString('utf8').toLowerCase()}`
    if (c.has(sub)) n = sub
  }
  return { nombre: n, clase: clasificar(n, await marcasDe(cliente, n, c)) }
}

/**
 * Las barreras de un comando, en este orden: no admitido, solo lectura, peligroso sin confirmar
 * y escritura en producción sin confirmar. Lanza un error con `codigo` (y `trabajador`, el
 * ErrorTrabajador ya hecho); devuelve la clasificación, o null si no hizo falta pedir marcas.
 * Sin política (`tdb`) = `soloLectura: true` siempre.
 */
async function aplicarPolitica(cliente, argv, politica, cache) {
  const p = politicaNormal(politica)
  let nombre = nombreComando(argv)
  const base = nombre.split('|')[0]
  const visible = nombreVisible(nombre)
  // 1. No admitido: da igual la política.
  if (NO_ADMITIDOS.has(base) || NO_ADMITIDOS.has(nombre)) {
    throw errorPolitica('servidor', CODIGO_NO_ADMITIDO, `${visible} no se admite en la consola: deja la conexión escuchando o cambia su protocolo.`)
  }
  let clase = null
  if (p.soloLectura || (p.produccion && !p.confirmado)) {
    const r = await clasificarConMarcas(cliente, argv, nombre, cache)
    nombre = r.nombre
    clase = r.clase
  }
  // 2. Solo lectura (también los peligrosos, aunque su marca sea `readonly`).
  if (p.soloLectura && !clase.lectura) {
    throw errorPolitica('soloLectura', CODIGO_SOLO_LECTURA, `La conexión es de solo lectura: ${clase.motivo}.`)
  }
  // 3. Peligroso sin confirmar.
  if (esPeligroso(nombre) && !p.confirmadoPeligroso) {
    throw errorPolitica('protocolo', CODIGO_PELIGROSO, `${visible} es un comando peligroso: hace falta confirmarlo.`)
  }
  // 4. Escritura en producción sin confirmar.
  if (p.produccion && !p.confirmado && !clase.lectura) {
    throw errorPolitica('protocolo', CODIGO_PRODUCCION, `Es una conexión de PRODUCCIÓN: ${clase.motivo}. Hace falta confirmarlo.`)
  }
  return clase
}

module.exports = { marcasDe, clasificar, aplicarPolitica }
