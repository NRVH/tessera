// =============================================================================
// Cola de UNA plaza de una sesión de base de datos (que solo hace una cosa a la vez), con
// prioridad y cancelación por clave. `cancelar(clave)` saca la tarea si espera (rechaza con
// `ErrorCola` 'cancelada') o devuelve true si ya corre, para que el llamador la interrumpa.
// La tarea arranca SÍNCRONA si la cola está libre: un `cancelar` inmediato la ve en curso.
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

export type PrioridadCola = 'alta' | 'normal' | 'baja'

export interface OpcionesTarea {
  /**
   * Identifica la tarea para `cancelar` y para el descarte. En el explorador es el
   * `peticionId` de una pestaña de tabla o el `ejecucionId` de una consola.
   */
  clave?: string
  /** Por defecto `'normal'`. Dentro de una misma prioridad, orden de llegada. */
  prioridad?: PrioridadCola
  /**
   * Si ya ESPERA una tarea con la misma clave, se descarta (su promesa rechaza con
   * motivo `'descartada'`) y esta ocupa su lugar al final de su prioridad. No
   * afecta a una tarea con esa clave que ya esté corriendo. Por defecto `true`.
   */
  descartarClave?: boolean
}

export type MotivoCola = 'cancelada' | 'descartada' | 'vaciada'

/** Rechazo de una tarea que la cola sacó antes de correrla. */
export class ErrorCola extends Error {
  readonly motivo: MotivoCola
  readonly clave: string | undefined

  constructor(motivo: MotivoCola, clave: string | undefined) {
    super(
      motivo === 'cancelada'
        ? 'Operación cancelada antes de empezar'
        : motivo === 'descartada'
          ? 'Operación sustituida por una petición más reciente'
          : 'Operación descartada: la sesión se cerró'
    )
    this.name = 'ErrorCola'
    this.motivo = motivo
    this.clave = clave
  }
}

export function esErrorCola(e: unknown): e is ErrorCola {
  return e instanceof ErrorCola
}

const RANGO: Record<PrioridadCola, number> = { alta: 0, normal: 1, baja: 2 }

interface Entrada {
  ejecutar: () => void
  rechazar: (e: unknown) => void
  clave: string | undefined
  rango: number
}

export class ColaSesion {
  private readonly esperando: Entrada[] = []
  private actual: { clave: string | undefined } | null = null

  /** Tareas esperando (no cuenta la que corre). */
  get longitud(): number {
    return this.esperando.length
  }

  /** ¿Hay una tarea corriendo? */
  get enCurso(): boolean {
    return this.actual !== null
  }

  /** Clave de la tarea en curso (`null` si no hay ninguna o no tiene clave). */
  claveEnCurso(): string | null {
    return this.actual?.clave ?? null
  }

  /** ¿Espera una tarea con esta clave? */
  esperandoClave(clave: string): boolean {
    return this.esperando.some((e) => e.clave === clave)
  }

  /** Nada corre y nada espera. El barrido de inactividad solo cierra sesiones así. */
  vacia(): boolean {
    return this.actual === null && this.esperando.length === 0
  }

  /**
   * Encola `fn`. Resuelve/rechaza con lo que haga `fn`, o rechaza con `ErrorCola`
   * si la tarea se saca de la cola antes de correr.
   */
  correr<T>(fn: () => T | Promise<T>, opciones: OpcionesTarea = {}): Promise<T> {
    const clave = opciones.clave
    const rango = RANGO[opciones.prioridad ?? 'normal']
    if (clave !== undefined && opciones.descartarClave !== false) {
      this.sacar((e) => e.clave === clave, 'descartada')
    }
    return new Promise<T>((resolve, reject) => {
      const entrada: Entrada = {
        clave,
        rango,
        rechazar: reject,
        ejecutar: () => {
          let resultado: T | Promise<T>
          try {
            resultado = fn()
          } catch (e) {
            reject(e)
            this.terminar()
            return
          }
          Promise.resolve(resultado).then(
            (v) => {
              resolve(v)
              this.terminar()
            },
            (e: unknown) => {
              reject(e)
              this.terminar()
            }
          )
        }
      }
      // Inserción estable: detrás de todas las de su prioridad o mejor.
      let i = this.esperando.length
      while (i > 0 && this.esperando[i - 1].rango > rango) i--
      this.esperando.splice(i, 0, entrada)
      this.bombear()
    })
  }

  /**
   * Cancela por clave. Saca de la cola las que esperan (rechazan con
   * `'cancelada'`) y devuelve `true` si la que CORRE tiene esa clave, para que el
   * llamador la interrumpa en el driver.
   */
  cancelar(clave: string): boolean {
    this.sacar((e) => e.clave === clave, 'cancelada')
    return this.actual !== null && this.actual.clave === clave
  }

  /**
   * Rechaza todo lo que espera con motivo `'vaciada'` (sesión perdida, proceso
   * caído, cierre). La que corre no se toca: termina o falla por su cuenta.
   * Devuelve cuántas se sacaron.
   */
  descartarTodas(): number {
    return this.sacar(() => true, 'vaciada')
  }

  private sacar(criterio: (e: Entrada) => boolean, motivo: MotivoCola): number {
    let n = 0
    for (let i = this.esperando.length - 1; i >= 0; i--) {
      const e = this.esperando[i]
      if (!criterio(e)) continue
      this.esperando.splice(i, 1)
      e.rechazar(new ErrorCola(motivo, e.clave))
      n++
    }
    return n
  }

  private terminar(): void {
    this.actual = null
    this.bombear()
  }

  private bombear(): void {
    if (this.actual !== null) return
    const siguiente = this.esperando.shift()
    if (!siguiente) return
    this.actual = { clave: siguiente.clave }
    siguiente.ejecutar()
  }
}
