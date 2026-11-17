// =============================================================================
// Contrapresión de xterm: cuenta los bytes escritos y aún no procesados, pide al main
// pausar el pty al cruzar la marca alta y lo reanuda al drenar por debajo de la baja.
// Un vigilante reanuda si el callback de `write` se pierde.
// Decisiones: docs/decisiones/terminales/contrapresion-del-pty.md
// =============================================================================

/** Bytes pendientes de procesar por xterm a partir de los cuales se pausa el pty. */
const UMBRAL_PAUSA = 1_000_000
/** Al drenar por debajo de esto, se reanuda. Histéresis para no oscilar pausa/reanuda. */
const UMBRAL_REANUDACION = 200_000
/** Tiempo máximo en pausa: por encima de lo que xterm tarda en tragar 1 MiB, solo se alcanza si el callback se perdió. */
const PAUSA_MAX_MS = 5000

/** Lo mínimo que necesitamos de xterm; evita acoplar el helper al tipo Terminal. */
interface TerminalEscribible {
  write(datos: string, alEscribir?: () => void): void
}

/** Escritor de xterm con contrapresión sobre el pty. */
export interface EscritorFlujo {
  /** Escribe respetando la contrapresión (pausa/reanuda el pty vía `fijarPausado`). */
  write: (datos: string) => void
  /** Reinicia el estado (al reload/cierre): olvida lo pendiente y reanuda si hacía falta. */
  reset: () => void
}

/**
 * Crea un escritor con contrapresión sobre `term`. `fijarPausado(true|false)` debe
 * enrutar al main la orden de pausar/reanudar el pty de la sesión (idempotente allá).
 */
export function crearEscritorFlujo(term: TerminalEscribible, fijarPausado: (pausado: boolean) => void): EscritorFlujo {
  let pendientes = 0
  let pausado = false
  let vigilante: ReturnType<typeof setTimeout> | null = null

  /** Reanuda de verdad: apaga la pausa y cancela su vigilante. */
  function reanudar(): void {
    if (vigilante !== null) {
      clearTimeout(vigilante)
      vigilante = null
    }
    if (!pausado) return
    pausado = false
    fijarPausado(false)
  }

  return {
    write(datos: string): void {
      pendientes += datos.length
      if (!pausado && pendientes >= UMBRAL_PAUSA) {
        pausado = true
        fijarPausado(true)
        // Red de seguridad por si el callback de abajo no llega (ver PAUSA_MAX_MS).
        vigilante = setTimeout(() => {
          vigilante = null
          pendientes = 0
          pausado = false
          fijarPausado(false)
        }, PAUSA_MAX_MS)
      }
      term.write(datos, () => {
        // Con suelo: los callbacks en vuelo tras un reset o el vigilante seguirían restando.
        pendientes = Math.max(0, pendientes - datos.length)
        if (pausado && pendientes <= UMBRAL_REANUDACION) reanudar()
      })
    },
    reset(): void {
      pendientes = 0
      reanudar()
    }
  }
}
