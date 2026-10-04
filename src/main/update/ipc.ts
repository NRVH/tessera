// =============================================================================
// Canales IPC de la actualización (`UPDATE_CHANNELS`): el único sitio del área con `ipcMain`.
// Cada handler pasa la petición a UN método de `peticionesUpdate` (`AutoUpdate.ts`) y no
// decide nada. El orden de registro es el de siempre. Lo registra `index.ts` justo ANTES de
// `initAutoUpdate`, como siempre: un fallo al sembrar o cablear no deja al renderer sin canales.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { UPDATE_CHANNELS, type AvisoDescartable, type UpdateState } from '../../shared/update-ipc'
import type { PeticionesUpdate } from './AutoUpdate'

type Ipc = Pick<IpcMain, 'handle'>

export function registrarIpcUpdate(ipc: Ipc, update: PeticionesUpdate): void {
  ipc.handle(UPDATE_CHANNELS.GET_STATE, (): UpdateState => update.estado())
  ipc.handle(UPDATE_CHANNELS.CHECK, (): Promise<UpdateState> => update.comprobar())
  ipc.handle(UPDATE_CHANNELS.INSTALL, (): Promise<void> => update.instalar())
  ipc.handle(UPDATE_CHANNELS.DISMISS, (_e: IpcMainInvokeEvent, que: AvisoDescartable): void =>
    update.descartar(que)
  )
  ipc.handle(UPDATE_CHANNELS.OPEN_LOG, (): Promise<void> => update.abrirRegistro())
}
