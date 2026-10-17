// =============================================================================
// Registro de los ptys del proceso cuya raíz puede seguir viva, y de a cuáles se mandó ya `kill()`.
// Existe porque un pty con la raíz viva al salir CUELGA el proceso: node-pty une, al desmontar Node,
// el hilo que espera el fin de esa raíz. Con él, el cierre remata lo que cualquier camino dejara
// suelto y deja escrito lo que quede.
// Puro: matar, señalar y saber si la raíz terminó entran como dependencias; `adaptadores/pty.ts`
// tiene la instancia del proceso.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================

/** Lo que el registro necesita de un pty: su pid. */
export interface PtyRegistrable {
  readonly pid: number
}

/** Un pty cuya raíz no consta como terminada, tal como se anota. */
export interface PtyPendiente {
  pid: number
  archivo: string
  /** Ya se le mandó `kill()`. */
  matado: boolean
}

/** Qué hizo `rematar` con un pty. */
export type Remate = 'terminado' | 'kill' | 'senal' | 'nada'

/** Cómo se mata un pty, cómo se señala su raíz y cómo se sabe que terminó. */
export interface DepsRegistroPtys<P> {
  /** El `kill()` de node-pty. */
  matar: (pty: P) => void
  /**
   * Fuerza la muerte de la raíz por su pid, o `null` donde no es seguro. En POSIX, mientras el pty no
   * avisa de su salida su raíz está viva o sin recoger, y los pids no se reutilizan enseguida. En
   * Windows el aviso llega a JS después de que node-pty suelte el handle del proceso, y en ese hueco
   * el pid ya podría ser de otro: allí basta `kill()`, que termina la raíz con el handle de node-pty.
   */
  senalar: ((pid: number) => void) | null
  /**
   * Si la raíz ya terminó. `avisoDeSalida` dice si el pty emitió su salida: en POSIX es lo mismo; en
   * Windows no, porque node-pty la emite al cerrarse la tubería de salida aunque la raíz siga viva.
   */
  terminado: (pty: P, avisoDeSalida: boolean) => boolean
}

/** El registro de UN proceso. Ninguna operación lanza: un fallo al matar se trata como hecho. */
export interface RegistroPtys<P extends PtyRegistrable> {
  alta: (pty: P, archivo: string) => void
  /** El pty emitió su salida (`onExit`). */
  avisoDeSalida: (pty: P) => void
  /** `kill()` una sola vez por pty, haya terminado o no: el segundo cerraría otra vez su pseudoconsola. */
  matar: (pty: P) => boolean
  /** Anota que el pty ya recibió su `kill()` por otro camino (una señal en POSIX). */
  anotarMatado: (pty: P) => void
  /** Si su raíz no consta como terminada (y así, si hay algo que rematar). */
  pendiente: (pty: P) => boolean
  /** Si su raíz no consta como terminada: `kill()` si nadie se lo mandó; si ya lo tuvo, la señal (donde la hay). */
  rematar: (pty: P) => Remate
  /** `rematar` a todos los pendientes; cuenta qué se hizo. */
  rematarTodos: () => Record<Remate, number>
  pendientes: () => PtyPendiente[]
}

export function crearRegistroPtys<P extends PtyRegistrable>(deps: DepsRegistroPtys<P>): RegistroPtys<P> {
  const vivos = new Map<P, { archivo: string; aviso: boolean }>()
  const matados = new WeakSet<P>()

  /** Si ya terminó, sale del registro: lo que queda son siempre raíces que pueden seguir vivas. */
  const sigue = (pty: P): boolean => {
    const e = vivos.get(pty)
    if (!e) return false
    let fin = false
    try {
      fin = deps.terminado(pty, e.aviso)
    } catch {
      fin = e.aviso
    }
    if (fin) vivos.delete(pty)
    return !fin
  }

  const matar = (pty: P): boolean => {
    if (matados.has(pty)) return false
    matados.add(pty)
    try {
      deps.matar(pty)
    } catch {
      /* ya destruido: no queda nada que matar */
    }
    return true
  }

  const rematar = (pty: P): Remate => {
    if (!sigue(pty)) return 'terminado'
    if (matar(pty)) return 'kill'
    if (deps.senalar === null) return 'nada'
    try {
      deps.senalar(pty.pid)
    } catch {
      /* ya no existe */
    }
    return 'senal'
  }

  const pendientesVivos = (): P[] => [...vivos.keys()].filter(sigue)

  return {
    alta: (pty, archivo) => {
      pendientesVivos()
      vivos.set(pty, { archivo, aviso: false })
    },
    avisoDeSalida: (pty) => {
      const e = vivos.get(pty)
      if (e) e.aviso = true
      sigue(pty)
    },
    matar,
    anotarMatado: (pty) => {
      matados.add(pty)
    },
    pendiente: sigue,
    rematar,
    rematarTodos: () => {
      const cuenta: Record<Remate, number> = { terminado: 0, kill: 0, senal: 0, nada: 0 }
      for (const pty of [...vivos.keys()]) cuenta[rematar(pty)]++
      return cuenta
    },
    pendientes: () => pendientesVivos().map((pty) => ({ pid: pty.pid, archivo: vivos.get(pty)?.archivo ?? '', matado: matados.has(pty) }))
  }
}

/** Los pendientes en una línea de registro: `ninguno` o `pid 12 pwsh.exe (matado), …`. */
export function textoPendientes(lista: readonly PtyPendiente[]): string {
  if (lista.length === 0) return 'ninguno'
  return lista.map((p) => `pid ${p.pid} ${p.archivo}${p.matado ? ' (matado)' : ''}`).join(', ')
}
