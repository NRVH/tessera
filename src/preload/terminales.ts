// =============================================================================
// Preload: las dos terminales (la de abajo y la del agente) por IPC.
// Los pty viven en el main; aquí solo hay invoke/send y las suscripciones a sus datos.
// Canales y formas: src/shared/terminal-ipc.ts y src/shared/agent-terminal-ipc.ts.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  TERMINAL_CHANNELS,
  type PeticionRecargarTerminal,
  type PeticionCerrarTerminal,
  type PeticionTerminalesEnMarcha,
  type PeticionAbrirTerminal,
  type PeticionAbrirSsh,
  type ResultadoAbrirTerminal,
  type MensajeEscribirTerminal,
  type MensajeRedimensionarTerminal,
  type MensajeControlFlujo,
  type MensajeDatosTerminal,
  type MensajeSalidaTerminal,
  type TerminalesEnMarcha
} from '../shared/terminal-ipc'
import type { DefinicionAgente } from '../shared/agentesManuales'
import {
  AGENT_TERMINAL_CHANNELS,
  type PeticionAbrirAgente,
  type ResultadoAbrirAgente,
  type MensajeEscribirAgente,
  type MensajeRedimensionarAgente,
  type MensajeFlujoAgente,
  type MensajeDatosAgente,
  type MensajeSalidaAgente,
  type MensajeActividadAgente,
  type ResultadoDetenerVariosAgentes,
  type PeticionHibernarInactivosAgente,
  type ResultadoHibernarInactivosAgente,
  type ParadaPorLimite,
  type AvisoSaturacion,
  type ConstanciaParada,
  type VigiaSaturacionConfig,
  type PeticionRecargarAgente,
  type PeticionCerrarAgente,
  type PeticionGuardarImagenAgente,
  type PeticionPrepararArchivoAgente,
  type PeticionDetenerVariosAgentes
} from '../shared/agent-terminal-ipc'

/** API de terminal expuesta al renderer. Todo pasa por IPC; node-pty vive en el main. */
export interface ApiTerminal {
  /** Abre una sesión anclada a un proyecto de un perfil. */
  abrir: (req: PeticionAbrirTerminal) => Promise<ResultadoAbrirTerminal>
  /**
   * Abre una conexión SSH guardada del perfil, en el pty del host. Se cierra y se reconecta con
   * `close` y `reload` (sin teclear nada en la sesión); su EXIT puede traer `reason`.
   */
  abrirSsh: (req: PeticionAbrirSsh) => Promise<ResultadoAbrirTerminal>
  /** Envía stdin al shell. */
  escribir: (msg: MensajeEscribirTerminal) => void
  /** Reflow del pty. */
  redimensionar: (msg: MensajeRedimensionarTerminal) => void
  /** Contrapresión: pausa/reanuda la salida del pty cuando xterm no da abasto. */
  fijarFlujo: (msg: MensajeControlFlujo) => void
  /**
   * RELOAD ROBUSTO: relevanta el shell conservando el mismo sessionId. `conexionDbIds`
   * reaplica el montaje de bases (entorno del pty), que solo puede fijarse al arrancar.
   */
  recargar: (sesionId: string, conexionDbIds?: string[]) => Promise<ResultadoAbrirTerminal>
  /** Cierra la sesión (el contenedor sigue vivo). */
  cerrar: (sesionId: string) => Promise<void>
  /** Cuántas terminales de shell del perfil están abiertas y cuántas ejecutan algo. */
  enMarcha: (perfilId: string) => Promise<TerminalesEnMarcha>
  /** Suscribe a la salida del shell. Devuelve una función para desuscribirse. */
  alRecibirDatos: (cb: (msg: MensajeDatosTerminal) => void) => () => void
  /** Suscribe al fin del shell. Devuelve una función para desuscribirse. */
  alSalir: (cb: (msg: MensajeSalidaTerminal) => void) => () => void
}

/**
 * API de la TERMINAL DEL AGENTE (columna derecha "Claude Code"). Espejo de
 * ApiTerminal pero sobre los canales HERMANOS `agentTerminal:*`: corre
 * claude/codex en un pty dentro del contenedor del perfil. NO comparte superficie
 * con la terminal de abajo; su contrato queda intacto.
 */
