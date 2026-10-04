// =============================================================================
// Contrapresión de xterm: cuenta los bytes escritos y aún no procesados, pide al main
// pausar el pty al cruzar la marca alta y lo reanuda al drenar por debajo de la baja.
// Un vigilante reanuda si el callback de `write` se pierde.
// Decisiones: docs/decisiones/terminales/contrapresion-del-pty.md
// =============================================================================

/** Bytes pendientes de procesar por xterm a partir de los cuales se pausa el pty. */
const HIGH_WATER = 1_000_000
/** Al drenar por debajo de esto, se reanuda. Histéresis para no oscilar pausa/reanuda. */
const LOW_WATER = 200_000
/** Tiempo máximo en pausa: por encima de lo que xterm tarda en tragar 1 MiB, solo se alcanza si el callback se perdió. */
const PAUSA_MAX_MS = 5000

/** Lo mínimo que necesitamos de xterm; evita acoplar el helper al tipo Terminal. */
interface Writable {
  write(data: string, callback?: () => void): void
}

/** Escritor de xterm con contrapresión sobre el pty. */
export interface FlowWriter {
  /** Escribe respetando la contrapresión (pausa/reanuda el pty vía `setPaused`). */
  write: (data: string) => void
  /** Reinicia el estado (al reload/cierre): olvida lo pendiente y reanuda si hacía falta. */
  reset: () => void
}

/**
 * Crea un escritor con contrapresión sobre `term`. `setPaused(true|false)` debe
 * enrutar al main la orden de pausar/reanudar el pty de la sesión (idempotente allá).
 */
export function createFlowWriter(term: Writable, setPaused: (paused: boolean) => void): FlowWriter {
  let pending = 0
  let paused = false
  let vigilante: ReturnType<typeof setTimeout> | null = null

  /** Reanuda de verdad: apaga la pausa y cancela su vigilante. */
  function reanudar(): void {
    if (vigilante !== null) {
      clearTimeout(vigilante)
      vigilante = null
    }
    if (!paused) return
    paused = false
    setPaused(false)
  }

  return {
    write(data: string): void {
      pending += data.length
      if (!paused && pending >= HIGH_WATER) {
        paused = true
        setPaused(true)
        // Red de seguridad por si el callback de abajo no llega (ver PAUSA_MAX_MS).
        vigilante = setTimeout(() => {
          vigilante = null
          pending = 0
          paused = false
          setPaused(false)
        }, PAUSA_MAX_MS)
      }
      term.write(data, () => {
        // Con suelo: los callbacks en vuelo tras un reset o el vigilante seguirían restando.
        pending = Math.max(0, pending - data.length)
        if (paused && pending <= LOW_WATER) reanudar()
      })
    },
    reset(): void {
      pending = 0
      reanudar()
    }
  }
}
