// =============================================================================
// Registro de los canales IPC del uso de cuenta: GET, WATCH y UNWATCH (`USAGE_CHANNELS`).
// El aviso `CHANGED` es un evento del main al renderer y lo compone `agents/componer.ts`.
// Solo lo importa esa raíz de composición.
// =============================================================================
import type { IpcMain } from 'electron'
import type { ServicioUso } from './ServicioUso'
import { USAGE_CHANNELS, type UsageRequest } from '../../shared/usage-ipc'

/** Registra GET, WATCH y UNWATCH; el orden de registro se conserva. */
export function registrarIpcUso(deps: { ipc: Pick<IpcMain, 'handle'>; uso: ServicioUso }): void {
  const { ipc, uso } = deps
  ipc.handle(USAGE_CHANNELS.GET, (_e, req: UsageRequest) => uso.leer(req))
  ipc.handle(USAGE_CHANNELS.WATCH, (_e, req: UsageRequest) => uso.vigilar(req))
  ipc.handle(USAGE_CHANNELS.UNWATCH, (_e, req: UsageRequest) => uso.dejarDeVigilar(req))
}
