// =============================================================================
// Preload: las dos terminales (la de abajo y la del agente) por IPC.
// Los pty viven en el main; aquí solo hay invoke/send y las suscripciones a sus datos.
// Canales y formas: src/shared/terminal-ipc.ts y src/shared/agent-terminal-ipc.ts.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  TERMINAL_CHANNELS,
  type OpenTerminalRequest,
  type OpenTerminalResult,
  type WriteTerminalMessage,
  type ResizeTerminalMessage,
  type FlowControlMessage,
  type TerminalDataMessage,
  type TerminalExitMessage
} from '../shared/terminal-ipc'
import {
  AGENT_TERMINAL_CHANNELS,
  type AgentOpenRequest,
  type AgentOpenResult,
  type AgentWriteMessage,
  type AgentResizeMessage,
  type AgentFlowMessage,
  type AgentDataMessage,
  type AgentExitMessage,
  type AgentActivityMessage,
  type AgentDetenerVariasResult,
  type AgentHibernarInactivosRequest,
  type AgentHibernarInactivosResult
} from '../shared/agent-terminal-ipc'

/** API de terminal expuesta al renderer. Todo pasa por IPC; node-pty vive en el main. */
export interface TerminalApi {
  /** Abre una sesión anclada a un proyecto de un perfil. */
  open: (req: OpenTerminalRequest) => Promise<OpenTerminalResult>
  /** Bootstrap de la sesión de terminal (perfil por defecto + proyecto de prueba). */
  bootstrapTerminalSession: () => Promise<OpenTerminalResult>
  /** Envía stdin al shell. */
  write: (msg: WriteTerminalMessage) => void
  /** Reflow del pty. */
  resize: (msg: ResizeTerminalMessage) => void
  /** Contrapresión: pausa/reanuda la salida del pty cuando xterm no da abasto. */
  setFlow: (msg: FlowControlMessage) => void
  /**
   * RELOAD ROBUSTO: relevanta el shell conservando el mismo sessionId. `dbConnectionIds`
   * reaplica el montaje de bases (entorno del pty), que solo puede fijarse al arrancar.
   */
  reload: (sessionId: string, dbConnectionIds?: string[]) => Promise<OpenTerminalResult>
  /** Cierra la sesión (el contenedor sigue vivo). */
  close: (sessionId: string) => Promise<void>
  /** Suscribe a la salida del shell. Devuelve una función para desuscribirse. */
  onData: (cb: (msg: TerminalDataMessage) => void) => () => void
  /** Suscribe al fin del shell. Devuelve una función para desuscribirse. */
  onExit: (cb: (msg: TerminalExitMessage) => void) => () => void
}

/**
 * API de la TERMINAL DEL AGENTE (columna derecha "Claude Code"). Espejo de
 * TerminalApi pero sobre los canales HERMANOS `agentTerminal:*`: corre
 * claude/codex en un pty dentro del contenedor del perfil. NO comparte superficie
 * con la terminal de abajo; su contrato queda intacto.
 */
export interface AgentTerminalApi {
  /** Abre una sesión de agente para (perfil, agente, proyecto). */
  open: (req: AgentOpenRequest) => Promise<AgentOpenResult>
  /** Envía stdin al agente. */
  write: (msg: AgentWriteMessage) => void
  /** Reflow del pty. */
  resize: (msg: AgentResizeMessage) => void
  /** Contrapresión: pausa/reanuda la salida del pty del agente. */
  setFlow: (msg: AgentFlowMessage) => void
  /**
   * RELOAD ROBUSTO: relevanta el agente conservando el mismo sessionId. `dbConnectionIds`
   * REAPLICA el montaje de bases (secretos del entorno + aviso al agente), que solo puede
   * fijarse al arrancar el proceso; omitirlo conserva el montaje vigente.
   */
  reload: (
    sessionId: string,
    dbConnectionIds?: string[],
    resumeSessionId?: string
  ) => Promise<AgentOpenResult>
  /** Cierra la sesión y desmonta el configDir (el contenedor sigue vivo). */
  close: (sessionId: string) => Promise<void>
  /**
   * Vuelca la imagen del portapapeles DENTRO del contenedor de la sesión y devuelve
   * su ruta EN EL CONTENEDOR (null si no hay imagen). Para pegar screenshots como
   * adjunto legible por el CLI del agente (que corre en el contenedor, no en Windows).
   */
  saveImage: (sessionId: string) => Promise<string | null>
  /**
   * Copia un ARCHIVO del host (ruta Windows, arrastrado/pegado) dentro del contenedor
   * de la sesión y devuelve su ruta en el contenedor (null si falla). Para adjuntar
   * archivos legibles por el CLI del agente.
   */
  stageFile: (sessionId: string, hostPath: string) => Promise<string | null>
  /** Suscribe a la salida del agente. Devuelve una función para desuscribirse. */
  onData: (cb: (msg: AgentDataMessage) => void) => () => void
  /** Suscribe al fin del agente. Devuelve una función para desuscribirse. */
  onExit: (cb: (msg: AgentExitMessage) => void) => () => void
  /**
   * Suscribe a los cambios de ACTIVIDAD (working/idle) de CUALQUIER sesión de
   * agente (el inspector de progreso). Un solo listener global; el mensaje trae la
   * identidad del target. Devuelve una función para desuscribirse.
   */
  onActivity: (cb: (msg: AgentActivityMessage) => void) => () => void
  /**
   * Foto del estado de actividad de TODAS las sesiones vivas. `onActivity` solo trae
   * cambios, así que un cambio perdido (ventana recreada, crash del renderer) dejaría
   * un indicador encendido sin nada que lo apague. Esto lo resincroniza.
   */
  activitySnapshot: () => Promise<AgentActivityMessage[]>
  /**
   * Parada ATÓMICA de varias sesiones nativas para el reinicio masivo (ver
   * DETENER_VARIAS): si una sola trabaja o no vale, no se para ninguna. Las paradas
   * conservan la sesión para que `reload` la relance en el mismo panel.
   */
  detenerVarias: (sessionIds: string[]) => Promise<AgentDetenerVariasResult>
  /**
   * Una ronda de hibernación por inactividad (ver HIBERNAR_INACTIVOS): el main decide con
   * lo que el renderer le dice que hay en pantalla y devuelve los proyectos hibernados.
   */
  hibernarInactivos: (req: AgentHibernarInactivosRequest) => Promise<AgentHibernarInactivosResult>
}