export interface ApiTerminalAgente {
  /** Abre una sesión de agente para (perfil, agente, proyecto). */
  abrir: (req: PeticionAbrirAgente) => Promise<ResultadoAbrirAgente>
  /** Envía stdin al agente. */
  escribir: (msg: MensajeEscribirAgente) => void
  /** Reflow del pty. */
  redimensionar: (msg: MensajeRedimensionarAgente) => void
  /** Contrapresión: pausa/reanuda la salida del pty del agente. */
  fijarFlujo: (msg: MensajeFlujoAgente) => void
  /**
   * RELOAD ROBUSTO: relevanta el agente conservando el mismo sessionId. `conexionDbIds`
   * REAPLICA el montaje de bases (secretos del entorno + aviso al agente), que solo puede
   * fijarse al arrancar el proceso; omitirlo conserva el montaje vigente.
   */
  recargar: (
    sesionId: string,
    conexionDbIds?: string[],
    conversacionReanudarId?: string,
    /** Agente manual: su definición de ahora, para que el reinicio aplique lo editado. */
    manual?: DefinicionAgente
  ) => Promise<ResultadoAbrirAgente>
  /** Cierra la sesión y desmonta el configDir (el contenedor sigue vivo). */
  cerrar: (sesionId: string) => Promise<void>
  /**
   * Vuelca la imagen del portapapeles DENTRO del contenedor de la sesión y devuelve
   * su ruta EN EL CONTENEDOR (null si no hay imagen). Para pegar screenshots como
   * adjunto legible por el CLI del agente (que corre en el contenedor, no en Windows).
   */
  guardarImagen: (sesionId: string) => Promise<string | null>
  /**
   * Copia un ARCHIVO del host (ruta Windows, arrastrado/pegado) dentro del contenedor
   * de la sesión y devuelve su ruta en el contenedor (null si falla). Para adjuntar
   * archivos legibles por el CLI del agente.
   */
  prepararArchivo: (sesionId: string, rutaHost: string) => Promise<string | null>
  /** Suscribe a la salida del agente. Devuelve una función para desuscribirse. */
  alRecibirDatos: (cb: (msg: MensajeDatosAgente) => void) => () => void
  /** Suscribe al fin del agente. Devuelve una función para desuscribirse. */
  alSalir: (cb: (msg: MensajeSalidaAgente) => void) => () => void
  /**
   * Suscribe a los cambios de ACTIVIDAD (working/idle) de CUALQUIER sesión de
   * agente (el inspector de progreso). Un solo listener global; el mensaje trae la
   * identidad del target. Devuelve una función para desuscribirse.
   */
  alCambiarActividad: (cb: (msg: MensajeActividadAgente) => void) => () => void
  /**
   * Foto del estado de actividad de TODAS las sesiones vivas. `alCambiarActividad` solo trae
   * cambios, así que un cambio perdido (ventana recreada, crash del renderer) dejaría
   * un indicador encendido sin nada que lo apague. Esto lo resincroniza.
   */
  fotoActividad: () => Promise<MensajeActividadAgente[]>
  /**
   * Parada ATÓMICA de varias sesiones nativas para el reinicio masivo (ver
   * DETENER_VARIAS): si una sola trabaja o no vale, no se para ninguna. Las paradas
   * conservan la sesión para que `reload` la relance en el mismo panel.
   */
  detenerVarias: (sesionIds: string[]) => Promise<ResultadoDetenerVariosAgentes>
  /**
   * Una ronda de hibernación por inactividad (ver HIBERNAR_INACTIVOS): el main decide con
   * lo que el renderer le dice que hay en pantalla y devuelve los proyectos hibernados.
   */
  hibernarInactivos: (req: PeticionHibernarInactivosAgente) => Promise<ResultadoHibernarInactivosAgente>
  /** El main paró el contenedor de otra cuenta por el límite o la saturación de Docker (ver PARADA_POR_LIMITE). */
  alPararPorLimite: (cb: (msg: ParadaPorLimite) => void) => () => void
  /** Ajustes, política y lo que se ve, para el vigía de la saturación (ver SATURACION_VIGIA). */
  configurarSaturacion: (config: VigiaSaturacionConfig) => void
  /** Aviso previo, cancelación o «nada que parar» del vigía (ver SATURACION_AVISO). */
  alAvisarSaturacion: (cb: (msg: AvisoSaturacion) => void) => () => void
  /** Durante el aviso, parar otro en vez del anunciado; false si no hay otro. */
  saturacionPararOtro: () => Promise<boolean>
  /** La constancia de las últimas paradas, la más reciente primero. */
  registroParadas: () => Promise<ConstanciaParada[]>
}

