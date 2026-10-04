// =============================================================================
// La rejilla del mosaico de agentes: filas y columnas, la casilla de cada tesela
// y las plantillas CSS que la dibujan. Recibe cuántas teselas hay (`n`), el hueco
// y el tamaño de una celda de carácter; qué agentes son teselas lo decide
// `mosaicoTeselas.ts`. Puro (sin React, DOM ni plataforma): corre bajo `node`.
// Decisiones: docs/decisiones/mosaico/disposicion-de-la-rejilla.md
// =============================================================================

// Con extensión `.ts`: este módulo corre también bajo `node` a secas (su test).
import { MOSAICO_PRESETS, esPresetMosaico, type MosaicoPresetGuardado } from '../../../../shared/workspace-state-ipc.ts'
import { mismaDisposicion } from './mismaDisposicion.ts'

export { mismaDisposicion }

/**
 * Preset de disposición elegido por el usuario.
 *   · 'auto'       — la elige el módulo según el tamaño (ver el ADR).
 *   · 'cuadricula' — la rejilla equilibrada: ⌈√n⌉ columnas, por filas (ver CUADRÍCULA).
 *   · 'columnas'   — todas en una fila, una al lado de otra.
 *   · 'filas'      — todas en una columna, una encima de otra.
 *   · 'principal'  — una grande a la izquierda y las demás apiladas a la derecha.
 * Los cuatro explícitos se aplican si llegan al suelo y, si no, AUTO (ver SUELO DURO).
 *
 * La lista y su guarda salen del contrato compartido (`shared/workspace-state-ipc.ts`),
 * que es quien las persiste: una sola copia, no dos que haya que mantener a la par.
 */
export type PresetMosaico = MosaicoPresetGuardado

/** Todos los presets, en el orden en que se ofrecen. */
export const PRESETS_MOSAICO: readonly PresetMosaico[] = MOSAICO_PRESETS

// Guarda de tipo para lo que llega de persistencia o de un menú (ver el contrato).
export { esPresetMosaico }

/** Máximo de teselas del mosaico (lo que exceda se recorta). */
export const MAX_TESELAS_MOSAICO = 6

/**
 * OBJETIVO de una tesela: una terminal clásica de 80 × 24, lo que un agente de código
 * necesita para que los bloques de código y los diffs no se partan. Es a la vez la
 * UNIDAD de la puntuación (80 × 24 puntúa 1) y su TECHO (ver SATURACION_*).
 */
export const OBJETIVO_COLS = 80
export const OBJETIVO_FILAS = 24

/**
 * Saturación: a partir de aquí, más tamaño no suma puntuación. Se satura EN EL
 * OBJETIVO (ver SE SATURA EN EL OBJETIVO en el ADR), así que una tesela de
 * 80 × 24 o mayor puntúa lo máximo, 1. Se conservan como constantes aparte, y
 * exportadas, porque son API y porque dicen algo distinto que el objetivo aunque hoy
 * valgan lo mismo: el objetivo es la vara, la saturación es dónde deja de contar.
 */
export const SATURACION_COLS = OBJETIVO_COLS
export const SATURACION_FILAS = OBJETIVO_FILAS

/** Suelo de usabilidad en AUTO: por debajo, el agente no se puede usar. */
export const MINIMO_COLS = 50
export const MINIMO_FILAS = 12

/**
 * La banda del 5 %: a menos de eso, dos disposiciones son un empate para el ojo. La
 * usan, a propósito con el MISMO número, las dos reglas que lo necesitan: qué
 * candidatas empatan con la mejor (entre ellas gana la de menos filas; ver CERCA DEL
 * EMPATE, MENOS FILAS) y la histéresis (una forma nueva sólo desplaza a la vigente si
 * es más de un 5 % mejor). El nombre es anterior a la primera; se conserva porque es
 * API exportada.
 */
export const UMBRAL_HISTERESIS = 0.95

/** Forma de la disposición resultante. */
export type FormaMosaico = 'unica' | 'columnas' | 'filas' | 'rejilla' | 'principal' | 'enfoque'

