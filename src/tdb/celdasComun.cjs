// =============================================================================
// Lo común de las celdas del proceso de sesión: topes por celda y por respuesta, recorte de
// texto y binario, la página como `filasJson` y la salida del servidor. Pieza de `celdas.cjs`,
// que la reexporta con las de Oracle y PostgreSQL. CommonJS puro y sin E/S ni drivers.
// Decisiones: docs/decisiones/bd/celdas-valores-exactos-y-topes.md
// =============================================================================

'use strict'

/** Tope por celda de texto (unidades UTF-16). */
const TOPE_CELDA = 64 * 1024
/** Tope de `filasJson` por respuesta (unidades UTF-16). */
const TOPE_RESPUESTA = 4 * 1024 * 1024
/** Tope de `filasJson` para consultas de catálogo (índice de autocompletado). */
const TOPE_RESPUESTA_CATALOGO = 64 * 1024 * 1024

/**
 * Topes efectivos de una ejecución. `catalogo` no recorta celdas: el SQL de
 * catálogo lo escribe Tessera y sus textos (fuente de un paquete) se quieren enteros.
 */
function topesDe(opciones) {
  const o = opciones || {}
  const catalogo = o.proposito === 'catalogo'
  const topeCelda = Number.isInteger(o.topeCelda) && o.topeCelda >= 0 ? o.topeCelda : catalogo ? 0 : TOPE_CELDA
  const topeRespuesta =
    Number.isInteger(o.topeRespuesta) && o.topeRespuesta > 0
      ? o.topeRespuesta
      : catalogo
        ? TOPE_RESPUESTA_CATALOGO
        : TOPE_RESPUESTA
  // El hex ocupa el doble que los bytes: con la mitad del tope de celda, la celda
  // binaria cabe en el mismo tope que una de texto.
  const topeBinario =
    Number.isInteger(o.topeBinario) && o.topeBinario >= 0 ? o.topeBinario : topeCelda ? Math.floor(topeCelda / 2) : 0
  return { topeCelda, topeRespuesta, topeBinario, catalogo }
}

/** `null` y `undefined` pasan a `null`; lo demás, a su texto. Lo usan las tres sesiones SQL. */
function textoONulo(v) {
  return v === null || v === undefined ? null : String(v)
}

/**
 * Recorta un texto a `tope` unidades UTF-16 sin partir un par sustituto.
 * Devuelve `original` (la longitud completa) solo si recortó.
 */
function recortarTexto(texto, tope) {
  if (!tope || texto.length <= tope) return { valor: texto, original: null }
  let corte = tope
  const c = texto.charCodeAt(corte - 1)
  if (c >= 0xd800 && c <= 0xdbff) corte -= 1
  return { valor: texto.slice(0, corte), original: texto.length }
}

/** '0x' + hex en mayúsculas de, como mucho, `topeBytes` bytes. `original` en bytes. */
function hexCorto(buf, topeBytes) {
  const n = buf.length
  const usar = topeBytes && n > topeBytes ? buf.subarray(0, topeBytes) : buf
  return {
    valor: '0x' + Buffer.from(usar).toString('hex').toUpperCase(),
    original: usar.length < n ? n : null
  }
}

/** Un número de 0 a 99 con dos cifras. */
function dos(n) {
  return n < 10 ? '0' + n : String(n)
}

/** Desplazamiento '+01:00' / '-03:30' a partir de minutos con signo. */
function textoDesplazamiento(minutos) {
  const signo = minutos < 0 ? '-' : '+'
  const abs = Math.abs(minutos)
  return `${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`
}

/** Celda de catálogo: valores JSON nativos, sin recorte. */
function celdaNativa(v) {
  if (v === undefined) return null
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex').toUpperCase()
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  return v
}

// --- Página ---------------------------------------------------------------------------

