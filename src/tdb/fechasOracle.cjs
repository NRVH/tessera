// =============================================================================
// Fechas e intervalos de Oracle como texto exacto: desde los bytes TTC que conserva el parche
// de thin, o desde el `Date` con precisión de milisegundo si el parche no está. Pieza de
// `celdasOracle.cjs`; `parchearFechasThin` solo lo llama el trabajador.
// Decisiones: docs/decisiones/bd/celdas-valores-exactos-y-topes.md
// =============================================================================

'use strict'

const { dos, textoDesplazamiento } = require('./celdasComun.cjs')

/** Símbolo con los bytes originales de una fecha de Oracle (thin). */
const BYTES_FECHA = Symbol.for('tessera.bytesFechaOracle')

function anioTexto(a) {
  const abs = Math.abs(a)
  const s = abs < 1000 ? String(abs).padStart(4, '0') : String(abs)
  return a < 0 ? '-' + s : s
}

function fraccion6(ns) {
  return String(ns).padStart(9, '0').slice(0, 6)
}

function textoFechaHora(anio, mes, dia, hora, min, seg) {
  return `${anioTexto(anio)}-${dos(mes)}-${dos(dia)} ${dos(hora)}:${dos(min)}:${dos(seg)}`
}

/** Un `Date` UTC para cualquier año (Date.UTC trata 0-99 como 1900-1999). */
function fechaUtc(anio, mes, dia, hora, min, seg) {
  const d = new Date(Date.UTC(2000, mes - 1, dia, hora, min, seg))
  d.setUTCFullYear(anio)
  return d
}

/**
 * Texto de una fecha de Oracle a partir de sus bytes TTC (7, 11 o 13 bytes).
 * `clase`: 'fecha' (DATE), 'ts' (TIMESTAMP), 'tstz' (WITH TIME ZONE), 'tsltz'
 * (WITH LOCAL TIME ZONE). Mismo formato que el NLS fijado al abrir en thick.
 */
function textoFechaDeBytes(b, clase) {
  const anio = (b[0] - 100) * 100 + (b[1] - 100)
  const mes = b[2]
  const dia = b[3]
  const hora = b[4] - 1
  const min = b[5] - 1
  const seg = b[6] - 1
  const ns = b.length >= 11 ? b.readUInt32BE(7) : 0
  if (clase === 'fecha') return textoFechaHora(anio, mes, dia, hora, min, seg)
  if (clase === 'ts') return `${textoFechaHora(anio, mes, dia, hora, min, seg)}.${fraccion6(ns)}`

  // Con zona: los bytes van en UTC.
  const utc = fechaUtc(anio, mes, dia, hora, min, seg)
  if (clase === 'tsltz') {
    // La zona de la sesión thin es la del proceso: se pinta en hora local.
    return `${textoFechaHora(utc.getFullYear(), utc.getMonth() + 1, utc.getDate(), utc.getHours(), utc.getMinutes(), utc.getSeconds())}.${fraccion6(ns)}`
  }
  let desplazamiento = 0
  if (b.length >= 13 && !(b[11] & 0x80)) {
    // Desplazamiento numérico: horas +20 y minutos +60, cada uno con su signo.
    desplazamiento = (b[11] - 20) * 60 + (b[12] - 60)
  }
  // Con zona por región (bit alto) no hay tabla para traducirla: queda en UTC.
  const pared = new Date(utc.getTime() + desplazamiento * 60000)
  return (
    `${textoFechaHora(pared.getUTCFullYear(), pared.getUTCMonth() + 1, pared.getUTCDate(), pared.getUTCHours(), pared.getUTCMinutes(), pared.getUTCSeconds())}` +
    `.${fraccion6(ns)} ${textoDesplazamiento(desplazamiento)}`
  )
}

/**
 * Texto de una fecha de Oracle en thin. Con los bytes del parche, exacto; sin
 * ellos, desde el `Date` (thin construye DATE/TIMESTAMP con la hora LOCAL y los
 * tipos con zona en UTC), con precisión de milisegundo.
 */
function textoFechaOracle(valor, clase) {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'string') return valor
  if (!(valor instanceof Date)) return String(valor)
  const bytes = valor[BYTES_FECHA]
  if (bytes && bytes.length >= 7) return textoFechaDeBytes(bytes, clase)
  if (Number.isNaN(valor.getTime())) return null
  const ns = valor.getMilliseconds() * 1e6
  if (clase === 'tstz') {
    return `${textoFechaHora(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate(), valor.getUTCHours(), valor.getUTCMinutes(), valor.getUTCSeconds())}.${fraccion6(ns)} +00:00`
  }
  const base = textoFechaHora(valor.getFullYear(), valor.getMonth() + 1, valor.getDate(), valor.getHours(), valor.getMinutes(), valor.getSeconds())
  return clase === 'fecha' ? base : `${base}.${fraccion6(ns)}`
}

/**
 * Instala el gancho que conserva los bytes de cada fecha que decodifica thin.
 * Idempotente. Devuelve si quedó instalado. Solo lo llama el trabajador, con el
 * `require` real de oracledb: toca un módulo INTERNO del driver, y por eso todo va
 * en try y el formateo tiene respaldo si falla.
 */
function parchearFechasThin(requerir) {
  try {
    const req = typeof requerir === 'function' ? requerir : require
    const mod = req('oracledb/lib/impl/datahandlers/buffer.js')
    const Base = mod && mod.BaseBuffer
    if (!Base || typeof Base.prototype.parseOracleDate !== 'function') return false
    if (Base.prototype.parseOracleDate.__tessera) return true
    const original = Base.prototype.parseOracleDate
    const envuelta = function (buf, useLocalTime) {
      const d = original.call(this, buf, useLocalTime)
      try {
        if (d instanceof Date && buf && buf.length >= 7) {
          // Copia: `buf` es una vista del paquete de red, que se reutiliza.
          Object.defineProperty(d, BYTES_FECHA, { value: Buffer.from(buf) })
        }
      } catch {
        // El formateo tiene respaldo sin bytes.
      }
      return d
    }
    envuelta.__tessera = true
    Base.prototype.parseOracleDate = envuelta
    return true
  } catch {
    return false
  }
}

/** IntervalYM {years, months} -> '+01-02'. */
function textoIntervaloYM(v) {
  const y = Number(v.years) || 0
  const m = Number(v.months) || 0
  const neg = y < 0 || m < 0
  return `${neg ? '-' : '+'}${dos(Math.abs(y))}-${dos(Math.abs(m))}`
}

/** IntervalDS -> '+01 02:03:04.500000'. */
function textoIntervaloDS(v) {
  const d = Number(v.days) || 0
  const h = Number(v.hours) || 0
  const mi = Number(v.minutes) || 0
  const s = Number(v.seconds) || 0
  const f = Number(v.fseconds) || 0
  const neg = d < 0 || h < 0 || mi < 0 || s < 0 || f < 0
  return `${neg ? '-' : '+'}${dos(Math.abs(d))} ${dos(Math.abs(h))}:${dos(Math.abs(mi))}:${dos(Math.abs(s))}.${fraccion6(Math.abs(f))}`
}

/** IntervalYM o IntervalDS de Oracle como texto. */
function textoIntervalo(v) {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return String(v)
  return 'years' in v || 'months' in v ? textoIntervaloYM(v) : textoIntervaloDS(v)
}

module.exports = { BYTES_FECHA, textoFechaDeBytes, textoFechaOracle, parchearFechasThin, textoIntervalo }