/**
 * De dónde salió una disposición. Lo usa la histéresis para no pegar una forma que
 * vino de otra clase de elección (ver el ADR).
 *   · 'trivial'   — n ≤ 1: no había nada que elegir.
 *   · 'sin-medir' — forma canónica provisional, el contenedor aún no mide nada.
 *   · 'ampliada'  — el usuario amplió una tesela: gana a todo.
 *   · 'preset'    — preset explícito aplicado tal cual.
 *   · 'auto'      — la eligió AUTO (también cuando un preset explícito no cabía).
 */
export type OrigenMosaico = 'trivial' | 'sin-medir' | 'ampliada' | 'preset' | 'auto'

/** Posición en la rejilla CSS, contada desde 1: gridRow = `${fila} / span ${spanFilas}`; gridColumn, igual con columna y spanColumnas. */
export interface CeldaMosaico {
  fila: number
  columna: number
  spanFilas: number
  spanColumnas: number
}

export interface EntradaMosaico {
  /** Teselas a colocar; se recorta a 0..MAX_TESELAS_MOSAICO y se redondea hacia abajo. */
  n: number
  preset: PresetMosaico
  /** px del contenedor de la rejilla (0 o menos = aún sin medir). */
  ancho: number
  alto: number
  /** px del `gap` CSS entre teselas. */
  hueco: number
  /** px de UN carácter (ancho) y de UNA fila (alto) de la terminal. */
  celda: { ancho: number; alto: number }
  /** px que cada tesela gasta fuera de la terminal (alto: cabecera+pie; ancho: relleno+scroll). */
  cromo: { ancho: number; alto: number }
  /** Índice 0-based de la tesela ampliada, o null. */
  ampliada: number | null
  /** Índice 0-based de la tesela enfocada (la que se muestra si se cae a 'enfoque'). */
  enfocada: number | null
  /** Resultado anterior, para la histéresis. */
  anterior: DisposicionMosaico | null
}

