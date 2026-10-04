#!/usr/bin/env node
// =============================================================================
// Prueba de la lógica pura de la rejilla (npm run test:db-rejilla-ui): prefijos y ventana
// virtual sobre 50 000 × 100, desplazar para mostrar, cargar más, selección, teclado en
// Windows y en Mac con sus mitades negativas (la plataforma es un parámetro) y ancho inicial.
// =============================================================================

import {
  prefijosColumnas,
  columnaEn,
  anchoTotal,
  ventana,
  desplazarParaMostrar,
  debeCargarMas,
  filasPorPagina
} from './ventanaRejilla.ts'
import {
  clic,
  mover,
  rango,
  filaCompleta,
  todo,
  contiene,
  acotarSeleccion,
  type Seleccion,
  type DimsRejilla
} from './seleccionRejilla.ts'
import { accionTecla, type TeclaRejilla, type AccionRejilla } from './tecladoRejilla.ts'
import {
  anchoInicial,
  anchosIniciales,
  acotarAnchoManual,
  OPCIONES_ANCHO,
  ANCHO_MAX_MANUAL
} from './anchoColumnas.ts'
import type { DbCelda, DbColumnaResultado } from '../../../../../shared/db-explorador-ipc.ts'

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
const j = (x: unknown): string => JSON.stringify(x)

