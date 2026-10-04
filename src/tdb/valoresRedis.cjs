// =============================================================================
// Los valores de Redis: buffers y texto, `bytes` (`DbKvBytes`), la respuesta estructurada
// (`respuestaDe`) y cómo la pinta redis-cli (`formatoCli`). Pieza de `redisComun.cjs`, que
// reexporta `bytes`, `respuestaDe` y `formatoCli`. Sin E/S ni drivers.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

'use strict'

let esUtf8Nativo = null
try {
  esUtf8Nativo = require('node:buffer').isUtf8 || null
} catch {
  esUtf8Nativo = null
}
const decodificadorEstricto = new TextDecoder('utf-8', { fatal: true })

function esUtf8(buf) {
  if (esUtf8Nativo) return esUtf8Nativo(buf)
  try {
    decodificadorEstricto.decode(buf)
    return true
  } catch {
    return false
  }
}

function aBuffer(v) {
  if (Buffer.isBuffer(v)) return v
  if (v === null || v === undefined) return Buffer.alloc(0)
  return Buffer.from(String(v), 'utf8')
}

function textoDe(v) {
  return Buffer.isBuffer(v) ? v.toString('utf8') : String(v)
}

/** Un entero de la respuesta (con `stringNumbers` llega como texto). */
function num(v) {
  if (v === null || v === undefined) return null
  const n = Number(Buffer.isBuffer(v) ? v.toString('latin1') : v)
  return Number.isFinite(n) ? n : null
}

/** El nombre del comando para mandarlo, en MAYÚSCULAS: con el nombre en minúscula ioredis aplica transformadores. */
function nombreEnvio(b) {
  const buf = aBuffer(b)
  for (const x of buf) {
    if (x > 0x7e || x < 0x21) return buf.toString('utf8')
  }
  return buf.toString('latin1').toUpperCase()
}

/** Unos bytes como `DbKvBytes`: `base64` siempre y `texto` si es UTF-8 válido. */
function bytes(buffer) {
  const b = aBuffer(buffer)
  const r = { base64: b.toString('base64') }
  if (esUtf8(b)) r.texto = b.toString('utf8')
  return r
}

/** Las respuestas de estado que un comando que LEE un valor nunca da (ver `esEstado`). */
const DEVUELVEN_VALOR = new Set([
  'get',
  'getdel',
  'getex',
  'getset',
  'getrange',
  'substr',
  'hget',
  'hrandfield',
  'lindex',
  'lpop',
  'rpop',
  'lmove',
  'rpoplpush',
  'spop',
  'srandmember',
  'echo',
  'randomkey',
  'dump',
  'json.get'
])
/** Siempre contestan con un estado (`+string`, `+Background saving started`). */
const ESTADO_SIEMPRE = new Set(['type', 'bgsave', 'bgrewriteaof'])

/**
 * ioredis devuelve el ESTADO (`+OK`) como Buffer, igual que un bulk: se decide con el comando.
 * El único error posible es pintar como estado el valor de un comando no listado que valga
 * exactamente «OK».
 */
function esEstado(buf, ctx) {
  if (!ctx || !ctx.nombre) return false
  const t = buf.toString('latin1')
  if (ctx.enMulti && t === 'QUEUED') return true
  if (ESTADO_SIEMPRE.has(ctx.nombre)) return true
  if (ctx.nombre === 'ping') return ctx.argc === 1 && t === 'PONG'
  if (DEVUELVEN_VALOR.has(ctx.nombre)) return false
  return t === 'OK' || t === 'QUEUED'
}

/**
 * La respuesta del driver como `DbKvRespuesta`. `contexto` = `{ nombre, argc, enMulti, cola }`
 * para distinguir un estado de un bulk.
 */
function respuestaDe(valor, contexto) {
  const ctx = contexto || {}
  if (valor === null || valor === undefined) return { tipo: 'nulo' }
  if (Buffer.isBuffer(valor)) return esEstado(valor, ctx) ? { tipo: 'simple', texto: valor.toString('utf8') } : { tipo: 'bytes', valor: bytes(valor) }
  if (typeof valor === 'string') return /^-?\d+$/.test(valor) ? { tipo: 'entero', valor } : { tipo: 'simple', texto: valor }
  if (typeof valor === 'number' || typeof valor === 'bigint') return { tipo: 'entero', valor: String(valor) }
  if (valor instanceof Error) return { tipo: 'error', texto: String(valor.message) }
  if (Array.isArray(valor)) {
    const cola = Array.isArray(ctx.cola) ? ctx.cola : null
    return { tipo: 'lista', elementos: valor.map((v, i) => respuestaDe(v, cola && cola[i] ? cola[i] : null)) }
  }
  return { tipo: 'simple', texto: String(valor) }
}

// --- Formato de redis-cli (tdb) -----------------------------------------------------------------

function escaparTexto(t) {
  let s = ''
  for (const ch of t) {
    const c = ch.codePointAt(0)
    if (ch === '\\') s += '\\\\'
    else if (ch === '"') s += '\\"'
    else if (ch === '\n') s += '\\n'
    else if (ch === '\r') s += '\\r'
    else if (ch === '\t') s += '\\t'
    else if (c === 0x07) s += '\\a'
    else if (c === 0x08) s += '\\b'
    else if (c < 0x20 || c === 0x7f) s += '\\x' + c.toString(16).padStart(2, '0')
    else s += ch
  }
  return s
}

function escaparBytes(b) {
  let s = ''
  for (const c of b) {
    if (c === 0x5c) s += '\\\\'
    else if (c === 0x22) s += '\\"'
    else if (c === 0x0a) s += '\\n'
    else if (c === 0x0d) s += '\\r'
    else if (c === 0x09) s += '\\t'
    else if (c === 0x07) s += '\\a'
    else if (c === 0x08) s += '\\b'
    else if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c)
    else s += '\\x' + c.toString(16).padStart(2, '0')
  }
  return s
}

/** Una lista como redis-cli: `1) "a"`, con los anidados sangrados. */
function formatoLista(els) {
  if (els.length === 0) return '(empty array)'
  const ancho = String(els.length).length
  const lineas = []
  els.forEach((e, i) => {
    const pref = `${String(i + 1).padStart(ancho)}) `
    const sub = formatoCli(e).split('\n')
    lineas.push(pref + sub[0])
    for (const l of sub.slice(1)) lineas.push(' '.repeat(pref.length) + l)
  })
  return lineas.join('\n')
}

/**
 * La respuesta como la pinta redis-cli, salvo que el texto UTF-8 válido sale tal cual
 * («"año"») y no por bytes («"a\xc3\xb1o"»): lo que no es UTF-8 sí sale por bytes.
 */
function formatoCli(respuesta) {
  const r = respuesta || { tipo: 'nulo' }
  switch (r.tipo) {
    case 'simple':
      return String(r.texto)
    case 'error':
      return `(error) ${r.texto}`
    case 'entero':
      return `(integer) ${r.valor}`
    case 'nulo':
      return '(nil)'
    case 'bytes': {
      const v = r.valor || { base64: '' }
      return typeof v.texto === 'string' ? `"${escaparTexto(v.texto)}"` : `"${escaparBytes(Buffer.from(v.base64 || '', 'base64'))}"`
    }
    case 'lista':
      return formatoLista(Array.isArray(r.elementos) ? r.elementos : [])
    default:
      return String(r.texto ?? '')
  }
}

module.exports = { esUtf8, aBuffer, textoDe, num, nombreEnvio, bytes, respuestaDe, formatoCli }