/**
 * Acumula filas ya convertidas en `filasJson` con el tope de respuesta. La primera
 * fila entra siempre: sin ella no habría forma de avanzar. `agregar` devuelve false
 * (y NO añade) cuando la fila haría pasar el tope.
 */
class AcumuladorPagina {
  constructor(topeRespuesta) {
    this.tope = topeRespuesta || TOPE_RESPUESTA
    this.partes = []
    this.largo = 2
    this.recortes = []
  }

  get n() {
    return this.partes.length
  }

  /** `recortesFila`: Array<[columna, longitudOriginal]>. */
  agregar(celdas, recortesFila) {
    const json = JSON.stringify(celdas)
    const extra = json.length + (this.partes.length ? 1 : 0)
    if (this.partes.length > 0 && this.largo + extra > this.tope) return false
    const fila = this.partes.length
    this.partes.push(json)
    this.largo += extra
    if (recortesFila) {
      for (const [col, original] of recortesFila) this.recortes.push([fila, col, original])
    }
    return true
  }

  json() {
    return '[' + this.partes.join(',') + ']'
  }
}

// --- Salida del servidor (DBMS_OUTPUT / NOTICE) ---------------------------------------

/**
 * Topes de la SALIDA DEL SERVIDOR de UNA sentencia: 1000 líneas o 1 Mi unidades UTF-16 cubren
 * cualquier depuración a mano; lo que pase se descarta y una última línea lo avisa.
 */
const TOPE_SALIDA_LINEAS = 1000
const TOPE_SALIDA_CARACTERES = 1024 * 1024

/**
 * Junta las líneas de salida de una sentencia con sus topes. `agregar` devuelve
 * false cuando ya no cabe (y la cuenta como descartada). `lineas()` añade al final
 * una línea de aviso si se descartó o se cortó algo. `marcarPurgada`: el resto se
 * tiró sin leerlo (Oracle), así que el aviso no puede decir cuántas líneas eran.
 */
class AcumuladorSalida {
  constructor(topeLineas, topeCaracteres) {
    this.topeLineas = topeLineas || TOPE_SALIDA_LINEAS
    this.topeCaracteres = topeCaracteres || TOPE_SALIDA_CARACTERES
    this.lista = []
    this.caracteres = 0
    this.descartadas = 0
    this.cortada = false
    this.purgada = false
  }

  get lleno() {
    return this.lista.length >= this.topeLineas || this.caracteres >= this.topeCaracteres
  }

  agregar(texto, aviso) {
    const t = texto === null || texto === undefined ? '' : String(texto)
    if (this.lleno) {
      this.descartadas++
      return false
    }
    const r = recortarTexto(t, Math.max(1, this.topeCaracteres - this.caracteres))
    const linea = { texto: r.valor }
    if (aviso) linea.aviso = true
    this.lista.push(linea)
    this.caracteres += r.valor.length
    if (r.original !== null) this.cortada = true
    return true
  }

  marcarPurgada() {
    this.purgada = true
  }

  lineas() {
    const salida = this.lista.slice()
    if (this.purgada || this.descartadas > 0 || this.cortada) {
      let detalle
      if (this.purgada) detalle = 'el resto se descartó sin leerlo'
      else if (this.descartadas > 0) {
        detalle = this.descartadas === 1 ? 'se descartó 1 línea más' : `se descartaron ${this.descartadas} líneas más`
      } else detalle = 'la última se cortó'
      salida.push({ texto: `… salida recortada: se muestran ${this.lista.length} líneas; ${detalle}.`, aviso: true })
    }
    return salida
  }
}

module.exports = {
  TOPE_CELDA,
  TOPE_RESPUESTA,
  TOPE_RESPUESTA_CATALOGO,
  TOPE_SALIDA_LINEAS,
  TOPE_SALIDA_CARACTERES,
  topesDe,
  textoONulo,
  recortarTexto,
  hexCorto,
  dos,
  textoDesplazamiento,
  celdaNativa,
  AcumuladorPagina,
  AcumuladorSalida
}