/** Evento de teclado sin modificadores salvo los que se pidan. */
function tecla(key: string, mods: Partial<Omit<TeclaRejilla, 'key'>> = {}): TeclaRejilla {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods }
}
function esMover(a: AccionRejilla | null, mov: string, extender: boolean): boolean {
  return a !== null && a.tipo === 'mover' && a.mov === mov && a.extender === extender
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) prefijosColumnas y columnaEn')
  // -------------------------------------------------------------------------
  const pref3 = prefijosColumnas([100, 50, 200])
  check('(1a) prefijos [0,100,150,350]', j(Array.from(pref3)) === j([0, 100, 150, 350]), j(Array.from(pref3)))
  check('(1b) anchoTotal = 350', anchoTotal(pref3) === 350, String(anchoTotal(pref3)))
  check(
    '(1c) columnaEn en los bordes exactos (0 -> 0, 100 -> 1, 150 -> 2)',
    columnaEn(pref3, 0) === 0 && columnaEn(pref3, 100) === 1 && columnaEn(pref3, 150) === 2,
    `${columnaEn(pref3, 0)},${columnaEn(pref3, 100)},${columnaEn(pref3, 150)}`
  )
  check(
    '(1d) columnaEn justo antes del borde (99.9 -> 0, 149 -> 1)',
    columnaEn(pref3, 99.9) === 0 && columnaEn(pref3, 149) === 1,
    `${columnaEn(pref3, 99.9)},${columnaEn(pref3, 149)}`
  )
  check(
    '(1e) fuera de rango: negativo -> 0, más allá del total -> última, NaN -> 0',
    columnaEn(pref3, -5) === 0 && columnaEn(pref3, 9999) === 2 && columnaEn(pref3, NaN) === 0,
    `${columnaEn(pref3, -5)},${columnaEn(pref3, 9999)},${columnaEn(pref3, NaN)}`
  )
  check('(1f) sin columnas -> -1', columnaEn(prefijosColumnas([]), 10) === -1, String(columnaEn(prefijosColumnas([]), 10)))
  const prefMalo = prefijosColumnas([100, NaN, -20, 50])
  check(
    '(1g) un ancho inválido (NaN, negativo) cuenta 0 y los prefijos no decrecen',
    j(Array.from(prefMalo)) === j([0, 100, 100, 100, 150]),
    j(Array.from(prefMalo))
  )
  // 100 columnas de ancho variable: la búsqueda binaria contra una lineal.
  const anchos100 = Array.from({ length: 100 }, (_, i) => 60 + ((i * 37) % 140))
  const pref100 = prefijosColumnas(anchos100)
  let binariaOk = true
  for (let x = 0; x < anchoTotal(pref100); x += 7) {
    let lineal = 0
    for (let c = 0; c < 100; c++) if (pref100[c] <= x) lineal = c
    if (columnaEn(pref100, x) !== lineal) binariaOk = false
  }
  check('(1h) columnaEn = búsqueda lineal en 100 columnas variables', binariaOk, 'x cada 7 px')

  // -------------------------------------------------------------------------
  hr('(2) ventana sobre 50 000 filas x 100 columnas')
  // -------------------------------------------------------------------------
  const base = {
    alto: 600,
    ancho: 1200,
    altoFila: 22,
    numFilas: 50_000,
    pref: pref100,
    anchoFijo: 48,
    altoFijo: 24
  }
  const arriba = ventana({ ...base, scrollTop: 0, scrollLeft: 0 })
  // 576 px útiles / 22 = 26.2 -> filas [0, 27) + 6 de overscan por abajo.
  check('(2a) arriba del todo: f0 = 0 y f1 = 27 + 6', arriba.f0 === 0 && arriba.f1 === 33, j(arriba))
  check('(2b) arriba a la izquierda: c0 = 0 (no hay overscan negativo)', arriba.c0 === 0, j(arriba))
  const vivas = (arriba.f1 - arriba.f0) * (arriba.c1 - arriba.c0)
  check('(2c) celdas vivas acotadas (< 1000), no 5 millones', vivas < 1000, `${vivas} celdas`)

  const medio = ventana({ ...base, scrollTop: 22 * 25_000, scrollLeft: pref100[50] })
  check(
    '(2d) en medio: f0 = 25 000 - 6, f1 = 25 000 + 27 + 6',
    medio.f0 === 24_994 && medio.f1 === 25_033,
    j(medio)
  )
  check('(2e) en medio: c0 = 50 - 2 (overscan de columnas)', medio.c0 === 48, j(medio))
  const cFinMedio = columnaEn(pref100, pref100[50] + 1200 - 48)
  check('(2f) en medio: c1 = última visible + 1 + 2', medio.c1 === cFinMedio + 3, `${j(medio)} cFin=${cFinMedio}`)

  const altoContenido = 50_000 * 22
  const fondo = ventana({ ...base, scrollTop: altoContenido - 576, scrollLeft: anchoTotal(pref100) - 1152 })
  check('(2g) al final: f1 = 50 000 exacto (no se sale)', fondo.f1 === 50_000, j(fondo))
  check('(2h) al final: c1 = 100 exacto (no se sale)', fondo.c1 === 100, j(fondo))
  const pasado = ventana({ ...base, scrollTop: altoContenido * 2, scrollLeft: 0 })
  check(
    '(2i) scroll más allá del contenido (datos que encogieron): ventana vacía y coherente',
    pasado.f0 === 50_000 && pasado.f1 === 50_000,
    j(pasado)
  )
  const vacia = ventana({ ...base, numFilas: 0, pref: prefijosColumnas([]), scrollTop: 0, scrollLeft: 0 })
  check('(2j) sin filas ni columnas: todo a 0', j(vacia) === j({ f0: 0, f1: 0, c0: 0, c1: 0 }), j(vacia))
  const sinOverscan = ventana({ ...base, scrollTop: 220, scrollLeft: 0, overscanF: 0, overscanC: 0 })
  check('(2k) sin overscan: empieza en la fila 10 exacta', sinOverscan.f0 === 10 && sinOverscan.f1 === 37, j(sinOverscan))
  const oculta = ventana({ ...base, alto: 0, ancho: 0, scrollTop: 0, scrollLeft: 0, overscanF: 0, overscanC: 0 })
  check('(2l) rejilla oculta (0x0): sin filas; los fijos no dan tamaños negativos', oculta.f1 === 0, j(oculta))

  // -------------------------------------------------------------------------
  hr('(3) desplazarParaMostrar')
  // -------------------------------------------------------------------------
  const vista = {
    scrollTop: 2200,
    scrollLeft: 0,
    alto: 600,
    ancho: 1200,
    altoFila: 22,
    pref: pref100,
    anchoFijo: 48,
    altoFijo: 24
  }
  // Útil: 576 px -> se ven de la fila 100 (2200) a la 126 entera (2772 + 22 = 2794 > 2776).
  check('(3a) celda ya visible: {}', j(desplazarParaMostrar({ f: 110, c: 1 }, vista)) === '{}', j(desplazarParaMostrar({ f: 110, c: 1 }, vista)))
  check(
    '(3b) fila por encima: scrollTop = su arriba',
    desplazarParaMostrar({ f: 50, c: 0 }, vista).scrollTop === 1100,
    j(desplazarParaMostrar({ f: 50, c: 0 }, vista))
  )
  const abajo = desplazarParaMostrar({ f: 200, c: 0 }, vista)
  check('(3c) fila por debajo: su borde inferior toca el fondo', abajo.scrollTop === 201 * 22 - 576, j(abajo))
  check('(3d) sólo cambia el eje que hace falta (sin scrollLeft)', abajo.scrollLeft === undefined, j(abajo))
  const derecha = desplazarParaMostrar({ f: 110, c: 30 }, vista)
  check(
    '(3e) columna a la derecha: su borde derecho toca el borde útil',
    derecha.scrollLeft === pref100[31] - (1200 - 48) && derecha.scrollTop === undefined,
    j(derecha)
  )
  const izquierda = desplazarParaMostrar({ f: 110, c: 3 }, { ...vista, scrollLeft: pref100[10] })
  check('(3f) columna a la izquierda: scrollLeft = su x', izquierda.scrollLeft === pref100[3], j(izquierda))
  const ancha = desplazarParaMostrar({ f: -1, c: 1 }, { ...vista, ancho: 48 + 30, scrollLeft: 0 })
  check(
    '(3g) columna más ancha que la vista: se alinea su principio; f < 0 no toca el vertical',
    ancha.scrollLeft === pref100[1] && ancha.scrollTop === undefined,
    j(ancha)
  )

  // -------------------------------------------------------------------------
  hr('(4) debeCargarMas')
  // -------------------------------------------------------------------------
  const cm = { alto: 600, altoFila: 22, numFilas: 500, hayMas: true, cargando: false, altoFijo: 24 }
  check('(4a) arriba de 500 filas (11 000 px): no', !debeCargarMas({ ...cm, scrollTop: 0 }), 'lejos del final')
  // total 11 000; útil 576; quedan < 1152 si scrollTop > 11000 - 576 - 1152 = 9272
  check('(4b) a menos de dos pantallas del final: sí', debeCargarMas({ ...cm, scrollTop: 9300 }), 'scrollTop 9300')
  check('(4c) justo fuera de las dos pantallas: no', !debeCargarMas({ ...cm, scrollTop: 9200 }), 'scrollTop 9200')
  check('(4d) sin más filas: nunca', !debeCargarMas({ ...cm, scrollTop: 10_500, hayMas: false }), 'hayMas=false')
  check('(4e) con una página en vuelo: no se pide otra', !debeCargarMas({ ...cm, scrollTop: 10_500, cargando: true }), 'cargando')
  check('(4f) rejilla OCULTA (alto 0): no pide aunque esté vacía', !debeCargarMas({ ...cm, numFilas: 0, alto: 0, scrollTop: 0 }), 'alto 0')
  check('(4g) resultado corto que ya cabe y tiene más: sí', debeCargarMas({ ...cm, numFilas: 5, scrollTop: 0 }), '5 filas')
  check('(4h) filasPorPagina(600, 22, 24) = 25 (una de contexto)', filasPorPagina(600, 22, 24) === 25, String(filasPorPagina(600, 22, 24)))
  check('(4i) filasPorPagina con vista minúscula: al menos 1', filasPorPagina(10, 22) === 1, String(filasPorPagina(10, 22)))

  // -------------------------------------------------------------------------
  hr('(5) selección')
  // -------------------------------------------------------------------------
  const dims: DimsRejilla = { filas: 500, columnas: 10, filasPorPagina: 25 }
  let s: Seleccion = clic(null, { f: 3, c: 2 }, { shift: false })
  check('(5a) clic: ancla = foco', j(s) === j({ ancla: { f: 3, c: 2 }, foco: { f: 3, c: 2 } }), j(s))
  s = clic(s, { f: 7, c: 5 }, { shift: true })
  check('(5b) Mayús+clic extiende desde el ancla', j(rango(s)) === j({ f0: 3, f1: 7, c0: 2, c1: 5 }), j(rango(s)))
  s = clic(s, { f: 1, c: 0 }, { shift: true })
  check('(5c) Mayús+clic hacia atrás: rango normalizado', j(rango(s)) === j({ f0: 1, f1: 3, c0: 0, c1: 2 }), j(rango(s)))
  check('(5d) Mayús+clic sin selección previa = clic simple', j(clic(null, { f: 4, c: 4 }, { shift: true })) === j({ ancla: { f: 4, c: 4 }, foco: { f: 4, c: 4 } }), 'ok')
  s = clic(null, { f: 3, c: 2 }, { shift: false })
  s = mover(s, 'derecha', dims, true)
  s = mover(s, 'derecha', dims, true)
  s = mover(s, 'abajo', dims, true)
  check('(5e) Mayús+→ x2, Mayús+↓: rango 3..4 x 2..4', j(rango(s)) === j({ f0: 3, f1: 4, c0: 2, c1: 4 }), j(rango(s)))
  s = mover(s, 'abajo', dims, false)
  check('(5f) ↓ sin Mayús colapsa y se mueve DESDE EL FOCO', j(s) === j({ ancla: { f: 5, c: 4 }, foco: { f: 5, c: 4 } }), j(s))
  const bordeDer = mover(s, 'bordeDerecha', dims, true)
  check('(5g) Mod+Mayús+→: extiende hasta la última columna', j(rango(bordeDer)) === j({ f0: 5, f1: 5, c0: 4, c1: 9 }), j(rango(bordeDer)))
  const bordeAb = mover(s, 'bordeAbajo', dims, false)
  check('(5h) Mod+↓: última fila, misma columna', j(bordeAb?.foco) === j({ f: 499, c: 4 }), j(bordeAb))
  check('(5i) ↑ en la fila 0 no da la vuelta', j(mover(clic(null, { f: 0, c: 0 }, { shift: false }), 'arriba', dims, false)?.foco) === j({ f: 0, c: 0 }), 'acotado')
  check('(5j) Mod+Fin: última celda', j(mover(s, 'ultimaCelda', dims, false)?.foco) === j({ f: 499, c: 9 }), 'ok')
  check('(5k) Inicio: principio de la fila', j(mover(s, 'inicioFila', dims, false)?.foco) === j({ f: 5, c: 0 }), 'ok')
  check('(5l) AvPág: 25 filas más abajo', j(mover(s, 'paginaAbajo', dims, false)?.foco) === j({ f: 30, c: 4 }), 'ok')
  check('(5m) RePág cerca del principio: se acota a 0', j(mover(s, 'paginaArriba', dims, false)?.foco) === j({ f: 0, c: 4 }), 'ok')
  check('(5n) sin selección, ↓ selecciona la PRIMERA celda (no se mueve desde la nada)', j(mover(null, 'abajo', dims, false)) === j({ ancla: { f: 0, c: 0 }, foco: { f: 0, c: 0 } }), 'ok')
  check('(5o) sin selección, Mod+Fin va a la última', j(mover(null, 'ultimaCelda', dims, false)?.foco) === j({ f: 499, c: 9 }), 'ok')
  check('(5p) sin nada cargado: null', mover(s, 'abajo', { filas: 0, columnas: 10 }, false) === null && todo({ filas: 5, columnas: 0 }) === null, 'null')
  const fila = filaCompleta(clic(null, { f: 2, c: 3 }, { shift: false }), 8, dims, true)
  check('(5q) Mayús+clic en el número de fila: filas 2..8 enteras', j(rango(fila)) === j({ f0: 2, f1: 8, c0: 0, c1: 9 }), j(rango(fila)))
  check('(5r) todo: 0..499 x 0..9', j(rango(todo(dims))) === j({ f0: 0, f1: 499, c0: 0, c1: 9 }), j(rango(todo(dims))))
  check('(5s) contiene dentro y fuera', contiene(fila, 5, 9) && !contiene(fila, 9, 0) && !contiene(null, 0, 0), 'ok')
  const encogida = acotarSeleccion({ ancla: { f: 10, c: 1 }, foco: { f: 400, c: 8 } }, { filas: 50, columnas: 5 })
  check('(5t) acotarSeleccion tras re-ejecutar con menos datos', j(encogida) === j({ ancla: { f: 10, c: 1 }, foco: { f: 49, c: 4 } }), j(encogida))
  const igual = { ancla: { f: 1, c: 1 }, foco: { f: 2, c: 2 } }
  check('(5u) acotarSeleccion sin cambios devuelve la MISMA referencia', acotarSeleccion(igual, dims) === igual, 'misma ref')

  // -------------------------------------------------------------------------
  hr('(6) teclado en WINDOWS (Mod = Ctrl)')
  // -------------------------------------------------------------------------
  const W = 'windows' as const
  check('(6a) ↓ mueve', esMover(accionTecla(tecla('ArrowDown'), W), 'abajo', false), j(accionTecla(tecla('ArrowDown'), W)))
  check('(6b) Mayús+→ extiende', esMover(accionTecla(tecla('ArrowRight', { shiftKey: true }), W), 'derecha', true), 'ok')
  check('(6c) Ctrl+→ = borde derecho', esMover(accionTecla(tecla('ArrowRight', { ctrlKey: true }), W), 'bordeDerecha', false), 'ok')
  check('(6d) Ctrl+Mayús+↓ = extender al borde de abajo', esMover(accionTecla(tecla('ArrowDown', { ctrlKey: true, shiftKey: true }), W), 'bordeAbajo', true), 'ok')
  check('(6e) Inicio / Fin = fila', esMover(accionTecla(tecla('Home'), W), 'inicioFila', false) && esMover(accionTecla(tecla('End'), W), 'finFila', false), 'ok')
  check('(6f) Ctrl+Inicio / Ctrl+Fin = primera / última celda', esMover(accionTecla(tecla('Home', { ctrlKey: true }), W), 'primeraCelda', false) && esMover(accionTecla(tecla('End', { ctrlKey: true }), W), 'ultimaCelda', false), 'ok')
  check('(6g) RePág / AvPág', esMover(accionTecla(tecla('PageUp'), W), 'paginaArriba', false) && esMover(accionTecla(tecla('PageDown', { shiftKey: true }), W), 'paginaAbajo', true), 'ok')
  check('(6h) Ctrl+A = todo', accionTecla(tecla('a', { ctrlKey: true }), W)?.tipo === 'todo', 'ok')
  check('(6i) Ctrl+C = copiar', accionTecla(tecla('c', { ctrlKey: true }), W)?.tipo === 'copiar', 'ok')
  check('(6j) Ctrl+C con Bloq Mayús (key "C") = copiar', accionTecla(tecla('C', { ctrlKey: true }), W)?.tipo === 'copiar', 'ok')
  check('(6k) Esc = colapsar', accionTecla(tecla('Escape'), W)?.tipo === 'colapsar', 'ok')
  // Mitad NEGATIVA de Windows: la tecla ⊞ (Meta) no es Ctrl.
  check('(6l) NEGATIVO: ⊞+→ (acoplar ventana) no hace nada', accionTecla(tecla('ArrowRight', { metaKey: true }), W) === null, 'null')
  check('(6m) NEGATIVO: ⊞+A y ⊞+C no hacen nada', accionTecla(tecla('a', { metaKey: true }), W) === null && accionTecla(tecla('c', { metaKey: true }), W) === null, 'null')
  check('(6n) NEGATIVO: Ctrl+⊞+→ (otro acorde) no hace nada', accionTecla(tecla('ArrowRight', { ctrlKey: true, metaKey: true }), W) === null, 'null')
  check('(6o) NEGATIVO: Alt+↓ no hace nada', accionTecla(tecla('ArrowDown', { altKey: true }), W) === null, 'null')
  check('(6p) NEGATIVO: Ctrl+AvPág (cambiar de pestaña en Chromium) no hace nada', accionTecla(tecla('PageDown', { ctrlKey: true }), W) === null, 'null')
  check('(6q) NEGATIVO: Tab sale de la rejilla (null)', accionTecla(tecla('Tab'), W) === null && accionTecla(tecla('Tab', { shiftKey: true }), W) === null, 'null')
  check('(6r) NEGATIVO: Ctrl+Mayús+C no se inventa (inspector de Chromium)', accionTecla(tecla('C', { ctrlKey: true, shiftKey: true }), W) === null, 'null')
  check('(6s) NEGATIVO: letras sueltas y Mayús+Esc no son de la rejilla', accionTecla(tecla('a'), W) === null && accionTecla(tecla('Escape', { shiftKey: true }), W) === null, 'null')
  check('(6t) Linux (otra) se comporta como Windows', esMover(accionTecla(tecla('ArrowUp', { ctrlKey: true }), 'otra'), 'bordeArriba', false) && accionTecla(tecla('ArrowUp', { metaKey: true }), 'otra') === null, 'ok')
  // Visor de valor: Mayús+Intro, y sus mitades negativas.
  check('(6u) Mayús+Intro = visor de valor', accionTecla(tecla('Enter', { shiftKey: true }), W)?.tipo === 'verValor', j(accionTecla(tecla('Enter', { shiftKey: true }), W)))
  check('(6v) NEGATIVO: Intro a secas no abre el visor', accionTecla(tecla('Enter'), W) === null, 'null')
  check('(6w) NEGATIVO: Ctrl+Intro (ejecutar en la consola) no abre el visor', accionTecla(tecla('Enter', { ctrlKey: true }), W) === null, 'null')
  check('(6x) NEGATIVO: Ctrl+Mayús+Intro (ejecutar todo) no abre el visor', accionTecla(tecla('Enter', { ctrlKey: true, shiftKey: true }), W) === null, 'null')
  check('(6y) NEGATIVO: ⊞+Mayús+Intro y Alt+Mayús+Intro no abren el visor', accionTecla(tecla('Enter', { metaKey: true, shiftKey: true }), W) === null && accionTecla(tecla('Enter', { altKey: true, shiftKey: true }), W) === null, 'null')

  // -------------------------------------------------------------------------
  hr('(7) teclado en MAC (Mod = ⌘; la tecla del borde es ⌘+flecha)')
  // -------------------------------------------------------------------------
  const M = 'mac' as const
  check('(7a) ↓ mueve', esMover(accionTecla(tecla('ArrowDown'), M), 'abajo', false), 'ok')
  check('(7b) ⌘+→ = borde derecho', esMover(accionTecla(tecla('ArrowRight', { metaKey: true }), M), 'bordeDerecha', false), 'ok')
  check('(7c) ⌘+↑ = primera fila', esMover(accionTecla(tecla('ArrowUp', { metaKey: true }), M), 'bordeArriba', false), 'ok')
  check('(7d) ⌘+Mayús+↓ = extender a la última fila', esMover(accionTecla(tecla('ArrowDown', { metaKey: true, shiftKey: true }), M), 'bordeAbajo', true), 'ok')
  check('(7e) ⌘+Inicio / ⌘+Fin (fn+⌘+←/→)', esMover(accionTecla(tecla('Home', { metaKey: true }), M), 'primeraCelda', false) && esMover(accionTecla(tecla('End', { metaKey: true }), M), 'ultimaCelda', false), 'ok')
  check('(7f) ⌘A = todo, ⌘C = copiar', accionTecla(tecla('a', { metaKey: true }), M)?.tipo === 'todo' && accionTecla(tecla('c', { metaKey: true }), M)?.tipo === 'copiar', 'ok')
  check('(7g) Esc = colapsar', accionTecla(tecla('Escape'), M)?.tipo === 'colapsar', 'ok')
  // Mitad NEGATIVA de Mac: ⌃ es del sistema (Mission Control) y de la edición de línea.
  check('(7h) NEGATIVO: ⌃+→ (cambiar de escritorio) no hace nada', accionTecla(tecla('ArrowRight', { ctrlKey: true }), M) === null, 'null')
  check('(7i) NEGATIVO: ⌃+↑ (Mission Control) no hace nada', accionTecla(tecla('ArrowUp', { ctrlKey: true }), M) === null, 'null')
  check('(7j) NEGATIVO: ⌃A (inicio de línea) y ⌃C no hacen nada', accionTecla(tecla('a', { ctrlKey: true }), M) === null && accionTecla(tecla('c', { ctrlKey: true }), M) === null, 'null')
  check('(7k) NEGATIVO: ⌃⌘+→ (otro acorde) no hace nada', accionTecla(tecla('ArrowRight', { ctrlKey: true, metaKey: true }), M) === null, 'null')
  check('(7l) NEGATIVO: ⌥+→ (palabra a palabra) no hace nada', accionTecla(tecla('ArrowRight', { altKey: true }), M) === null, 'null')
  check('(7m) NEGATIVO: ⌘+AvPág no hace nada', accionTecla(tecla('PageDown', { metaKey: true }), M) === null, 'null')
  check('(7n) RePág / AvPág sin modificador (fn+↑/↓) sí', esMover(accionTecla(tecla('PageUp'), M), 'paginaArriba', false), 'ok')
  // Visor de valor: ⇧↩ es la misma tecla; las mitades negativas son las de Mac.
  check('(7o) ⇧↩ = visor de valor', accionTecla(tecla('Enter', { shiftKey: true }), M)?.tipo === 'verValor', 'ok')
  check('(7p) NEGATIVO: ↩ a secas no abre el visor', accionTecla(tecla('Enter'), M) === null, 'null')
  check('(7q) NEGATIVO: ⌘↩ (ejecutar en la consola) y ⌘⇧↩ (ejecutar todo) no abren el visor', accionTecla(tecla('Enter', { metaKey: true }), M) === null && accionTecla(tecla('Enter', { metaKey: true, shiftKey: true }), M) === null, 'null')
  check('(7r) NEGATIVO: ⌃⇧↩ (el modificador ajeno) y ⌥⇧↩ no abren el visor', accionTecla(tecla('Enter', { ctrlKey: true, shiftKey: true }), M) === null && accionTecla(tecla('Enter', { altKey: true, shiftKey: true }), M) === null, 'null')

  // -------------------------------------------------------------------------
  hr('(8) anchoInicial y compañía')
  // -------------------------------------------------------------------------
  const porCaracter = (s: string): number => s.length * 7 // monoespaciada de 7 px
  const o = OPCIONES_ANCHO
  // relleno 17 = padding 8+8 y el filete derecho de 1 px (border-box); icono 16 = SVG
  // de 12 + gap de 4. Con 16/14 la app cortaba «urgente» en «urgen…» (e2e conexiones).
  check('(8a) opciones por defecto: la caja real de rejilla.css (56/360/17/16)', o.min === 56 && o.max === 360 && o.relleno === 17 && o.icono === 16, j(o))
  check('(8b) nombre corto y muestras cortas: el mínimo (56)', anchoInicial('ID', ['1', '22'], porCaracter) === 56, String(anchoInicial('ID', ['1', '22'], porCaracter)))
  // 'DESCRIPCION' = 11 * 7 = 77 + 16 (icono) = 93; + 17 = 110
  check('(8c) manda la cabecera: medida + icono + relleno', anchoInicial('DESCRIPCION', ['x'], porCaracter) === 110, String(anchoInicial('DESCRIPCION', ['x'], porCaracter)))
  // muestra de 20 chars = 140 > 93 -> 157
  check('(8d) manda la muestra más ancha (sin icono)', anchoInicial('DESCRIPCION', ['corta', 'x'.repeat(20)], porCaracter) === 157, String(anchoInicial('DESCRIPCION', ['corta', 'x'.repeat(20)], porCaracter)))
  // Lo que cortó la app: con el ancho que se da, el HUECO DEL TEXTO (ancho − padding −
  // filete) cabe la medida, también con decimales.
  const medidaUrgente = 49.7
  const hueco = anchoInicial('nota', ['urgente'], () => medidaUrgente, { ...o, min: 0 }) - 16 - 1
  check('(8d2) el hueco del texto cabe la medida con decimales', hueco >= medidaUrgente, `hueco ${hueco} >= ${medidaUrgente}`)
  check('(8e) texto larguísimo: el máximo (360)', anchoInicial('N', ['x'.repeat(300)], porCaracter) === 360, String(anchoInicial('N', ['x'.repeat(300)], porCaracter)))
  let medidas = 0
  const contando = (s: string): number => {
    medidas++
    return s.length * 7
  }
  anchoInicial('N', ['x'.repeat(300), 'a', 'b', 'c'], contando)
  check('(8f) deja de medir en cuanto alcanza el máximo', medidas === 2, `${medidas} medidas (cabecera + 1)`)
  check('(8g) medida inválida (NaN, sin canvas) no rompe: el mínimo', anchoInicial('X', ['y'], () => NaN) === 56, String(anchoInicial('X', ['y'], () => NaN)))
  check('(8h) redondea hacia arriba', anchoInicial('A', ['b'], () => 60.2, { min: 10, max: 500, relleno: 0, icono: 0 }) === 61, String(anchoInicial('A', ['b'], () => 60.2, { min: 10, max: 500, relleno: 0, icono: 0 })))
  const columnas: DbColumnaResultado[] = [
    { nombre: 'ID', tipoLogico: 'numero', tipoMotor: 'NUMBER' },
    { nombre: 'NOTA', tipoLogico: 'texto', tipoMotor: 'VARCHAR2' }
  ]
  const filas: DbCelda[][] = [
    ['1', null],
    ['2', 'línea 1\nlínea 2']
  ]
  const anchos = anchosIniciales(columnas, filas, porCaracter)
  // NOTA: la muestra es el texto PINTADO: 'línea 1 ⏎ línea 2' (17) -> 119 + 17 = 136
  check('(8i) anchosIniciales mide el texto PINTADO (<null>, ⏎)', anchos[0] === 56 && anchos[1] === 136, j(anchos))
  check('(8j) acotarAnchoManual: sin el máximo de 360, con suelo y techo', acotarAnchoManual(800) === 800 && acotarAnchoManual(10) === 56 && acotarAnchoManual(99_999) === ANCHO_MAX_MANUAL && acotarAnchoManual(NaN) === 56, 'ok')

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
