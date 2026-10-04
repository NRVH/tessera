// =============================================================================
// Lo común de los parseos del plan de ejecución de cada motor: convertir un valor suelto de una
// fila a texto o a número, y el tope de nodos que se leen. Puro; lo usan `planSql*.ts`.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import { texto } from './motores/filasCatalogo.ts'

/** Tope de nodos que se leen de un plan (uno real tiene decenas; cientos es raro). */
export const MAX_NODOS_PLAN = 5000

// El valor como texto (`null` y `undefined` son ''): el mismo de las filas de catálogo.
export { texto }

/** El valor como número finito, o `undefined` si falta o no lo es. */
export function numero(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(texto(v).trim())
  return Number.isFinite(n) ? n : undefined
}
