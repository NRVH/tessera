#!/usr/bin/env node
// =============================================================================
// Prueba de mosaicoLayout: la rejilla del mosaico decidida en celdas de terminal.
// (node src/renderer/src/features/mosaico/test-mosaico-layout.mts)
// Fixture común: celda 8 × 17 px, cromo 14 × 69, hueco 4 (las pantallas reales de
// (21) usan las medidas del integrador). Cada caso escribe su cuenta a la vista
// —(77 / 80) * (21 / 24)— para poder comprobar un fallo a mano. La sección (16)
// compara con una referencia en aritmética entera que puntúa tesela a tesela.
// Decisiones: docs/decisiones/mosaico/disposicion-de-la-rejilla.md
// =============================================================================

import {
  calcularMosaico,
  esPresetMosaico,
  mismaDisposicion,
  MAX_TESELAS_MOSAICO,
  MINIMO_COLS,
  MINIMO_FILAS,
  OBJETIVO_COLS,
  OBJETIVO_FILAS,
  PRESETS_MOSAICO,
  SATURACION_COLS,
  SATURACION_FILAS,
  UMBRAL_HISTERESIS,
  type DisposicionMosaico,
  type EntradaMosaico,
  type PresetMosaico
} from './mosaicoLayout.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CELDA = { ancho: 8, alto: 17 }
const CROMO = { ancho: 14, alto: 69 }
const PISTA = 'minmax(0, 1fr)'
/**
 * Puntuación de una tesela que satura en las dos dimensiones: llega al objetivo,
 * 80 × 24 o más. Se escribe con la cuenta a la vista, como las demás: (80/80)·(24/24).
 */
const P_MAX = (80 / 80) * (24 / 24)

function entrada(extra: Partial<EntradaMosaico> = {}): EntradaMosaico {
  return {
    n: 1,
    preset: 'auto',
    ancho: 1920,
    alto: 1000,
    hueco: 4,
    celda: CELDA,
    cromo: CROMO,
    ampliada: null,
    enfocada: null,
    anterior: null,
    ...extra
  }
}

function calc(extra: Partial<EntradaMosaico> = {}): DisposicionMosaico {
  return calcularMosaico(entrada(extra))
}

function fmt(d: DisposicionMosaico): string {
  return (
    `${d.forma}[${d.filasDeTeselas.join(',')}] ${d.minimo.cols}x${d.minimo.filas} ` +
    `p=${d.puntuacion.toFixed(4)} resp=${d.presetRespetado} vis=${d.visibleEnfoque} origen=${d.origen}`
  )
}

function cerca(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9
}

function mismasFilas(d: DisposicionMosaico, filas: number[]): boolean {
  return d.filasDeTeselas.length === filas.length && d.filasDeTeselas.every((k, i) => k === filas[i])
}

/** Forma + tamaño + puntuación, lo que se afirma en casi todos los casos. */
function es(d: DisposicionMosaico, forma: string, filas: number[], cols: number, filasTerm: number, p: number): boolean {
  return (
    d.forma === forma &&
    mismasFilas(d, filas) &&
    d.minimo.cols === cols &&
    d.minimo.filas === filasTerm &&
    cerca(d.puntuacion, p)
  )
}

/** Misma geometría pintable (sin mirar origen, preset ni puntuación). */
function mismaGeometria(a: DisposicionMosaico, b: DisposicionMosaico): boolean {
  return (
    a.forma === b.forma &&
    mismasFilas(a, b.filasDeTeselas) &&
    a.plantillaColumnas === b.plantillaColumnas &&
    a.plantillaFilas === b.plantillaFilas &&
    JSON.stringify(a.celdas) === JSON.stringify(b.celdas)
  )
}

function spans(d: DisposicionMosaico): string {
  return d.celdas.map((c) => (c ? String(c.spanColumnas) : '-')).join(',')
}

/** Número de pistas de una plantilla, o null si no es una que este módulo emita. */
function pistas(plantilla: string): number | null {
  if (plantilla === PISTA) return 1
  if (plantilla === 'minmax(0, 3fr) minmax(0, 2fr)') return 2
  const m = /^repeat\((\d+), minmax\(0, 1fr\)\)$/.exec(plantilla)
  return m ? Number(m[1]) : null
}

/** Problemas estructurales de una disposición (lista vacía = sana). */
function problemas(d: DisposicionMosaico, n: number): string[] {
  const p: string[] = []
  const T = pistas(d.plantillaColumnas)
  const R = pistas(d.plantillaFilas)
  if (T === null) p.push(`plantillaColumnas rara: ${d.plantillaColumnas}`)
  if (R === null) p.push(`plantillaFilas rara: ${d.plantillaFilas}`)
  if (d.celdas.length !== n) p.push(`celdas.length=${d.celdas.length} != n=${n}`)
  if (T === null || R === null) return p

  const ocupada: boolean[][] = Array.from({ length: R }, () => new Array<boolean>(T).fill(false))
  d.celdas.forEach((c, i) => {
    if (c === null) return
    const enteros = [c.fila, c.columna, c.spanFilas, c.spanColumnas].every((v) => Number.isInteger(v) && v >= 1)
    if (!enteros) {
      p.push(`celda ${i} con valores no enteros o < 1: ${JSON.stringify(c)}`)
      return
    }
    if (c.fila + c.spanFilas - 1 > R || c.columna + c.spanColumnas - 1 > T) {
      p.push(`celda ${i} se sale de ${R}x${T}: ${JSON.stringify(c)}`)
      return
    }
    for (let f = c.fila - 1; f < c.fila - 1 + c.spanFilas; f++) {
      for (let k = c.columna - 1; k < c.columna - 1 + c.spanColumnas; k++) {
        if (ocupada[f][k]) p.push(`celda ${i} solapa en (${f + 1},${k + 1})`)
        ocupada[f][k] = true
      }
    }
  })

  const pintadas = d.celdas.filter((c) => c !== null).length
  if (d.forma === 'enfoque') {
    if (pintadas !== 1) p.push(`enfoque con ${pintadas} pintadas`)
    const v = d.visibleEnfoque
    if (v === null || d.celdas[v] === null) p.push(`visibleEnfoque=${v} no es la pintada`)
    if (T !== 1 || R !== 1) p.push(`enfoque no es 1x1: ${R}x${T}`)
    if (!mismasFilas(d, [1])) p.push(`enfoque con filasDeTeselas=${d.filasDeTeselas}`)
  } else {
    if (d.visibleEnfoque !== null) p.push(`visibleEnfoque=${d.visibleEnfoque} fuera de 'enfoque'`)
    if (pintadas !== n) p.push(`${pintadas} pintadas de ${n}`)
    const suma = d.filasDeTeselas.reduce((a, b) => a + b, 0)
    if (suma !== n) p.push(`suma(filasDeTeselas)=${suma} != n=${n}`)
    // Sin huecos: toda la rejilla cubierta (la última fila se estira).
    if (n > 0 && ocupada.some((fila) => fila.some((x) => !x))) p.push('hay huecos en la rejilla')
  }

  // Rejillas: por cada fila visual, los tramos suman T y el recuento cuadra.
  if (d.forma === 'columnas' || d.forma === 'filas' || d.forma === 'rejilla') {
    if (d.filasDeTeselas.length !== R) p.push(`filas visuales=${d.filasDeTeselas.length} != R=${R}`)
    d.filasDeTeselas.forEach((k, r) => {
      const deLaFila = d.celdas.filter((c) => c !== null && c.fila === r + 1)
      const suma = deLaFila.reduce((a, c) => a + (c ? c.spanColumnas : 0), 0)
      if (deLaFila.length !== k) p.push(`fila ${r + 1}: ${deLaFila.length} teselas != ${k}`)
      if (suma !== T) p.push(`fila ${r + 1}: tramos suman ${suma} != T=${T}`)
    })
  }
  return p
}

/** Ningún número de la salida es NaN, Infinity ni negativo; ninguna plantilla los contiene. */
function numerosSanos(d: DisposicionMosaico): boolean {
  const nums: number[] = [d.puntuacion, d.minimo.cols, d.minimo.filas, ...d.filasDeTeselas]
  if (d.visibleEnfoque !== null) nums.push(d.visibleEnfoque)
  for (const c of d.celdas) if (c) nums.push(c.fila, c.columna, c.spanFilas, c.spanColumnas)
  const plantillasSanas = [d.plantillaColumnas, d.plantillaFilas].every(
    (t) => !/NaN|Infinity|-/.test(t) && pistas(t) !== null
  )
  return plantillasSanas && nums.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
}

/** Forma legible: `rejilla[3,2]`. */
function forma(d: DisposicionMosaico): string {
  return `${d.forma}[${d.filasDeTeselas.join(',')}]`
}

// ---------------------------------------------------------------------------
// Referencia independiente (16). Se escribe de nuevo desde el contrato, en
// aritmética ENTERA: con entradas enteras, cada tamaño en caracteres es
// floor(a / b) con a y b enteros, que es exacto (no pasa por sumar fracciones de
// pista). Si el módulo y esto discrepan, uno de los dos no dice lo que el contrato.
// ---------------------------------------------------------------------------
interface Fixture {
  ancho: number
  alto: number
  hueco: number
  celdaAncho: number
  celdaAlto: number
  cromoAncho: number
  cromoAlto: number
}
interface FormaRef {
  forma: string
  filas: number[]
  cols: number
  filasTerm: number
  p: number
  valida: boolean
  principal: boolean
}
function divEntera(a: number, b: number): number {
  return Math.max(0, Math.floor(a / b))
}
/**
 * Puntuación de UNA tesela, escrita otra vez desde el contrato (no se importa la del
 * módulo ni sus constantes): (min(c, 80) / 80) · (min(f, 24) / 24), saturada en el
 * objetivo.
 */
function puntuacionRef(cols: number, filas: number): number {
  return (Math.min(cols, 80) / 80) * (Math.min(filas, 24) / 24)
}
// La referencia puntúa CADA tesela y se queda con la peor; el módulo puntúa sólo
// `minimo` (mínimo de columnas y mínimo de filas). Que coincidan en todo el barrido
// de (16) es lo que demuestra que las dos cosas son la misma (ver cabecera del módulo).
function refRejilla(n: number, c: number, f: Fixture): FormaRef {
  const filas: number[] = []
  for (let r = n; r > 0; r -= c) filas.push(Math.min(c, r))
  const mcd = (a: number, b: number): number => (b === 0 ? a : mcd(b, a % b))
  const T = filas.reduce((t, k) => (t / mcd(t, k)) * k, 1)
  const R = filas.length
  const filasTerm = divEntera(f.alto - (R - 1) * f.hueco - R * f.cromoAlto, R * f.celdaAlto)
  let cols = Number.MAX_SAFE_INTEGER
  let p = Number.POSITIVE_INFINITY
  for (const k of filas) {
    const s = T / k
    // ancho de la tesela = s·(W − (T−1)·g)/T + (s−1)·g; multiplicado por T para quedar entero.
    const num = s * (f.ancho - (T - 1) * f.hueco) + T * (s - 1) * f.hueco - T * f.cromoAncho
    const colsTesela = divEntera(num, T * f.celdaAncho)
    cols = Math.min(cols, colsTesela)
    p = Math.min(p, puntuacionRef(colsTesela, filasTerm))
  }
  const nombre = c === n ? 'columnas' : c === 1 ? 'filas' : 'rejilla'
  return {
    forma: nombre,
    filas,
    cols,
    filasTerm,
    p,
    valida: cols >= 50 && filasTerm >= 12,
    principal: false
  }
}
function refPrincipal(n: number, f: Fixture): FormaRef {
  const pila = n - 1
  // principal 3/5 y pila 2/5 de (W − g), multiplicado por 5.
  const colsPrincipal = divEntera(3 * (f.ancho - f.hueco) - 5 * f.cromoAncho, 5 * f.celdaAncho)
  const colsPila = divEntera(2 * (f.ancho - f.hueco) - 5 * f.cromoAncho, 5 * f.celdaAncho)
  const filasPrincipal = divEntera(f.alto - f.cromoAlto, f.celdaAlto)
  const filasPila = divEntera(f.alto - (pila - 1) * f.hueco - pila * f.cromoAlto, pila * f.celdaAlto)
  const cols = Math.min(colsPrincipal, colsPila)
  const filasTerm = Math.min(filasPrincipal, filasPila)
  return {
    forma: 'principal',
    filas: [2, ...new Array<number>(pila - 1).fill(1)],
    cols,
    filasTerm,
    p: Math.min(puntuacionRef(colsPrincipal, filasPrincipal), puntuacionRef(colsPila, filasPila)),
    valida: cols >= 50 && filasTerm >= 12,
    principal: true
  }
}
/**
 * AUTO de referencia, escrito desde el contrato: entre las válidas que puntúan al
 * menos 0,95 × la mejor, la de MENOS filas visuales; a igualdad de filas, la que más
 * puntúa; luego rejilla antes que principal; luego menos columnas. null si ninguna vale.
 */
