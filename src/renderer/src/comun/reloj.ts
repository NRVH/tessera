// =============================================================================
// El latido de los textos «hace N min»: pone la hora y la refresca cada `tickMs` hasta la
// limpieza. Puro (los temporizadores se inyectan) para probarlo bajo `node` en
// `test-reloj.mts`; el hook que lo usa es `useAhora.ts`.
// =============================================================================

/** Los temporizadores del reloj; en la app, los del navegador. */
export interface Temporizador {
  ahora: () => number
  cada: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  parar: (id: ReturnType<typeof setInterval>) => void
}

const TEMPORIZADOR_REAL: Temporizador = {
  ahora: () => Date.now(),
  cada: (fn, ms) => setInterval(fn, ms),
  parar: (id) => clearInterval(id)
}

/**
 * Hace latir el reloj cada `tickMs`; con `ponerEnHora`, lo pone en hora ya (un reloj que
 * estuvo parado lleva la hora de cuando se paró). Devuelve la limpieza.
 */
export function latirReloj(
  poner: (ms: number) => void,
  tickMs: number,
  ponerEnHora: boolean,
  t: Temporizador = TEMPORIZADOR_REAL
): () => void {
  if (ponerEnHora) poner(t.ahora())
  const id = t.cada(() => poner(t.ahora()), tickMs)
  return () => t.parar(id)
}
