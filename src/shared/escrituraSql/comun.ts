// =============================================================================
// Lo que comparten los escritores de SQL de cada motor y el serializador de filas. Hoja (solo
// `import type`): la importan `oracle.ts`, `postgres.ts` y `formatosFilas.ts`, y si viviera en
// `formatosFilas.ts` el de Oracle lo importaría de vuelta y cerraría un ciclo. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/escritura-sql-contrato-por-motor.md
// =============================================================================

import type { DbCelda } from '../db-explorador-ipc.ts'

/** Un trozo de filas, tal como lo reciben los escritores. */
export type Filas = readonly (readonly DbCelda[])[]

/** Lo que el main entrega como número: texto exacto, quizá sin cero inicial (Oracle). */
export const NUMERAL_SQL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/** Cadena SQL con comillas simples duplicadas. */
export function cadenaSql(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'"
}

/** El hex de una celda binaria, sin `0x`; null si no es hex (recortada con `…`, un BFILENAME). */
export function hexDe(v: string): string | null {
  const hex = v.startsWith('0x') || v.startsWith('0X') ? v.slice(2) : v
  return /^[0-9a-fA-F]*$/.test(hex) ? hex : null
}

/** La celda `c` de una fila; la que falta (fila más corta que las columnas) es NULL. */
export function celda(fila: readonly DbCelda[], c: number): DbCelda | undefined {
  return c < fila.length ? fila[c] : null
}
