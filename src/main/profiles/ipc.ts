// =============================================================================
// Canal IPC de los perfiles (`IPC_CHANNELS.GET_PROFILES`): el único sitio del área con
// `ipcMain`. Devuelve la lista viva que le da la raíz de composición (`SAVE_PROFILES` la reasigna
// y la clausura la lee al usarse). Lo registra `index.ts`.
// =============================================================================

import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { Profile } from './types'

export function registrarIpcPerfiles(deps: {
  ipc: Pick<IpcMain, 'handle'>
  perfiles: () => Profile[]
}): void {
  deps.ipc.handle(IPC_CHANNELS.GET_PROFILES, () => deps.perfiles())
}
