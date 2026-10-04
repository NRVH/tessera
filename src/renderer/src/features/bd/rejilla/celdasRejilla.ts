// =============================================================================
// Celdas de la rejilla: qué texto se pinta (`<null>`, números como texto exacto, una línea
// cortada con `…`, `<binario N bytes>`), la validación de las páginas que llegan por IPC y
// lo puro del presupuesto de celdas (cuánto cabe y quién suelta). `truncado` es que lo
// pintado no es el valor entero; `incompleto`, que ya llegó recortado del main. Puro.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-memoria.md
// =============================================================================

import type { DbCelda, DbPagina, DbTipoLogico } from '../../../../../shared/db-explorador-ipc'

/** Unidades UTF-16 que se pintan como mucho en una celda (luego `…`). */
export const LARGO_VISIBLE_CELDA = 300

/** Lo que se pinta en lugar de un NULL. */
export const TEXTO_NULO = '<null>'

export type ClaseCelda = 'nulo' | 'num' | 'texto' | 'bin' | 'lob' | 'bool' | 'fecha'

export interface TextoCelda {
  texto: string
  clase: ClaseCelda
  /** Lo pintado no es el valor entero (tooltip). */
  truncado: boolean
  /** El valor en memoria llegó recortado del main (aviso al copiar). */
  incompleto: boolean
}

export interface OpcionesTextoCelda {
  /** Longitud original si el main recortó la celda (bytes en binario, UTF-16 en texto). */
  longitudOriginal?: number
  /**
   * Tipo del motor. Sólo se mira para un `lob` que en realidad es binario (BLOB,
   * BFILE): el trabajador puede etiquetarlo como `lob` y mandarlo en hex.
   */
  tipoMotor?: string
}

export const HEX = /^0x[0-9a-fA-F]*$/
export const TIPO_MOTOR_BINARIO = /BLOB|BFILE|RAW|BYTEA|BINARY/i
const SALTOS = /\r\n|\r|\n/g

/**
 * Espacio duro (U+00A0) como separador de miles, para que la cifra no se parta de
 * línea. Se ESCRIBE con `fromCharCode` y no se pega: el carácter crudo en el fuente es
 * invisible y `test:fuentes-limpias` lo rechaza (y con razón).
 */
export const SEPARADOR_MILES = String.fromCharCode(160)

/**
 * Entero con separador de miles a la manera de la RAE: espacio (duro, para que no
 * parta la línea) y SÓLO a partir de cinco cifras (1234, pero 12 345).
 */
export function formatoEntero(n: number): string {
  const s = String(Math.trunc(Math.abs(n)))
  const signo = n < 0 ? '-' : ''
  if (s.length < 5) return signo + s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += SEPARADOR_MILES
    out += s[i]
  }
  return signo + out
}

/** Quita un sustituto alto suelto al final (un emoji partido por el corte). */
function sinSustitutoSuelto(s: string): string {
  const u = s.charCodeAt(s.length - 1)
  return u >= 0xd800 && u <= 0xdbff ? s.slice(0, -1) : s
}

/** Una línea, cortada a `LARGO_VISIBLE_CELDA` con `…`. */
function aplanar(v: string): { texto: string; cortado: boolean } {
  let cortado = v.length > LARGO_VISIBLE_CELDA
  // Se corta ANTES de sustituir: un CLOB de 64 KiB no se recorre entero por celda.
  let t = (cortado ? v.slice(0, LARGO_VISIBLE_CELDA) : v).replace(SALTOS, ' ⏎ ')
  if (t.length > LARGO_VISIBLE_CELDA) {
    t = t.slice(0, LARGO_VISIBLE_CELDA)
    cortado = true
  }
  if (cortado) t = sinSustitutoSuelto(t) + '…'
  return { texto: t, cortado }
}

function claseDeTipo(tipo: DbTipoLogico): ClaseCelda {
  switch (tipo) {
    case 'numero':
      return 'num'
    case 'fecha':
    case 'fechaHora':
      return 'fecha'
    case 'booleano':
      return 'bool'
    case 'lob':
      return 'lob'
    case 'binario':
      return 'bin'
    default:
      return 'texto'
  }
}

/** Texto y clase de una celda para pintarla. */
export function textoCelda(
  v: DbCelda,
  tipoLogico: DbTipoLogico,
  opciones: OpcionesTextoCelda = {}
): TextoCelda {
  if (v === null || v === undefined) {
    return { texto: TEXTO_NULO, clase: 'nulo', truncado: false, incompleto: false }
  }
  if (typeof v === 'boolean') {
    return { texto: v ? 'true' : 'false', clase: 'bool', truncado: false, incompleto: false }
  }
  const recortada = opciones.longitudOriginal !== undefined && opciones.longitudOriginal >= 0
  const binario = esCeldaBinaria(tipoLogico, opciones.tipoMotor)
  if (binario && HEX.test(v)) return textoBinario(v, recortada ? (opciones.longitudOriginal as number) : null)

  const { texto, cortado } = aplanar(v)
  return {
    texto,
    clase: binario ? 'bin' : claseDeTipo(tipoLogico),
    truncado: cortado || recortada,
    incompleto: recortada
  }
}

