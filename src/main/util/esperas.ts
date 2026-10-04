// =============================================================================
// Las dos esperas del cierre y del apagado de procesos: `esperar` (una pausa) y `conTope`
// (esperar algo como mucho N ms, sin cancelarlo). Sin dependencias; el reloj de `conTope`
// se inyecta para probarlo en `test-registro-cierre.mts`.
// Decisiones: docs/decisiones/app/cierre-ordenado.md
// =============================================================================

/** Resuelve tras `ms`. */
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Lo que sale de una espera con tope: llegó, o se dejó de esperar. */
export type Desenlace = 'a-tiempo' | 'tope'

/** Temporizador inyectable (el test usa uno falso). */
export interface RelojTope {
  poner(fn: () => void, ms: number): unknown
  quitar(h: unknown): void
}

const RELOJ_REAL: RelojTope = {
  poner: (fn, ms) => setTimeout(fn, ms),
  quitar: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
}

/**
 * Espera `p` como mucho `ms`. 'a-tiempo' si llegó; 'tope' si no (y se sigue sin él: `p`
 * no se cancela). Si `p` FALLA a tiempo, relanza su error; si falla después del tope, se
 * absorbe (ya nadie lo espera, y sin manejador sería un `unhandledRejection`). El
 * temporizador se quita en cuanto `p` acaba: no retiene el proceso ni dispara después.
 * `p` puede no ser una promesa (el `undefined` de un `ref?.metodo()` sin ref).
 */
export function conTope(p: unknown, ms: number, reloj: RelojTope = RELOJ_REAL): Promise<Desenlace> {
  return new Promise<Desenlace>((resolve, reject) => {
    const h = reloj.poner(() => resolve('tope'), ms)
    Promise.resolve(p).then(
      () => {
        reloj.quitar(h)
        resolve('a-tiempo')
      },
      (e: unknown) => {
        reloj.quitar(h)
        reject(e)
      }
    )
  })
}
