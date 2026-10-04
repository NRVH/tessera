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
  type WriteTerminalMessage,
  type ResizeTerminalMessage,
  type FlowControlMessage,
  type ReloadTerminalRequest,
  type CloseTerminalRequest
} from '../../shared/terminal-ipc'

/** Registra los cinco `handle` y los tres `on` de la terminal; el orden de registro se conserva. */
export function registrarIpcTerminal(deps: {
  ipc: Pick<IpcMain, 'handle' | 'on'>
  terminales: TerminalController
}): void {
  const { ipc, terminales } = deps
  ipc.handle(TERMINAL_CHANNELS.OPEN, (_e, req: OpenTerminalRequest) => terminales.open(req))
  ipc.handle(TERMINAL_CHANNELS.BOOTSTRAP_SESSION, () => terminales.abrirArranque())
  ipc.on(TERMINAL_CHANNELS.WRITE, (_e, msg: WriteTerminalMessage) => terminales.escribir(msg))
  ipc.on(TERMINAL_CHANNELS.RESIZE, (_e, msg: ResizeTerminalMessage) => terminales.redimensionar(msg))
  ipc.on(TERMINAL_CHANNELS.FLOW, (_e, msg: FlowControlMessage) => terminales.flujo(msg))
  ipc.handle(TERMINAL_CHANNELS.RELOAD, (_e, req: ReloadTerminalRequest) =>
    terminales.reload(req.sessionId, req.dbConnectionIds)
  )
  ipc.handle(TERMINAL_CHANNELS.CLOSE, (_e, req: CloseTerminalRequest) =>
    terminales.close(req.sessionId)
  )
}
