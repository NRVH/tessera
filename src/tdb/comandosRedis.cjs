// =============================================================================
// Los comandos de Redis: cómo se parte un texto en comandos (la sintaxis de redis-cli), su
// nombre con subcomando y las listas de peligrosos, no admitidos y bloqueantes. Pieza de
// `redisComun.cjs`, que reexporta lo que usan `redis.cjs`, `sesionRedis.cjs` y las pruebas.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

const { ErrorSintaxis } = require('./erroresRedis.cjs')
const { aBuffer } = require('./valoresRedis.cjs')

/**
 * Se confirman siempre y se rechazan en solo lectura (aunque su marca sea `readonly`): por el
 * nombre del comando o por el subcomando entero (`script|flush`). Además de FLUSHALL, FLUSHDB,
 * KEYS, CONFIG, SHUTDOWN y DEBUG, lo que borra o sustituye datos a lo grande: REPLICAOF/SLAVEOF
 * (el servidor tira su dataset para resincronizar), SWAPDB, FAILOVER y el vaciado de scripts y
 * funciones.
 */
const PELIGROSOS = new Set([
  'flushall',
  'flushdb',
  'keys',
  'config',
  'shutdown',
  'debug',
  'replicaof',
  'slaveof',
  'swapdb',
  'failover',
  'script|flush',
  'function|flush',
  'function|restore'
])

/** ¿Es peligroso? Por el comando o por el subcomando entero. */
function esPeligroso(nombre) {
  const n = String(nombre || '')
  return PELIGROSOS.has(n.split('|')[0]) || PELIGROSOS.has(n)
}

/**
 * Cambian el protocolo de la conexión o la dejan escuchando: la consola no los admite.
 * Van por el nombre del comando o por el subcomando entero (`client|reply`: con `OFF` o `SKIP`
 * el servidor deja de contestar).
 */
const NO_ADMITIDOS = new Set([
  'subscribe',
  'psubscribe',
  'ssubscribe',
  'unsubscribe',
  'punsubscribe',
  'sunsubscribe',
  'monitor',
  'sync',
  'psync',
  'hello',
  'quit',
  'reset',
  'client|reply'
])

/** Los contenedores conocidos (el resto se resuelve con la tabla de `COMMAND`). */
const CONTENEDORES = new Set([
  'acl',
  'client',
  'cluster',
  'command',
  'config',
  'function',
  'latency',
  'memory',
  'module',
  'object',
  'pubsub',
  'script',
  'slowlog',
  'xgroup',
  'xinfo'
])

/**
 * No tocan datos aunque el servidor no los marque `readonly`. MULTI y EXEC son seguros como
 * lectura porque EXEC solo ejecuta lo encolado y cada comando encolado pasó su barrera al
 * encolarse.
 */
const LECTURA_SIN_MARCA = new Set([
  'select',
  'ping',
  'echo',
  'info',
  'time',
  'lastsave',
  'role',
  'command',
  'command|info',
  'command|count',
  'command|docs',
  'command|list',
  'command|getkeys',
  'command|getkeysandflags',
  'client|id',
  'client|info',
  'client|getname',
  'multi',
  'exec',
  'discard',
  'watch',
  'unwatch'
])

/** Comandos que pueden quedarse bloqueados (se sueltan con CLIENT UNBLOCK); además, la marca `blocking`. */
const BLOQUEANTES = new Set([
  'blpop',
  'brpop',
  'brpoplpush',
  'blmove',
  'blmpop',
  'bzpopmin',
  'bzpopmax',
  'bzmpop',
  'xread',
  'xreadgroup',
  'wait',
  'waitaof'
])

/** Lua y funciones: se paran con SCRIPT KILL / FUNCTION KILL (solo si no escribieron). */
const LUA = new Set(['eval', 'evalsha', 'eval_ro', 'evalsha_ro', 'fcall', 'fcall_ro'])

/** Para los mensajes: 'config|get' → 'CONFIG GET', recortado. */
function nombreVisible(nombre) {
  const t = String(nombre).replace('|', ' ').toUpperCase()
  return t.length > 40 ? t.slice(0, 40) + '…' : t
}

// --- Partir un comando (sdssplitargs) -------------------------------------------------------

/** `isspace` de C: lo que se salta ENTRE argumentos y lo que puede seguir a una comilla de cierre. */
const BLANCOS = new Set([' ', '\n', '\r', '\t', '\v', '\f'])
/** Lo que TERMINA un argumento sin comillas en `sdssplitargs`. */
const SEPARADORES = new Set([' ', '\n', '\r', '\t', '\0'])
const ESCAPES = { n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, a: 0x07 }

function esHex(c) {
  return typeof c === 'string' && /^[0-9a-fA-F]$/.test(c)
}