export const terminal: ApiTerminal = {
  abrir: (req) => ipcRenderer.invoke(TERMINAL_CHANNELS.OPEN, req),
  abrirSsh: (req) => ipcRenderer.invoke(TERMINAL_CHANNELS.OPEN_SSH, req),
  escribir: (msg) => ipcRenderer.send(TERMINAL_CHANNELS.WRITE, msg),
  redimensionar: (msg) => ipcRenderer.send(TERMINAL_CHANNELS.RESIZE, msg),
  fijarFlujo: (msg) => ipcRenderer.send(TERMINAL_CHANNELS.FLOW, msg),
  recargar: (sesionId, conexionDbIds) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.RELOAD, { sesionId, conexionDbIds } satisfies PeticionRecargarTerminal),
  cerrar: (sesionId) => ipcRenderer.invoke(TERMINAL_CHANNELS.CLOSE, { sesionId } satisfies PeticionCerrarTerminal),
  enMarcha: (perfilId) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.EN_MARCHA, { perfilId } satisfies PeticionTerminalesEnMarcha),
  alRecibirDatos: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, msg: MensajeDatosTerminal): void => cb(msg)
    ipcRenderer.on(TERMINAL_CHANNELS.DATA, oyente)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.DATA, oyente)
  },
  alSalir: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, msg: MensajeSalidaTerminal): void => cb(msg)
    ipcRenderer.on(TERMINAL_CHANNELS.EXIT, oyente)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.EXIT, oyente)
  }
}

/** Terminal del agente: mismos gestos que `terminal` pero sobre los canales hermanos. */
export const terminalAgente: ApiTerminalAgente = {
  abrir: (req) => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.OPEN, req),
  escribir: (msg) => ipcRenderer.send(AGENT_TERMINAL_CHANNELS.WRITE, msg),
  redimensionar: (msg) => ipcRenderer.send(AGENT_TERMINAL_CHANNELS.RESIZE, msg),
  fijarFlujo: (msg) => ipcRenderer.send(AGENT_TERMINAL_CHANNELS.FLOW, msg),
  recargar: (sesionId, conexionDbIds, conversacionReanudarId, manual) =>
    ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.RELOAD, {
      sessionId: sesionId,
      conexionDbIds,
      conversacionReanudarId,
      manual
    } satisfies PeticionRecargarAgente),
  cerrar: (sesionId) => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.CLOSE, { sesionId } satisfies PeticionCerrarAgente),
  guardarImagen: (sesionId) =>
    ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.SAVE_IMAGE, { sesionId } satisfies PeticionGuardarImagenAgente),
  prepararArchivo: (sesionId, rutaHost) =>
    ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.STAGE_FILE, { sesionId, rutaHost } satisfies PeticionPrepararArchivoAgente),
  alRecibirDatos: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, msg: MensajeDatosAgente): void => cb(msg)
    ipcRenderer.on(AGENT_TERMINAL_CHANNELS.DATA, oyente)
    return () => ipcRenderer.removeListener(AGENT_TERMINAL_CHANNELS.DATA, oyente)
  },
  alSalir: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, msg: MensajeSalidaAgente): void => cb(msg)
    ipcRenderer.on(AGENT_TERMINAL_CHANNELS.EXIT, oyente)
    return () => ipcRenderer.removeListener(AGENT_TERMINAL_CHANNELS.EXIT, oyente)
  },
  alCambiarActividad: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, msg: MensajeActividadAgente): void => cb(msg)
    ipcRenderer.on(AGENT_TERMINAL_CHANNELS.ACTIVITY, oyente)
    return () => ipcRenderer.removeListener(AGENT_TERMINAL_CHANNELS.ACTIVITY, oyente)
  },
  fotoActividad: () => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.ACTIVITY_SNAPSHOT),
  detenerVarias: (sesionIds) =>
    ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.DETENER_VARIAS, { sessionIds: sesionIds } satisfies PeticionDetenerVariosAgentes),
  hibernarInactivos: (req) => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.HIBERNAR_INACTIVOS, req),
  alPararPorLimite: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, msg: ParadaPorLimite): void => cb(msg)
    ipcRenderer.on(AGENT_TERMINAL_CHANNELS.PARADA_POR_LIMITE, oyente)
    return () => ipcRenderer.removeListener(AGENT_TERMINAL_CHANNELS.PARADA_POR_LIMITE, oyente)
  },
  configurarSaturacion: (config) => ipcRenderer.send(AGENT_TERMINAL_CHANNELS.SATURACION_VIGIA, config),
  alAvisarSaturacion: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, msg: AvisoSaturacion): void => cb(msg)
    ipcRenderer.on(AGENT_TERMINAL_CHANNELS.SATURACION_AVISO, oyente)
    return () => ipcRenderer.removeListener(AGENT_TERMINAL_CHANNELS.SATURACION_AVISO, oyente)
  },
  saturacionPararOtro: () => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.SATURACION_OTRO),
  registroParadas: () => ipcRenderer.invoke(AGENT_TERMINAL_CHANNELS.REGISTRO_PARADAS)
}
