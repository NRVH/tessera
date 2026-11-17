// =============================================================================
// Contrato IPC de la terminal de la interfaz (main <-> preload <-> UI); node-pty y los servicios
// viven siempre en el main. Sirve a las dos clases de sesión: la del shell del proyecto (OPEN) y la
// de una conexión SSH del perfil (OPEN_SSH, en el pty del host); el resto de canales es común.
// invoke (renderer -> main): OPEN, OPEN_SSH, RELOAD, CLOSE, EN_MARCHA. send (renderer -> main):
// WRITE, RESIZE, FLOW. send (main -> renderer): DATA, EXIT (con `motivo` si una SSH salió con 255
// o si murió el contenedor de un shell en modo Docker).
// Hermanos: `agent-terminal-ipc.ts` (terminal del agente) y `ssh-ipc.ts` (registro de conexiones).
// =============================================================================

export const TERMINAL_CHANNELS = {
  /** invoke: abre una sesión de terminal. PeticionAbrirTerminal -> ResultadoAbrirTerminal. */
  OPEN: 'terminal:open',
  /**
   * invoke: abre una conexión SSH del perfil en el pty del HOST (sin shell delante), aunque el
   * proyecto sea de Docker. PeticionAbrirSsh -> ResultadoAbrirTerminal con `rutaHostProyecto` y
   * `rutaWorkspace` vacíos. Se recarga por RELOAD («Reconectar», con los datos vigentes de la conexión).
   */
  OPEN_SSH: 'terminal:openSsh',
  /** send: stdin del usuario hacia el shell. MensajeEscribirTerminal. */
  WRITE: 'terminal:write',
  /** send: reflow del pty (cols/rows). MensajeRedimensionarTerminal. */
  RESIZE: 'terminal:resize',
  /**
   * send (renderer -> main): CONTRAPRESIÓN. El renderer pide pausar/reanudar la
   * salida del pty cuando xterm no da abasto (marcas de agua). Pausar corta la
   * lectura del pty -> el proceso de dentro se bloquea al escribir (backpressure
   * real), evitando que una salida masiva inunde y congele el hilo de UI.
   */
  FLOW: 'terminal:flow',
  /**
   * invoke: RELOAD ROBUSTO. Mata el shell y levanta uno nuevo en el MISMO
   * contenedor/cwd (entorno recomputado), conservando el sessionId y los
   * suscriptores (onData/onExit de primer nivel). Additivo al contrato original:
   * expone ServicioTerminal.recargarSesion() sin tocar el resto de la superficie.
   * PeticionRecargarTerminal -> ResultadoAbrirTerminal (misma identidad de sesión).
   */
  RELOAD: 'terminal:reload',
  /** invoke: cierra la sesión (el contenedor sigue vivo). PeticionCerrarTerminal -> void. */
  CLOSE: 'terminal:close',
  /**
   * invoke: cuántas terminales de shell de un perfil están abiertas y cuántas ejecutan algo
   * (hibernar las cierra). PeticionTerminalesEnMarcha -> TerminalesEnMarcha.
   */
  EN_MARCHA: 'terminal:enMarcha',
  /** send (main -> renderer): salida (stdout/stderr) del shell. MensajeDatosTerminal. */
  DATA: 'terminal:data',
  /** send (main -> renderer): el shell terminó. MensajeSalidaTerminal. */
  EXIT: 'terminal:exit'
} as const

/** Petición para abrir una terminal anclada a un proyecto de un perfil. */
export interface PeticionAbrirTerminal {
  /** Id de perfil (debe existir en config/profiles.json). */
  perfilId: string
  /** Ruta host (Windows) del proyecto a montar/anclar como cwd. */
  rutaHostProyecto: string
  /**
   * Ids de las conexiones montadas en este proyecto (mismo ámbito que la sesión de
   * agente): así `tdb` a mano ve exactamente lo mismo que ve el agente.
   */
  conexionDbIds?: string[]
}

/** Petición para abrir una conexión SSH guardada: la conexión tiene que ser de ese perfil. */
export interface PeticionAbrirSsh {
  perfilId: string
  conexionId: string
}

/** Respuesta al abrir una terminal: identidad de la sesión y su cwd neutro. */
export interface ResultadoAbrirTerminal {
  /** Id estable de la sesión; se conserva a través de reload en el ServicioTerminal. */
  sesionId: string
  perfilId: string
  /** Ruta host tal como se pidió. */
  rutaHostProyecto: string
  /** cwd neutro dentro del contenedor: /workspace/<x> (nunca la ruta de Windows). */
  rutaWorkspace: string
}

export interface MensajeEscribirTerminal {
  sessionId: string
  /** Bytes crudos de stdin (incluye el "\n" si corresponde). */
  data: string
}

export interface MensajeRedimensionarTerminal {
  sesionId: string
  cols: number
  rows: number
}

/** Contrapresión: pausar (true) o reanudar (false) la lectura del pty de una sesión. */
export interface MensajeControlFlujo {
  sessionId: string
  paused: boolean
}

export interface PeticionRecargarTerminal {
  sesionId: string
  /**
   * Bases MONTADAS ahora mismo en el proyecto (modo Windows). Recargar es la vía por
   * la que se aplica un cambio de montaje también aquí: los secretos y el PATH con
   * `tdb` viven en el entorno del pty y solo pueden fijarse al arrancarlo. Omitirlo
   * conserva el entorno vigente.
   */
  conexionDbIds?: string[]
}

export interface PeticionCerrarTerminal {
  sesionId: string
}

export interface PeticionTerminalesEnMarcha {
  perfilId: string
}

/**
 * Las terminales de shell vivas de un perfil (las SSH no: hibernar no las cierra) y cuántas
 * ejecutan algo más que el shell en reposo. `enMarcha` es null si no se pudo mirar.
 */
export interface TerminalesEnMarcha {
  abiertas: number
  enMarcha: number | null
}

/** Evento main -> renderer con salida del shell. */
export interface MensajeDatosTerminal {
  sessionId: string
  data: string
}

/**
 * Por qué terminó una sesión SSH que salió con 255 (el código de los fallos del propio ssh): la
 * huella del servidor cambió o no está confirmada, no se autenticó, no se llegó al servidor o se
 * cortó la conexión, o no hubo algoritmos en común.
 */
export type MotivoSsh = 'ssh-huella-cambiada' | 'ssh-huella-sin-confirmar' | 'ssh-autenticacion' | 'ssh-inalcanzable' | 'ssh-algoritmos'

/** Por qué terminó una sesión, si el main lo sabe: solo las SSH traen motivo. */
export type MotivoSalidaTerminal = MotivoSsh

/** Evento main -> renderer cuando el shell termina (usuario `exit`, crash, etc.). */
export interface MensajeSalidaTerminal {
  sessionId: string
  /** Código de salida del shell; -1 si el sistema no lo dio (ConPTY a veces avisa sin código). */
  codigoSalida: number | null
  /**
   * En sesiones SSH, con código de salida 255 (en Windows también -1, que incluye la salida sin código)
   * y si ssh dejó escrito por qué; sin él, el 255 pudo darlo el comando remoto.
   */
  motivo?: MotivoSalidaTerminal
}
