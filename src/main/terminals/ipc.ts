// =============================================================================
// Registro de los canales IPC de la terminal de la interfaz (`TERMINAL_CHANNELS`).
// Cada handler solo traduce la petición y delega en `TerminalController`.
// Solo lo importa `src/main/agents/componer.ts`.
// =============================================================================
import type { IpcMain } from 'electron'
import type { TerminalController } from './TerminalController'
import {
  TERMINAL_CHANNELS,
  type OpenTerminalRequest,
  type OpenSshRequest,
  type WriteTerminalMessage,
  type ResizeTerminalMessage,
  type FlowControlMessage,
  type ReloadTerminalRequest,
  type CloseTerminalRequest
} from '../../shared/terminal-ipc'

/** Registra los seis `handle` y los tres `on` de la terminal; el orden de registro se conserva. */
export function registrarIpcTerminal(deps: {
  ipc: Pick<IpcMain, 'handle' | 'on'>
  terminales: TerminalController
  /** Espera a que termine el borrado en curso de ese perfil: una sesión abierta a mitad sería del perfil recreado. */
  esperarBorrado?: (profileId: unknown) => Promise<void>
}): void {
  const { ipc, terminales, esperarBorrado } = deps
  /** `abrir` tras el borrado en curso del perfil de la petición, si hay quien lo espere. */
  const trasBorrado = <T>(req: { profileId?: unknown } | undefined, abrir: () => T): T | Promise<T> =>
    esperarBorrado ? esperarBorrado(req?.profileId).then(abrir) : abrir()
  ipc.handle(TERMINAL_CHANNELS.OPEN, (_e, req: OpenTerminalRequest) => trasBorrado(req, () => terminales.open(req)))
  ipc.handle(TERMINAL_CHANNELS.BOOTSTRAP_SESSION, () => terminales.abrirArranque())
  ipc.on(TERMINAL_CHANNELS.WRITE, (_e, msg: WriteTerminalMessage) => terminales.escribir(msg))
  ipc.on(TERMINAL_CHANNELS.RESIZE, (_e, msg: ResizeTerminalMessage) => terminales.redimensionar(msg))
  ipc.on(TERMINAL_CHANNELS.FLOW, (_e, msg: FlowControlMessage) => terminales.flujo(msg))
  // Recargar relanza la shell (y en contenedor, lo levanta): espera al borrado del perfil DE LA SESIÓN.
  ipc.handle(TERMINAL_CHANNELS.RELOAD, (_e, req: ReloadTerminalRequest) =>
    trasBorrado({ profileId: terminales.perfilDeSesion(req?.sessionId) }, () => terminales.reload(req.sessionId, req.dbConnectionIds))
  )
  ipc.handle(TERMINAL_CHANNELS.CLOSE, (_e, req: CloseTerminalRequest) =>
    terminales.close(req.sessionId)
  )
  ipc.handle(TERMINAL_CHANNELS.OPEN_SSH, (_e, req: OpenSshRequest) => trasBorrado(req, () => terminales.abrirSsh(req)))
}
