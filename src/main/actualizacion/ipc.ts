// =============================================================================
// Canales IPC de la actualización (`UPDATE_CHANNELS`): el único sitio del área con `ipcMain`.
// Cada handler pasa la petición a UN método de `peticionesActualizacion` (`actualizacionAutomatica.ts`) y no
// decide nada. El orden de registro es el de siempre. Lo registra `index.ts` justo ANTES de
// `iniciarActualizacionAutomatica`, como siempre: un fallo al sembrar o cablear no deja al renderer sin canales.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { UPDATE_CHANNELS, type AvisoDescartable, type EstadoActualizacion } from '../../shared/update-ipc'
import type { PeticionesActualizacion } from './actualizacionAutomatica'

type Ipc = Pick<IpcMain, 'handle'>

export function registrarIpcActualizacion(ipc: Ipc, actualizacion: PeticionesActualizacion): void {
  ipc.handle(UPDATE_CHANNELS.GET_STATE, (): EstadoActualizacion => actualizacion.estado())
  ipc.handle(UPDATE_CHANNELS.CHECK, (): Promise<EstadoActualizacion> => actualizacion.comprobar())
  ipc.handle(UPDATE_CHANNELS.INSTALL, (): Promise<void> => actualizacion.instalar())
  ipc.handle(UPDATE_CHANNELS.DISMISS, (_e: IpcMainInvokeEvent, que: AvisoDescartable): void =>
    actualizacion.descartar(que)
  )
  ipc.handle(UPDATE_CHANNELS.OPEN_LOG, (): Promise<void> => actualizacion.abrirRegistro())
}