/** ¿Se pinta como binario? El tipo lógico, o un `lob` que el tipo del motor dice binario. */
function esCeldaBinaria(tipoLogico: DbTipoLogico, tipoMotor: string | undefined): boolean {
  return tipoLogico === 'binario' || (tipoLogico === 'lob' && tipoMotor !== undefined && TIPO_MOTOR_BINARIO.test(tipoMotor))
}

/** `<binario N bytes>` de un hex `0x…`; `original` es la longitud si el main lo recortó. */
function textoBinario(v: string, original: number | null): TextoCelda {
  const enHex = Math.floor((v.length - 2) / 2)
  const bytes = original !== null ? original : enHex
  return {
    texto: `<binario ${formatoEntero(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}>`,
    clase: 'bin',
    truncado: original !== null && bytes > enHex,
    incompleto: original !== null
  }
}

// --- Llegada de páginas ------------------------------------------------------

export type ResultadoParseo =
  | { ok: true; filas: DbCelda[][] }
  | { ok: false; error: string }

/**
 * Parsea `filasJson` UNA vez y comprueba su forma: lista de filas, cada fila una
 * lista de celdas `string | boolean | null` y, si se da `numColumnas`, todas con
 * ese largo. Un número se RECHAZA: el contrato los manda como texto exacto y uno
 * de verdad significa que alguien perdió precisión por el camino.
 */
export function parsearPagina(filasJson: string, numColumnas?: number): ResultadoParseo {
  let crudo: unknown
  try {
    crudo = JSON.parse(filasJson)
  } catch {
    return { ok: false, error: 'La página de filas no es JSON válido.' }
  }
  if (!Array.isArray(crudo)) return { ok: false, error: 'La página de filas no es una lista.' }
  for (let f = 0; f < crudo.length; f++) {
    const fila: unknown = crudo[f]
    if (!Array.isArray(fila)) return { ok: false, error: `La fila ${f + 1} no es una lista.` }
    if (numColumnas !== undefined && fila.length !== numColumnas) {
      return {
        ok: false,
        error: `La fila ${f + 1} tiene ${fila.length} celdas y el resultado ${numColumnas} columnas.`
      }
    }
    for (let c = 0; c < fila.length; c++) {
      const v: unknown = fila[c]
      if (v !== null && typeof v !== 'string' && typeof v !== 'boolean') {
        return {
          ok: false,
          error: `La celda (fila ${f + 1}, columna ${c + 1}) llegó como ${typeof v}; se esperaba texto, booleano o NULL.`
        }
      }
    }
  }
  return { ok: true, filas: crudo as DbCelda[][] }
}

/** Celdas recortadas del resultado CARGADO: fila absoluta -> columna -> longitud original. */
export type MapaRecortes = ReadonlyMap<number, ReadonlyMap<number, number>>

export const SIN_RECORTES: MapaRecortes = new Map()

/**
 * Suma los recortes de una página (relativos a ELLA) al mapa del resultado, en
 * coordenadas absolutas (`desde + fila`). Inmutable: si la página no trae
 * recortes válidos devuelve el MISMO mapa, y si trae, uno nuevo. Los que caen
 * fuera de la página se ignoran (un fallo del trabajador no pinta una marca en una
 * celda que no es).
 */
export function aplicarRecortes(
  previo: MapaRecortes,
  recortes: DbPagina['recortes'],
  desde: number,
  dims: { filas: number; columnas: number }
): MapaRecortes {
  if (!recortes || recortes.length === 0) return previo
  let nuevo: Map<number, ReadonlyMap<number, number>> | null = null
  for (const r of recortes) {
    const valido = recorteValido(r, dims)
    if (!valido) continue
    const [f, c, largo] = valido
    if (!nuevo) nuevo = new Map(previo)
    const abs = desde + f
    const fila = new Map(nuevo.get(abs) ?? [])
    fila.set(c, largo)
    nuevo.set(abs, fila)
  }
  return nuevo ?? previo
}

/** El recorte `[fila, columna, largo]` si tiene forma y cae dentro de la página, o null. */
function recorteValido(r: unknown, dims: { filas: number; columnas: number }): [number, number, number] | null {
  if (!Array.isArray(r) || r.length < 3) return null
  const [f, c, largo] = r as [number, number, number]
  if (!Number.isInteger(f) || !Number.isInteger(c) || !(largo >= 0)) return null
  if (f < 0 || f >= dims.filas || c < 0 || c >= dims.columnas) return null
  return [f, c, largo]
}

