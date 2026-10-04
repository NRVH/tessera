// =============================================================================
// Ventana visible de la rejilla, virtualizada en los dos ejes: qué filas y columnas se
// pintan (con margen), a dónde desplazar para enseñar una celda y cuándo pedir la página
// siguiente. Columnas de ancho variable por prefijos y búsqueda binaria; filas de alto fijo.
// Puro: el DOM (alto, ancho, scroll) lo mide `DbRejilla` y llega por parámetro.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-pintado.md
// =============================================================================

/** Prefijos de anchos: `pref[i]` = x donde empieza la columna i; `pref[n]` = total. */
export function prefijosColumnas(anchos: readonly number[]): Float64Array {
  const pref = new Float64Array(anchos.length + 1)
  let x = 0
  for (let i = 0; i < anchos.length; i++) {
    const a = anchos[i]
    // Un ancho inválido (NaN, negativo) contaría hacia atrás y rompería la
    // búsqueda binaria, que exige prefijos no decrecientes.
    x += Number.isFinite(a) && a > 0 ? a : 0
    pref[i + 1] = x
  }
  return pref
}

/** Número de columnas descrito por unos prefijos. */
export function numColumnas(pref: Float64Array): number {
  return Math.max(0, pref.length - 1)
}

/** Ancho total de las columnas (sin la columna fija de números de fila). */
export function anchoTotal(pref: Float64Array): number {
  return pref.length > 0 ? pref[pref.length - 1] : 0
}

/**
 * Columna que contiene la `x` (en coordenadas de las columnas): el mayor `c` con
 * `pref[c] <= x`. Por debajo de 0 da la primera; más allá del total, la última.
 * Sin columnas, -1.
 */
export function columnaEn(pref: Float64Array, x: number): number {
  const n = numColumnas(pref)
  if (n === 0) return -1
  if (!(x > 0)) return 0 // también NaN
  if (x >= pref[n]) return n - 1
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pref[mid] <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface ParamsVentana {
  scrollTop: number
  scrollLeft: number
  /** Alto del contenedor de scroll (incluida la cabecera pegajosa si hay `altoFijo`). */
  alto: number
  /** Ancho del contenedor de scroll (incluida la columna fija de números). */
  ancho: number
  altoFila: number
  numFilas: number
  pref: Float64Array
  /** Ancho de la columna pegajosa de números de fila. */
  anchoFijo: number
  /** Alto de la cabecera pegajosa. 0 si `alto` ya es el útil. */
  altoFijo?: number
  overscanF?: number
  overscanC?: number
}

/** Ventana a pintar. Intervalos SEMIABIERTOS: filas `[f0, f1)`, columnas `[c0, c1)`. */
export interface Ventana {
  f0: number
  f1: number
  c0: number
  c1: number
}

function acotar(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

/** Qué filas y columnas hay que pintar (con su margen de overscan). */
export function ventana(p: ParamsVentana): Ventana {
  const altoFila = p.altoFila > 0 ? p.altoFila : 1
  const overscanF = p.overscanF ?? 6
  const overscanC = p.overscanC ?? 2
  const numFilas = Math.max(0, Math.floor(p.numFilas))

  const top = Math.max(0, p.scrollTop || 0)
  const altoUtil = Math.max(0, p.alto - (p.altoFijo ?? 0))
  const fIni = Math.floor(top / altoFila)
  const fFin = Math.ceil((top + altoUtil) / altoFila)
  const f0 = acotar(fIni - overscanF, 0, numFilas)
  const f1 = acotar(fFin + overscanF, f0, numFilas)

  const n = numColumnas(p.pref)
  if (n === 0) return { f0, f1, c0: 0, c1: 0 }
  const left = Math.max(0, p.scrollLeft || 0)
  const anchoUtil = Math.max(0, p.ancho - p.anchoFijo)
  const cIni = columnaEn(p.pref, left)
  // La columna que empieza JUSTO en el borde derecho no se ve, pero una de más es
  // inofensiva (el overscan ya pinta otras dos).
  const cFin = columnaEn(p.pref, left + anchoUtil)
  const c0 = acotar(cIni - overscanC, 0, n)
  const c1 = acotar(cFin + 1 + overscanC, c0, n)
  return { f0, f1, c0, c1 }
}

export interface VistaRejilla {
  scrollTop: number
  scrollLeft: number
  alto: number
  ancho: number
  altoFila: number
  pref: Float64Array
  anchoFijo: number
  altoFijo?: number
}

/**
 * El scroll mínimo que deja a la vista una celda (la del foco, tras una tecla).
 * Devuelve SOLO los ejes que cambian: `{}` si ya se ve entera. Una `f` o `c`
 * negativa significa "este eje no importa" (p. ej. la fila entera de un clic en
 * su número). Si la celda no cabe, se alinea su principio: se ve dónde empieza.
 */
export function desplazarParaMostrar(
  celda: { f: number; c: number },
  vista: VistaRejilla
): { scrollTop?: number; scrollLeft?: number } {
  const out: { scrollTop?: number; scrollLeft?: number } = {}
  const altoFila = vista.altoFila > 0 ? vista.altoFila : 1

  if (celda.f >= 0) {
    const altoUtil = Math.max(0, vista.alto - (vista.altoFijo ?? 0))
    const arriba = celda.f * altoFila
    const abajo = arriba + altoFila
    if (arriba < vista.scrollTop || altoUtil < altoFila) {
      if (arriba !== vista.scrollTop) out.scrollTop = arriba
    } else if (abajo > vista.scrollTop + altoUtil) {
      out.scrollTop = abajo - altoUtil
    }
  }

  const n = numColumnas(vista.pref)
  if (celda.c >= 0 && celda.c < n) {
    const anchoUtil = Math.max(0, vista.ancho - vista.anchoFijo)
    const izq = vista.pref[celda.c]
    const der = vista.pref[celda.c + 1]
    if (izq < vista.scrollLeft || der - izq > anchoUtil) {
      if (izq !== vista.scrollLeft) out.scrollLeft = izq
    } else if (der > vista.scrollLeft + anchoUtil) {
      out.scrollLeft = der - anchoUtil
    }
  }
  return out
}

export interface ParamsCargarMas {
  scrollTop: number
  /** Alto del contenedor de scroll. 0 = rejilla oculta: nunca pide. */
  alto: number
  altoFila: number
  numFilas: number
  hayMas: boolean
  /** Ya hay una página en vuelo: no se pide otra. */
  cargando: boolean
  altoFijo?: number
}

/** ¿Hay que pedir la página siguiente? A menos de DOS pantallas del final. */
export function debeCargarMas(p: ParamsCargarMas): boolean {
  if (!p.hayMas || p.cargando) return false
  const altoUtil = Math.max(0, p.alto - (p.altoFijo ?? 0))
  if (altoUtil <= 0) return false
  const altoFila = p.altoFila > 0 ? p.altoFila : 1
  const total = Math.max(0, p.numFilas) * altoFila
  const restante = total - (Math.max(0, p.scrollTop) + altoUtil)
  return restante < 2 * altoUtil
}

/** Filas que caben en una pantalla, para PgUp/PgDn (al menos 1, deja una de contexto). */
export function filasPorPagina(alto: number, altoFila: number, altoFijo = 0): number {
  const altoUtil = Math.max(0, alto - altoFijo)
  const af = altoFila > 0 ? altoFila : 1
  return Math.max(1, Math.floor(altoUtil / af) - 1)
}