export interface DisposicionMosaico {
  forma: FormaMosaico
  /**
   * Teselas por FILA VISUAL, de arriba abajo. Suma siempre `n`, salvo en 'enfoque'
   * ([1]: una sola pintada) y con n = 0 ([]).
   *   · rejilla / columnas / filas: [3, 2] para 5 como 3+2; [2] para 2 en columnas.
   *   · unica: [1].
   *   · principal: [2, 1, 1, …] — la primera fila visual tiene la principal y la
   *     primera de la pila; cada fila siguiente, sólo su tesela de la pila. La
   *     principal se cuenta una vez, en la fila donde EMPIEZA, aunque abarque todas.
   * Es descriptivo (y la identidad de la forma para la histéresis): para pintar,
   * el integrador sólo necesita `celdas` y las plantillas.
   */
  filasDeTeselas: number[]
  /** Valor de `grid-template-columns`. */
  plantillaColumnas: string
  /** Valor de `grid-template-rows`. */
  plantillaFilas: string
  /** Longitud = n recortado; null = la tesela no se pinta (oculta mientras otra está en 'enfoque'). */
  celdas: (CeldaMosaico | null)[]
  /** En 'enfoque': índice de la tesela que se muestra; en cualquier otra forma, null. */
  visibleEnfoque: number | null
  /** false cuando un preset explícito no llegaba al suelo y se usó AUTO en su lugar. */
  presetRespetado: boolean
  /**
   * cols × filas de la tesela pintada MÁS PEQUEÑA (0 × 0 si no se ha medido). Se
   * calcula como el mínimo de columnas y el mínimo de filas entre las teselas; en
   * todas las formas de este módulo los dos mínimos caen en la MISMA tesela (en las
   * rejillas todas las filas miden lo mismo; en `principal`, las de la pila son más
   * estrechas y más bajas que la principal), así que es el tamaño de una tesela real:
   * la peor, la que da la `puntuacion`.
   */
  minimo: { cols: number; filas: number }
  /**
   * Puntuación de la tesela más pequeña (`minimo`), que es la de la disposición:
   * (min(cols, SATURACION_COLS) / OBJETIVO_COLS) × (min(filas, SATURACION_FILAS) / OBJETIVO_FILAS).
   * Va de 0 a 1: 1 es una terminal de 80 × 24 o mayor (se satura en el objetivo).
   * 0 si no se ha medido. Ver LA PEOR TESELA MANDA en el ADR.
   */
  puntuacion: number
  /** Clase de elección que produjo este resultado (histéresis). Opcional: si falta, se decide de cero. */
  origen?: OrigenMosaico
  /** Preset que se pidió al calcularlo (histéresis). Opcional: si falta, se decide de cero. */
  presetPedido?: PresetMosaico
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

/** Pista de rejilla que puede encogerse hasta 0: sin el `minmax(0, …)`, el contenido
 *  mínimo del xterm impediría que la pista baje de su ancho intrínseco. */
const PISTA = 'minmax(0, 1fr)'
/** Columnas de `principal`: 3/5 para la principal, 2/5 para la pila. */
const PLANTILLA_PRINCIPAL = 'minmax(0, 3fr) minmax(0, 2fr)'
/** Tolerancia al pasar de px a caracteres (ver FLOTANTES en el ADR). */
const EPS_CARACTER = 1e-6
/** Diferencia de puntuación por debajo de la cual dos disposiciones empatan. */
const EPS_PUNTUACION = 1e-9

/** Forma candidata antes de colocarla: rejilla de `columnas` columnas, o principal + pila. */
type Candidata = { tipo: 'rejilla'; columnas: number } | { tipo: 'principal' }

/** Medidas ya saneadas (todo finito; celda > 0; el resto ≥ 0). */
interface Medidas {
  ancho: number
  alto: number
  hueco: number
  celdaAncho: number
  celdaAlto: number
  cromoAncho: number
  cromoAlto: number
}

interface Tamano {
  cols: number
  filas: number
}

/** Una candidata ya colocada: su geometría CSS y, si hay medidas, su tamaño en caracteres. */
interface Colocada {
  candidata: Candidata
  forma: FormaMosaico
  filasDeTeselas: number[]
  plantillaColumnas: string
  plantillaFilas: string
  celdas: CeldaMosaico[]
  /** Filas VISUALES de la rejilla (para "menos filas": ver CERCA DEL EMPATE). */
  filas: number
  minimo: Tamano
  puntuacion: number
  valida: boolean
}

function positivoFinito(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/** Un px opcional (hueco, cromo): lo no finito o negativo cuenta como 0. */
function pxSaneado(v: unknown): number {
  return positivoFinito(v) ? v : 0
}

/** n recortado a 0..MAX y redondeado hacia abajo; lo que no es un número es 0. */
function normalizarN(n: unknown): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0
  return Math.min(MAX_TESELAS_MOSAICO, Math.max(0, Math.floor(n)))
}

/** El índice, si es un entero dentro de 0..n-1; si no, null. */
function indiceValido(v: unknown, n: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : null
}

function medir(e: EntradaMosaico): Medidas | null {
  const celda = e.celda ?? { ancho: 0, alto: 0 }
  const cromo = e.cromo ?? { ancho: 0, alto: 0 }
  if (!positivoFinito(e.ancho) || !positivoFinito(e.alto)) return null
  if (!positivoFinito(celda.ancho) || !positivoFinito(celda.alto)) return null
  return {
    ancho: e.ancho,
    alto: e.alto,
    hueco: pxSaneado(e.hueco),
    celdaAncho: celda.ancho,
    celdaAlto: celda.alto,
    cromoAncho: pxSaneado(cromo.ancho),
    cromoAlto: pxSaneado(cromo.alto)
  }
}

/** Caracteres que caben en una tesela de `ancho` × `alto` px: siempre un entero finito ≥ 0. */
function caracteres(ancho: number, alto: number, m: Medidas): Tamano {
  return {
    cols: enteroDeCaracteres((ancho - m.cromoAncho) / m.celdaAncho),
    filas: enteroDeCaracteres((alto - m.cromoAlto) / m.celdaAlto)
  }
}

/**
 * Redondea hacia abajo con la tolerancia de FLOTANTES y acota a un entero finito
 * ≥ 0. Las medidas ya llegan finitas, pero con valores absurdos la aritmética se
 * sale igual: un hueco de 1e308 da −∞ en la pista y −∞ + ∞ = NaN al sumar los
 * huecos de una tesela que abarca tres, y una celda de 1e-320 px da ∞ columnas.
 * `Math.max(0, NaN)` es NaN, así que no basta con el `max` de antes: NaN y lo
 * negativo son 0 (no cabe nada) y ∞ se acota al mayor entero seguro (cabe de sobra).
 */
function enteroDeCaracteres(v: number): number {
  const x = Math.floor(v + EPS_CARACTER)
  if (!(x > 0)) return 0
  return Math.min(x, Number.MAX_SAFE_INTEGER)
}

/**
 * Puntuación de UNA tesela (ver LA PEOR TESELA MANDA en el ADR). Es monótona:
 * no baja al crecer ninguna de las dos dimensiones, y eso es lo que permite puntuar
 * `minimo` en vez de cada tesela.
 */
function puntuar(t: Tamano): number {
  return (Math.min(t.cols, SATURACION_COLS) / OBJETIVO_COLS) * (Math.min(t.filas, SATURACION_FILAS) / OBJETIVO_FILAS)
}

function esValido(t: Tamano): boolean {
  return t.cols >= MINIMO_COLS && t.filas >= MINIMO_FILAS
}

function repetir(k: number): string {
  return `repeat(${k}, ${PISTA})`
}

function mcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) {
    const r = x % y
    x = y
    y = r
  }
  return x
}

