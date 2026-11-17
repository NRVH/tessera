// =============================================================================
// Tipos de una sesión de terminal: la vista pública (`SesionTerminal`), las opciones de
// creación y el registro interno mutable que `ServicioTerminal` guarda por sesión.
// Solo tipos: los reexporta `ServicioTerminal`, que es por donde los importa el resto.
// =============================================================================
import type { IPty, IDisposable } from 'node-pty'

/** Vista pública de una sesión de terminal (lo que consume la UI de xterm). */
export interface SesionTerminal {
  /** Id estable de cara a la UI; se conserva a través de recargarSesion(). */
  readonly id: string
  readonly perfilId: string
  /** Ruta host del proyecto tal como se pidió en crearSesion(). */
  readonly proyecto: string
  /** cwd neutro dentro del contenedor: /workspace/<x>. */
  readonly rutaWorkspace: string
  /** pty vivo actual (cambia de instancia tras un reload; el id no). */
  readonly pty: IPty
  /** Código de salida del shell una vez terminado; null mientras vive. */
  readonly codigoSalida: number | null
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

/** Opciones de `ServicioTerminal.crearSesion`. */
export interface OpcionesCrearSesion {
  /** Proyecto al que anclar el cwd: ruta host, nombre de workspace o rutaWorkspace neutro. */
  proyecto: string
  /**
   * Comando de arranque del pty. Con él corre `bash -lc <comandoLanzamiento>` (la terminal del agente);
   * sin él, `bash -il`. Se conserva a través de recargarSesion().
   */
  comandoLanzamiento?: string
  /**
   * Modo nativo: el pty corre el shell del sistema con cwd en la ruta real del proyecto, sin
   * contenedor ni montajes. Con `comandoLanzamiento` ejecuta ese comando (el agente nativo). Se conserva
   * a través de recargarSesion().
   */
  host?: boolean
  /**
   * Variables extra del entorno del pty, solo en modo nativo: por aquí llegan las conexiones
   * a bases de datos y el PATH con `tdb`. Los secretos viven solo en la memoria del proceso.
   * Se conservan a través de recargarSesion().
   */
  extraEnv?: Record<string, string>
  /**
   * Con él, el pty lanza este ejecutable en el HOST con cwd en HOME, y cerrar o recargar matan su
   * árbol sin teclear nada. Pide `host: true`. Se conserva a través de recargarSesion().
   */
  ejecutable?: EjecutableSesion
  /** Columnas y filas con las que nace el pty; sin él (o fuera de rango), 80x24. */
  tamano?: { cols: number; rows: number }
}

/**
 * Registro interno mutable de una sesión. Es el mismo objeto que se expone como
 * `SesionTerminal`, así que la UI ve siempre el pty y el código de salida vigentes.
 */
export interface RegistroSesion {
  id: string
  perfilId: string
  proyecto: string
  rutaWorkspace: string
  nombreContenedor: string
  /** Pty nativo (shell del sistema, cwd en la ruta real) y no `docker exec`. */
  host: boolean
  /** Comando de arranque (agente); mutable: recargarSesion() puede sustituirlo. */
  comandoLanzamiento?: string
  /** Variables extra del entorno (modo nativo); mutable por el mismo motivo que `comandoLanzamiento`. */
  extraEnv?: Record<string, string>
  /** Ejecutable lanzado sin shell (sesiones SSH); mutable por el mismo motivo que `comandoLanzamiento`. */
  ejecutable?: EjecutableSesion
  pty: IPty
  cols: number
  rows: number
  codigoSalida: number | null
  /** Mientras se mata el pty a propósito para un reload (no es una salida real). */
  recargando: boolean
  /** Mientras se cierra la sesión definitivamente. */
  cerrando: boolean
  /**
   * Desde que `detenerSesion()` empieza a parar el agente nativo hasta que un respawn lo
   * relanza: el pty no reenvía nada y su salida no se anuncia. Bandera propia porque
   * `recargando` se limpia en el `finally` del reinicio y `cerrando` no se limpia nunca.
   */
  detenida: boolean
  /**
   * La parada en curso, o null. `recargarSesion` y `cerrarSesion` la esperan antes de tocar el
   * pty: entrar a mitad haría que dos caminos acabaran matando el mismo pty. Nunca rechaza.
   */
  parada: Promise<void> | null
  /** Suscriptores externos (UI) a la salida; se conservan a través de un reload. */
  oyentesDatos: Set<(datos: string) => void>
  /**
   * Suscriptores de primer nivel al fin del shell: viven en el record y no en el pty, así que
   * sobreviven a recargarSesion(). Solo se notifican en salidas reales.
   */
  oyentesSalida: Set<(codigoSalida: number | null) => void>
  /** Salida acumulada (coalescing): se vuelca en un solo lote por ventana de flush. */
  bufSalida: string[]
  /** Temporizador del volcado pendiente, o null. */
  temporizadorVolcado: ReturnType<typeof setTimeout> | null
  /** Pty pausado por contrapresión del renderer. */
  pausado: boolean
  /** Suscripciones al pty ACTUAL; se rehacen en cada (re)spawn. */
  suscripcionDatos: IDisposable
  suscripcionSalida: IDisposable
  /** Se resuelve cuando el pty ACTUAL emite onExit. */
  salidaPty: Promise<number>
  resolverSalidaPty: (codigo: number) => void
}
