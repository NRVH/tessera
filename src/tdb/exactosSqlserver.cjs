// =============================================================================
// Los valores exactos de SQL Server: el parche de `readValue` de tedious, para que decimal,
// money y las fechas lleguen como texto exacto, y el enganche que deja el comando (`curCmd`) de
// cada DONE en la petición. Pieza de `sqlserverComun.cjs`, que reexporta lo que usan `tdb` y
// el trabajador. Cada parche se instala una vez por proceso.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-conexion-y-exactos.md
// =============================================================================

'use strict'

const { dos, textoDesplazamiento } = require('./celdasComun.cjs')

let estadoExactos = null

function potencia10(n) {
  let r = 1n
  for (let i = 0; i < n; i++) r *= 10n
  return r
}

function conEscala(entero, escala) {
  const negativo = entero < 0n
  let s = (negativo ? -entero : entero).toString()
  if (escala > 0) {
    s = s.padStart(escala + 1, '0')
    s = s.slice(0, s.length - escala) + '.' + s.slice(s.length - escala)
  }
  return (negativo ? '-' : '') + s
}

function uintLE(buf, ini, n) {
  let v = 0n
  for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[ini + i])
  return v
}

/** `time(escala)`: unidades de 10^-escala s en `n` bytes → 'hh:mm:ss[.fffffff]'. */
function textoHora(buf, ini, n, escala) {
  const cien = uintLE(buf, ini, n) * potencia10(7 - escala) // en unidades de 100 ns
  const seg = cien / 10000000n
  const frac = cien % 10000000n
  let t = `${dos(Number(seg / 3600n))}:${dos(Number((seg % 3600n) / 60n))}:${dos(Number(seg % 60n))}`
  if (escala > 0) t += '.' + frac.toString().padStart(7, '0').slice(0, escala)
  return t
}