function refAuto(n: number, f: Fixture): FormaRef | null {
  const candidatas: FormaRef[] = []
  for (let c = 1; c <= n; c++) candidatas.push(refRejilla(n, c, f))
  if (n === 3) candidatas.push(refPrincipal(n, f))
  const validas = candidatas.filter((x) => x.valida)
  if (validas.length === 0) return null
  const mejor = Math.max(...validas.map((x) => x.p))
  const empatadas = validas.filter((x) => x.p >= 0.95 * mejor - 1e-9)
  empatadas.sort((a, b) => {
    if (a.filas.length !== b.filas.length) return a.filas.length - b.filas.length
    if (Math.abs(a.p - b.p) >= 1e-9) return b.p - a.p
    if (a.principal !== b.principal) return a.principal ? 1 : -1
    return a.filas[0] - b.filas[0]
  })
  return empatadas[0]
}
/** La de MAYOR puntuación de la referencia (la que elegía la regla descartada), o null. */
function refMejor(n: number, f: Fixture): FormaRef | null {
  const validas: FormaRef[] = []
  for (let c = 1; c <= n; c++) validas.push(refRejilla(n, c, f))
  if (n === 3) validas.push(refPrincipal(n, f))
  return validas.filter((x) => x.valida).reduce<FormaRef | null>((a, b) => (a === null || b.p > a.p + 1e-9 ? b : a), null)
}
function refATexto(r: FormaRef): string {
  return `${r.forma}[${r.filas.join(',')}] ${r.cols}x${r.filasTerm}`
}
function calcFixture(f: Fixture, n: number, preset: PresetMosaico): DisposicionMosaico {
  return calcularMosaico({
    n,
    preset,
    ancho: f.ancho,
    alto: f.alto,
    hueco: f.hueco,
    celda: { ancho: f.celdaAncho, alto: f.celdaAlto },
    cromo: { ancho: f.cromoAncho, alto: f.cromoAlto },
    ampliada: null,
    enfocada: null,
    anterior: null
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  hr('(1) Constantes y esPresetMosaico')

  // La saturación ES el objetivo (ver SE SATURA EN EL OBJETIVO en la cabecera del
  // módulo): con 100 × 40, 4 agentes en 1920 × 1080 salían en columnas de 52.
  check(
    '(1a) constantes del contrato; la saturación es el objetivo (80 × 24), no 100 × 40',
    MAX_TESELAS_MOSAICO === 6 &&
      OBJETIVO_COLS === 80 &&
      OBJETIVO_FILAS === 24 &&
      MINIMO_COLS === 50 &&
      MINIMO_FILAS === 12 &&
      SATURACION_COLS === 80 &&
      SATURACION_FILAS === 24 &&
      SATURACION_COLS === OBJETIVO_COLS &&
      SATURACION_FILAS === OBJETIVO_FILAS &&
      UMBRAL_HISTERESIS === 0.95,
    `max=${MAX_TESELAS_MOSAICO} objetivo=${OBJETIVO_COLS}x${OBJETIVO_FILAS} minimo=${MINIMO_COLS}x${MINIMO_FILAS} ` +
      `saturacion=${SATURACION_COLS}x${SATURACION_FILAS}`
  )
  check(
    '(1b) PRESETS_MOSAICO en su orden (cuadricula justo detrás de auto)',
    JSON.stringify(PRESETS_MOSAICO) === JSON.stringify(['auto', 'cuadricula', 'columnas', 'filas', 'principal']),
    JSON.stringify(PRESETS_MOSAICO)
  )
  // Los nombres de tmux y kitty, y la palabra con tilde, NO son el preset: lo que se
  // persiste y viaja por el menú es 'cuadricula' tal cual.
  check(
    '(1c) esPresetMosaico acepta los cinco y rechaza el resto',
    PRESETS_MOSAICO.length === 5 &&
      PRESETS_MOSAICO.every((p) => esPresetMosaico(p)) &&
      esPresetMosaico('cuadricula') &&
      !esPresetMosaico('cuadrícula') &&
      !esPresetMosaico('tiled') &&
      !esPresetMosaico('grid') &&
      !esPresetMosaico('rejilla') &&
      !esPresetMosaico('AUTO') &&
      !esPresetMosaico(3) &&
      !esPresetMosaico(null) &&
      !esPresetMosaico(undefined),
    'auto/cuadricula/columnas/filas/principal sí; cuadrícula, tiled, grid, rejilla, AUTO, 3, null, undefined no'
  )

  // ---------------------------------------------------------------------------
  hr('(2) Triviales y saneado de n')

  {
    const d = calc({ n: 0 })
    check(
      '(2a) n=0 → unica vacía, plantillas 1x1',
      d.forma === 'unica' &&
        d.celdas.length === 0 &&
        d.filasDeTeselas.length === 0 &&
        d.plantillaColumnas === PISTA &&
        d.plantillaFilas === PISTA &&
        d.visibleEnfoque === null,
      fmt(d)
    )
  }
  {
    // 1920-14 = 1906 / 8 = 238,25 → 238; 1000-69 = 931 / 17 = 54,8 → 54.
    // p = (80/80)·(24/24) = 1: satura en las dos (238 > 80, 54 > 24).
    const d = calc({ n: 1 })
    const c = d.celdas[0]
    check(
      '(2b) n=1 → unica, una celda {1,1,1,1}, medida',
      es(d, 'unica', [1], 238, 54, P_MAX) &&
        d.celdas.length === 1 &&
        c !== null &&
        c.fila === 1 &&
        c.columna === 1 &&
        c.spanFilas === 1 &&
        c.spanColumnas === 1 &&
        d.plantillaColumnas === PISTA &&
        d.plantillaFilas === PISTA,
      fmt(d)
    )
  }
  {
    const siete = calc({ n: 7 })
    const seis = calc({ n: 6 })
    check('(2c) n=7 se recorta a 6', siete.celdas.length === 6 && mismaGeometria(siete, seis), fmt(siete))
    const d = calc({ n: 2.9 })
    check('(2d) n=2.9 se redondea hacia abajo a 2', d.celdas.length === 2 && d.forma === 'columnas', fmt(d))
    const neg = calc({ n: -3 })
    const nan = calc({ n: Number.NaN })
    const inf = calc({ n: Number.POSITIVE_INFINITY })
    check(
      '(2e) n negativo o NaN → 0; Infinity → 6',
      neg.celdas.length === 0 && nan.celdas.length === 0 && inf.celdas.length === 6,
      `neg=${neg.celdas.length} nan=${nan.celdas.length} inf=${inf.celdas.length}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(3) 1920 × 1000, AUTO, n = 1..6')

  {
    // n=2 columnas: pista (1920-4)/2 = 958 → (958-14)/8 = 118 cols; alto 54 filas.
    //   p = (80/80)·(24/24) = 1: satura. En filas: 238 × 25 → también 1 (25 ≥ 24). EMPATE,
    //   y gana la de menos filas de teselas: columnas.
    const d2 = calc({ n: 2 })
    check(
      '(3a) n=2 → columnas [2], 118x54, p=1 (filas, 238x25, también satura: empate, gana la de menos filas)',
      es(d2, 'columnas', [2], 118, 54, P_MAX),
      fmt(d2)
    )
  }
  {
    // n=3 → TRES COLUMNAS, que es lo que se pidió («si hay 3, en 3»):
    //   columnas [3]:  pista (1920-8)/3 = 637,3 → 77 cols × 54 filas → (77/80)·(24/24) = 0,9625
    //   rejilla [2,1]: arriba 118 cols, abajo 238; filas (1000-4)/2 = 498 → 25 → satura: 1
    //   principal:     pila 2/5·1916 = 766,4 → 94 cols × 25 filas → satura: 1
    //   filas:         238 × 15 → (80/80)·(15/24) = 0,625
    // 2+1 y principal son las MEJORES (1), pero tres columnas están al 96,3 %, dentro del
    // 5 %, y tienen una fila de teselas en vez de dos: ganan por menos filas.
    const d3 = calc({ n: 3 })
    check(
      '(3b) n=3 → columnas [3], 77x54, p=0,9625 (no 2+1: dentro del 5 % de la mejor y con menos filas)',
      es(d3, 'columnas', [3], 77, 54, (77 / 80) * (24 / 24)),
      fmt(d3)
    )
    const pri3 = calc({ n: 3, preset: 'principal' })
    const fil3 = calc({ n: 3, preset: 'filas' })
    check(
      '(3b2) …principal (94x25) puntúa MÁS (1) y aun así pierde por tener dos filas; filas (238x15) puntúa menos',
      es(pri3, 'principal', [2, 1], 94, 25, (80 / 80) * (24 / 24)) &&
        es(fil3, 'filas', [1, 1, 1], 238, 15, (80 / 80) * (15 / 24)) &&
        pri3.puntuacion > d3.puntuacion &&
        d3.puntuacion >= UMBRAL_HISTERESIS * pri3.puntuacion &&
        fil3.puntuacion < d3.puntuacion,
      `principal=${fmt(pri3)} | filas=${fmt(fil3)}`
    )
    // Por qué se DESCARTÓ min(cols/80, filas/24) SIN tope: con esa fórmula ganaba 2+1, y
    // ni con la banda del 5 % saldrían tres columnas (0,9625 es el 92,4 % de 1,0417). La
    // peor tesela de [2,1] es una de arriba, idéntica a las del 2×2 de n=4 (misma T = 2 y
    // las mismas dos filas visuales): 118 × 25. Se toman los dos tamaños del módulo. Con
    // la actual, 2+1 también puntúa más (1), pero tres columnas quedan dentro del 5 %.
    const d4 = calc({ n: 4 })
    const descartada = (t: { cols: number; filas: number }): number => Math.min(t.cols / 80, t.filas / 24)
    check(
      '(3b3) la fórmula descartada elegía 2+1 (0,9625 es el 92,4 % de 1,0417: ni con la banda); la actual, tres columnas (0,9625 es el 96,3 % de 1)',
      d3.minimo.cols === 77 &&
        d3.minimo.filas === 54 &&
        d4.minimo.cols === 118 &&
        d4.minimo.filas === 25 &&
        descartada(d3.minimo) < UMBRAL_HISTERESIS * descartada(d4.minimo) &&
        cerca(d4.puntuacion, P_MAX) &&
        d3.puntuacion < d4.puntuacion &&
        d3.puntuacion >= UMBRAL_HISTERESIS * d4.puntuacion,
      `descartada: ${descartada(d3.minimo).toFixed(4)} vs ${descartada(d4.minimo).toFixed(4)} | ` +
        `actual: ${d3.puntuacion.toFixed(4)} vs ${d4.puntuacion.toFixed(4)}`
    )
    // `principal` NUNCA gana en AUTO, pero sí puede EMPATAR como la mejor. En 1800 × 1000:
    //   [2,1]:     (1800-4)/2 = 898 → (898-14)/8 = 110 cols; filas (1000-4)/2 = 498 → 25 → satura: 1
    //   principal: pila 2/5·1796 = 718,4 → (718,4-14)/8 = 88 cols × 25 → satura: 1 (EMPATE)
    //   columnas:  (1800-8)/3 = 597,3 → 72 cols × 54 → (72/80)·(24/24) = 0,9 (90 %: fuera de la banda)
    //   filas:     (1000-8)/3 = 330,7 → 15 filas × 223 → (80/80)·(15/24) = 0,625
    // Las dos mejores tienen dos filas; el desempate prefiere la rejilla a principal.
    const auto1800 = calc({ n: 3, ancho: 1800 })
    const pri1800 = calc({ n: 3, ancho: 1800, preset: 'principal' })
    check(
      '(3b4) principal empata con [2,1] como la mejor (1800 × 1000, las dos saturan; tres columnas al 90 %) y pierde el desempate',
      es(auto1800, 'rejilla', [2, 1], 110, 25, P_MAX) && es(pri1800, 'principal', [2, 1], 88, 25, P_MAX),
      `auto=${fmt(auto1800)} | principal=${fmt(pri1800)}`
    )
  }
  {
    // n=4 [2,2]: 118 × 25 → satura: 1.
    //   ([3,1]: 77 × 25 → 0,9625, en la banda y con las MISMAS dos filas: gana la que más puntúa;
    //    [4]: (1920-12)/4 = 477 → 57 × 54 → (57/80)·(24/24) = 0,7125; filas: 10 < 12.)
    const d4 = calc({ n: 4 })
    check('(3c) n=4 → rejilla [2,2], 118x25, p=1 (cuatro columnas de 57 se quedan en 0,7125)', es(d4, 'rejilla', [2, 2], 118, 25, P_MAX), fmt(d4))
    // n=5 [3,2]: T=6, pista (1920-20)/6 = 316,7; arriba 2 pistas = 637,3 → 77; abajo 3 = 958 → 118.
    //   p = (77/80)·(24/24) = 0,9625 (la peor es la de arriba; la de abajo satura).
    //   ([2,2,1]: 118 × 15 → 0,625; [4,1]: 57 × 25 → 0,7125; [5]: 45 cols < 50.)
    const d5 = calc({ n: 5 })
    check('(3d) n=5 → rejilla [3,2], 77x25, p=0,9625', es(d5, 'rejilla', [3, 2], 77, 25, (77 / 80) * (24 / 24)), fmt(d5))
    // n=6 [3,3]: 77 × 25 → 0,9625. ([2,2,2]: 118 × 15 → 0,625; [4,2]: 57 × 25 → 0,7125; [5,1] y [6]: < 50 cols.)
    const d6 = calc({ n: 6 })
    check('(3e) n=6 → rejilla [3,3], 77x25, p=0,9625', es(d6, 'rejilla', [3, 3], 77, 25, (77 / 80) * (24 / 24)), fmt(d6))
    const todos = [1, 2, 3, 4, 5, 6].map((n) => calc({ n }))
    const formas = todos.map(forma)
    const esperadas = ['unica[1]', 'columnas[2]', 'columnas[3]', 'rejilla[2,2]', 'rejilla[3,2]', 'rejilla[3,3]']
    check(
      '(3f) n=1..6: una / 2 y 3 en columnas / 2×2 / 3+2 / 3+3; todas de AUTO (salvo n=1, trivial)',
      JSON.stringify(formas) === JSON.stringify(esperadas) &&
        todos.every((d) => d.presetRespetado) &&
        todos[0].origen === 'trivial' &&
        todos.slice(1).every((d) => d.origen === 'auto'),
      formas.join(' / ')
    )
  }

  // ---------------------------------------------------------------------------
  hr('(4) 1366 × 690 con 3 y con 6')

  {
    // n=6 [3,3]: pista (1366-8)/3 = 452,7 → (438,7)/8 = 54 cols; fila (690-4)/2 = 343 → 274/17 = 16.
    //   p = (54/80)·(16/24) = 0,45: corta en LAS DOS dimensiones, y el producto cuenta los dos
    //   déficits. Por encima del suelo 50 × 12.
    //   [2,2,2]: 9 filas; [4,2]: 40 cols; [6], [5,1], filas: fuera del suelo.
    const d = calc({ n: 6, ancho: 1366, alto: 690 })
    check('(4a) n=6 → rejilla [3,3], 54x16, p=0,45', es(d, 'rejilla', [3, 3], 54, 16, (54 / 80) * (16 / 24)), fmt(d))
    // n=3 columnas [3]: 54 cols × (690-69)/17 = 36,5 → 36 filas → (54/80)·(24/24) = 0,675 (las 12
    //   filas por encima de 24 no cuentan).
    //   [2,1]: (1366-4)/2 = 681 → 83 cols × 16 → (80/80)·(16/24) = 0,6667 (98,8 %, pero con dos filas);
    //   principal: 66 × 16 → 0,55; filas: (690-8)/3 = 227,3 → 9 filas < 12.
    const d3 = calc({ n: 3, ancho: 1366, alto: 690 })
    check('(4b) n=3 → columnas [3], 54x36, p=0,675', es(d3, 'columnas', [3], 54, 36, (54 / 80) * (24 / 24)), fmt(d3))
  }

  // ---------------------------------------------------------------------------
  hr('(5) 900 × 560 con 6: nada llega al suelo')

  {
    // [3,3]: (900-8)/3 = 297,3 → 35 cols < 50. [2,2,2]: filas (560-8)/3 = 184 → 6 < 12. El resto, peor.
    // Enfoque a pantalla completa: (900-14)/8 = 110 cols; (560-69)/17 = 28 filas → satura: 1.
    const d = calc({ n: 6, ancho: 900, alto: 560, enfocada: 4 })
    check(
      '(5a) enfoque en la enfocada (4), a pantalla completa',
      d.forma === 'enfoque' &&
        d.visibleEnfoque === 4 &&
        d.celdas[4] !== null &&
        d.celdas.filter((c) => c !== null).length === 1 &&
        d.minimo.cols === 110 &&
        d.minimo.filas === 28 &&
        cerca(d.puntuacion, P_MAX) &&
        d.origen === 'auto' &&
        d.presetRespetado,
      fmt(d)
    )
    const sinFoco = calc({ n: 6, ancho: 900, alto: 560, enfocada: null })
    const fuera = calc({ n: 6, ancho: 900, alto: 560, enfocada: 9 })
    check(
      '(5b) sin enfocada (o fuera de rango) → la 0',
      sinFoco.forma === 'enfoque' && sinFoco.visibleEnfoque === 0 && fuera.visibleEnfoque === 0,
      `null → ${sinFoco.visibleEnfoque}, 9 → ${fuera.visibleEnfoque}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(6) Vertical 1080 × 1800 y ultrapanorámica 3440 × 1400')

  {
    // n=2 filas: 1080-14 = 1066/8 → 133 cols; (1800-4)/2 = 898 → 829/17 = 48. Satura: p = 1.
    //   columnas: (1080-4)/2 = 538 → 65 cols × 101 filas → (65/80)·(24/24) = 0,8125 (81,3 %: fuera).
    const d2 = calc({ n: 2, ancho: 1080, alto: 1800 })
    check('(6a) n=2 → filas [1,1], 133x48, p=1 (columnas se quedan en 65: 0,8125)', es(d2, 'filas', [1, 1], 133, 48, P_MAX), fmt(d2))
    // n=4 → FILAS, no 2×2. Con la saturación en el objetivo las 48 filas del 2×2 cuentan como
    // 24 y sus 65 columnas se quedan cortas; a filas le faltan 2 filas, que pesan menos:
    //   filas: (1800-12)/4 = 447 → 378/17 = 22 filas × 133 → (80/80)·(22/24) = 0,9167 (la mejor)
    //   [2,2]: 65 cols × 48 filas → (65/80)·(24/24) = 0,8125 (88,6 %: fuera de la banda)
    //   [3,1]: 42 cols < 50; [4]: (1080-12)/4 = 267 → 31 cols < 50.
    // (Con la saturación descartada en 100 × 40 salía el 2×2: 1,3542 frente a 1,1458.)
    const d4 = calc({ n: 4, ancho: 1080, alto: 1800 })
    check(
      '(6b) n=4 → filas [1,1,1,1], 133x22, p=0,9167: al 2×2 le faltan 15 columnas y a filas sólo 2 filas',
      es(d4, 'filas', [1, 1, 1, 1], 133, 22, (80 / 80) * (22 / 24)),
      fmt(d4)
    )
    // El 2×2 no lo pide ningún preset: su tamaño se toma de la referencia de (16).
    const ref2x2v = refRejilla(4, 2, { ancho: 1080, alto: 1800, hueco: 4, celdaAncho: 8, celdaAlto: 17, cromoAncho: 14, cromoAlto: 69 })
    check(
      '(6b2) …el 2×2 es válido pero puntúa menos (65x48, p=0,8125), fuera del 5 %',
      ref2x2v.valida &&
        ref2x2v.cols === 65 &&
        ref2x2v.filasTerm === 48 &&
        cerca(ref2x2v.p, (65 / 80) * (24 / 24)) &&
        ref2x2v.p < UMBRAL_HISTERESIS * d4.puntuacion,
      `2×2 allí: ${refATexto(ref2x2v)} p=${ref2x2v.p.toFixed(4)} (${((ref2x2v.p / d4.puntuacion) * 100).toFixed(1)} %)`
    )
  }
  {
    // Ultrapanorámica 3440 × 1400 con 4 → CUATRO columnas, no 2×2 (ver "Efecto que sorprende"):
    //   columnas [4]: (3440-12)/4 = 857 → (857-14)/8 = 105 cols × (1400-69)/17 = 78 filas → satura: 1
    //   rejilla [2,2]: (3440-4)/2 = 1718 → (1718-14)/8 = 213 cols × ((1396/2 = 698) - 69)/17 = 37 filas → satura: 1
    //   [3,1]: 141 × 37 → satura: 1; filas: 16 filas → 0,6667.
    // Las tres primeras EMPATAN a 1, y gana la de menos filas.
    const d = calc({ n: 4, ancho: 3440, alto: 1400 })
    check(
      '(6c) ultrapanorámica, n=4 → columnas [4], 105x78, p=1: el 2×2 (213x37) también satura, y gana la de menos filas',
      es(d, 'columnas', [4], 105, 78, P_MAX),
      fmt(d)
    )
    // Viniendo de un 2×2, en cambio, se QUEDA: empata con la elegida (1 ≥ 0,95 · 1) y la
    // histéresis conserva la forma vigente. (Con la saturación en 100 × 40 el 2×2 quedaba
    // a más del 5 %, 1,9271 frente a 2,0833, y cambiaba.)
    const dosPorDos = calc({ n: 4 })
    const desde2x2 = calc({ n: 4, ancho: 3440, alto: 1400, anterior: dosPorDos })
    const ref2x2 = refRejilla(4, 2, { ancho: 3440, alto: 1400, hueco: 4, celdaAncho: 8, celdaAlto: 17, cromoAncho: 14, cromoAlto: 69 })
    check(
      '(6d) …pero viniendo de 2×2 se QUEDA en 2×2 (213x37): empata con la elegida y la histéresis conserva la vigente',
      forma(dosPorDos) === 'rejilla[2,2]' &&
        es(desde2x2, 'rejilla', [2, 2], 213, 37, P_MAX) &&
        desde2x2.origen === 'auto' &&
        ref2x2.valida &&
        ref2x2.cols === 213 &&
        ref2x2.filasTerm === 37 &&
        cerca(ref2x2.p, P_MAX),
      `${fmt(dosPorDos)} → ${fmt(desde2x2)} | 2×2 allí: ${refATexto(ref2x2)} p=${ref2x2.p.toFixed(4)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(7) Tramos: la última fila se estira')

  {
    const d = calc({ n: 5 })
    const celdas = d.celdas.map((c) => (c ? `${c.fila}:${c.columna}+${c.spanColumnas}` : '-')).join(' ')
    check(
      '(7a) 5 como 3+2: T=6, arriba abarcan 2 y abajo 3',
      d.plantillaColumnas === 'repeat(6, minmax(0, 1fr))' &&
        d.plantillaFilas === 'repeat(2, minmax(0, 1fr))' &&
        celdas === '1:1+2 1:3+2 1:5+2 2:1+3 2:4+3',
      `${d.plantillaColumnas} | ${celdas}`
    )
  }
  {
    // 1400 × 1280 con 3: [2,1] = (698-14)/8 → 85 cols × (638-69)/17 → 33 filas → satura: 1
    // gana claro a principal (pila 558,4 px → 68 cols × 33 → (68/80)·(24/24) = 0,85), a filas
    // (173 × 20 → (80/80)·(20/24) = 0,8333) y a columnas ((1400-8)/3 = 464 → 56 cols × 71 →
    // (56/80)·(24/24) = 0,7: las 71 filas no pagan las 24 columnas que faltan).
    const d = calc({ n: 3, ancho: 1400, alto: 1280 })
    const celdas = d.celdas.map((c) => (c ? `${c.fila}:${c.columna}+${c.spanColumnas}` : '-')).join(' ')
    check(
      '(7b) 3 como 2+1: tramos [1,1,2], la de abajo abarca las dos pistas',
      es(d, 'rejilla', [2, 1], 85, 33, P_MAX) &&
        spans(d) === '1,1,2' &&
        d.plantillaColumnas === 'repeat(2, minmax(0, 1fr))' &&
        celdas === '1:1+1 1:2+1 2:1+2',
      `${fmt(d)} | ${celdas}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(8) Ampliada')

  {
    const d = calc({ n: 5, preset: 'filas', ancho: 900, alto: 560, ampliada: 2, enfocada: 0 })
    check(
      '(8a) gana a preset y tamaño: enfoque en la ampliada (no en la enfocada)',
      d.forma === 'enfoque' &&
        d.visibleEnfoque === 2 &&
        JSON.stringify(d.celdas[2]) === JSON.stringify({ fila: 1, columna: 1, spanFilas: 1, spanColumnas: 1 }) &&
        d.celdas.every((c, i) => (i === 2 ? c !== null : c === null)) &&
        d.plantillaColumnas === PISTA &&
        d.plantillaFilas === PISTA &&
        d.origen === 'ampliada' &&
        d.presetRespetado,
      fmt(d)
    )
    const holgado = calc({ n: 2, ampliada: 1 })
    check(
      '(8b) también cuando todo cabe (1920 × 1000, n=2)',
      holgado.forma === 'enfoque' && holgado.visibleEnfoque === 1 && holgado.minimo.cols === 238,
      fmt(holgado)
    )
    const sinMedir = calc({ n: 4, ancho: 0, ampliada: 3 })
    check(
      '(8c) y sin medir: enfoque, puntuación 0',
      sinMedir.forma === 'enfoque' && sinMedir.visibleEnfoque === 3 && sinMedir.puntuacion === 0 && sinMedir.minimo.cols === 0,
      fmt(sinMedir)
    )
    const base = calc({ n: 5 })
    const fueras = [5, -1, 1.5, Number.NaN].map((a) => calc({ n: 5, ampliada: a }))
    check(
      '(8d) fuera de rango (5, -1, 1.5, NaN) se ignora',
      fueras.every((d) => d.forma !== 'enfoque' && mismaGeometria(d, base)),
      fueras.map((d) => d.forma).join(', ')
    )
  }

  // ---------------------------------------------------------------------------
  hr('(9) Presets explícitos')

  {
    // 6 en columnas a 1366: (1366-20)/6 = 224,3 → 26 cols < 50 → no cabe → AUTO [3,3].
    const d = calc({ n: 6, ancho: 1366, alto: 690, preset: 'columnas' })
    const auto = calc({ n: 6, ancho: 1366, alto: 690 })
    check(
      '(9a) columnas con 6 a 1366 × 690 → no cabe: AUTO y presetRespetado=false',
      !d.presetRespetado && mismaGeometria(d, auto) && d.forma === 'rejilla' && d.presetPedido === 'columnas' && d.origen === 'auto',
      fmt(d)
    )
    const dos = calc({ n: 2, preset: 'columnas' })
    check(
      '(9b) columnas con 2 a 1920 × 1000 → respetado',
      dos.presetRespetado && es(dos, 'columnas', [2], 118, 54, P_MAX) && dos.origen === 'preset',
      fmt(dos)
    )
    // filas con 3: (1000-8)/3 = 330,7 → 261,7/17 = 15 filas ≥ 12 → cabe. p = (80/80)·(15/24) = 0,625.
    const filas = calc({ n: 3, preset: 'filas' })
    check(
      '(9c) filas con 3 a 1920 × 1000 → respetado, 238x15',
      filas.presetRespetado && es(filas, 'filas', [1, 1, 1], 238, 15, (80 / 80) * (15 / 24)),
      fmt(filas)
    )
  }
  {
    // principal 3: útil 1916; principal 3/5 = 1149,6 → 141 cols × 54; pila 2/5 = 766,4 → 94 × 25.
    //   p = la de la pila, que también llega al objetivo: 1 (la principal, igual).
    const d = calc({ n: 3, preset: 'principal' })
    const celdas = JSON.stringify(d.celdas)
    const esperadas = JSON.stringify([
      { fila: 1, columna: 1, spanFilas: 2, spanColumnas: 1 },
      { fila: 1, columna: 2, spanFilas: 1, spanColumnas: 1 },
      { fila: 2, columna: 2, spanFilas: 1, spanColumnas: 1 }
    ])
    check(
      '(9d) principal con 3: celdas y plantillas del contrato, 94x25',
      d.presetRespetado &&
        es(d, 'principal', [2, 1], 94, 25, P_MAX) &&
        celdas === esperadas &&
        d.plantillaColumnas === 'minmax(0, 3fr) minmax(0, 2fr)' &&
        d.plantillaFilas === 'repeat(2, minmax(0, 1fr))',
      `${fmt(d)} | ${celdas}`
    )
    // principal 4: pila (1000-8)/3 = 330,7 → 15 filas → cabe; 94 × 15 → p = (80/80)·(15/24) = 0,625.
    const cuatro = calc({ n: 4, preset: 'principal' })
    check(
      '(9e) principal con 4: pila de 3, [2,1,1], 94x15, respetado',
      cuatro.presetRespetado &&
        es(cuatro, 'principal', [2, 1, 1], 94, 15, (80 / 80) * (15 / 24)) &&
        cuatro.plantillaFilas === 'repeat(3, minmax(0, 1fr))',
      fmt(cuatro)
    )
    // principal 6: pila (1000-16)/5 = 196,8 → 7 filas < 12 → no cabe → AUTO [3,3].
    const seis = calc({ n: 6, preset: 'principal' })
    check(
      '(9f) principal con 6 → pila de 7 filas no cabe: AUTO [3,3], presetRespetado=false',
      !seis.presetRespetado && seis.forma === 'rejilla' && mismasFilas(seis, [3, 3]),
      fmt(seis)
    )
    const p2 = calc({ n: 2, preset: 'principal' })
    const p1 = calc({ n: 1, preset: 'principal' })
    check(
      '(9g) principal con 2 → columnas; con 1 → unica',
      p2.forma === 'columnas' && mismasFilas(p2, [2]) && p2.presetRespetado && p1.forma === 'unica',
      `${fmt(p2)} | ${fmt(p1)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(10) Histéresis')

  {
    // 1400 × 1280 con 2: columnas = (698-14)/8 → 85 cols × (1280-69)/17 → 71 filas → satura: 1;
    //                   filas    = 173 cols × (638-69)/17 → 33 filas → satura: 1.
    // EMPATE: de cero gana la de menos filas (columnas), y la que estuviera se queda.
    const fresco = calc({ n: 2, ancho: 1400, alto: 1280 })
    check(
      '(10a) de cero, 1400 × 1280 con 2 → columnas (1; filas también satura: empate, menos filas)',
      es(fresco, 'columnas', [2], 85, 71, P_MAX),
      fmt(fresco)
    )

    const vertical = calc({ n: 2, ancho: 1080, alto: 1800 })
    const conservada = calc({ n: 2, ancho: 1400, alto: 1280, anterior: vertical })
    check(
      '(10b) venía de filas (vertical) → a 1400 × 1280 se QUEDA en filas, recalculada (empata con la elegida)',
      vertical.forma === 'filas' && es(conservada, 'filas', [1, 1], 173, 33, P_MAX) && conservada.origen === 'auto',
      `anterior=${fmt(vertical)} → ${fmt(conservada)}`
    )

    // A 1920 × 1000 filas (238 × 25) SIGUE saturando: empata con columnas y se queda. Hace
    // falta bajar el alto hasta que a filas le falten filas de verdad:
    //   1920 × 800: filas    = 238 × (796/2 = 398 − 69)/17 → 19 filas → (80/80)·(19/24) = 0,7917
    //               columnas = 118 × (800−69)/17 → 43 filas → satura: 1. 0,7917 < 0,95 → cambia.
    const sigue = calc({ n: 2, anterior: conservada })
    check(
      '(10c) a 1920 × 1000 filas (238x25) sigue en el objetivo: empata con columnas y se QUEDA',
      es(sigue, 'filas', [1, 1], 238, 25, P_MAX),
      fmt(sigue)
    )
    const cambia = calc({ n: 2, alto: 800, anterior: sigue })
    check(
      '(10c1) a 1920 × 800 filas cae a 19 filas (0,7917 < 0,95 · 1) → cambia a columnas',
      es(cambia, 'columnas', [2], 118, 43, P_MAX),
      `${fmt(sigue)} → ${fmt(cambia)}`
    )

    // El par ajustado: columnas ES la elegida de cero (dentro del 5 % y con menos filas), y
    // la histéresis aparece del otro lado: se viene de filas y filas se queda.
    //   1270 × 1200: columnas = (633-14)/8 → 77 × 66 → (77/80)·(24/24) = 0,9625 (elegida: 96,3 % y 1 fila);
    //                filas    = 157 × (598-69)/17 → 31 → satura: 1 (la mejor).
    //                Viniendo de filas: 1 ≥ 0,95 × 0,9625 → se QUEDA (la estabilidad gana a la preferencia).
    //   1200 × 1200: columnas = (598-14)/8 → 73 × 66 → (73/80)·(24/24) = 0,9125 < 0,95 × 1 →
    //                fuera de la banda: de cero, filas 148 × 31; y una anterior de columnas CAMBIA a filas.
    const de1270 = calc({ n: 2, ancho: 1270, alto: 1200 })
    const pegada1270 = calc({ n: 2, ancho: 1270, alto: 1200, anterior: vertical })
    check(
      '(10c2) a 1270 × 1200 de cero sale columnas (96,3 % de filas, menos filas); viniendo de filas, se QUEDA en filas',
      es(de1270, 'columnas', [2], 77, 66, (77 / 80) * (24 / 24)) && es(pegada1270, 'filas', [1, 1], 157, 31, P_MAX),
      `de cero ${fmt(de1270)} | pegada ${fmt(pegada1270)}`
    )
    // Al estrechar desde columnas ya no hay banda: columnas deja de ser la elegida justo
    // cuando deja de aguantar frente a ella (las dos cuentas son columnas ≥ 0,95 × filas).
    const a1200 = calc({ n: 2, ancho: 1200, alto: 1200, anterior: de1270 })
    check(
      '(10c3) …y a 1200 × 1200 una anterior de columnas cambia a filas: columnas (0,9125) queda por debajo del 95 % (0,95)',
      de1270.origen === 'auto' &&
        es(a1200, 'filas', [1, 1], 148, 31, P_MAX) &&
        (73 / 80) * (24 / 24) < UMBRAL_HISTERESIS * P_MAX,
      `${fmt(de1270)} → ${fmt(a1200)}`
    )

    // 1920 × 500: filas = (500-4)/2 = 248 → 10 filas < 12: la anterior ya no es válida.
    const invalida = calc({ n: 2, ancho: 1920, alto: 500, anterior: conservada })
    check('(10d) si la forma anterior deja de ser válida, no se conserva', invalida.forma === 'columnas', fmt(invalida))

    const presetFilas = calc({ n: 2, ancho: 1400, alto: 1280, preset: 'filas' })
    const trasPreset = calc({ n: 2, ancho: 1400, alto: 1280, anterior: presetFilas })
    check(
      '(10e) una anterior de preset EXPLÍCITO no se pega al volver a auto',
      presetFilas.origen === 'preset' && presetFilas.forma === 'filas' && trasPreset.forma === 'columnas',
      `anterior=${fmt(presetFilas)} → ${fmt(trasPreset)}`
    )

    // n=3 en 1400 × 1280 da [2,1] de cero (ver (7b)); la anterior de n=2 no cuenta.
    const otraN = calc({ n: 3, ancho: 1400, alto: 1280, anterior: vertical })
    check('(10f) una anterior con otra n se ignora', otraN.forma === 'rejilla' && mismasFilas(otraN, [2, 1]), fmt(otraN))

    const aMano: DisposicionMosaico = { ...vertical }
    delete aMano.origen
    delete aMano.presetPedido
    const sinOrigen = calc({ n: 2, ancho: 1400, alto: 1280, anterior: aMano })
    check('(10g) una anterior sin origen (construida a mano) se ignora', sinOrigen.forma === 'columnas', fmt(sinOrigen))

    const otroPreset = calc({ n: 2, ancho: 1400, alto: 1280, preset: 'columnas', anterior: vertical })
    check(
      '(10h) con OTRO preset pedido, la anterior de auto no manda',
      otroPreset.forma === 'columnas' && otroPreset.presetRespetado && otroPreset.origen === 'preset',
      fmt(otroPreset)
    )

    const enfoquePrevio = calc({ n: 6, ancho: 900, alto: 560 })
    const salida = calc({ n: 6, anterior: enfoquePrevio })
    check(
      '(10i) un enfoque por falta de sitio no se pega: al agrandar vuelve la rejilla',
      enfoquePrevio.forma === 'enfoque' && salida.forma === 'rejilla' && mismasFilas(salida, [3, 3]),
      `${fmt(enfoquePrevio)} → ${fmt(salida)}`
    )

    const incoherente: DisposicionMosaico = { ...vertical, filasDeTeselas: [2, 5] }
    const conIncoherente = calc({ n: 2, ancho: 1400, alto: 1280, anterior: incoherente })
    check('(10j) una anterior incoherente (filasDeTeselas que no cuadran) se ignora', conIncoherente.forma === 'columnas', fmt(conIncoherente))

    // Histéresis DENTRO del respaldo de un preset explícito que no cabe (misma clase:
    // AUTO con el mismo preset pedido). 1030 px: la pila de principal da 2/5·1026 =
    // 410,4 → 49 cols < 50, así que principal nunca cabe y decide AUTO.
    // Tres columnas tampoco: (1030−8)/3 = 340,7 → 40 cols < 50.
    //   1030 × 1800: [2,1] = (513−14)/8 → 62 cols × (898−69)/17 → 48 → (62/80)·(24/24) = 0,775;
    //                filas = 127 × (597,3−69)/17 → 31 → satura: 1. [2,1] queda al 77,5 %: filas.
    //   1030 × 1200: [2,1] = 62 × (598−69)/17 → 31 → (62/80)·(24/24) = 0,775;
    //                filas = 127 × (397,3−69)/17 → 19 → (80/80)·(19/24) = 0,7917 (la mejor).
    //                De cero sale [2,1]: al 97,9 % de filas y con menos filas. Viniendo de
    //                filas, 0,7917 ≥ 0,95 × 0,775 → se QUEDA en filas.
    const respaldo = calc({ n: 3, preset: 'principal', ancho: 1030, alto: 1800 })
    const respaldoFresco = calc({ n: 3, preset: 'principal', ancho: 1030, alto: 1200 })
    const respaldoPegado = calc({ n: 3, preset: 'principal', ancho: 1030, alto: 1200, anterior: respaldo })
    check(
      '(10k) el respaldo AUTO de un preset que no cabe también tiene histéresis',
      es(respaldo, 'filas', [1, 1, 1], 127, 31, P_MAX) &&
        !respaldo.presetRespetado &&
        es(respaldoFresco, 'rejilla', [2, 1], 62, 31, (62 / 80) * (24 / 24)) &&
        es(respaldoPegado, 'filas', [1, 1, 1], 127, 19, (80 / 80) * (19 / 24)) &&
        !respaldoPegado.presetRespetado &&
        respaldoPegado.origen === 'auto' &&
        respaldoPegado.presetPedido === 'principal',
      `${fmt(respaldo)} → fresco ${fmt(respaldoFresco)} | pegado ${fmt(respaldoPegado)}`
    )
    // La validez manda aunque la puntuación entre en la banda del 5 %. (10d) no lo
    // demuestra, porque allí la anterior ya perdía también por puntuación.
    //   900 × 640 con 2: columnas = (448−14)/8 → 54 × (640−69)/17 → 33 → (54/80)·(24/24) = 0,675;
    //                    filas = 110 × (318−69)/17 → 14 → (80/80)·(14/24) = 0,5833.
    //   820 × 640:       columnas = (408−14)/8 → 49 cols < 50 → INVÁLIDA, aunque puntuaría
    //                    (49/80)·(24/24) = 0,6125, MÁS que filas (100 × 14 → 0,5833). No llega al suelo.
    const ancha = calc({ n: 2, ancho: 900, alto: 640 })
    const estrecha = calc({ n: 2, ancho: 820, alto: 640, anterior: ancha })
    check(
      '(10m) una anterior bajo el suelo no se conserva aunque puntúe más que la mejor válida',
      es(ancha, 'columnas', [2], 54, 33, (54 / 80) * (24 / 24)) &&
        es(estrecha, 'filas', [1, 1], 100, 14, (80 / 80) * (14 / 24)) &&
        (49 / 80) * (24 / 24) > estrecha.puntuacion,
      `${fmt(ancha)} → ${fmt(estrecha)}`
    )

    // …pero ese respaldo es otra clase de elección para el preset 'auto': sale la de cero.
    const autoTrasRespaldo = calc({ n: 3, preset: 'auto', ancho: 1030, alto: 1200, anterior: respaldo })
    check(
      '(10l) la anterior del respaldo de OTRO preset no se pega en auto',
      es(autoTrasRespaldo, 'rejilla', [2, 1], 62, 31, (62 / 80) * (24 / 24)) && autoTrasRespaldo.presetRespetado,
      fmt(autoTrasRespaldo)
    )

    // La anterior se mide contra la ELEGIDA de cero, no contra la MEJOR (ver el final de
    // la cabecera del módulo). 3 teselas; en 1080 × 1800 AUTO da filas:
    //   filas 133 × (597,3−69)/17 → 31 → satura: 1; [2,1] 65 × 48 → (65/80)·(24/24) = 0,8125
    //   (81,3 %, fuera); [3] (1080−8)/3 = 357,3 → 42 cols < 50.
    // En 1920 × 1340:
    //   [2,1]  (1916/2 = 958 − 14)/8 → 118 cols × (668 − 69)/17 → 35 filas → satura: 1 (la mejor)
    //   [3]    (1912/3 = 637,3 − 14)/8 → 77 × (1340 − 69)/17 → 74 → (77/80)·(24/24) = 0,9625 (96,3 %, 1 fila: la elegida)
    //   filas  (1920 − 14)/8 → 238 × (1332/3 = 444 − 69)/17 → 22 → (80/80)·(22/24) = 0,9167
    // filas está al 91,7 % de la MEJOR (fuera de su banda) pero al 95,2 % de la ELEGIDA: se
    // queda. Contra la mejor saltaría a tres columnas, que sólo la mejoran un 5 %.
    const filas3 = calc({ n: 3, ancho: 1080, alto: 1800 })
    const alto1340: Fixture = { ancho: 1920, alto: 1340, hueco: 4, celdaAncho: 8, celdaAlto: 17, cromoAncho: 14, cromoAlto: 69 }
    const deCero1340 = calc({ n: 3, alto: 1340 })
    const pegada1340 = calc({ n: 3, alto: 1340, anterior: filas3 })
    const mejor1340 = refMejor(3, alto1340)
    check(
      '(10n) la anterior se mide contra la ELEGIDA: filas al 91,7 % de la mejor pero al 95,2 % de la elegida se queda',
      es(filas3, 'filas', [1, 1, 1], 133, 31, P_MAX) &&
        es(deCero1340, 'columnas', [3], 77, 74, (77 / 80) * (24 / 24)) &&
        es(pegada1340, 'filas', [1, 1, 1], 238, 22, (80 / 80) * (22 / 24)) &&
        mejor1340 !== null &&
        refATexto(mejor1340) === 'rejilla[2,1] 118x35' &&
        cerca(mejor1340.p, P_MAX) &&
        pegada1340.puntuacion < UMBRAL_HISTERESIS * mejor1340.p &&
        pegada1340.puntuacion >= UMBRAL_HISTERESIS * deCero1340.puntuacion,
      `${fmt(filas3)} → pegada ${fmt(pegada1340)} | de cero ${fmt(deCero1340)} | mejor ${mejor1340 ? refATexto(mejor1340) : '-'}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(11) Sin medir')

  {
    const canon = [1, 2, 3, 4, 5, 6].map((n) => calc({ n, ancho: 0 }))
    const esperado = ['unica[1]', 'columnas[2]', 'columnas[3]', 'rejilla[2,2]', 'rejilla[3,2]', 'rejilla[3,3]']
    const obtenido = canon.map((d) => `${d.forma}[${d.filasDeTeselas.join(',')}]`)
    check(
      '(11a) auto con ancho 0 → formas canónicas apaisadas',
      JSON.stringify(obtenido) === JSON.stringify(esperado),
      obtenido.join(' / ')
    )
    check(
      '(11b) …provisionales: puntuación 0, mínimo 0x0, respetado',
      canon.every((d) => d.puntuacion === 0 && d.minimo.cols === 0 && d.minimo.filas === 0 && d.presetRespetado) &&
        canon.slice(1).every((d) => d.origen === 'sin-medir'),
      canon.map((d) => `${d.puntuacion}/${d.minimo.cols}x${d.minimo.filas}`).join(' ')
    )
    const explicitos: [PresetMosaico, number, string][] = [
      ['columnas', 4, 'columnas[4]'],
      ['filas', 3, 'filas[1,1,1]'],
      ['principal', 4, 'principal[2,1,1]'],
      ['principal', 2, 'columnas[2]']
    ]
    const malos = explicitos.filter(([preset, n, forma]) => {
      const d = calc({ n, preset, ancho: 0 })
      return `${d.forma}[${d.filasDeTeselas.join(',')}]` !== forma || !d.presetRespetado || d.puntuacion !== 0
    })
    check(
      '(11c) presets explícitos sin medir → su propia forma',
      malos.length === 0,
      malos.length === 0 ? explicitos.map(([p, n, f]) => `${p}/${n}=${f}`).join(' ') : `fallan: ${JSON.stringify(malos)}`
    )
    const celda0 = calc({ n: 4, celda: { ancho: 0, alto: 17 } })
    const altoNaN = calc({ n: 4, alto: Number.NaN })
    const negativo = calc({ n: 4, ancho: -100 })
    check(
      '(11d) celda 0, alto NaN o ancho negativo también cuentan como sin medir',
      [celda0, altoNaN, negativo].every((d) => d.origen === 'sin-medir' && d.forma === 'rejilla' && mismasFilas(d, [2, 2])),
      [celda0, altoNaN, negativo].map(fmt).join(' | ')
    )
  }

  // ---------------------------------------------------------------------------
  hr('(12) mismaDisposicion')

  {
    const a = calc({ n: 5 })
    const b = calc({ n: 5 })
    const copia = JSON.parse(JSON.stringify(a)) as DisposicionMosaico
    check('(12a) dos cálculos iguales y una copia profunda → true', mismaDisposicion(a, b) && mismaDisposicion(a, copia), 'n=5 × 3')
    const otraCelda = JSON.parse(JSON.stringify(a)) as DisposicionMosaico
    const c0 = otraCelda.celdas[0]
    if (c0) c0.spanColumnas = 3
    const otraPlantilla = { ...a, plantillaColumnas: 'repeat(3, minmax(0, 1fr))' }
    check(
      '(12b) una celda o una plantilla distinta → false',
      !mismaDisposicion(a, otraCelda) && !mismaDisposicion(a, otraPlantilla),
      'spanColumnas 2→3; plantillaColumnas 6→3'
    )
    const enf = calc({ n: 3, ampliada: 1 })
    const enfOtra = calc({ n: 3, ampliada: 2 })
    check(
      '(12c) null/null → true; null/algo → false; celda null vs no null → false',
      mismaDisposicion(null, null) && !mismaDisposicion(null, a) && !mismaDisposicion(a, null) && !mismaDisposicion(enf, enfOtra),
      `${fmt(enf)} vs ${fmt(enfOtra)}`
    )
    // Un píxel de más que no cambia ningún carácter → la misma disposición (no re-render).
    const px = calc({ n: 5, ancho: 1921 })
    check('(12d) 1 px más sin cambio de caracteres → misma disposición', mismaDisposicion(a, px), `${fmt(a)} vs ${fmt(px)}`)
  }

  // ---------------------------------------------------------------------------
  hr('(13) Invariantes en un barrido')

  {
    const tamanos: [number, number][] = [
      [1920, 1000],
      [1366, 690],
      [900, 560],
      [1080, 1800],
      [1400, 1000],
      [2560, 1400],
      [3840, 2100],
      [800, 2400],
      [400, 300],
      [0, 0]
    ]
    let casos = 0
    const fallos: string[] = []
    for (const [ancho, alto] of tamanos) {
      for (let n = 0; n <= 7; n++) {
        for (const preset of PRESETS_MOSAICO) {
          for (const ampliada of [null, 0, n - 1]) {
            for (const enfocada of [null, n - 1]) {
              casos++
              const d = calc({ n, preset, ancho, alto, ampliada, enfocada })
              const nn = Math.min(n, MAX_TESELAS_MOSAICO)
              const p = problemas(d, nn)
              if (!numerosSanos(d)) p.push('números no sanos')
              // Garantía responsive: con medidas, lo pintado en rejilla SIEMPRE pasa el suelo.
              const medido = ancho > 0 && alto > 0
              if (medido && nn > 1 && d.forma !== 'enfoque' && (d.minimo.cols < MINIMO_COLS || d.minimo.filas < MINIMO_FILAS)) {
                p.push(`rejilla bajo el suelo: ${d.minimo.cols}x${d.minimo.filas}`)
              }
              if (p.length > 0) fallos.push(`${ancho}x${alto} n=${n} ${preset} amp=${ampliada} enf=${enfocada}: ${p.join('; ')}`)
            }
          }
        }
      }
    }
    check(
      '(13a) sin solapes, dentro de la rejilla, sin huecos, tramos suman T, suelo respetado',
      fallos.length === 0,
      fallos.length === 0 ? `${casos} casos` : `${fallos.length}/${casos}: ${fallos.slice(0, 3).join(' || ')}`
    )

    // El verificador no puede ser vacuo: una rejilla rota a mano TIENE que dar problemas.
    const buena = calc({ n: 5 })
    const solapada: DisposicionMosaico = {
      ...buena,
      celdas: buena.celdas.map((c, i) => (i === 1 && c ? { ...c, columna: 2 } : c))
    }
    const conHueco: DisposicionMosaico = {
      ...buena,
      celdas: buena.celdas.map((c, i) => (i === 4 && c ? { ...c, spanColumnas: 2 } : c))
    }
    const fuera: DisposicionMosaico = {
      ...buena,
      celdas: buena.celdas.map((c, i) => (i === 0 && c ? { ...c, fila: 3 } : c))
    }
    const detectados = [solapada, conHueco, fuera].map((d) => problemas(d, 5))
    check(
      '(13b) el verificador detecta solape, hueco y celda fuera de la rejilla',
      problemas(buena, 5).length === 0 && detectados.every((p) => p.length > 0),
      detectados.map((p) => p[0] ?? '(nada)').join(' | ')
    )
  }

  // ---------------------------------------------------------------------------
  hr('(14) Entradas basura')

  {
    const basura: Partial<EntradaMosaico>[] = [
      { n: 4, ancho: Number.POSITIVE_INFINITY },
      { n: 4, alto: Number.NaN },
      { n: 4, hueco: Number.NaN },
      { n: 4, hueco: -10 },
      { n: 6, hueco: 1e9 },
      { n: 4, hueco: Number.POSITIVE_INFINITY },
      { n: 4, celda: { ancho: Number.NaN, alto: 17 } },
      { n: 4, celda: { ancho: 8, alto: Number.POSITIVE_INFINITY } },
      { n: 4, cromo: { ancho: Number.NaN, alto: -3 } },
      { n: 4, cromo: { ancho: 1e6, alto: 1e6 } },
      { n: 4, ancho: 1, alto: 1 },
      { n: '3' as any },
      { n: 3, preset: 'mosaico' as any },
      { n: 3, celda: undefined as any, cromo: undefined as any },
      { n: 3, anterior: { forma: 'rejilla', celdas: null } as any },
      // Anterior casi bien formada: pasa los primeros campos de la comparación y
      // revienta en los últimos si mismaDisposicion no tolera listas ausentes.
      { n: 3, anterior: { ...calc({ n: 3 }), celdas: null, filasDeTeselas: undefined, minimo: undefined } as any },
      { n: 3, anterior: { ...calc({ n: 3 }), celdas: [undefined, undefined, undefined] } as any },
      // Extremos que desbordan la aritmética aunque cada entrada sea finita:
      //   hueco 1e308 → pista −∞, y −∞ + ∞ = NaN en la tesela que abarca 3 pistas (5 = 3+2);
      //   celda 1e-320 px o contenedor de MAX_VALUE → ∞ caracteres.
      { n: 5, hueco: 1e308 },
      { n: 5, hueco: Number.MAX_VALUE, preset: 'filas' },
      { n: 5, celda: { ancho: 1e-320, alto: 1e-320 } },
      { n: 3, celda: { ancho: 1e-320, alto: 17 }, ampliada: 1 },
      { n: 4, ancho: Number.MAX_VALUE, alto: Number.MAX_VALUE },
      { n: 1, ancho: Number.MAX_VALUE, alto: Number.MAX_VALUE, celda: { ancho: 0.5, alto: 0.5 } },
      { n: 6, ancho: Number.MAX_VALUE, alto: 1000, preset: 'principal', enfocada: 5 },
      // …y los mismos extremos por el preset 'cuadricula', que coloca 5 como 3+2 (T = 6).
      { n: 5, hueco: 1e308, preset: 'cuadricula' },
      { n: 3, celda: { ancho: 1e-320, alto: 1e-320 }, preset: 'cuadricula' },
      { n: 7, ancho: Number.MAX_VALUE, alto: Number.MAX_VALUE, preset: 'cuadricula', enfocada: 6 }
    ]
    const rotos: string[] = []
    for (const extra of basura) {
      let d: DisposicionMosaico | null = null
      try {
        d = calc(extra)
      } catch (err) {
        rotos.push(`${JSON.stringify(extra)} lanzó ${String(err)}`)
        continue
      }
      const nn = typeof extra.n === 'number' ? Math.min(Math.max(0, Math.floor(extra.n)), 6) : 0
      const p = problemas(d, nn)
      if (!numerosSanos(d)) p.push('números no sanos')
      if (p.length > 0) rotos.push(`${JSON.stringify(extra)}: ${p.join('; ')} (${fmt(d)})`)
    }
    check(
      '(14a) nunca NaN, Infinity, negativos ni excepciones',
      rotos.length === 0,
      rotos.length === 0 ? `${basura.length} entradas basura` : rotos.slice(0, 3).join(' || ')
    )
    const presetRaro = calc({ n: 3, preset: 'mosaico' as any })
    check('(14b) un preset desconocido se trata como auto', presetRaro.presetPedido === 'auto' && presetRaro.presetRespetado, fmt(presetRaro))
    // Antes salía `puntuacion: Infinity` y `minimo.cols: Infinity` (null en JSON).
    const diminuta = calc({ n: 3, celda: { ancho: 1e-320, alto: 17 }, ampliada: 1 })
    check(
      '(14c) celda de 1e-320 px: columnas acotadas al mayor entero seguro, puntuación finita',
      diminuta.minimo.cols === Number.MAX_SAFE_INTEGER && Number.isFinite(diminuta.puntuacion) && diminuta.minimo.filas === 54,
      fmt(diminuta)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(15) Desempates')

  {
    // 1160 × 870 con 2, un empate EXACTO sin que ninguna llegue al objetivo:
    //   columnas = (578−14)/8 → 70 cols × (870−69)/17 → 47 filas → (70/80)·(24/24) = 0,875;
    //   filas    = 143 cols × (433−69)/17 → 21 filas → (80/80)·(21/24) = 0,875. EMPATE.
    // Gana la de menos filas visuales: columnas.
    const d = calc({ n: 2, ancho: 1160, alto: 870 })
    const col = calc({ n: 2, ancho: 1160, alto: 870, preset: 'columnas' })
    const fil = calc({ n: 2, ancho: 1160, alto: 870, preset: 'filas' })
    check(
      '(15a) empate columnas/filas (0,875 las dos, a ninguna le sobra nada) → menos filas (columnas)',
      cerca(col.puntuacion, fil.puntuacion) &&
        es(fil, 'filas', [1, 1], 143, 21, (80 / 80) * (21 / 24)) &&
        es(d, 'columnas', [2], 70, 47, (70 / 80) * (24 / 24)),
      `columnas ${fmt(col)} | filas ${fmt(fil)} → ${fmt(d)}`
    )
    // 3500 × 1000 con 6: [3,3] = 143 × 25, [4,2] = 107 × 25, [5,1] = 85 × 25 (T = 5:
    // (3500−16)/5 = 696,8 → 85): las tres SATURAN (1). Columnas [6] = (3480/6 = 580 − 14)/8 →
    // 70 × 54 → 0,875 (87,5 %: fuera); [2,2,2] = 15 filas → 0,625. Mismas filas → menos
    // columnas: la última fila más llena.
    const seis = calc({ n: 6, ancho: 3500, alto: 1000 })
    check(
      '(15b) empate a igualdad de filas → menos columnas ([3,3], no [4,2] ni [5,1])',
      es(seis, 'rejilla', [3, 3], 143, 25, P_MAX),
      fmt(seis)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(16) Contra una referencia independiente en aritmética entera')

  {
    const fuentes: [number, number, number, number][] = [
      [8, 17, 14, 69],
      [7, 15, 20, 60],
      [10, 22, 0, 0],
      [9, 19, 30, 90]
    ]
    let casos = 0
    const fallos: string[] = []
    for (const [celdaAncho, celdaAlto, cromoAncho, cromoAlto] of fuentes) {
      for (const hueco of [0, 4, 12]) {
        for (let ancho = 200; ancho <= 4200; ancho += 47) {
          for (let alto = 150; alto <= 2600; alto += 61) {
            const f: Fixture = { ancho, alto, hueco, celdaAncho, celdaAlto, cromoAncho, cromoAlto }
            for (let n = 2; n <= MAX_TESELAS_MOSAICO; n++) {
              casos++
              const d = calcFixture(f, n, 'auto')
              const r = refAuto(n, f)
              const obtenido = `${forma(d)} ${d.minimo.cols}x${d.minimo.filas}`
              const esperado = r
                ? refATexto(r)
                : `enfoque[1] ${divEntera(ancho - cromoAncho, celdaAncho)}x${divEntera(alto - cromoAlto, celdaAlto)}`
              const pOk = r ? cerca(d.puntuacion, r.p) : true
              if (obtenido !== esperado || !pOk) fallos.push(`${JSON.stringify(f)} n=${n}: ${obtenido} p=${d.puntuacion} != ${esperado}`)
            }
          }
        }
      }
    }
    check(
      '(16a) AUTO coincide con la referencia (forma, tamaño mínimo, puntuación de la peor tesela puntuada una a una, y enfoque cuando nada cabe)',
      fallos.length === 0,
      fallos.length === 0 ? `${casos} casos` : `${fallos.length}/${casos}: ${fallos.slice(0, 3).join(' || ')}`
    )

    // Las columnas de la cuadrícula se escriben aquí con la raíz (el módulo cuenta con
    // enteros): dos formulaciones de ⌈√n⌉ que tienen que coincidir.
    const columnasCuadriculaRef = (n: number): number => Math.ceil(Math.sqrt(n))
    let casosP = 0
    const fallosP: string[] = []
    for (let ancho = 300; ancho <= 4000; ancho += 53) {
      for (let alto = 200; alto <= 2500; alto += 47) {
        const f: Fixture = { ancho, alto, hueco: 4, celdaAncho: 8, celdaAlto: 17, cromoAncho: 14, cromoAlto: 69 }
        for (let n = 2; n <= MAX_TESELAS_MOSAICO; n++) {
          for (const preset of ['cuadricula', 'columnas', 'filas', 'principal'] as const) {
            casosP++
            const d = calcFixture(f, n, preset)
            const r =
              preset === 'cuadricula'
                ? refRejilla(n, columnasCuadriculaRef(n), f)
                : preset === 'filas'
                  ? refRejilla(n, 1, f)
                  : preset === 'principal' && n >= 3
                    ? refPrincipal(n, f)
                    : refRejilla(n, n, f)
            const auto = calcFixture(f, n, 'auto')
            const ok = r.valida
              ? d.presetRespetado && d.origen === 'preset' && `${forma(d)} ${d.minimo.cols}x${d.minimo.filas}` === refATexto(r)
              : !d.presetRespetado && mismaGeometria(d, auto)
            if (!ok) fallosP.push(`${ancho}x${alto} n=${n} ${preset}: ${fmt(d)} vs ref ${refATexto(r)} valida=${r.valida}`)
          }
        }
      }
    }
    check(
      '(16b) presets explícitos: se aplican si la referencia dice que caben; si no, AUTO y presetRespetado=false',
      fallosP.length === 0,
      fallosP.length === 0 ? `${casosP} casos` : `${fallosP.length}/${casosP}: ${fallosP.slice(0, 3).join(' || ')}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(17) Histéresis en trayectorias de redimensionado')

  {
    // Se arrastra un borde píxel a píxel encadenando `anterior`, como el ResizeObserver.
    // En cada paso: el resultado es el de cero o conserva la FORMA de la anterior (y
    // entonces es válida y puntúa ≥ 95 % de la ELEGIDA de cero); un vaivén de 1 px no
    // alterna entre dos formas VÁLIDAS (la cuenta del ADR; los cruces del suelo sí
    // cambian); y las invariantes de la rejilla siguen valiendo. Las trayectorias
    // cruzan 1920 × 1200 (empate 2+1 / tres columnas) y el borde 2×2 / cuatro columnas.
    let pasos = 0
    const fallos: string[] = []
    const vaivenes: string[] = []
    const reglaRota: string[] = []
    let conservadas = 0
    let cambiadas = 0
    // Todos los presets, de la lista del módulo: uno nuevo entra solo en el barrido.
    const presets: readonly PresetMosaico[] = PRESETS_MOSAICO
    const trayectorias: { eje: 'ancho' | 'alto'; fijo: number; desde: number; hasta: number }[] = [
      { eje: 'ancho', fijo: 700, desde: 300, hasta: 3400 },
      { eje: 'ancho', fijo: 1000, desde: 300, hasta: 3400 },
      { eje: 'ancho', fijo: 1200, desde: 300, hasta: 3400 },
      { eje: 'ancho', fijo: 1800, desde: 300, hasta: 3400 },
      { eje: 'alto', fijo: 1000, desde: 200, hasta: 2600 },
      { eje: 'alto', fijo: 1920, desde: 200, hasta: 2600 },
      { eje: 'alto', fijo: 2560, desde: 200, hasta: 2600 }
    ]
    const tam = (t: (typeof trayectorias)[number], v: number): { ancho: number; alto: number } =>
      t.eje === 'ancho' ? { ancho: v, alto: t.fijo } : { ancho: t.fijo, alto: v }
    const valida = (d: DisposicionMosaico): boolean => d.minimo.cols >= MINIMO_COLS && d.minimo.filas >= MINIMO_FILAS
    for (const preset of presets) {
      for (let n = 2; n <= MAX_TESELAS_MOSAICO; n++) {
        for (const t of trayectorias) {
          let prev: DisposicionMosaico | null = null
          for (let v = t.desde; v <= t.hasta; v += 3) {
            pasos++
            const d = calc({ n, preset, ...tam(t, v), anterior: prev })
            const fresco = calc({ n, preset, ...tam(t, v) })
            const donde = `${preset} n=${n} ${t.eje}=${v} (${t.eje === 'ancho' ? 'alto' : 'ancho'}=${t.fijo})`
            const p = problemas(d, n)
            if (p.length > 0) fallos.push(`${donde}: ${p.join('; ')}`)
            if (forma(d) !== forma(fresco)) {
              if (prev === null || forma(d) !== forma(prev)) fallos.push(`${donde}: ${forma(d)} no es la de cero ni la anterior`)
              if (!valida(d) || d.puntuacion < UMBRAL_HISTERESIS * fresco.puntuacion - 1e-9) {
                fallos.push(`${donde}: conservó ${fmt(d)} frente a ${fmt(fresco)}`)
              }
            }
            // La regla EXACTA, no sólo su mitad: si la anterior es de AUTO (misma clase),
            // es una forma de rejilla o principal, la de cero es de AUTO y la anterior,
            // medida con la REFERENCIA al tamaño nuevo, es válida y ≥ 95 % de la ELEGIDA
            // de cero (no de la mejor), HAY que conservarla; en cualquier otro caso HAY que
            // dar la de cero. Sin esto, un módulo sin histéresis pasaría (17a): nunca
            // "conserva" nada indebido.
            {
              const aqui: Fixture = { ...tam(t, v), hueco: 4, celdaAncho: 8, celdaAlto: 17, cromoAncho: 14, cromoAlto: 69 }
              const pegable =
                prev !== null &&
                prev.origen === 'auto' &&
                fresco.origen === 'auto' &&
                fresco.forma !== 'enfoque' &&
                (prev.forma === 'columnas' || prev.forma === 'filas' || prev.forma === 'rejilla' || (prev.forma === 'principal' && n === 3))
              let esperada = forma(fresco)
              if (pegable && prev !== null) {
                const r = prev.forma === 'principal' ? refPrincipal(n, aqui) : refRejilla(n, prev.filasDeTeselas[0], aqui)
                if (r.valida && r.p >= UMBRAL_HISTERESIS * fresco.puntuacion - 1e-9) esperada = forma(prev)
                if (forma(prev) !== forma(fresco)) {
                  if (esperada === forma(prev)) conservadas++
                  else if (r.valida) cambiadas++
                }
              }
              if (forma(d) !== esperada) reglaRota.push(`${donde}: ${fmt(d)} (anterior ${prev ? fmt(prev) : 'null'}, de cero ${fmt(fresco)}) != ${esperada}`)
            }
            // Vaivén de 1 px desde aquí.
            const ida = calc({ n, preset, ...tam(t, v + 1), anterior: d })
            const vuelta = calc({ n, preset, ...tam(t, v), anterior: ida })
            const alterna = forma(ida) !== forma(d) && forma(vuelta) === forma(d)
            if (alterna) {
              // Es un cruce del suelo —y entonces el cambio es correcto— si interviene
              // 'enfoque', si un preset explícito empieza o deja de caber (cambia el
              // origen), o si alguna de las dos formas no es válida en el otro tamaño.
              // La validez de una forma en un tamaño la da la REFERENCIA, no el módulo.
              const aqui: Fixture = { ...tam(t, v), hueco: 4, celdaAncho: 8, celdaAlto: 17, cromoAncho: 14, cromoAlto: 69 }
              const alla: Fixture = { ...aqui, ...tam(t, v + 1) }
              const validaEn = (x: DisposicionMosaico, f: Fixture): boolean =>
                x.forma === 'principal' ? refPrincipal(n, f).valida : refRejilla(n, x.filasDeTeselas[0], f).valida
              const cruceDeSuelo =
                d.forma === 'enfoque' ||
                ida.forma === 'enfoque' ||
                d.origen !== 'auto' ||
                ida.origen !== 'auto' ||
                vuelta.origen !== 'auto' ||
                !validaEn(d, alla) ||
                !validaEn(ida, aqui)
              if (!cruceDeSuelo) vaivenes.push(`${donde}: ${fmt(d)} → ${fmt(ida)} → ${fmt(vuelta)}`)
            }
            prev = d
          }
        }
      }
    }
    check(
      '(17a) cada paso es la de cero o la anterior válida y ≥ 95 % de la elegida; invariantes intactas',
      fallos.length === 0,
      fallos.length === 0 ? `${pasos} pasos` : `${fallos.length}/${pasos}: ${fallos.slice(0, 3).join(' || ')}`
    )
    check(
      '(17b) sin vaivén de 1 px entre formas válidas',
      vaivenes.length === 0,
      vaivenes.length === 0 ? `${pasos} vaivenes probados` : `${vaivenes.length}: ${vaivenes.slice(0, 3).join(' || ')}`
    )
    // No vacuo: en las trayectorias tiene que haber pasos que CONSERVAN una forma que
    // no es la de cero, y pasos que CAMBIAN porque la anterior, aun válida, cayó por
    // debajo del 95 %.
    check(
      '(17c) la histéresis sigue la regla EXACTA: conserva la anterior válida y ≥ 95 % de la elegida, y si no, cambia a la de cero',
      reglaRota.length === 0 && conservadas > 0 && cambiadas > 0,
      reglaRota.length === 0
        ? `${pasos} pasos: ${conservadas} conservadas frente a la de cero, ${cambiadas} cambios por >5 %`
        : `${reglaRota.length}: ${reglaRota.slice(0, 3).join(' || ')}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(18) Mismo resultado → mismo objeto')

  {
    const a = calc({ n: 5 })
    const b = calc({ n: 5, ancho: 1921, anterior: a })
    check('(18a) sin cambios de caracteres, devuelve la MISMA anterior (identidad)', b === a, `b === a: ${b === a}`)
    const c = calc({ n: 5, ancho: 1700, anterior: a })
    check(
      '(18b) con un cambio real devuelve un objeto nuevo y no toca la anterior',
      c !== a && !mismaDisposicion(a, c) && a.minimo.cols === 77,
      `${fmt(a)} → ${fmt(c)}`
    )
    const copia = JSON.parse(JSON.stringify(a)) as DisposicionMosaico
    const conCopia = calc({ n: 5, anterior: copia })
    check('(18c) una copia profunda igual también se conserva (la igualdad es estructural)', conCopia === copia, `conCopia === copia: ${conCopia === copia}`)
    let lanzo = ''
    try {
      mismaDisposicion(a, { ...a, celdas: null, filasDeTeselas: undefined, minimo: undefined } as any)
      mismaDisposicion(undefined as any, a)
      mismaDisposicion(a, { ...a, celdas: [undefined, null, null, null, null] } as any)
    } catch (err) {
      lanzo = String(err)
    }
    check('(18d) mismaDisposicion no lanza con disposiciones mal formadas', lanzo === '', lanzo || 'sin excepciones')
  }

  // ---------------------------------------------------------------------------
  hr('(19) Saturación en el objetivo: más allá de 80 × 24 no se puntúa')

  {
    // Con n=1 no hay nada que elegir, y la puntuación es la de UNA tesela a pantalla completa.
    //   ancho 2414: (2414−14)/8 = 300 cols; 654: 80 cols; 646: 79 cols. Alto 1000 → 54 filas (satura).
    const c300 = calc({ n: 1, ancho: 2414 })
    const c80 = calc({ n: 1, ancho: 654 })
    const c79 = calc({ n: 1, ancho: 646 })
    check(
      '(19a) 300 columnas puntúan lo mismo que 80 (1); 79, menos ((79/80)·(24/24) = 0,9875)',
      es(c300, 'unica', [1], 300, 54, P_MAX) &&
        es(c80, 'unica', [1], 80, 54, P_MAX) &&
        c300.puntuacion === c80.puntuacion &&
        es(c79, 'unica', [1], 79, 54, (79 / 80) * (24 / 24)) &&
        c79.puntuacion < c80.puntuacion,
      `${fmt(c300)} | ${fmt(c80)} | ${fmt(c79)}`
    )
    //   alto 1599: (1599−69)/17 = 90 filas; 477: 24 filas; 476: 23,9 → 23. Ancho 1920 → 238 cols (satura).
    const f90 = calc({ n: 1, alto: 1599 })
    const f24 = calc({ n: 1, alto: 477 })
    const f23 = calc({ n: 1, alto: 476 })
    check(
      '(19b) 90 filas puntúan lo mismo que 24 (1); 23, menos ((80/80)·(23/24) = 0,9583)',
      es(f90, 'unica', [1], 238, 90, P_MAX) &&
        es(f24, 'unica', [1], 238, 24, P_MAX) &&
        f90.puntuacion === f24.puntuacion &&
        es(f23, 'unica', [1], 238, 23, (80 / 80) * (23 / 24)) &&
        f23.puntuacion < f24.puntuacion,
      `${fmt(f90)} | ${fmt(f24)} | ${fmt(f23)}`
    )
    // Cuando falta en LAS DOS dimensiones es un PRODUCTO, no el menor de los dos cocientes:
    //   494 × 409 → (494−14)/8 = 60 cols × (409−69)/17 = 20 filas → 0,75 · 0,8333 = 0,625
    //   (el mínimo daría min(0,75, 0,8333) = 0,75: las 4 filas que faltan no contarían).
    const prod = calc({ n: 1, ancho: 494, alto: 409 })
    check(
      '(19c) corta en las dos dimensiones → producto de los dos cocientes (60x20 → 0,625, no 0,75)',
      es(prod, 'unica', [1], 60, 20, (60 / 80) * (20 / 24)),
      fmt(prod)
    )
    // Y lo que SOBRA en una dimensión no paga lo que falta en la otra (la razón de saturar
    // en el objetivo): 60 × 54 puntúa lo mismo que 60 × 24, (60/80)·(24/24) = 0,75. Con la
    // saturación descartada en 100 × 40, 60 × 54 puntuaba 0,75 · 1,667 = 1,25: más que una
    // terminal de 80 × 24 completa.
    const alta = calc({ n: 1, ancho: 494 })
    const justa = calc({ n: 1, ancho: 494, alto: 477 })
    check(
      '(19c2) lo que sobra en una dimensión no paga la otra: 60x54 puntúa como 60x24 (0,75)',
      es(alta, 'unica', [1], 60, 54, (60 / 80) * (24 / 24)) &&
        es(justa, 'unica', [1], 60, 24, (60 / 80) * (24 / 24)) &&
        alta.puntuacion === justa.puntuacion,
      `${fmt(alta)} | ${fmt(justa)}`
    )
    // Una disposición puntúa su PEOR tesela: 5 en 1920 × 1000 es [3,2], arriba 77 × 25 y
    // abajo 118 × 25. Puntúa (77/80)·(24/24) = 0,9625, no 1 (la de abajo llega al
    // objetivo); y lo grande que sea la de abajo no la sube.
    const cinco = calc({ n: 5 })
    check(
      '(19d) la disposición puntúa su peor tesela ([3,2]: la de arriba, 77x25 → 0,9625; la de abajo, 118x25, daría 1)',
      es(cinco, 'rejilla', [3, 2], 77, 25, (77 / 80) * (24 / 24)) && cinco.puntuacion < P_MAX,
      fmt(cinco)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(20) Cerca del empate, menos filas')

  {
    // 1920 × 1200 con 3 (la fixture de siempre):
    //   [2,1]  958 → 118 cols × (598−69)/17 → 31 filas → satura: 1 (la MEJOR, con principal: pila 94 × 31 → 1)
    //   [3]    637,3 → 77 cols × (1200−69)/17 → 66 filas → (77/80)·(24/24) = 0,9625 (96,3 %)
    //   filas: 238 × 19 → (80/80)·(19/24) = 0,7917.
    // Con la puntuación a secas saldría 2+1, que puntúa un 3,9 % más. Dentro del 5 %, gana la
    // de menos filas: TRES COLUMNAS.
    const f1200: Fixture = { ancho: 1920, alto: 1200, hueco: 4, celdaAncho: 8, celdaAlto: 17, cromoAncho: 14, cromoAlto: 69 }
    const d = calc({ n: 3, alto: 1200 })
    const mejor = refMejor(3, f1200)
    check(
      '(20a) 1920 × 1200 con 3 → columnas [3] (77x66, 0,9625), aunque 2+1 (118x31) llegue al objetivo y puntúe un 3,9 % más',
      es(d, 'columnas', [3], 77, 66, (77 / 80) * (24 / 24)) &&
        mejor !== null &&
        refATexto(mejor) === 'rejilla[2,1] 118x31' &&
        cerca(mejor.p, P_MAX) &&
        d.puntuacion < mejor.p &&
        d.puntuacion >= UMBRAL_HISTERESIS * mejor.p,
      `${fmt(d)} | mejor ${mejor ? `${refATexto(mejor)} p=${mejor.p.toFixed(4)}` : '-'}`
    )
  }
  {
    // Portátil Mac con la letra 7 × 15 de la fixture vieja (cromo y hueco de la de siempre):
    // con la saturación en 100 × 40 esto era un EMPATE (2+1 por delante un 0,7 % y un 1,4 %, y
    // salían tres columnas por menos filas). Con la saturación en el objetivo, 2+1 llega a 80
    // columnas y tres columnas no, y ya no es un empate: 2+1.
    //   1470 × 956: [3]   (1462/3 = 487,3 − 14)/7 → 67 × (956−69)/15 → 59 → (67/80)·(24/24) = 0,8375 (83,8 %)
    //               [2,1] (733 − 14)/7 → 102 cols × (476−69)/15 → 27 → satura: 1
    //   1512 × 982: [3]   (1504/3 = 501,3 − 14)/7 → 69 × (982−69)/15 → 60 → (69/80)·(24/24) = 0,8625 (86,3 %)
    //               [2,1] (754 − 14)/7 → 105 cols × (489−69)/15 → 28 → satura: 1
    // (Con las medidas REALES del portátil sale lo mismo: ver (21f).)
    const mac = { celda: { ancho: 7, alto: 15 } }
    const air = calc({ n: 3, ancho: 1470, alto: 956, ...mac })
    const pro = calc({ n: 3, ancho: 1512, alto: 982, ...mac })
    const airCol = calc({ n: 3, ancho: 1470, alto: 956, preset: 'columnas', ...mac })
    const proCol = calc({ n: 3, ancho: 1512, alto: 982, preset: 'columnas', ...mac })
    check(
      '(20b) portátil Mac (1470 × 956 y 1512 × 982, letra 7 × 15) con 3 → 2+1: tres columnas (67 y 69 caracteres) quedan a más del 5 %',
      es(air, 'rejilla', [2, 1], 102, 27, P_MAX) &&
        es(pro, 'rejilla', [2, 1], 105, 28, P_MAX) &&
        es(airCol, 'columnas', [3], 67, 59, (67 / 80) * (24 / 24)) &&
        es(proCol, 'columnas', [3], 69, 60, (69 / 80) * (24 / 24)) &&
        airCol.puntuacion < UMBRAL_HISTERESIS * air.puntuacion &&
        proCol.puntuacion < UMBRAL_HISTERESIS * pro.puntuacion,
      `${fmt(air)} (columnas ${fmt(airCol)}) | ${fmt(pro)} (columnas ${fmt(proCol)})`
    )
  }
  {
    // 2 teselas en 1270 × 1200: filas 157 × 31 (1) es la mejor; columnas 77 × 66
    // (0,9625) está al 96,3 % → una fila de teselas le gana a dos.
    // A 1200 × 1200 columnas cae a 73 × 66 (0,9125, 91,3 %): fuera del 5 %, y gana filas.
    const d1270 = calc({ n: 2, ancho: 1270, alto: 1200 })
    const d1200 = calc({ n: 2, ancho: 1200, alto: 1200 })
    check(
      '(20c) una rejilla de 2 filas dentro del 5 % pierde contra la de 1 (1270 × 1200: columnas 96,3 % de filas)',
      es(d1270, 'columnas', [2], 77, 66, (77 / 80) * (24 / 24)) && (77 / 80) * (24 / 24) >= UMBRAL_HISTERESIS * P_MAX,
      fmt(d1270)
    )
    check(
      '(20d) …pero si la de menos filas queda a más del 5 %, gana la mejor (1200 × 1200: columnas 91,3 % → filas)',
      es(d1200, 'filas', [1, 1], 148, 31, P_MAX) && (73 / 80) * (24 / 24) < UMBRAL_HISTERESIS * P_MAX,
      fmt(d1200)
    )
  }
  {
    // 4 en 1920 × 1000: 2×2 = 118 × 25 (1); cuatro columnas = 57 × 54 (0,7125), un 71,3 %:
    // fuera de la banda, así que se queda el 2×2 («si hay 4, 2 arriba y 2 abajo»).
    const d4 = calc({ n: 4 })
    const cuatro = calc({ n: 4, preset: 'columnas' })
    check(
      '(20e) 4 en 1920 × 1000 sigue 2×2: cuatro columnas (57x54) son un 29 % peores, fuera del 5 %',
      es(d4, 'rejilla', [2, 2], 118, 25, P_MAX) &&
        es(cuatro, 'columnas', [4], 57, 54, (57 / 80) * (24 / 24)) &&
        cuatro.puntuacion < UMBRAL_HISTERESIS * d4.puntuacion,
      `${fmt(d4)} | columnas ${fmt(cuatro)} (${((cuatro.puntuacion / d4.puntuacion) * 100).toFixed(1)} %)`
    )
    // Donde las dos reglas van a una: vertical (filas es la mejor por mucho; ver (6a)); y la
    // ultrapanorámica, donde todo satura y decide «menos filas» (ver (6c)).
    const ultra = calc({ n: 4, ancho: 3440, alto: 1400 })
    const vertical = calc({ n: 2, ancho: 1080, alto: 1800 })
    check(
      '(20f) 3440 × 1400 con 4 → columnas [4]; vertical 1080 × 1800 con 2 → filas (columnas, al 81 %, no entra)',
      es(ultra, 'columnas', [4], 105, 78, P_MAX) && es(vertical, 'filas', [1, 1], 133, 48, P_MAX),
      `${fmt(ultra)} | ${fmt(vertical)}`
    )
    // El efecto del otro lado (cabecera, "Efecto que sorprende" y SIN MEDIR): 4 en
    // 2540 × 1000. Cuatro columnas = (2528/4 = 632 − 14)/8 → 77 × 54 → (77/80)·(24/24) = 0,9625;
    // 2×2 = (1268 − 14)/8 → 156 × 25 → satura: 1. 96,3 %: dentro, y con menos filas.
    const ancha = calc({ n: 4, ancho: 2540 })
    check(
      '(20g) 4 en 2540 × 1000 → cuatro columnas (77x54), al 96,3 % del 2×2 (156x25) y con menos filas',
      es(ancha, 'columnas', [4], 77, 54, (77 / 80) * (24 / 24)) && (77 / 80) * (24 / 24) >= UMBRAL_HISTERESIS * P_MAX,
      fmt(ancha)
    )
  }

  // ---------------------------------------------------------------------------
  hr('(21) Pantallas reales: las medidas del integrador')

  {
    // Aquí no se usa la fixture de siempre sino las medidas con las que la app llama de
    // verdad a `calcularMosaico`. CROMO_REAL y HUECO_REAL calcan CROMO_CASILLA y
    // HUECO_CASILLAS de features/agentes/useCCPanelMosaico.ts: si cambian allí, se cambian aquí. Las dos
    // celdas son las que da su `medirCeldaTerminal` —alto ⌊⌈tamaño · 1,17⌉ · 1,2⌋, ancho
    // 0,6 em, la proporción que usa cuando no puede medir la 'W' de la fuente—: 7,8 × 19
    // es la letra por defecto del agente (13 px) y 8,4 × 20, la de 14 px. Cada contenedor
    // es la ventana (o la pantalla, maximizada) menos lo que no es rejilla —marco, barra
    // de título, barra del mosaico y, maximizada en Windows, la barra de tareas—; son
    // aproximados, y cada caso dice de qué ventana sale.
    const CROMO_REAL = { ancho: 33, alto: 69 }
    const HUECO_REAL = 1
    const LETRA_13 = { ancho: 7.8, alto: 19 }
    const LETRA_14 = { ancho: 8.4, alto: 20 }
    const real = (celda: { ancho: number; alto: number }, ancho: number, alto: number, n: number, preset: PresetMosaico = 'auto'): DisposicionMosaico =>
      calc({ n, preset, ancho, alto, hueco: HUECO_REAL, cromo: CROMO_REAL, celda })
    const corto = (d: DisposicionMosaico): string => `${forma(d)} ${d.minimo.cols}x${d.minimo.filas} p=${d.puntuacion.toFixed(4)}`
    interface Esperado {
      n: number
      forma: string
      filas: number[]
      cols: number
      filasTerm: number
      p: number
    }
    /** Todos los casos de una ventana y una letra: forma, tamaño y puntuación exactos. */
    const ventana = (celda: { ancho: number; alto: number }, ancho: number, alto: number, casos: Esperado[]): [boolean, string] => {
      const ds = casos.map((c) => real(celda, ancho, alto, c.n))
      const ok = casos.every((c, i) => es(ds[i], c.forma, c.filas, c.cols, c.filasTerm, c.p) && ds[i].origen === 'auto')
      return [ok, ds.map((d, i) => `n=${casos[i].n} ${corto(d)}`).join(' | ')]
    }

    // 1920 × 1080 MAXIMIZADA → contenedor ≈ 1906 × 968. Es la forma canónica entera (y por
    // eso es la que se devuelve sin medir: ver SIN MEDIR en la cabecera del módulo).
    //   letra 8,4 × 20: n=2 (1905/2 = 952,5 − 33)/8,4 → 109 × (968−69)/20 → 44 → 1
    //                   n=3 (1904/3 = 634,7 − 33)/8,4 → 71 × 44 → (71/80)·(24/24) = 0,8875 (2+1: 109 × 20 → 0,8333)
    //                   n=4 2×2 109 × (967/2 = 483,5 − 69)/20 → 20 → (80/80)·(20/24) = 0,8333 (cuatro columnas: 52 × 44 → 0,65)
    //                   n=5 [3,2] y n=6 [3,3]: 71 × 20 → (71/80)·(20/24) = 0,7396
    //   letra 7,8 × 19: n=2 117 × 47 → 1; n=3 77 × 47 → 0,9625; n=4 117 × 21 → 0,875 (cuatro columnas: 56 × 47 → 0,7);
    //                   n=5 y n=6: 77 × 21 → (77/80)·(21/24) = 0,8422
    const [ok14, ev14] = ventana(LETRA_14, 1906, 968, [
      { n: 2, forma: 'columnas', filas: [2], cols: 109, filasTerm: 44, p: P_MAX },
      { n: 3, forma: 'columnas', filas: [3], cols: 71, filasTerm: 44, p: (71 / 80) * (24 / 24) },
      { n: 4, forma: 'rejilla', filas: [2, 2], cols: 109, filasTerm: 20, p: (80 / 80) * (20 / 24) },
      { n: 5, forma: 'rejilla', filas: [3, 2], cols: 71, filasTerm: 20, p: (71 / 80) * (20 / 24) },
      { n: 6, forma: 'rejilla', filas: [3, 3], cols: 71, filasTerm: 20, p: (71 / 80) * (20 / 24) }
    ])
    check('(21a) 1920 × 1080 maximizada (≈ 1906 × 968), letra 8,4 × 20: 2 y 3 en columnas, 4 en 2×2, 5 en 3+2, 6 en 3+3', ok14, ev14)
    const [ok13, ev13] = ventana(LETRA_13, 1906, 968, [
      { n: 2, forma: 'columnas', filas: [2], cols: 117, filasTerm: 47, p: P_MAX },
      { n: 3, forma: 'columnas', filas: [3], cols: 77, filasTerm: 47, p: (77 / 80) * (24 / 24) },
      { n: 4, forma: 'rejilla', filas: [2, 2], cols: 117, filasTerm: 21, p: (80 / 80) * (21 / 24) },
      { n: 5, forma: 'rejilla', filas: [3, 2], cols: 77, filasTerm: 21, p: (77 / 80) * (21 / 24) },
      { n: 6, forma: 'rejilla', filas: [3, 3], cols: 77, filasTerm: 21, p: (77 / 80) * (21 / 24) }
    ])
    check('(21a2) …y con la letra por defecto, 7,8 × 19: la misma forma canónica para n = 2..6', ok13, ev13)

    // El caso que DESCARTÓ la saturación en 100 × 40 (cabecera del módulo): con ella, 4
    // agentes salían en cuatro columnas de 52 (o de 56 con letra 7,8 × 19), porque las filas
    // 25 a 40 de cada columna pagaban las columnas que les faltaban hasta 80.
    //   8,4 × 20: cuatro columnas (1903/4 = 475,75 − 33)/8,4 → 52 × 44: (52/80)·(40/24) = 1,0833
    //             frente al 2×2, 109 × 20: (100/80)·(20/24) = 1,0417 → ganaban las columnas.
    //   7,8 × 19: 56 × 47 → (56/80)·(40/24) = 1,1667 frente a 117 × 21 → (100/80)·(21/24) = 1,0938.
    // Con el tope en el objetivo: 0,65 frente a 0,8333 y 0,7 frente a 0,875 → 2×2.
    const sat100x40 = (d: DisposicionMosaico): number => (Math.min(d.minimo.cols, 100) / 80) * (Math.min(d.minimo.filas, 40) / 24)
    const descartes = [LETRA_14, LETRA_13].map((celda) => ({
      auto: real(celda, 1906, 968, 4),
      cuatro: real(celda, 1906, 968, 4, 'columnas')
    }))
    check(
      '(21b) con la saturación descartada en 100 × 40 ganaban cuatro columnas de 52 y 56 caracteres; con la del objetivo, 2×2 y con margen',
      es(descartes[0].cuatro, 'columnas', [4], 52, 44, (52 / 80) * (24 / 24)) &&
        es(descartes[1].cuatro, 'columnas', [4], 56, 47, (56 / 80) * (24 / 24)) &&
        descartes.every(
          ({ auto, cuatro }) =>
            forma(auto) === 'rejilla[2,2]' &&
            sat100x40(cuatro) > sat100x40(auto) &&
            cuatro.puntuacion < UMBRAL_HISTERESIS * auto.puntuacion
        ),
      descartes
        .map(({ auto, cuatro }) => `2×2 ${corto(auto)} (100×40: ${sat100x40(auto).toFixed(4)}) vs cuatro ${corto(cuatro)} (100×40: ${sat100x40(cuatro).toFixed(4)})`)
        .join(' || ')
    )

    // 1500 × 950 en ventana → ≈ 1486 × 880 (la ventana de e2e/mosaico.spec.ts, que espera
    // 2 arriba y 2 abajo con 4 agentes):
    //   8,4 × 20: 2×2 (1485/2 = 742,5 − 33)/8,4 → 84 × (879/2 = 439,5 − 69)/20 → 18 → (80/80)·(18/24) = 0,75
    //             (cuatro columnas: 40 < 50, no llegan al suelo; [3,1]: 54 × 18 → 0,5063)
    //   7,8 × 19: 2×2 90 × 19 → (80/80)·(19/24) = 0,7917 (cuatro columnas: 43 < 50)
    const v1500a = real(LETRA_14, 1486, 880, 4)
    const v1500b = real(LETRA_13, 1486, 880, 4)
    check(
      '(21c) 1500 × 950 (≈ 1486 × 880) con 4 → 2×2 con las dos letras (la ventana del e2e)',
      es(v1500a, 'rejilla', [2, 2], 84, 18, (80 / 80) * (18 / 24)) && es(v1500b, 'rejilla', [2, 2], 90, 19, (80 / 80) * (19 / 24)),
      `8,4×20 ${corto(v1500a)} | 7,8×19 ${corto(v1500b)}`
    )

    // 2560 × 1440 maximizada → ≈ 2546 × 1328.
    //   n=3: tres columnas llegan al objetivo con las dos letras —(2544/3 = 848 − 33)/8,4 → 97 × 62;
    //        (848 − 33)/7,8 → 104 × 66— y empatan a 1 con 2+1: gana la de menos filas.
    const q3a = real(LETRA_14, 2546, 1328, 3)
    const q3b = real(LETRA_13, 2546, 1328, 3)
    check(
      '(21d) 2560 × 1440 (≈ 2546 × 1328) con 3 → tres columnas con las dos letras (97x62 y 104x66, las dos a 1)',
      es(q3a, 'columnas', [3], 97, 62, P_MAX) && es(q3b, 'columnas', [3], 104, 66, P_MAX),
      `8,4×20 ${corto(q3a)} | 7,8×19 ${corto(q3b)}`
    )
    //   n=4 con 8,4 × 20: 2×2 (2545/2 = 1272,5 − 33)/8,4 → 147 × (1327/2 = 663,5 − 69)/20 → 29 → satura: 1;
    //        cuatro columnas (2543/4 = 635,75 − 33)/8,4 → 71 × 62 → (71/80)·(24/24) = 0,8875 (88,8 %: fuera) → 2×2.
    const q4a = real(LETRA_14, 2546, 1328, 4)
    check('(21e) …con 4 y letra 8,4 × 20 → 2×2 (147x29, 1): cuatro columnas de 71 quedan al 88,8 %', es(q4a, 'rejilla', [2, 2], 147, 29, P_MAX), corto(q4a))
    //   n=4 con 7,8 × 19: NO sale 2×2 (se pidió «4 → 2 arriba y 2 abajo»). Cuatro columnas
    //        (635,75 − 33)/7,8 → 77 × (1328 − 69)/19 → 66 → (77/80)·(24/24) = 0,9625, frente al 1 del
    //        2×2 (158 × 31): al 96,3 %, DENTRO de la banda del 5 %, y con una fila de teselas en vez
    //        de dos → cuatro columnas. Lo produce «CERCA DEL EMPATE, MENOS FILAS», no la saturación:
    //        77 columnas son un empate con 80 para esa regla. Se fija aquí para que un cambio en
    //        ella se vea; ver "Efecto que sorprende" en la cabecera del módulo.
    const q4b = real(LETRA_13, 2546, 1328, 4)
    const q4b2x2 = refRejilla(4, 2, { ancho: 2546, alto: 1328, hueco: HUECO_REAL, celdaAncho: 7.8, celdaAlto: 19, cromoAncho: 33, cromoAlto: 69 })
    check(
      '(21e2) …con 4 y letra 7,8 × 19 → CUATRO COLUMNAS (77x66, 0,9625), no 2×2: al 96,3 % del 2×2 (158x31, 1), dentro del 5 % y con menos filas',
      es(q4b, 'columnas', [4], 77, 66, (77 / 80) * (24 / 24)) &&
        q4b2x2.cols === 158 &&
        q4b2x2.filasTerm === 31 &&
        cerca(q4b2x2.p, P_MAX) &&
        q4b.puntuacion >= UMBRAL_HISTERESIS * q4b2x2.p,
      `${corto(q4b)} | 2×2 allí: ${refATexto(q4b2x2)} p=${q4b2x2.p.toFixed(4)}`
    )
    //   …y ése es el caso que trajo el preset 'cuadricula' (ver CUADRÍCULA en la cabecera del
    //   módulo): quien quiere «2 arriba y 2 abajo» lo PIDE, y sale el 2×2 de la referencia,
    //   158 × 31, respetado y como preset (no como elección de AUTO), con las dos letras
    //   (con 8,4 × 20 coincide con AUTO: 147 × 29).
    const q4bCuad = real(LETRA_13, 2546, 1328, 4, 'cuadricula')
    const q4aCuad = real(LETRA_14, 2546, 1328, 4, 'cuadricula')
    check(
      '(21e3) …con el preset cuadricula, 2×2 con las dos letras (158x31 y 147x29, a 1), respetado y como preset',
      es(q4bCuad, 'rejilla', [2, 2], 158, 31, P_MAX) &&
        es(q4aCuad, 'rejilla', [2, 2], 147, 29, P_MAX) &&
        mismaGeometria(q4aCuad, q4a) &&
        [q4bCuad, q4aCuad].every((d) => d.presetRespetado && d.origen === 'preset' && d.presetPedido === 'cuadricula'),
      `7,8×19 ${corto(q4bCuad)} (AUTO: ${corto(q4b)}) | 8,4×20 ${corto(q4aCuad)}`
    )

    // Portátil Mac, 1470 × 956 → ≈ 1456 × 880, con 3: NO salen tres columnas (se pidió «3 → en
    // 3»). Tres columnas pasan el suelo, pero quedan a más del 5 % de 2+1:
    //   8,4 × 20: tres columnas (1454/3 = 484,7 − 33)/8,4 → 53 × (880−69)/20 → 40 → (53/80)·(24/24) = 0,6625
    //             2+1 (1455/2 = 727,5 − 33)/8,4 → 82 × (879/2 = 439,5 − 69)/20 → 18 → (80/80)·(18/24) = 0,75
    //             → 88,3 %: fuera de la banda, y gana 2+1.
    //   7,8 × 19: tres columnas 57 × 42 → 0,7125; 2+1 89 × 19 → 0,7917 → 90,0 %: 2+1.
    // Lo produce la saturación en el objetivo: las 40 filas de cada columna cuentan como 24 y ya
    // no pagan las 27 columnas que les faltan (con 100 × 40 salían tres columnas: 1,1042 frente
    // a 0,7688). Ver "Y por qué no una banda más ancha" en la cabecera del módulo.
    const macA = real(LETRA_14, 1456, 880, 3)
    const macB = real(LETRA_13, 1456, 880, 3)
    const macColA = real(LETRA_14, 1456, 880, 3, 'columnas')
    const macColB = real(LETRA_13, 1456, 880, 3, 'columnas')
    check(
      '(21f) portátil Mac (≈ 1456 × 880) con 3 → 2+1, NO tres columnas: pasan el suelo (53x40 y 57x42) pero quedan al 88,3 % y al 90,0 % de 2+1',
      es(macA, 'rejilla', [2, 1], 82, 18, (80 / 80) * (18 / 24)) &&
        es(macB, 'rejilla', [2, 1], 89, 19, (80 / 80) * (19 / 24)) &&
        es(macColA, 'columnas', [3], 53, 40, (53 / 80) * (24 / 24)) &&
        es(macColB, 'columnas', [3], 57, 42, (57 / 80) * (24 / 24)) &&
        macColA.presetRespetado &&
        macColB.presetRespetado &&
        macColA.puntuacion < UMBRAL_HISTERESIS * macA.puntuacion &&
        macColB.puntuacion < UMBRAL_HISTERESIS * macB.puntuacion,
      `8,4×20 ${corto(macA)} (columnas ${corto(macColA)}) | 7,8×19 ${corto(macB)} (columnas ${corto(macColB)})`
    )

    // Ultrapanorámica 3440 × 1440 maximizada → ≈ 3426 × 1328, con 4: cuatro columnas llegan al
    // objetivo —(3423/4 = 855,75 − 33)/8,4 → 97 × 62; /7,8 → 105 × 66— y empatan a 1 con el 2×2 y
    // con 3+1: gana la de menos filas.
    const ultraA = real(LETRA_14, 3426, 1328, 4)
    const ultraB = real(LETRA_13, 3426, 1328, 4)
    check(
      '(21g) ultrapanorámica 3440 × 1440 (≈ 3426 × 1328) con 4 → cuatro columnas (97x62 y 105x66, a 1)',
      es(ultraA, 'columnas', [4], 97, 62, P_MAX) && es(ultraB, 'columnas', [4], 105, 66, P_MAX),
      `8,4×20 ${corto(ultraA)} | 7,8×19 ${corto(ultraB)}`
    )

    // Vertical 1080 × 1920 → ≈ 1066 × 1810, con 2: filas llega al objetivo —(1066−33)/8,4 → 122 ×
    // (1809/2 = 904,5 − 69)/20 → 41; /7,8 → 132 × 43— y columnas se queda en 59 y 64 caracteres
    // (0,7375 y 0,8).
    const vertA = real(LETRA_14, 1066, 1810, 2)
    const vertB = real(LETRA_13, 1066, 1810, 2)
    check(
      '(21h) vertical 1080 × 1920 (≈ 1066 × 1810) con 2 → filas (122x41 y 132x43, a 1)',
      es(vertA, 'filas', [1, 1], 122, 41, P_MAX) && es(vertB, 'filas', [1, 1], 132, 43, P_MAX),
      `8,4×20 ${corto(vertA)} | 7,8×19 ${corto(vertB)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(22) Cuadrícula: la rejilla equilibrada, a petición')

  // La forma que el preset promete para cada n, escrita a mano (la regla es ⌈√n⌉
  // columnas, por filas): es lo que se tiene que ver en cualquier tamaño en que quepa.
  const FORMA_CUADRICULA = ['', 'unica[1]', 'columnas[2]', 'rejilla[2,1]', 'rejilla[2,2]', 'rejilla[3,2]', 'rejilla[3,3]']
  const celdasDe = (d: DisposicionMosaico): string => d.celdas.map((c) => (c ? `${c.fila}:${c.columna}+${c.spanColumnas}` : '-')).join(' ')
  {
    // 3840 × 2100 con la fixture de siempre: tan holgado que AUTO pone TODAS en una fila
    // de teselas (todas llegan al objetivo, o quedan dentro del 5 %, y gana la de menos
    // filas). La cuadrícula no mira eso:
    //   n=2 [2]:   (3840−4)/2 = 1918 → (1918−14)/8 = 238 cols × (2100−69)/17 = 119 filas → 1
    //   n=3 [2,1]: arriba 238 cols; la de abajo abarca las 2 pistas → 478; filas (2100−4)/2 = 1048 → 57 → 1
    //   n=4 [2,2]: 238 × 57 → 1
    //   n=5 [3,2]: T = 6, (3840−20)/6 = 636,7; arriba 2 pistas = 1277,3 → 157; abajo 3 = 1918 → 238; 57 filas → 1
    //   n=6 [3,3]: (3840−8)/3 = 1277,3 → 157 × 57 → 1
    //   AUTO: [2]; [3] 157 × 119; [4] 117 × 119; [5] 93 × 119 (todas 1); [6] 77 × 119 → 0,9625, en la banda.
    const grande = { ancho: 3840, alto: 2100 }
    const cuad = [1, 2, 3, 4, 5, 6].map((n) => calc({ n, preset: 'cuadricula', ...grande }))
    const auto = [1, 2, 3, 4, 5, 6].map((n) => calc({ n, ...grande }))
    const esperadas: [string, number[], number, number][] = [
      ['unica', [1], 478, 119],
      ['columnas', [2], 238, 119],
      ['rejilla', [2, 1], 238, 57],
      ['rejilla', [2, 2], 238, 57],
      ['rejilla', [3, 2], 157, 57],
      ['rejilla', [3, 3], 157, 57]
    ]
    check(
      '(22a) n=1..6 en 3840 × 2100 → una / 2 / 2+1 / 2×2 / 3+2 / 3+3 con su tamaño; respetada y como preset (n=1, trivial)',
      cuad.every((d, i) => es(d, esperadas[i][0], esperadas[i][1], esperadas[i][2], esperadas[i][3], P_MAX)) &&
        cuad.every((d, i) => forma(d) === FORMA_CUADRICULA[i + 1]) &&
        cuad.every((d) => d.presetRespetado && d.presetPedido === 'cuadricula') &&
        cuad[0].origen === 'trivial' &&
        cuad.slice(1).every((d) => d.origen === 'preset'),
      cuad.map(fmt).join(' | ')
    )
    check(
      '(22a2) …donde AUTO pone de 2 a 6 en UNA fila de teselas: la cuadrícula no depende de sus preferencias',
      auto.slice(1).every((d) => d.forma === 'columnas' && d.filasDeTeselas.length === 1) &&
        es(auto[5], 'columnas', [6], 77, 119, (77 / 80) * (24 / 24)),
      auto.map(forma).join(' / ')
    )
    // La última fila se estira como en cualquier rejilla: 3 como 2+1 (T = 2), 5 como 3+2 (T = 6).
    check(
      '(22b) la última fila se estira: 3 → 1:1+1 1:2+1 2:1+2 sobre 2×2 pistas; 5 → T=6, arriba abarcan 2 y abajo 3',
      celdasDe(cuad[2]) === '1:1+1 1:2+1 2:1+2' &&
        cuad[2].plantillaColumnas === 'repeat(2, minmax(0, 1fr))' &&
        cuad[2].plantillaFilas === 'repeat(2, minmax(0, 1fr))' &&
        celdasDe(cuad[4]) === '1:1+2 1:3+2 1:5+2 2:1+3 2:4+3' &&
        cuad[4].plantillaColumnas === 'repeat(6, minmax(0, 1fr))' &&
        cuad.every((d, i) => problemas(d, i + 1).length === 0),
      `3: ${celdasDe(cuad[2])} | 5: ${celdasDe(cuad[4])}`
    )
  }
  {
    // PREDECIBLE: la forma depende sólo de n. En un barrido de tamaños, letras, cromos y
    // huecos, siempre que se respeta es LA de FORMA_CUADRICULA; cuando no, es exactamente
    // la de AUTO en ese tamaño, marcada como no respetada. Tiene que haber de las dos.
    const fuentes: [number, number, number, number][] = [
      [8, 17, 14, 69],
      [7.8, 19, 33, 69],
      [7, 15, 20, 60],
      [10, 22, 0, 0]
    ]
    let casos = 0
    let respetadas = 0
    let respaldos = 0
    const fallos: string[] = []
    for (const [celdaAncho, celdaAlto, cromoAncho, cromoAlto] of fuentes) {
      for (const hueco of [0, 1, 4, 12]) {
        for (let ancho = 200; ancho <= 4200; ancho += 97) {
          for (let alto = 150; alto <= 2600; alto += 89) {
            const f: Fixture = { ancho, alto, hueco, celdaAncho, celdaAlto, cromoAncho, cromoAlto }
            for (let n = 2; n <= MAX_TESELAS_MOSAICO; n++) {
              casos++
              const d = calcFixture(f, n, 'cuadricula')
              let ok: boolean
              if (d.presetRespetado) {
                respetadas++
                ok = forma(d) === FORMA_CUADRICULA[n] && d.origen === 'preset' && d.minimo.cols >= MINIMO_COLS && d.minimo.filas >= MINIMO_FILAS
              } else {
                respaldos++
                const a = calcFixture(f, n, 'auto')
                ok = d.origen === 'auto' && d.presetPedido === 'cuadricula' && mismaGeometria(d, a) && forma(d) !== FORMA_CUADRICULA[n]
              }
              if (!ok) fallos.push(`${JSON.stringify(f)} n=${n}: ${fmt(d)}`)
            }
          }
        }
      }
    }
    check(
      '(22c) predecible: respetada, siempre SU forma para cada n; si no, la de AUTO con presetRespetado=false',
      fallos.length === 0 && respetadas > 0 && respaldos > 0,
      fallos.length === 0
        ? `${casos} casos: ${respetadas} respetadas, ${respaldos} por AUTO`
        : `${fallos.length}/${casos}: ${fallos.slice(0, 3).join(' || ')}`
    )
  }
  {
    // Sin medir, SU forma y no la canónica de AUTO: con 3, 2+1 (AUTO daría tres columnas).
    const sinMedir = [1, 2, 3, 4, 5, 6].map((n) => calc({ n, preset: 'cuadricula', ancho: 0 }))
    const autoSinMedir = calc({ n: 3, ancho: 0 })
    check(
      '(22d) sin medir → su forma (3 como 2+1, no la canónica de AUTO), provisional: puntuación 0, 0x0, respetada',
      sinMedir.every((d, i) => forma(d) === FORMA_CUADRICULA[i + 1]) &&
        sinMedir.every((d) => d.puntuacion === 0 && d.minimo.cols === 0 && d.minimo.filas === 0 && d.presetRespetado) &&
        sinMedir.slice(1).every((d) => d.origen === 'sin-medir' && d.presetPedido === 'cuadricula') &&
        forma(autoSinMedir) === 'columnas[3]',
      `${sinMedir.map(forma).join(' / ')} | auto con 3: ${forma(autoSinMedir)}`
    )
  }
  {
    // Cuando no llega al suelo decide AUTO, y lo dice (presetRespetado=false):
    //   800 × 2400 con 4: 2×2 (800−4)/2 = 398 → (398−14)/8 = 48 cols < 50 → AUTO: filas
    //     (800−14)/8 = 98 × ((2400−12)/4 = 597 − 69)/17 = 31 → 1.
    //   3000 × 400 con 4: 2×2 (400−4)/2 = 198 → (198−69)/17 = 7 filas < 12 → AUTO: cuatro columnas
    //     (3000−12)/4 = 747 → (747−14)/8 = 91 × (400−69)/17 = 19 → (80/80)·(19/24) = 0,7917.
    //   900 × 560 con 6: 3+3 (900−8)/3 = 297,3 → 35 cols < 50, y nada más cabe (ver (5)) →
    //     'enfoque' en la enfocada, a pantalla completa: 110 × 28 → 1.
    const estrecho = calc({ n: 4, preset: 'cuadricula', ancho: 800, alto: 2400 })
    const bajo = calc({ n: 4, preset: 'cuadricula', ancho: 3000, alto: 400 })
    const diminuto = calc({ n: 6, preset: 'cuadricula', ancho: 900, alto: 560, enfocada: 2 })
    const respaldo = [estrecho, bajo, diminuto]
    const autos = [calc({ n: 4, ancho: 800, alto: 2400 }), calc({ n: 4, ancho: 3000, alto: 400 }), calc({ n: 6, ancho: 900, alto: 560, enfocada: 2 })]
    check(
      '(22e) no cabe → AUTO y presetRespetado=false: filas si falta ancho, cuatro columnas si falta alto, enfoque si nada cabe',
      es(estrecho, 'filas', [1, 1, 1, 1], 98, 31, P_MAX) &&
        es(bajo, 'columnas', [4], 91, 19, (80 / 80) * (19 / 24)) &&
        es(diminuto, 'enfoque', [1], 110, 28, P_MAX) &&
        diminuto.visibleEnfoque === 2 &&
        respaldo.every((d, i) => !d.presetRespetado && d.origen === 'auto' && d.presetPedido === 'cuadricula' && mismaGeometria(d, autos[i])),
      respaldo.map(fmt).join(' | ')
    )
  }
  {
    // Histéresis: la misma regla que para los otros presets explícitos.
    // Aplicada, es una orden: no mira la anterior. En 3840 × 2100 con 4, AUTO da cuatro
    // columnas; con 'cuadricula' sale el 2×2 aunque la anterior fueran esas columnas. Y al
    // volver a 'auto' con el 2×2 de anterior NO se pega, aunque AUTO lo conservaría si
    // viniera de él: el 2×2 puntúa 1, igual que la elegida (cuatro columnas, 117 × 119).
    const grande = { ancho: 3840, alto: 2100 }
    const autoCuatro = calc({ n: 4, ...grande })
    const cuadTrasAuto = calc({ n: 4, preset: 'cuadricula', ...grande, anterior: autoCuatro })
    const autoTrasCuad = calc({ n: 4, ...grande, anterior: cuadTrasAuto })
    check(
      '(22f) aplicada no mira la anterior, y al volver a auto no se pega (aunque el 2×2 empate con la elegida)',
      es(autoCuatro, 'columnas', [4], 117, 119, P_MAX) &&
        es(cuadTrasAuto, 'rejilla', [2, 2], 238, 57, P_MAX) &&
        cuadTrasAuto.origen === 'preset' &&
        es(autoTrasCuad, 'columnas', [4], 117, 119, P_MAX) &&
        autoTrasCuad.presetRespetado &&
        cuadTrasAuto.puntuacion >= UMBRAL_HISTERESIS * autoCuatro.puntuacion,
      `${fmt(autoCuatro)} → cuadricula ${fmt(cuadTrasAuto)} → auto ${fmt(autoTrasCuad)}`
    )
    // Dentro del RESPALDO sí hay histéresis (misma clase: AUTO con 'cuadricula' pedido), como
    // en (10k) para principal. 5 teselas en 1100 px de ancho, donde 3+2 no cabe:
    //   T = 6, (1100−20)/6 = 180 → arriba 2 pistas = 364 → (364−14)/8 = 43 cols < 50.
    //   [4,1] y [5] tampoco: (1100−12)/4 = 272 → 32 cols. Quedan [2,2,1] y filas.
    //   1100 × 2600: [2,2,1] (1100−4)/2 = 548 → 66 cols × ((2600−8)/3 = 864 − 69)/17 = 46 → (66/80)·(24/24) = 0,825
    //                filas 135 × ((2600−16)/5 = 516,8 − 69)/17 = 26 → 1. [2,2,1] al 82,5 %: filas.
    //   1100 × 2000: [2,2,1] 66 × ((1992/3 = 664 − 69)/17 = 35) → 0,825 (la mejor);
    //                filas 135 × ((1984/5 = 396,8 − 69)/17 = 19) → (80/80)·(19/24) = 0,7917 (96,0 %).
    //                De cero, [2,2,1]: tres filas de teselas frente a cinco. Viniendo de filas,
    //                0,7917 ≥ 0,95 × 0,825 = 0,7838 → se QUEDA en filas.
    const respaldo = calc({ n: 5, preset: 'cuadricula', ancho: 1100, alto: 2600 })
    const fresco = calc({ n: 5, preset: 'cuadricula', ancho: 1100, alto: 2000 })
    const pegado = calc({ n: 5, preset: 'cuadricula', ancho: 1100, alto: 2000, anterior: respaldo })
    const autoTrasRespaldo = calc({ n: 5, ancho: 1100, alto: 2000, anterior: respaldo })
    check(
      '(22g) en el respaldo AUTO hay histéresis (se queda en filas), y no se pega en auto (otra clase)',
      es(respaldo, 'filas', [1, 1, 1, 1, 1], 135, 26, P_MAX) &&
        es(fresco, 'rejilla', [2, 2, 1], 66, 35, (66 / 80) * (24 / 24)) &&
        es(pegado, 'filas', [1, 1, 1, 1, 1], 135, 19, (80 / 80) * (19 / 24)) &&
        [respaldo, fresco, pegado].every((d) => !d.presetRespetado && d.origen === 'auto' && d.presetPedido === 'cuadricula') &&
        es(autoTrasRespaldo, 'rejilla', [2, 2, 1], 66, 35, (66 / 80) * (24 / 24)) &&
        autoTrasRespaldo.presetRespetado,
      `${fmt(respaldo)} → fresco ${fmt(fresco)} | pegado ${fmt(pegado)} | auto ${fmt(autoTrasRespaldo)}`
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