function mcm(a: number, b: number): number {
  return (a / mcd(a, b)) * b
}

/** Teselas por fila de una rejilla de `c` columnas: filas llenas y la última con el resto. */
function filasDeRejilla(n: number, c: number): number[] {
  const filas: number[] = []
  for (let resto = n; resto > 0; resto -= c) filas.push(Math.min(c, resto))
  return filas
}

function formaDeRejilla(n: number, c: number): FormaMosaico {
  if (n <= 1) return 'unica'
  if (c === n) return 'columnas'
  if (c === 1) return 'filas'
  return 'rejilla'
}

/** Coloca una rejilla de `c` columnas con la última fila estirada (T = mcm). */
function colocarRejilla(n: number, c: number, m: Medidas | null): Colocada {
  const filasDeTeselas = filasDeRejilla(n, c)
  const pistas = filasDeTeselas.reduce((t, k) => mcm(t, k), 1)
  const numFilas = filasDeTeselas.length
  const celdas: CeldaMosaico[] = []
  let minimo: Tamano = { cols: 0, filas: 0 }
  let primera = true

  const anchoPista = m ? (m.ancho - (pistas - 1) * m.hueco) / pistas : 0
  const altoFila = m ? (m.alto - (numFilas - 1) * m.hueco) / numFilas : 0

  filasDeTeselas.forEach((k, r) => {
    const span = pistas / k
    for (let p = 0; p < k; p++) {
      celdas.push({ fila: r + 1, columna: p * span + 1, spanFilas: 1, spanColumnas: span })
      if (m) {
        const t = caracteres(span * anchoPista + (span - 1) * m.hueco, altoFila, m)
        minimo = primera ? t : { cols: Math.min(minimo.cols, t.cols), filas: Math.min(minimo.filas, t.filas) }
        primera = false
      }
    }
  })

  const unica = n <= 1
  return {
    candidata: { tipo: 'rejilla', columnas: c },
    forma: formaDeRejilla(n, c),
    filasDeTeselas,
    plantillaColumnas: unica ? PISTA : repetir(pistas),
    plantillaFilas: unica ? PISTA : repetir(numFilas),
    celdas,
    filas: numFilas,
    minimo,
    puntuacion: m ? puntuar(minimo) : 0,
    valida: m ? esValido(minimo) : false
  }
}

/**
 * Principal + pila (el main-vertical de tmux), para n ≥ 3: la tesela 0 en la
 * columna 1 abarcando las n−1 filas; las demás apiladas en la columna 2.
 */
