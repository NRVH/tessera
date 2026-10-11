// =============================================================================
// Lo que cambia en Redis Cluster: los maestros en un orden fijo, el cursor que recorre sus SCAN uno
// tras otro y los comandos de la consola que no van a un solo nodo (sin clave, o con claves de
// varios slots que se pueden repartir). Pieza de `redisComun.cjs`; la usan `ejecucionRedis.cjs` y
// `claveRedis.cjs`. Lo que no tiene sentido en Cluster (SELECT de otra base, MULTI) se dice.
// Decisiones: docs/decisiones/bd/redis-sentinel-y-cluster.md
// =============================================================================

'use strict'

const { errorUso } = require('./erroresRedis.cjs')
const { aBuffer, textoDe } = require('./valoresRedis.cjs')

/** Un cursor de SCAN de Redis cabe en 64 bits: el índice del maestro va por encima. */
const DESPLAZAMIENTO = 1n << 64n

/** Los maestros del cluster por `host:puerto`: el mismo orden en cada vuelta de SCAN. */
function maestros(cluster) {
  const lista = cluster.nodes('master').slice()
  const clave = (n) => `${n.options.host}:${String(n.options.port).padStart(5, '0')}`
  lista.sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0))
  return lista
}

/** El nombre `host:puerto` de un nodo, para los mensajes y la salida de INFO. */
function nombreNodo(n) {
  return `${n.options.host}:${n.options.port}`
}

/**
 * El cursor del recorrido de todos los maestros en una sola cifra: `indice·2^64 + cursor`. Así sigue
 * siendo un número en texto, como el de SCAN, y '0' es a la vez el principio y el final.
 */
function cursorCompuesto(indice, cursor) {
  return (BigInt(indice) * DESPLAZAMIENTO + BigInt(cursor)).toString()
}

/** `{ indice, cursor }` de un cursor compuesto (`cursor` en texto). */
function partirCursor(texto) {
  const n = BigInt(texto)
  return { indice: Number(n / DESPLAZAMIENTO), cursor: (n % DESPLAZAMIENTO).toString() }
}

/** El cursor que sigue a una vuelta del maestro `indice` que devolvió `siguiente`, con `total` maestros. */
function cursorTras(indice, siguiente, total) {
  if (siguiente !== '0') return cursorCompuesto(indice, siguiente)
  return indice + 1 < total ? cursorCompuesto(indice + 1, '0') : '0'
}

/** Ejecuta en cada maestro, en orden, y devuelve `[{ nodo, r }]`. */
async function enCadaMaestro(cluster, argv) {
  const salida = []
  for (const nodo of maestros(cluster)) salida.push({ nodo, r: await nodo.callBuffer(argv[0], ...argv.slice(1)) })
  return salida
}

const TRANSACCION = new Set(['multi', 'exec', 'discard', 'watch', 'unwatch'])
/** Cuentan claves una a una: repartir por clave da la misma suma que en un servidor. */
const SUMA_POR_CLAVE = new Set(['del', 'unlink', 'exists', 'touch'])

/** SCAN de la consola con el cursor compuesto: `[cursor, claves]` como lo da el servidor. */
async function scanConsola(cluster, argv) {
  const texto = argv.length > 1 ? aBuffer(argv[1]).toString('latin1') : ''
  if (!/^\d+$/.test(texto)) throw errorUso('El cursor de SCAN tiene que ser un número (0 la primera vez).')
  const lista = maestros(cluster)
  const { indice, cursor } = partirCursor(texto)
  if (indice >= lista.length) return [Buffer.from('0'), []]
  const r = await lista[indice].callBuffer('SCAN', cursor, ...argv.slice(2))
  return [Buffer.from(cursorTras(indice, textoDe(r[0]), lista.length)), Array.isArray(r[1]) ? r[1] : []]
}

/** INFO de cada maestro, uno tras otro y con su nombre delante. */
async function infoConsola(cluster, argv) {
  const partes = (await enCadaMaestro(cluster, argv)).map(({ nodo, r }) => `# Nodo ${nombreNodo(nodo)}\r\n${textoDe(r)}`)
  return Buffer.from(partes.join('\r\n'), 'utf8')
}

/** Un comando de varias claves, clave a clave (cada una a su nodo). */
async function porClave(cluster, nombre, argv) {
  const rs = []
  for (const k of argv.slice(1)) rs.push(await cluster.callBuffer(argv[0], k))
  // MGET de una clave contesta una lista de uno: se junta en una sola lista.
  if (nombre === 'mget') return rs.map((r) => (Array.isArray(r) ? r[0] : r))
  return String(rs.reduce((s, x) => s + Number(textoDe(x)), 0))
}

/**
 * Los comandos que en Cluster no van a un nodo cualquiera, ejecutados como corresponde; `undefined`
 * si el comando va tal cual (el cliente lo lleva al nodo de su clave, o a uno cualquiera si no tiene).
 */
async function ejecutarEnCluster(cluster, nombre, argv) {
  const base = nombre.split('|')[0]
  if (base === 'select') {
    const n = argv.length === 2 ? aBuffer(argv[1]).toString('latin1') : ''
    if (n === '0') return Buffer.from('OK')
    throw errorUso('En Cluster solo existe la base 0: SELECT no está disponible.')
  }
  if (TRANSACCION.has(base)) {
    throw errorUso(
      'En Cluster la consola no abre transacciones: cada comando puede ir a un nodo distinto. Para varias escrituras juntas sobre claves del mismo slot (con una etiqueta {…} común), usa EVAL.'
    )
  }
  switch (base) {
    case 'dbsize':
      return String((await enCadaMaestro(cluster, argv)).reduce((s, { r }) => s + Number(textoDe(r)), 0))
    case 'keys':
      return (await enCadaMaestro(cluster, argv)).flatMap(({ r }) => (Array.isArray(r) ? r : []))
    case 'scan':
      return scanConsola(cluster, argv)
    case 'flushdb':
    case 'flushall':
      await enCadaMaestro(cluster, argv)
      return Buffer.from('OK')
    case 'info':
      return infoConsola(cluster, argv)
    default:
      if ((SUMA_POR_CLAVE.has(base) || base === 'mget') && argv.length > 2) return porClave(cluster, base, argv)
      return undefined
  }
}

module.exports = { maestros, nombreNodo, cursorCompuesto, partirCursor, cursorTras, ejecutarEnCluster }
