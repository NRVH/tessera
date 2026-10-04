// =============================================================================
// Cola con tope de concurrencia, mínima y sin dependencias.
// La usan los dos procesos: el explorador (un `listDir` por carpeta visible, que con
// la carpeta padre de todos los proyectos son miles) y el main (cada consulta de
// `tdb` es un proceso Electron entero).
// Obreros que van tomando de la cola, y no lotes con `Promise.all`: así siempre hay
// N en vuelo y un lento no desperdicia el hueco de los rápidos.
// =============================================================================
// No reutiliza `ColaGit` (src/main/git): el renderer no puede importarla y su cola es
// GLOBAL, 16 plazas para todos los spawns de git; otro tipo de trabajo la dejaría sin
// plazas justo cuando el usuario mira la vista de Git.
export class ColaConcurrencia {
  /** Tope de tareas en vuelo. Campo explícito: el type-stripping de Node no
   *  admite propiedades de constructor (`constructor(private x)`). */
  private readonly tope: number
  private enVueloN = 0
  private readonly cola: Array<() => void> = []

  constructor(tope: number) {
    if (!Number.isInteger(tope) || tope < 1) {
      throw new Error(`ColaConcurrencia: el tope debe ser un entero >= 1, no ${tope}`)
    }
    this.tope = tope
  }

  /** Tareas esperando plaza. */
  get enCola(): number {
    return this.cola.length
  }

  /** Tareas corriendo ahora mismo. */
  get enVuelo(): number {
    return this.enVueloN
  }

  /**
   * Encola `fn`. La promesa devuelta se resuelve (o se rompe) con lo que dé `fn`.
   * Una tarea CANCELADA rompe con `CanceladaError`.
   */
  correr<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolver, rechazar) => {
      const arrancar = (): void => {
        this.enVueloN++
        // El try NO es decorativo: si `fn` es una función normal que revienta ANTES
        // de devolver promesa —un `window.tessera.*` cuyo puente ya no existe, un
        // `execFile` con argv inválido—, sin él la plaza quedaba ocupada para
        // siempre (nadie decrementa), la promesa de esta tarea no se asentaba nunca
        // y la excepción salía por `bombear()`, o sea por el ejecutor de la promesa
        // de OTRA tarea: la que acababa de encolarse rompía en lugar de la que
        // falló. Con `tope` fallos así la cola aceptaba trabajo y no corría nada.
        // El `.then` va dentro por el mismo motivo (un `fn` que no devuelva thenable).
        try {
          fn().then(
            (v) => {
              this.enVueloN--
              resolver(v)
              this.bombear()
            },
            (e: unknown) => {
              this.enVueloN--
              rechazar(e)
              this.bombear()
            }
          )
        } catch (e) {
          this.enVueloN--
          rechazar(e)
          // Sin `bombear()` a propósito: a `arrancar` solo se llega desde el `while`
          // de `bombear`, que seguirá girando por su cuenta. Rebombear aquí anidaría
          // una llamada por cada fallo síncrono y desbordaría la pila con un lote
          // entero de tareas rotas.
        }
      }
      // `cancelar` marca la entrada para que `cancelarPendientes` pueda romperla
      // sin haberla ejecutado nunca.
      ;(arrancar as { cancelar?: () => void }).cancelar = () => rechazar(new CanceladaError())
      this.cola.push(arrancar)
      this.bombear()
    })
  }

  /**
   * Tira lo que quede EN COLA. Lo que ya corre se deja terminar: no hay forma de
   * abortar un `invoke` a medias, y su resultado ya está pagado. Devuelve cuántas
   * tiró, que es justo lo que hace falta para poder afirmar en un test que el
   * abanico viejo no se quedó vivo.
   */
  cancelarPendientes(): number {
    const tiradas = this.cola.length
    for (const t of this.cola) {
      const c = (t as { cancelar?: () => void }).cancelar
      if (c) c()
    }
    this.cola.length = 0
    return tiradas
  }

  /** Arranca tantas tareas en cola como permita el tope. Síncrono a propósito. */
  private bombear(): void {
    while (this.enVueloN < this.tope) {
      const siguiente = this.cola.shift()
      if (siguiente === undefined) return
      siguiente()
    }
  }
}

/** Rechazo de una tarea que se tiró de la cola sin llegar a ejecutarse. */
export class CanceladaError extends Error {
  constructor() {
    super('tarea cancelada antes de ejecutarse')
    this.name = 'CanceladaError'
  }
}

/** ¿Este fallo es una cancelación (y por tanto NO hay que enseñárselo al usuario)? */
export function esCancelada(err: unknown): boolean {
  return err instanceof CanceladaError
}