function colocarPrincipal(n: number, m: Medidas | null): Colocada {
  const pila = n - 1
  const celdas: CeldaMosaico[] = [{ fila: 1, columna: 1, spanFilas: pila, spanColumnas: 1 }]
  for (let i = 1; i <= pila; i++) celdas.push({ fila: i, columna: 2, spanFilas: 1, spanColumnas: 1 })

  let minimo: Tamano = { cols: 0, filas: 0 }
  if (m) {
    const util = m.ancho - m.hueco
    const principal = caracteres((util * 3) / 5, m.alto, m)
    const apilada = caracteres((util * 2) / 5, (m.alto - (pila - 1) * m.hueco) / pila, m)
    minimo = {
      cols: Math.min(principal.cols, apilada.cols),
      filas: Math.min(principal.filas, apilada.filas)
    }
  }

  return {
    candidata: { tipo: 'principal' },
    forma: 'principal',
    filasDeTeselas: [2, ...new Array<number>(pila - 1).fill(1)],
    plantillaColumnas: PLANTILLA_PRINCIPAL,
    plantillaFilas: repetir(pila),
    celdas,
    filas: pila,
    minimo,
    puntuacion: m ? puntuar(minimo) : 0,
    valida: m ? esValido(minimo) : false
  }
}

function colocar(n: number, cand: Candidata, m: Medidas | null): Colocada {
  // principal con menos de 3 no tiene pila: con 2 es lo mismo que columnas y con 1, única.
  if (cand.tipo === 'principal') return n >= 3 ? colocarPrincipal(n, m) : colocarRejilla(n, n, m)
  return colocarRejilla(n, Math.min(Math.max(1, cand.columnas), Math.max(1, n)), m)
}

/**
 * Columnas de la cuadrícula: la menor c con c² ≥ n, es decir ⌈√n⌉ (ver CUADRÍCULA).
 * Se cuenta con enteros en vez de `Math.ceil(Math.sqrt(n))`: con n ≤ 6 darían lo mismo,
 * pero así la regla se lee tal cual y no depende de que la raíz de un cuadrado perfecto
 * salga exacta.
 */
function columnasDeCuadricula(n: number): number {
  let c = 1
  while (c * c < n) c++
  return c
}

/** La candidata que corresponde a un preset explícito (o a la forma canónica de AUTO). */
function candidataDePreset(preset: PresetMosaico, n: number): Candidata {
  if (preset === 'cuadricula') return { tipo: 'rejilla', columnas: columnasDeCuadricula(n) }
  if (preset === 'columnas') return { tipo: 'rejilla', columnas: n }
  if (preset === 'filas') return { tipo: 'rejilla', columnas: 1 }
  if (preset === 'principal') return { tipo: 'principal' }
  // Forma canónica apaisada: 1, 2 y 3 en columnas; de 4 en adelante, dos filas.
  return { tipo: 'rejilla', columnas: n <= 3 ? n : Math.ceil(n / 2) }
}

/** Candidatas de AUTO: todas las rejillas de 1..n columnas, y principal sólo con 3. */
function candidatasAuto(n: number): Candidata[] {
  const cs: Candidata[] = []
  for (let c = 1; c <= n; c++) cs.push({ tipo: 'rejilla', columnas: c })
  if (n === 3) cs.push({ tipo: 'principal' })
  return cs
}

/**
 * ¿`p` está dentro de la banda del 5 % de `referencia`? Es la MISMA tolerancia para
 * las dos cosas que la usan (ver CERCA DEL EMPATE, MENOS FILAS e HISTÉRESIS): qué
 * candidatas empatan con la mejor, y si la anterior aguanta frente a la elegida.
 */
function dentroDeLaBanda(p: number, referencia: number): boolean {
  return p >= UMBRAL_HISTERESIS * referencia - EPS_PUNTUACION
}

/**
 * Entre dos candidatas que YA están dentro de la banda de la mejor, ¿es `b`
 * preferible a `a`? Menos filas visuales primero (ver CERCA DEL EMPATE, MENOS
 * FILAS); a igualdad de filas, más puntuación; en empate exacto, las formas de
 * rejilla antes que `principal`. Si sigue el empate gana `a`, que es la de MENOS
 * columnas (se evalúan en orden creciente): a igualdad de filas, la última fila
 * queda más llena (6 como 3+3 antes que 4+2 o 5+1).
 */
