// =============================================================================
// La entrada de `tdb` para Redis: parte el texto en comandos de redis-cli (uno por línea), hace
// `SELECT` en `tdb` mismo y aplica la guardia de solo lectura antes de conectar. Pieza de
// `redis.cjs`, que reexporta `guardiaSoloLectura`, `mensajeGuardia`, `lineas` e `interpretar`.
// Decisiones: docs/decisiones/bd/adaptador-redis-solo-lectura-y-texto.md
// =============================================================================

'use strict'

const comun = require('./redisComun.cjs')

/**
 * Las líneas con comando del texto: `{ linea, texto }` (línea desde 1). Se ignoran las vacías
 * y las que empiezan por `#`, como en un archivo `.redis` de la consola.
 */
function lineas(texto) {
  const salida = []
  String(texto)
    .split(/\r?\n/)
    .forEach((l, i) => {
      const t = l.trim()
      if (t === '' || t.startsWith('#')) return
      salida.push({ linea: i + 1, texto: t })
    })
  return salida
}

/** Columna (desde 1, en puntos de código) de la línea ORIGINAL a partir del offset en la recortada. */
function columnaDe(textoOriginal, lineaNum, offsetCp) {
  const l = String(textoOriginal).split(/\r?\n/)[lineaNum - 1] || ''
  const blancos = Array.from(l).length - Array.from(l.trimStart()).length
  return blancos + offsetCp + 1
}

/** «No se entiende el comando (línea L, columna C): …» y cómo se escribe. */
function textoSintaxis(mensaje, texto, linea, offsetCp) {
  const donde = typeof offsetCp === 'number' && offsetCp >= 0 ? ` (línea ${linea}, columna ${columnaDe(texto, linea, offsetCp)})` : ` (línea ${linea})`
  return (
    `No se entiende el comando${donde}: ${mensaje}\n` +
    '    tdb acepta comandos de redis-cli, uno por línea, con sus comillas: p. ej.\n' +
    '    HGETALL usuario:1   o   GET "clave con espacios"   (\\xHH para bytes entre comillas dobles).'
  )
}

/** El nombre del comando en mayúsculas, para los mensajes. */
function mayusculas(argv) {
  return argv.length > 0 ? argv[0].toString('utf8').toUpperCase() : ''
}

/**
 * `SELECT n` lo hace `tdb` y no se manda como un comando más: la base pedida, o un motivo si
 * está mal escrito; null si la línea no es un SELECT.
 */
function selectDe(argv) {
  if (argv.length === 0 || argv[0].toString('utf8').toLowerCase() !== 'select') return null
  const n = argv.length === 2 ? argv[1].toString('utf8') : ''
  if (!/^\d{1,4}$/.test(n)) return { motivo: 'SELECT lleva un solo argumento: el número de la base (0, 1, 2…).' }
  return { base: Number(n) }
}

/**
 * Parte el texto en comandos (sin conectar). `{ ok: true, comandos: [{ linea, texto, argv,
 * base? }] }` o `{ ok: false, motivo }` con la línea y la columna. Lo que no es un error de
 * sintaxis (un fallo de `redisComun`) se lanza.
 */
function interpretar(texto) {
  const ls = lineas(texto)
  if (ls.length === 0) return { ok: false, motivo: 'No hay ningún comando que ejecutar.' }
  const comandos = []
  for (const l of ls) {
    let argv
    try {
      argv = comun.partirComando(l.texto)
    } catch (e) {
      if (!(e instanceof comun.ErrorSintaxis)) throw e
      return { ok: false, motivo: textoSintaxis(e.message, texto, l.linea, e.offsetCp) }
    }
    if (!Array.isArray(argv) || argv.length === 0) return { ok: false, motivo: textoSintaxis('no hay comando.', texto, l.linea) }
    const sel = selectDe(argv)
    if (sel && sel.motivo) return { ok: false, motivo: `Línea ${l.linea}: ${sel.motivo}` }
    comandos.push({ linea: l.linea, texto: l.texto, argv, ...(sel ? { base: sel.base } : {}) })
  }
  return { ok: true, comandos }
}

/**
 * La guardia PURA, antes de conectar: `{ ok: true, avisos: [] }` o `{ ok: false, motivo,
 * general? }`. `general: true` = el motivo va solo (un texto que no se entiende, o un comando
 * que `tdb` no admite con ninguna conexión, no es cosa del solo lectura).
 */
function guardiaSoloLectura(texto) {
  const r = interpretar(texto)
  if (!r.ok) return { ok: false, motivo: r.motivo, general: true }
  for (const c of r.comandos) {
    if (c.base !== undefined) continue
    // `clasificar` sin marcas (no hay servidor todavía) ya sabe lo no admitido y lo peligroso,
    // resolviendo el SUBCOMANDO (`CLIENT REPLY` no se ve mirando solo `client`).
    const cl = comun.clasificar(comun.nombreComando(c.argv), null)
    if (cl.noAdmitido) {
      return {
        ok: false,
        general: true,
        motivo:
          `tdb no admite ${mayusculas(c.argv)} (línea ${c.linea}): cambia el protocolo de la conexión o la deja\n` +
          '    escuchando, y tdb abre y cierra la conexión en cada comando.'
      }
    }
    if (cl.peligroso) {
      return { ok: false, motivo: `${mayusculas(c.argv)}, en la línea ${c.linea}, es de los peligrosos: tdb no lo manda nunca` }
    }
  }
  return { ok: true, avisos: [] }
}

/**
 * El mensaje de un rechazo para el agente: la frase de siempre de `tdb` («"x" es de SOLO
 * LECTURA…»), el motivo, y quién impone el candado. Lo usan `tdb.cjs` y `consultar`.
 */
function mensajeGuardia(alias, g) {
  if (g.general) return g.motivo
  const motivo = String(g.motivo || '').replace(/[.\s]+$/, '')
  return (
    `"${alias}" es de SOLO LECTURA para los agentes (en Redis, siempre) y esa orden no es de lectura:\n` +
    `    ${motivo}.\n` +
    '    En Redis el solo lectura lo impone Tessera con las marcas de COMMAND INFO: pasan los comandos\n' +
    '    de lectura (GET, HGETALL, LRANGE, SCAN, TYPE, TTL…); KEYS, CONFIG y FLUSHALL, nunca. Para\n' +
    '    escribir, la consola de Redis de Tessera. La garantía de verdad es un usuario con ACL de lectura.'
  )
}

module.exports = { lineas, interpretar, guardiaSoloLectura, mensajeGuardia }