/** Longitud original de una celda recortada, o `undefined` si llegó entera. */
export function longitudOriginal(mapa: MapaRecortes, f: number, c: number): number | undefined {
  return mapa.get(f)?.get(c)
}

/** Lo cargado de un resultado, que crece página a página sin mutar lo anterior. */
export interface DatosRejilla {
  readonly filas: readonly (readonly DbCelda[])[]
  readonly recortes: MapaRecortes
  readonly hayMas: boolean
}

export type ResultadoAnexar = { ok: true; datos: DatosRejilla } | { ok: false; error: string }

/**
 * Añade una página. `desde === 0` empieza de cero (primera página, o se volvió a
 * ejecutar); si no, tiene que empezar JUSTO donde acaba lo cargado: una página
 * duplicada o saltada sería un resultado falso con buena cara.
 */
export function anexarPagina(
  datos: DatosRejilla | null,
  pagina: DbPagina,
  numColumnas: number
): ResultadoAnexar {
  const p = parsearPagina(pagina.filasJson, numColumnas)
  if (!p.ok) return p
  const base = pagina.desde === 0 ? null : datos
  const cargadas = base ? base.filas.length : 0
  if (pagina.desde !== cargadas) {
    return {
      ok: false,
      error: `La página empieza en la fila ${pagina.desde + 1} y había ${cargadas} cargadas.`
    }
  }
  const filas: readonly (readonly DbCelda[])[] = base ? base.filas.concat(p.filas) : p.filas
  const recortes = aplicarRecortes(base ? base.recortes : SIN_RECORTES, pagina.recortes, pagina.desde, {
    filas: p.filas.length,
    columnas: numColumnas
  })
  return { ok: true, datos: { filas, recortes, hayMas: pagina.hayMas } }
}

/**
 * Lo que queda de una rejilla al soltar memoria: sus `n` primeras filas, los
 * recortes de ESAS filas (uno de una fila soltada marcaría una celda que ya no
 * existe) y `hayMas` a true, porque lo soltado sigue en el servidor. Con `n` o menos
 * filas devuelve la MISMA referencia: nada que soltar, nada que repintar.
 */
export function soloPrimeraPagina(datos: DatosRejilla, n: number): DatosRejilla {
  const hasta = Math.max(0, Math.floor(n))
  if (datos.filas.length <= hasta) return datos
  let recortes = datos.recortes
  let fuera = false
  recortes.forEach((_v, fila) => {
    if (fila >= hasta) fuera = true
  })
  if (fuera) {
    const nuevo = new Map<number, ReadonlyMap<number, number>>()
    recortes.forEach((v, fila) => {
      if (fila < hasta) nuevo.set(fila, v)
    })
    recortes = nuevo.size === 0 ? SIN_RECORTES : nuevo
  }
  return { filas: datos.filas.slice(0, hasta), recortes, hayMas: true }
}

// --- Presupuesto de memoria -------------------------------------------------

/**
 * Tope de celdas cargadas en el renderer, sumando TODAS las rejillas (pestañas de
 * tabla y resultados de consola): lo aplica el registro de `presupuestoCeldas.ts`.
 */
export const TOPE_CELDAS_MEMORIA = 2_000_000

export interface Presupuesto {
  usadas: number
  tope: number
  restantes: number
  /** Llegó al tope: nadie carga más solo. */
  excedido: boolean
}

export function presupuesto(celdasTotales: number, tope: number = TOPE_CELDAS_MEMORIA): Presupuesto {
  const usadas = Math.max(0, celdasTotales)
  return { usadas, tope, restantes: Math.max(0, tope - usadas), excedido: usadas >= tope }
}

export interface RejillaEnMemoria {
  id: string
  /** Celdas cargadas ahora (filas x columnas). */
  celdas: number
  /** Las que conserva al soltar (su primera página). */
  celdasPrimeraPagina: number
  visible: boolean
  /** Última vez que se vio (cualquier reloj monótono). */
  usadaEn: number
}

/**
 * Qué rejillas sueltan lo que va después de su primera página para volver bajo el
 * tope: las OCULTAS, de la menos usada a la más, hasta que alcance. Nunca la
 * visible (el usuario la está mirando). Si soltando todas las ocultas no alcanza,
 * devuelve las que haya y es `presupuesto().excedido` quien para la carga.
 */
export function rejillasALiberar(
  rejillas: readonly RejillaEnMemoria[],
  tope: number = TOPE_CELDAS_MEMORIA
): string[] {
  let total = 0
  for (const r of rejillas) total += Math.max(0, r.celdas)
  if (total <= tope) return []
  const candidatas = rejillas
    .filter((r) => !r.visible && r.celdas > r.celdasPrimeraPagina)
    .sort((a, b) => a.usadaEn - b.usadaEn)
  const ids: string[] = []
  for (const r of candidatas) {
    if (total <= tope) break
    total -= r.celdas - Math.max(0, r.celdasPrimeraPagina)
    ids.push(r.id)
  }
  return ids
}
