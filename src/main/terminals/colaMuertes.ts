// =============================================================================
// Cola de las MUERTES de pty: parar, cerrar, reiniciar e hibernar van de una en una, las pida
// quien las pida. Matar varios ptys a la vez tumba el main en Windows (0xC0000005), y eso es
// del PROCESO: los dos `TerminalService` (agentes y terminales de abajo) comparten una cola.
// El turno se coge en síncrono: el orden es el de las llamadas.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================

/** Un turno ya cogido: se espera a `anterior` y se suelta al terminar, pase lo que pase. */
export interface TurnoMuerte {
  anterior: Promise<void>
  soltar: () => void
}

/** Cola de un solo carril para las muertes de pty. */
export class ColaMuertes {
  private cola: Promise<void> = Promise.resolve()

  /** Coge turno en síncrono; quien llama espera a `anterior` y luego llama a `soltar`. */
  coger(): TurnoMuerte {
    const anterior = this.cola
    let soltar: () => void = () => {}
    this.cola = new Promise<void>((resolve) => {
      soltar = resolve
    })
    return { anterior, soltar }
  }

  /** Corre `matar` cuando le llega el turno y lo suelta aunque falle. */
  async enTurno(matar: () => Promise<void>): Promise<void> {
    const turno = this.coger()
    try {
      await turno.anterior
      await matar()
    } finally {
      turno.soltar()
    }
  }
}

/** La cola del proceso: la comparten todos los `TerminalService`. */
export const colaMuertesDelProceso = new ColaMuertes()