/** `date`: días desde el 0001-01-01 en 3 bytes → 'AAAA-MM-DD'. */
function textoFecha(buf, ini) {
  const dias = buf[ini] | (buf[ini + 1] << 8) | (buf[ini + 2] << 16)
  const d = new Date(Date.UTC(2000, 0, 1))
  d.setUTCFullYear(1, 0, 1)
  d.setUTCDate(d.getUTCDate() + dias)
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`
}

function bytesHora(escala) {
  return escala <= 2 ? 3 : escala <= 4 ? 4 : 5
}

/** decimal y numeric: signo y magnitud en little endian, con la escala de la columna. */
function textoDecimal(buf, offset, metadata) {
  const len = buf[offset]
  const signo = buf[offset + 1] === 1 ? 1n : -1n
  return conEscala(signo * uintLE(buf, offset + 2, len - 1), metadata.scale)
}

/** money y smallmoney (fijos o `MoneyN`): un entero con 4 decimales. */
function textoDinero(buf, offset, nombre) {
  const len = nombre === 'Money' ? 8 : nombre === 'SmallMoney' ? 4 : buf[offset]
  const ini = nombre === 'MoneyN' ? offset + 1 : offset
  const v = len === 4 ? BigInt(buf.readInt32LE(ini)) : (BigInt(buf.readInt32LE(ini)) << 32n) | BigInt(buf.readUInt32LE(ini + 4))
  return conEscala(v, 4)
}

/**
 * datetimeoffset: los bytes son la hora UTC y el desplazamiento en minutos; se enseña la hora
 * LOCAL del valor con su desplazamiento.
 */
function textoDesplazada(buf, offset, metadata) {
  const lh = bytesHora(metadata.scale)
  const desplazamiento = buf.readInt16LE(offset + 1 + lh + 3)
  const utc = textoFecha(buf, offset + 1 + lh)
  const hora = textoHora(buf, offset + 1, lh, metadata.scale)
  const [hh, mm, resto] = hora.split(':')
  const d = new Date(Date.UTC(2000, 0, 1))
  const [a, m, dia] = utc.split('-').map(Number)
  d.setUTCFullYear(a, m - 1, dia)
  d.setUTCHours(Number(hh), Number(mm), 0, 0)
  d.setTime(d.getTime() + desplazamiento * 60000)
  const fecha = `${String(d.getUTCFullYear()).padStart(4, '0')}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`
  return `${fecha} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}:${resto} ${textoDesplazamiento(desplazamiento)}`
}

/**
 * El texto exacto de un valor de los tipos que tedious redondea, desde sus BYTES, o undefined
 * si el tipo no es de esos. `offset` apunta al byte de longitud (los tipos N) o al valor
 * (Money y SmallMoney fijos).
 */
function textoExacto(buf, offset, metadata) {
  const nombre = metadata.type.name
  switch (nombre) {
    case 'NumericN':
    case 'DecimalN':
      return textoDecimal(buf, offset, metadata)
    case 'Money':
    case 'SmallMoney':
    case 'MoneyN':
      return textoDinero(buf, offset, nombre)
    case 'Date':
      return textoFecha(buf, offset + 1)
    case 'Time':
      return textoHora(buf, offset + 1, buf[offset], metadata.scale)
    case 'DateTime2': {
      const lh = buf[offset] - 3
      return textoFecha(buf, offset + 1 + lh) + ' ' + textoHora(buf, offset + 1, lh, metadata.scale)
    }
    case 'DateTimeOffset':
      return textoDesplazada(buf, offset, metadata)
    default:
      return undefined
  }
}

/**
 * Instala el parche de valores exactos UNA vez por proceso: envuelve `readValue` de
 * `tedious/lib/value-parser` (los lectores de filas lo llaman por la propiedad de `exports`, así
 * que sustituirla surte efecto). Devuelve `{activo, motivo?}`; si no engancha, no toca nada y las
 * celdas caen a lo que da tedious. `vp` entra por parámetro para el test.
 */
function instalarValoresExactos(vp) {
  if (estadoExactos) return estadoExactos
  let modulo = vp
  try {
    if (!modulo) modulo = require('tedious/lib/value-parser')
  } catch (e) {
    estadoExactos = { activo: false, motivo: `no se pudo cargar el lector de valores de tedious (${e && e.message})` }
    return estadoExactos
  }
  const original = modulo && modulo.readValue
  if (typeof original !== 'function') {
    estadoExactos = { activo: false, motivo: 'tedious ya no expone readValue: los decimales y las fechas llegan redondeados' }
    return estadoExactos
  }
  const exacto = function readValueExacto(buf, offset, metadata, options) {
    const r = original(buf, offset, metadata, options)
    if (r && r.value !== null && r.value !== undefined && metadata && metadata.type) {
      const t = textoExacto(buf, offset, metadata)
      if (t !== undefined) r.value = t
    }
    return r
  }
  modulo.readValue = exacto
  estadoExactos = modulo.readValue === exacto ? { activo: true } : { activo: false, motivo: 'readValue no se dejó sustituir' }
  return estadoExactos
}

/** El estado del parche: null si no se intentó instalar. */
function valoresExactos() {
  return estadoExactos
}

/**
 * El COMANDO de cada token DONE (`curCmd` de TDS): 193 SELECT (también la asignación de una
 * variable: `DECLARE @x int = 5` y `SET @x = 3` llegan con 193 y 1 fila), 194 SELECT INTO, 195
 * INSERT, 196 DELETE, 197 UPDATE, 279 MERGE. Sin él, un `DECLARE @x int = 5; SELECT @x` enseñaba
 * «1 fila afectada» como resultado.
 */
const COMANDOS_DONE = new Map([
  [194, 'SELECT'],
  [195, 'INSERT'],
  [196, 'DELETE'],
  [197, 'UPDATE'],
  [279, 'MERGE']
])
/** `curCmd` de un SELECT o de una asignación de variable: sin columnas, no es una escritura. */
const CURCMD_SELECT = 193

let estadoCurCmd = null

/**
 * tedious no pasa el `curCmd` del DONE en sus eventos (solo la cuenta): se envuelven los tres
 * manejadores de su `RequestTokenHandler` para dejarlo en la petición (`__tesseraCurCmd`) antes
 * de que emitan. Es un interno, como el de los valores exactos, con la misma red: si no engancha
 * no se instala (`{activo:false}`) y la asignación de una variable cuenta como una fila.
 */
function instalarComandoDone(modulo) {
  if (estadoCurCmd) return estadoCurCmd
  try {
    const H = (modulo || require('tedious/lib/token/handler')).RequestTokenHandler
    for (const m of ['onDone', 'onDoneInProc', 'onDoneProc']) {
      if (!H || !H.prototype || typeof H.prototype[m] !== 'function') throw new Error(`sin ${m}`)
    }
    for (const m of ['onDone', 'onDoneInProc', 'onDoneProc']) {
      const original = H.prototype[m]
      H.prototype[m] = function conComando(token) {
        if (this.request && token) this.request.__tesseraCurCmd = token.curCmd
        return original.call(this, token)
      }
    }
    estadoCurCmd = { activo: true }
  } catch (e) {
    estadoCurCmd = { activo: false, motivo: String((e && e.message) || e) }
  }
  return estadoCurCmd
}

/** El estado del enganche: null si no se intentó instalar. */
function comandoDone() {
  return estadoCurCmd
}

/**
 * ¿La cuenta de un DONE SIN columnas es de una escritura? No si su `curCmd` es el de SELECT
 * (la asignación de una variable). Sin el enganche (`curCmd` ausente), sí.
 */
function esCuentaDeEscritura(curCmd) {
  return curCmd !== CURCMD_SELECT
}

module.exports = {
  textoExacto,
  instalarValoresExactos,
  valoresExactos,
  COMANDOS_DONE,
  CURCMD_SELECT,
  instalarComandoDone,
  comandoDone,
  esCuentaDeEscritura
}
