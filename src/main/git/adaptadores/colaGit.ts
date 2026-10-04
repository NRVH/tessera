// =============================================================================
// Cola de procesos de git: tope de concurrencia (y uno propio para el relleno de fondo),
// PRIORIDAD (primero lo que se ve) y descarte de lo que aún no ha nacido, por ámbito o porque
// ya no interesa. El tope protege la latencia del bucle de eventos, no el rendimiento. No sabe
// nada de git: recibe funciones, así que se prueba con `node` a secas.
// Decisiones: docs/decisiones/git/main-cola-y-techos.md
// Decisiones: docs/decisiones/git/main-abanico-fondo-y-generacion.md
// =============================================================================

/** Prioridades. Menor número = antes. */
export const PRIORIDAD = {
  /** Lo que el usuario está mirando ahora mismo. */
  VISIBLE: 0,
  /** Lo que hará falta enseguida (el repo activo, el vecino de scroll). */
  PRONTO: 1,
  /** Relleno de fondo: el resto de la contenedora. */
  FONDO: 2
} as const

export type Prioridad = (typeof PRIORIDAD)[keyof typeof PRIORIDAD]

interface Encolado<T = unknown> {
  fn: () => Promise<T>
  prioridad: Prioridad
  ambito: string
  /** Orden de llegada: desempata dentro de la misma prioridad (FIFO). */
  seq: number
  /** ¿Sigue interesando? Se pregunta al SACARLO de la cola; ausente = siempre. */
  vigente?: () => boolean
  resolver: (v: T) => void
  rechazar: (e: unknown) => void
}

/** Error con el que se rechaza un trabajo cancelado. Se distingue de un fallo real. */
export class CanceladoError extends Error {
  constructor(ambito: string) {
    super(`trabajo cancelado (ámbito "${ambito}")`)
    this.name = 'CanceladoError'
  }
}

export function esCancelado(err: unknown): boolean {
  return err instanceof Error && err.name === 'CanceladoError'
}

/**
 * Cola con tope de concurrencia y prioridad.
 *
 * No sabe nada de git a propósito: recibe funciones. Así se prueba con `node` a
 * secas, sin spawnear nada — que es justo lo que hace falta para fijar el
 * comportamiento (orden, tope, cancelación) sin depender del antivirus del día.
 */
export class ColaGit {
  private readonly cola: Encolado[] = []
  private vuelo = 0
  private seq = 0
  /** Ámbitos cancelados. Un trabajo suyo se rechaza al salir de la cola. */
  private readonly cancelados = new Set<string>()

  /**
   * Tope de procesos en vuelo. Campo explícito y no propiedad de parámetro: los
   * tests corren con `node` a secas (type-stripping), que no admite esa azúcar.
   */
  private readonly tope: number
  /** Tope propio del relleno de FONDO, dentro del general: lo visible nunca se queda sin plaza. */
  private readonly topeFondo: number
  private vueloFondo = 0

  constructor(tope: number, topeFondo: number = tope) {
    if (tope < 1) throw new Error('el tope de la cola de git debe ser >= 1')
    if (topeFondo < 1 || topeFondo > tope) throw new Error('el tope de fondo debe estar entre 1 y el tope')
    this.tope = tope
    this.topeFondo = topeFondo
  }

  get enVuelo(): number {
    return this.vuelo
  }
  get enCola(): number {
    return this.cola.length
  }

  /**
   * Encola un trabajo. `ambito` agrupa trabajos que se pueden tirar juntos (todo lo
   * de un perfil, de una contenedora); `''` = sin ámbito, nunca se cancela. Con
   * `vigente`, un trabajo que al llegar su turno ya no interesa se rechaza sin ejecutarse,
   * igual que uno de un ámbito cancelado.
   */
  correr<T>(
    fn: () => Promise<T>,
    prioridad: Prioridad = PRIORIDAD.PRONTO,
    ambito = '',
    vigente?: () => boolean
  ): Promise<T> {
    return new Promise<T>((resolver, rechazar) => {
      this.cola.push({
        fn: fn as () => Promise<unknown>,
        prioridad,
        ambito,
        vigente,
        seq: this.seq++,
        resolver: resolver as (v: unknown) => void,
        rechazar
      })
      this.bombear()
    })
  }

  /**
   * Tira lo que quede EN COLA de ese ámbito. Lo que ya corre se deja terminar: no
   * hay forma barata de abortar un proceso a medias y su resultado ya está pagado.
   * El ámbito queda marcado para que un trabajo suyo que llegue tarde tampoco corra.
   */
  cancelarAmbito(ambito: string): number {
    if (ambito === '') return 0
    this.cancelados.add(ambito)
    let tirados = 0
    for (let i = this.cola.length - 1; i >= 0; i--) {
      const t = this.cola[i]
      if (t !== undefined && t.ambito === ambito) {
        this.cola.splice(i, 1)
        t.rechazar(new CanceladoError(ambito))
        tirados++
      }
    }
    return tirados
  }

  /** Vuelve a admitir un ámbito (al regresar a ese perfil). */
  reabrirAmbito(ambito: string): void {
    this.cancelados.delete(ambito)
  }

  private bombear(): void {
    while (this.vuelo < this.tope && this.cola.length > 0) {
      const mejor = this.indiceDelMejor()
      // Si el mejor es de FONDO, en la cola solo queda fondo: con su tope lleno no arranca
      // nada más, y las plazas que sobran quedan para lo visible que llegue.
      const esFondo = this.cola[mejor]?.prioridad === PRIORIDAD.FONDO
      if (esFondo && this.vueloFondo >= this.topeFondo) return
      const t = this.cola.splice(mejor, 1)[0]
      if (t === undefined) return
      if (this.descartado(t)) {
        t.rechazar(new CanceladoError(t.ambito))
        continue
      }
      this.vuelo++
      if (esFondo) this.vueloFondo++
      // `void` + then/catch y no async/await: `bombear` es síncrona a propósito, para
      // que encolar 1000 trabajos no encadene 1000 microtareas antes de arrancar el
      // primero. Un `fn` que LANZA en síncrono (argumentos inválidos) se trata como un
      // rechazo: si escapara de aquí, su plaza no se devolvería nunca.
      let enMarcha: Promise<unknown>
      try {
        enMarcha = t.fn()
      } catch (err) {
        enMarcha = Promise.reject(err)
      }
      enMarcha
        .then(t.resolver, t.rechazar)
        .finally(() => {
          this.vuelo--
          if (esFondo) this.vueloFondo--
          this.bombear()
        })
    }
  }

  /**
   * El siguiente por prioridad y, dentro de ella, por llegada. Se busca el mínimo en vez de
   * mantener la cola ordenada: las inserciones son muchas (1000 de golpe) y las extracciones
   * también, y buscar es O(n) sin reordenar nada.
   */
  private indiceDelMejor(): number {
    let mejor = 0
    for (let i = 1; i < this.cola.length; i++) {
      const a = this.cola[i]
      const b = this.cola[mejor]
      if (a === undefined || b === undefined) continue
      if (a.prioridad < b.prioridad || (a.prioridad === b.prioridad && a.seq < b.seq)) mejor = i
    }
    return mejor
  }

  /** ¿Ya no hay que ejecutarlo? Su ámbito se canceló o dejó de interesar mientras esperaba. */
  private descartado(t: Encolado): boolean {
    return (t.ambito !== '' && this.cancelados.has(t.ambito)) || t.vigente?.() === false
  }
}
