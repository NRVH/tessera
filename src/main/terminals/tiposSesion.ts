// =============================================================================
// Tipos de una sesión de terminal: la vista pública (`TerminalSession`), las opciones de
// creación y el registro interno mutable que `TerminalService` guarda por sesión.
// Solo tipos: los reexporta `TerminalService`, que es por donde los importa el resto.
// =============================================================================
import type { IPty, IDisposable } from 'node-pty'

/** Vista pública de una sesión de terminal (lo que consume la UI de xterm). */
export interface TerminalSession {
  /** Id estable de cara a la UI; se conserva a través de reloadSession(). */
  readonly id: string
  readonly profileId: string
  /** Ruta host del proyecto tal como se pidió en createSession(). */
  readonly project: string
  /** cwd neutro dentro del contenedor: /workspace/<x>. */
  readonly workspacePath: string
  /** pty vivo actual (cambia de instancia tras un reload; el id no). */
  readonly pty: IPty
  /** exitCode del shell una vez terminado; null mientras vive. */
  readonly exitCode: number | null
}

/**
 * Un ejecutable que el pty lanza DIRECTAMENTE, sin shell delante (las sesiones SSH): su código de
 * salida llega intacto y no hay citado de shell. `quitarEnv` son variables que no debe heredar.
 */
export interface EjecutableSesion {
  archivo: string
  args: string[]
  quitarEnv?: string[]
}

/** Opciones de `TerminalService.createSession`. */
export interface CreateSessionOptions {
  /** Proyecto al que anclar el cwd: ruta host, nombre de workspace o workspacePath neutro. */
  project: string
  /**
   * Comando de arranque del pty. Con él corre `bash -lc <launch>` (la terminal del agente);
   * sin él, `bash -il`. Se conserva a través de reloadSession().
   */
  launch?: string
  /**
   * Modo nativo: el pty corre el shell del sistema con cwd en la ruta real del proyecto, sin
   * contenedor ni montajes. Con `launch` ejecuta ese comando (el agente nativo). Se conserva
   * a través de reloadSession().
   */
  host?: boolean
  /**
   * Variables extra del entorno del pty, solo en modo nativo: por aquí llegan las conexiones
   * a bases de datos y el PATH con `tdb`. Los secretos viven solo en la memoria del proceso.
   * Se conservan a través de reloadSession().
   */
  extraEnv?: Record<string, string>
  /**
   * Con él, el pty lanza este ejecutable en el HOST con cwd en HOME, y cerrar o recargar matan su
   * árbol sin teclear nada. Pide `host: true`. Se conserva a través de reloadSession().
   */
  ejecutable?: EjecutableSesion
}

/**
 * Registro interno mutable de una sesión. Es el mismo objeto que se expone como
 * `TerminalSession`, así que la UI ve siempre el pty y el exitCode vigentes.
 */
export interface SessionRecord {
  id: string
  profileId: string
  project: string
  workspacePath: string
  containerName: string
  /** Pty nativo (shell del sistema, cwd en la ruta real) y no `docker exec`. */
  host: boolean
  /** Comando de arranque (agente); mutable: reloadSession() puede sustituirlo. */
  launch?: string
  /** Variables extra del entorno (modo nativo); mutable por el mismo motivo que `launch`. */
  extraEnv?: Record<string, string>
  /** Ejecutable lanzado sin shell (sesiones SSH); mutable por el mismo motivo que `launch`. */
  ejecutable?: EjecutableSesion
  pty: IPty
  cols: number
  rows: number
  exitCode: number | null
  /** Mientras se mata el pty a propósito para un reload (no es una salida real). */
  reloading: boolean
  /** Mientras se cierra la sesión definitivamente. */
  closing: boolean
  /**
   * Desde que `detenerSesion()` empieza a parar el agente nativo hasta que un respawn lo
   * relanza: el pty no reenvía nada y su salida no se anuncia. Bandera propia porque
   * `reloading` se limpia en el `finally` del reinicio y `closing` no se limpia nunca.
   */
  detenida: boolean
  /**
   * La parada en curso, o null. `reloadSession` y `closeSession` la esperan antes de tocar el
   * pty: entrar a mitad haría que dos caminos acabaran matando el mismo pty. Nunca rechaza.
   */
  parada: Promise<void> | null
  /** Suscriptores externos (UI) a la salida; se conservan a través de un reload. */
  listeners: Set<(data: string) => void>
  /**
   * Suscriptores de primer nivel al fin del shell: viven en el record y no en el pty, así que
   * sobreviven a reloadSession(). Solo se notifican en salidas reales.
   */
  exitListeners: Set<(exitCode: number | null) => void>
  /** Salida acumulada (coalescing): se vuelca en un solo lote por ventana de flush. */
  outBuf: string[]
  /** Temporizador del volcado pendiente, o null. */
  flushTimer: ReturnType<typeof setTimeout> | null
  /** Pty pausado por contrapresión del renderer. */
  paused: boolean
  /** Suscripciones al pty ACTUAL; se rehacen en cada (re)spawn. */
  dataSub: IDisposable
  exitSub: IDisposable
  /** Se resuelve cuando el pty ACTUAL emite onExit. */
  exit: Promise<number>
  resolveExit: (code: number) => void
}
