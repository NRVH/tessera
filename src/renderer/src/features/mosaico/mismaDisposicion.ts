// =============================================================================
// Igualdad estructural de dos disposiciones del mosaico: `calcularMosaico` la usa
// para devolver `anterior` con su identidad cuando nada cambió.
// Tolera disposiciones mal formadas (un `anterior` de persistencia o hecho a mano):
// mal formada contra bien formada es «distinta», nunca una excepción.
// Decisiones: docs/decisiones/mosaico/disposicion-de-la-rejilla.md
// =============================================================================

import type { CeldaMosaico, DisposicionMosaico } from './mosaicoLayout.ts'

function mismaCelda(a: CeldaMosaico | null | undefined, b: CeldaMosaico | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.fila === b.fila && a.columna === b.columna && a.spanFilas === b.spanFilas && a.spanColumnas === b.spanColumnas
}

function mismasListas<T>(a: readonly T[] | null | undefined, b: readonly T[] | null | undefined, igual: (x: T, y: T) => boolean): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b
  return a.length === b.length && a.every((x, i) => igual(x, b[i]))
}

/**
 * Igualdad ESTRUCTURAL de dos disposiciones, para que el estado de React sólo se
 * actualice cuando algo cambia de verdad (un ResizeObserver dispara a cada píxel;
 * casi todos esos disparos devuelven la misma rejilla). Compara todos los campos,
 * incluidos `minimo` y `puntuacion`: son enteros y un producto de cocientes de esos
 * enteros, que con los mismos enteros da el mismo número bit a bit, así que `===`
 * es exacto y un cambio en ellos sí es un cambio que alguien puede pintar.
 */
export function mismaDisposicion(a: DisposicionMosaico | null, b: DisposicionMosaico | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    mismaForma(a, b) &&
    mismaMedida(a, b) &&
    mismasListas(a.filasDeTeselas, b.filasDeTeselas, (x, y) => x === y) &&
    mismasListas(a.celdas, b.celdas, mismaCelda)
  )
}

/** Forma, plantillas CSS y banderas de presentación iguales. */
function mismaForma(a: DisposicionMosaico, b: DisposicionMosaico): boolean {
  return (
    a.forma === b.forma &&
    a.plantillaColumnas === b.plantillaColumnas &&
    a.plantillaFilas === b.plantillaFilas &&
    a.visibleEnfoque === b.visibleEnfoque &&
    a.presetRespetado === b.presetRespetado
  )
}

/** Mínimo, puntuación y clase de elección iguales. */
function mismaMedida(a: DisposicionMosaico, b: DisposicionMosaico): boolean {
  return (
    a.minimo?.cols === b.minimo?.cols &&
    a.minimo?.filas === b.minimo?.filas &&
    a.puntuacion === b.puntuacion &&
    a.origen === b.origen &&
    a.presetPedido === b.presetPedido
  )
}
