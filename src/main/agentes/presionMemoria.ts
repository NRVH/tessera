// =============================================================================
// Cuándo le queda poca memoria al equipo y qué cambia entonces en la hibernación por inactividad:
// el plazo se acorta para soltar antes los agentes que nadie usa (cada CLI pesa cientos de MB). Puro:
// la memoria disponible y la total entran por parámetro; las lee `vigilanteMemoria.ts`.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

/** Por debajo de esto disponible hay poca memoria, sea cual sea el equipo: un agente más no cabe. */
export const MEMORIA_MINIMA_BYTES = 512 * 1024 * 1024
/** Y por debajo de esta fracción del total, aunque sean más bytes. */
export const FRACCION_MINIMA = 0.1
/** Para dejar de estar en poca memoria hay que superar el umbral en esta proporción: sin ir y venir. */
export const HOLGURA_SALIDA = 1.5
/** El plazo de inactividad con poca memoria, si el del ajuste es más largo. */
export const UMBRAL_HIBERNACION_POCA_MEMORIA_MS = 2 * 60_000

/** Los bytes disponibles por debajo de los que se considera poca memoria. */
export function umbralPocaMemoria(totalBytes: number): number {
  return Math.max(totalBytes * FRACCION_MINIMA, MEMORIA_MINIMA_BYTES)
}

/** Si hay poca memoria, sabiendo si ya la había (la salida pide holgura). Sin datos válidos, no. */
export function hayPocaMemoria(disponibleBytes: number, totalBytes: number, antes: boolean): boolean {
  if (!(totalBytes > 0) || !(disponibleBytes >= 0)) return false
  const umbral = umbralPocaMemoria(totalBytes)
  return disponibleBytes < (antes ? umbral * HOLGURA_SALIDA : umbral)
}

/** El plazo de la ronda: con poca memoria, el corto si el ajuste es más largo. «Nunca» (null) se respeta. */
export function umbralConMemoria(umbralMs: number | null, pocaMemoria: boolean): number | null {
  if (umbralMs === null || !pocaMemoria) return umbralMs
  return Math.min(umbralMs, UMBRAL_HIBERNACION_POCA_MEMORIA_MS)
}

/**
 * macOS: la memoria libre del sistema no cuenta la caché que se puede soltar, y casi siempre parece
 * poca. `kern.memorystatus_level` es el porcentaje disponible que usa el propio sistema para medir la
 * presión. Devuelve los bytes disponibles, o null si la salida no es un porcentaje.
 */
export function disponibleDesdeNivel(salida: string, totalBytes: number): number | null {
  const texto = salida.trim()
  if (!/^\d{1,3}$/.test(texto)) return null
  const nivel = Number(texto)
  return nivel <= 100 ? (totalBytes * nivel) / 100 : null
}