export const terminal: TerminalApi = {
  open: (req) => ipcRenderer.invoke(TERMINAL_CHANNELS.OPEN, req),
  bootstrapTerminalSession: () => ipcRenderer.invoke(TERMINAL_CHANNELS.BOOTSTRAP_SESSION),
  write: (msg) => ipcRenderer.send(TERMINAL_CHANNELS.WRITE, msg),
  resize: (msg) => ipcRenderer.send(TERMINAL_CHANNELS.RESIZE, msg),
  setFlow: (msg) => ipcRenderer.send(TERMINAL_CHANNELS.FLOW, msg),
  reload: (sessionId, dbConnectionIds) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.RELOAD, { sessionId, dbConnectionIds }),
  close: (sessionId) => ipcRenderer.invoke(TERMINAL_CHANNELS.CLOSE, { sessionId }),
  onData: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: TerminalDataMessage): void => cb(msg)
    ipcRenderer.on(TERMINAL_CHANNELS.DATA, listener)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.DATA, listener)
  },
  onExit: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: TerminalExitMessage): void => cb(msg)
    ipcRenderer.on(TERMINAL_CHANNELS.EXIT, listener)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.EXIT, listener)
  }
}

/** Terminal del agente: mismos gestos que `terminal` pero sobre los canales hermanos. */
export const agentTerminal: AgentTerminalApi = {
  open: (req) => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.OPEN, req),
  write: (msg) => ipcRenderer.send(AGENT_TERMINAL_CHANNELS.WRITE, msg),
  resize: (msg) => ipcRenderer.send(AGENT_TERMINAL_CHANNELS.RESIZE, msg),
  setFlow: (msg) => ipcRenderer.send(AGENT_TERMINAL_CHANNELS.FLOW, msg),
  reload: (sessionId, dbConnectionIds, resumeSessionId) =>
    ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.RELOAD, {
      sessionId,
      dbConnectionIds,
      resumeSessionId
    }),
  close: (sessionId) => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.CLOSE, { sessionId }),
  saveImage: (sessionId) => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.SAVE_IMAGE, { sessionId }),
  stageFile: (sessionId, hostPath) =>
    ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.STAGE_FILE, { sessionId, hostPath }),
  onData: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: AgentDataMessage): void => cb(msg)
    ipcRenderer.on(AGENT_TERMINAL_CHANNELS.DATA, listener)
    return () => ipcRenderer.removeListener(AGENT_TERMINAL_CHANNELS.DATA, listener)
  },
  onExit: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: AgentExitMessage): void => cb(msg)
    ipcRenderer.on(AGENT_TERMINAL_CHANNELS.EXIT, listener)
    return () => ipcRenderer.removeListener(AGENT_TERMINAL_CHANNELS.EXIT, listener)
  },
  onActivity: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: AgentActivityMessage): void => cb(msg)
    ipcRenderer.on(AGENT_TERMINAL_CHANNELS.ACTIVITY, listener)
    return () => ipcRenderer.removeListener(AGENT_TERMINAL_CHANNELS.ACTIVITY, listener)
  },
  activitySnapshot: () => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.ACTIVITY_SNAPSHOT),
  detenerVarias: (sessionIds) =>
    ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.DETENER_VARIAS, { sessionIds }),
  hibernarInactivos: (req) => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.HIBERNAR_INACTIVOS, req)
}