/** Añade los bytes UTF-8 de un carácter. */
function ponerCaracter(bytes, c) {
  for (const b of Buffer.from(c, 'utf8')) bytes.push(b)
}

/** Una comilla de cierre solo puede ir seguida de un blanco o del final. */
function comprobarCierre(cp, i) {
  if (cp[i + 1] !== undefined && !BLANCOS.has(cp[i + 1])) {
    throw new ErrorSintaxis('Tras unas comillas que cierran tiene que venir un espacio o el final.', i + 1)
  }
}

/**
 * Lee lo que hay entre comillas dobles, que se abren en `abre`, con sus escapes (`\n \r \t \b \a
 * \\ \"` y `\xHH`), y devuelve la posición siguiente a la comilla de cierre.
 */
function leerDobles(cp, abre, bytes) {
  let i = abre + 1
  for (;;) {
    const c = cp[i]
    if (c === undefined) throw new ErrorSintaxis('Estas comillas dobles no se cierran.', abre)
    if (c === '\\' && cp[i + 1] === 'x' && esHex(cp[i + 2]) && esHex(cp[i + 3])) {
      bytes.push(parseInt(cp[i + 2] + cp[i + 3], 16))
      i += 4
    } else if (c === '\\' && cp[i + 1] !== undefined) {
      const e = cp[i + 1]
      if (Object.prototype.hasOwnProperty.call(ESCAPES, e)) bytes.push(ESCAPES[e])
      else ponerCaracter(bytes, e)
      i += 2
    } else if (c === '"') {
      comprobarCierre(cp, i)
      return i + 1
    } else {
      ponerCaracter(bytes, c)
      i++
    }
  }
}

/** Lee lo que hay entre comillas simples (solo admiten `\'`) y devuelve la posición siguiente a la de cierre. */
function leerSimples(cp, abre, bytes) {
  let i = abre + 1
  for (;;) {
    const c = cp[i]
    if (c === undefined) throw new ErrorSintaxis('Estas comillas simples no se cierran.', abre)
    if (c === '\\' && cp[i + 1] === "'") {
      ponerCaracter(bytes, "'")
      i += 2
    } else if (c === "'") {
      comprobarCierre(cp, i)
      return i + 1
    } else {
      ponerCaracter(bytes, c)
      i++
    }
  }
}

/**
 * Lee un argumento desde `desde` y devuelve `{ arg, i }`. Termina en un separador (que consume),
 * en el final, o justo tras una comilla de cierre.
 */
function leerArgumento(cp, desde) {
  const bytes = []
  let i = desde
  while (i < cp.length && !SEPARADORES.has(cp[i])) {
    const c = cp[i]
    if (c === '"' || c === "'") {
      // Las comillas rellenan `bytes`: el argumento se arma después de leerlas.
      const fin = c === '"' ? leerDobles(cp, i, bytes) : leerSimples(cp, i, bytes)
      return { arg: Buffer.from(bytes), i: fin }
    }
    ponerCaracter(bytes, c)
    i++
  }
  return { arg: Buffer.from(bytes), i: i < cp.length ? i + 1 : i }
}

/**
 * Parte un comando como `sdssplitargs` de redis-cli: argumentos separados por blancos; una
 * comilla de cierre seguida de algo que no es blanco es un error. UN comando por texto. Una
 * comilla que no se cierra da el error en la posición de la comilla que ABRE; una de cierre
 * pegada a texto, en el carácter que la sigue. Lanza `ErrorSintaxis` con el offset en puntos de
 * código, y devuelve `Buffer[]` (el primero es el comando).
 */
function partirComando(texto) {
  if (typeof texto !== 'string') throw new ErrorSintaxis('El comando tiene que ser texto.', 0)
  const cp = Array.from(texto)
  const argv = []
  let i = 0
  for (;;) {
    while (i < cp.length && BLANCOS.has(cp[i])) i++
    if (i >= cp.length) break
    const r = leerArgumento(cp, i)
    argv.push(r.arg)
    i = r.i
  }
  if (argv.length === 0) throw new ErrorSintaxis('No hay ningún comando.', 0)
  return argv
}

/** El nombre en minúscula, con subcomando si es contenedor ('config|get'). */
function nombreComando(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return ''
  const n = aBuffer(argv[0]).toString('utf8').toLowerCase()
  if (CONTENEDORES.has(n) && argv.length > 1) return `${n}|${aBuffer(argv[1]).toString('utf8').toLowerCase()}`
  return n
}

module.exports = {
  PELIGROSOS,
  NO_ADMITIDOS,
  CONTENEDORES,
  LECTURA_SIN_MARCA,
  BLOQUEANTES,
  LUA,
  esPeligroso,
  nombreVisible,
  partirComando,
  nombreComando
}
