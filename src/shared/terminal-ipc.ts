// =============================================================================
// Contrato IPC de la terminal de la interfaz (main <-> preload <-> UI); node-pty y los servicios
// viven siempre en el main. Sirve a las dos clases de sesión: la del shell del proyecto (OPEN) y la
// de una conexión SSH del perfil (OPEN_SSH, en el pty del host); el resto de canales es común.
// invoke (renderer -> main): OPEN, OPEN_SSH, BOOTSTRAP_SESSION, RELOAD, CLOSE. send (renderer -> main):
// WRITE, RESIZE, FLOW. send (main -> renderer): DATA, EXIT (con `reason` si una SSH salió con 255).
// Hermanos: `agent-terminal-ipc.ts` (terminal del agente) y `ssh-ipc.ts` (registro de conexiones).
// =============================================================================

export const TERMINAL_CHANNELS = {
  /** invoke: abre una sesión de terminal. OpenTerminalRequest -> OpenTerminalResult. */
  OPEN: 'terminal:open',
  /**
   * invoke: abre una conexión SSH del perfil en el pty del HOST (sin shell delante), aunque el
   * proyecto sea de Docker. OpenSshRequest -> OpenTerminalResult con `projectHostPath` y
   * `workspacePath` vacíos. Se recarga por RELOAD («Reconectar», con los datos vigentes de la conexión).
   */
  OPEN_SSH: 'terminal:openSsh',
  /**
   * invoke: bootstrap de la sesión de terminal (checkDocker -> ensureContainer
   * (Alfa) -> addProject(proyecto de prueba) -> createSession). Sin argumentos.
   * -> OpenTerminalResult.
   */
  BOOTSTRAP_SESSION: 'terminal:bootstrapSession',
  /** send: stdin del usuario hacia el shell. WriteTerminalMessage. */
  WRITE: 'terminal:write',
  /** send: reflow del pty (cols/rows). ResizeTerminalMessage. */
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
   * expone TerminalService.reloadSession() sin tocar el resto de la superficie.
   * ReloadTerminalRequest -> OpenTerminalResult (misma identidad de sesión).
   */
  RELOAD: 'terminal:reload',
  /** invoke: cierra la sesión (el contenedor sigue vivo). CloseTerminalRequest -> void. */
  CLOSE: 'terminal:close',
  /** send (main -> renderer): salida (stdout/stderr) del shell. TerminalDataMessage. */
  DATA: 'terminal:data',
  /** send (main -> renderer): el shell terminó. TerminalExitMessage. */
  EXIT: 'terminal:exit'
} as const

/**
 * Dónde corre el shell de la terminal:
 *   - 'container' (por defecto): dentro del contenedor Docker del perfil.
 *   - 'host': una PowerShell nativa de Windows, con cwd en la ruta real del
 *     proyecto (proyectos en modo Windows). Espejo de AgentRunMode.
 */
export type TerminalRunMode = 'container' | 'host'

/** Petición para abrir una terminal anclada a un proyecto de un perfil. */
export interface OpenTerminalRequest {
  /** Id de perfil (debe existir en config/profiles.json). */
  profileId: string
  /** Ruta host (Windows) del proyecto a montar/anclar como cwd. */
  projectHostPath: string
  /** Dónde correr el shell. Ausente => 'container' (retrocompatible). */
  mode?: TerminalRunMode
  /**
   * Ids de las conexiones montadas en este proyecto (mismo ámbito que la sesión de
   * agente): así `tdb` a mano ve exactamente lo mismo que ve el agente. Solo en
   * modo 'host'.
   */
  dbConnectionIds?: string[]
}

/** Petición para abrir una conexión SSH guardada: la conexión tiene que ser de ese perfil. */
export interface OpenSshRequest {
  profileId: string
  conexionId: string
}

/** Respuesta al abrir una terminal: identidad de la sesión y su cwd neutro. */
export interface OpenTerminalResult {
  /** Id estable de la sesión; se conserva a través de reload en el TerminalService. */
  sessionId: string
  profileId: string
  /** Ruta host tal como se pidió. */
  projectHostPath: string
  /** cwd neutro dentro del contenedor: /workspace/<x> (nunca la ruta de Windows). */
  workspacePath: string
}

export interface WriteTerminalMessage {
  sessionId: string
  /** Bytes crudos de stdin (incluye el "\n" si corresponde). */
  data: string
}

export interface ResizeTerminalMessage {
  sessionId: string
  cols: number
  rows: number
}

/** Contrapresión: pausar (true) o reanudar (false) la lectura del pty de una sesión. */
export interface FlowControlMessage {
  sessionId: string
  paused: boolean
}

export interface ReloadTerminalRequest {
  sessionId: string
  /**
   * Bases MONTADAS ahora mismo en el proyecto (modo Windows). Recargar es la vía por
   * la que se aplica un cambio de montaje también aquí: los secretos y el PATH con
   * `tdb` viven en el entorno del pty y solo pueden fijarse al arrancarlo. Omitirlo
   * conserva el entorno vigente.
   */
  dbConnectionIds?: string[]
}

export interface CloseTerminalRequest {
  sessionId: string
}

/** Evento main -> renderer con salida del shell. */
export interface TerminalDataMessage {
  sessionId: string
  data: string
}

/**
 * Por qué terminó una sesión SSH que salió con 255 (el código de los fallos del propio ssh): la
 * huella del servidor cambió, no se autenticó, no se llegó al servidor o se cortó la conexión, o
 * no hubo algoritmos en común.
 */
export type TerminalExitReason = 'ssh-huella-cambiada' | 'ssh-autenticacion' | 'ssh-inalcanzable' | 'ssh-algoritmos'

/** Evento main -> renderer cuando el shell termina (usuario `exit`, crash, etc.). */
export interface TerminalExitMessage {
  sessionId: string
  /** exitCode del shell; -1 si el sistema no lo dio (ConPTY a veces avisa sin código). */
  exitCode: number | null
  /**
   * Solo en sesiones SSH, con exitCode 255 (en Windows también -1, que incluye la salida sin código)
   * y si ssh dejó escrito por qué. Sin él, el 255 pudo darlo el comando remoto.
   */
  reason?: TerminalExitReason
}
