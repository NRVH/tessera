// =============================================================================
// Registro del canal IPC del contexto de la conversación (`CONTEXT_CHANNELS.GET`).
// El handler delega en `ServicioContexto`, que resuelve la carpeta de la cuenta y lee.
// Solo lo importa `src/main/agents/componer.ts`.
// =============================================================================
import type { IpcMain } from 'electron'
import type { ServicioContexto } from './ServicioContexto'
import { CONTEXT_CHANNELS, type ContextRequest } from '../../shared/context-ipc'

/** Registra GET. */
export function registrarIpcContexto(deps: {
  ipc: Pick<IpcMain, 'handle'>
  contexto: ServicioContexto
}): void {
  const { ipc, contexto } = deps
  ipc.handle(CONTEXT_CHANNELS.GET, (_e, req: ContextRequest) => contexto.leer(req))
}
