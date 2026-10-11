// =============================================================================
// Las esperas del cierre y del apagado de procesos: `esperar` (una pausa), `conTope` (esperar
// algo como mucho N ms, sin cancelarlo) y `conTopeSinAvance` (como mucho N ms SIN AVANZAR). Sin
// dependencias; el reloj se inyecta para probarlas en `test-registro-cierre.mts`.
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

/** Una espera con tope sin avance: su desenlace y el trabajo, que sigue aunque se deje de esperar. */
export interface EsperaSinAvance {
  desenlace: Promise<Desenlace>
  /** Acaba cuando acaba el trabajo, bien o mal; nunca rechaza. */
  trabajo: Promise<void>
}

/**
 * Como `conTope`, pero el tope cuenta desde el último AVANCE: `arrancar` recibe `avanzar`, que
 * reinicia el plazo y dice si aún se espera (tras el tope devuelve false: lo que llegue tarde ya
 * no es de nadie). Así un trabajo lento que avanza no se corta, y uno colgado sí.
 */
export function conTopeSinAvance(
  arrancar: (avanzar: () => boolean) => unknown,
  ms: number,
  reloj: RelojTope = RELOJ_REAL
): EsperaSinAvance {
  let cerrado = false
  let resolver: (d: Desenlace) => void = () => undefined
  let rechazar: (e: unknown) => void = () => undefined
  const desenlace = new Promise<Desenlace>((res, rej) => {
    resolver = res
    rechazar = rej
  })
  const vencer = (): void => {
    cerrado = true
    resolver('tope')
  }
  let h = reloj.poner(vencer, ms)
  const avanzar = (): boolean => {
    if (cerrado) return false
    reloj.quitar(h)
    h = reloj.poner(vencer, ms)
    return true
  }
  let p: Promise<unknown>
  try {
    p = Promise.resolve(arrancar(avanzar))
  } catch (e) {
    p = Promise.reject(e)
  }
  const acabar = (fin: () => void): void => {
    if (cerrado) return
    cerrado = true
    reloj.quitar(h)
    fin()
  }
  p.then(
    () => acabar(() => resolver('a-tiempo')),
    (e: unknown) => acabar(() => rechazar(e))
  )
  return { desenlace, trabajo: p.then(() => undefined, () => undefined) }
}