function preferible(b: Colocada, a: Colocada): boolean {
  if (b.filas !== a.filas) return b.filas < a.filas
  const d = b.puntuacion - a.puntuacion
  if (d > EPS_PUNTUACION) return true
  if (d < -EPS_PUNTUACION) return false
  const bPrincipal = b.candidata.tipo === 'principal'
  const aPrincipal = a.candidata.tipo === 'principal'
  return bPrincipal !== aPrincipal && aPrincipal
}

/**
 * La forma del resultado anterior, si puede conservarse por histéresis: misma `n`,
 * elegida por AUTO con el mismo preset pedido, y una forma que AUTO también habría
 * podido proponer (no 'enfoque', ni 'unica', ni principal fuera de n = 3). Se
 * reconstruye desde `forma` + `filasDeTeselas` y se comprueba que cuadra: una
 * anterior incoherente se ignora en vez de adivinar.
 */
function candidataDeAnterior(ant: DisposicionMosaico | null, n: number, preset: PresetMosaico): Candidata | null {
  if (!anteriorComparable(ant, n, preset)) return null
  if (ant.forma === 'principal') return n === 3 ? { tipo: 'principal' } : null
  if (ant.forma !== 'columnas' && ant.forma !== 'filas' && ant.forma !== 'rejilla') return null
  return rejillaDeAnterior(ant, n)
}

/** ¿La anterior salió de la misma clase de elección y tiene la forma de datos esperada? */
function anteriorComparable(
  ant: DisposicionMosaico | null,
  n: number,
  preset: PresetMosaico
): ant is DisposicionMosaico & { filasDeTeselas: number[] } {
  if (!ant || ant.origen !== 'auto' || ant.presetPedido !== preset) return false
  return Array.isArray(ant.celdas) && ant.celdas.length === n && Array.isArray(ant.filasDeTeselas)
}

/** La rejilla de la anterior si sus filas son las que da `filasDeRejilla` para sus columnas. */
function rejillaDeAnterior(ant: DisposicionMosaico & { filasDeTeselas: number[] }, n: number): Candidata | null {
  const c = ant.filasDeTeselas[0]
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > n) return null
  const esperadas = filasDeRejilla(n, c)
  const cuadra =
    formaDeRejilla(n, c) === ant.forma &&
    esperadas.length === ant.filasDeTeselas.length &&
    esperadas.every((k, i) => k === ant.filasDeTeselas[i])
  return cuadra ? { tipo: 'rejilla', columnas: c } : null
}

function aDisposicion(
  col: Colocada,
  medida: boolean,
  presetRespetado: boolean,
  origen: OrigenMosaico,
  presetPedido: PresetMosaico
): DisposicionMosaico {
  return {
    forma: col.forma,
    filasDeTeselas: col.filasDeTeselas,
    plantillaColumnas: col.plantillaColumnas,
    plantillaFilas: col.plantillaFilas,
    celdas: col.celdas,
    visibleEnfoque: null,
    presetRespetado,
    minimo: medida ? col.minimo : { cols: 0, filas: 0 },
    puntuacion: medida ? col.puntuacion : 0,
    origen,
    presetPedido
  }
}

/** Una sola tesela visible a pantalla completa; las demás, sin casilla. */
function enfoque(
  n: number,
  visible: number,
  m: Medidas | null,
  presetRespetado: boolean,
  origen: OrigenMosaico,
  presetPedido: PresetMosaico
): DisposicionMosaico {
  const celdas: (CeldaMosaico | null)[] = new Array<CeldaMosaico | null>(n).fill(null)
  celdas[visible] = { fila: 1, columna: 1, spanFilas: 1, spanColumnas: 1 }
  const minimo = m ? caracteres(m.ancho, m.alto, m) : { cols: 0, filas: 0 }
  return {
    forma: 'enfoque',
    filasDeTeselas: [1],
    plantillaColumnas: PISTA,
    plantillaFilas: PISTA,
    celdas,
    visibleEnfoque: visible,
    presetRespetado,
    minimo,
    puntuacion: m ? puntuar(minimo) : 0,
    origen,
    presetPedido
  }
}

/**
 * AUTO con medidas. De cero: entre las válidas que quedan dentro del 5 % de la mejor,
 * la de menos filas (`preferible`). Con histéresis: la anterior, si es válida y la
 * elegida de cero no la supera en más de un 5 %. Si ninguna candidata vale, 'enfoque'.
 */
