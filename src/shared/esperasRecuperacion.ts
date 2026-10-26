// =============================================================================
// Cuánto se espera antes de cada reintento automático cuando muere el contenedor de una sesión
// (la del agente y la terminal de abajo): crecen para dar tiempo a un Docker que arranca. Agotados,
// la sesión se para y avisa; si Docker vuelve después, se reintenta sola.
// Decisiones: docs/decisiones/sandbox/supervisor-de-contenedores.md
// =============================================================================

/** Esperas antes de cada intento, en orden; el primero va sin espera. */
export const ESPERAS_RECUPERACION_MS: readonly number[] = [0, 2_000, 5_000, 10_000, 20_000]

/** Reintentos automáticos ante la muerte del contenedor. */
export const MAX_INTENTOS_RECUPERACION = ESPERAS_RECUPERACION_MS.length

/** Una espera que se puede saltar si es cero (el primer intento). */
export function esperarMs(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}