function elegirAuto(
  n: number,
  m: Medidas,
  e: EntradaMosaico,
  preset: PresetMosaico,
  presetRespetado: boolean
): DisposicionMosaico {
  const validas = candidatasAuto(n)
    .map((cand) => colocar(n, cand, m))
    .filter((col) => col.valida)
  if (validas.length === 0) {
    return enfoque(n, indiceValido(e.enfocada, n) ?? 0, m, presetRespetado, 'auto', preset)
  }

  // La mejor puntuación sólo fija la banda; quién gana dentro de ella lo decide
  // `preferible`. La mejor está siempre en su propia banda, así que hay elegida.
  const mejorPuntuacion = Math.max(...validas.map((col) => col.puntuacion))
  const elegida = validas
    .filter((col) => dentroDeLaBanda(col.puntuacion, mejorPuntuacion))
    .reduce((a, b) => (preferible(b, a) ? b : a))

  // HISTÉRESIS contra la ELEGIDA, no contra la mejor: es la que desplazaría a la
  // anterior, y es lo que hace imposible el vaivén (ver el ADR).
  const previa = candidataDeAnterior(e.anterior, n, preset)
  if (previa) {
    const col = colocar(n, previa, m)
    if (col.valida && dentroDeLaBanda(col.puntuacion, elegida.puntuacion)) {
      return aDisposicion(col, true, presetRespetado, 'auto', preset)
    }
  }
  return aDisposicion(elegida, true, presetRespetado, 'auto', preset)
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Decide la rejilla del mosaico. Orden de precedencia:
 *   1. n = 0 → 'unica' vacía; tesela ampliada válida → 'enfoque' en ella (gana a todo).
 *   2. n = 1 → 'unica'.
 *   3. Sin medir → forma canónica del preset, provisional (puntuación 0).
 *   4. Preset explícito que llega al suelo → se aplica tal cual.
 *   5. AUTO (pedido, o porque el preset explícito no cabía): entre las válidas a
 *      menos de un 5 % de la mejor, la de menos filas, con histéresis; si ninguna
 *      llega al suelo, 'enfoque' en la enfocada (o la 0).
 * Si el resultado es igual a `anterior`, devuelve `anterior` (el mismo objeto).
 */
export function calcularMosaico(e: EntradaMosaico): DisposicionMosaico {
  const nueva = calcularDeCero(e)
  // MISMO RESULTADO, MISMO OBJETO (ver el ADR): si no cambió nada, se devuelve la
  // anterior tal cual para que `setState(prev => calcularMosaico({ …, anterior: prev }))`
  // no provoque un render.
  const ant = e.anterior
  return ant && mismaDisposicion(ant, nueva) ? ant : nueva
}

function calcularDeCero(e: EntradaMosaico): DisposicionMosaico {
  const n = normalizarN(e.n)
  const preset: PresetMosaico = esPresetMosaico(e.preset) ? e.preset : 'auto'
  const m = medir(e)

  if (n === 0) {
    return {
      forma: 'unica',
      filasDeTeselas: [],
      plantillaColumnas: PISTA,
      plantillaFilas: PISTA,
      celdas: [],
      visibleEnfoque: null,
      presetRespetado: true,
      minimo: { cols: 0, filas: 0 },
      puntuacion: 0,
      origen: 'trivial',
      presetPedido: preset
    }
  }

  const ampliada = indiceValido(e.ampliada, n)
  if (ampliada !== null) return enfoque(n, ampliada, m, true, 'ampliada', preset)

  if (n === 1) return aDisposicion(colocarRejilla(1, 1, m), m !== null, true, 'trivial', preset)

  if (m === null) return aDisposicion(colocar(n, candidataDePreset(preset, n), null), false, true, 'sin-medir', preset)

  if (preset !== 'auto') {
    const col = colocar(n, candidataDePreset(preset, n), m)
    if (col.valida) return aDisposicion(col, true, true, 'preset', preset)
    return elegirAuto(n, m, e, preset, false)
  }
  return elegirAuto(n, m, e, preset, true)
}
