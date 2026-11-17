// =============================================================================
// Canales IPC de la búsqueda en archivos (`SEARCH_CHANNELS`): el único sitio del área con
// `ipcMain`. Cada handler pasa la petición a UN método de `ServicioBusqueda` y no decide nada. El
// orden de registro es el de siempre. Lo registra `index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  SEARCH_CHANNELS,
  type CancelarBusqueda,
  type PeticionCarpetas,
  type IniciarBusqueda
} from '../../shared/busqueda-ipc'
import type { ServicioBusqueda } from './ServicioBusqueda'

/** Registra arrancar, cancelar y listar carpetas, y lo deja dicho en el log del servicio. */
export function registrarIpcBusqueda(deps: {
  ipc: Pick<IpcMain, 'handle'>
  busqueda: ServicioBusqueda
}): void {
  const { ipc, busqueda } = deps
  ipc.handle(SEARCH_CHANNELS.START, (_e: IpcMainInvokeEvent, req: IniciarBusqueda) =>
    busqueda.iniciar(req)
  )
  ipc.handle(SEARCH_CHANNELS.CANCEL, (_e: IpcMainInvokeEvent, req: CancelarBusqueda) => {
    busqueda.cancelar(req.busquedaId)
  })
  ipc.handle(SEARCH_CHANNELS.CARPETAS, (_e: IpcMainInvokeEvent, req: PeticionCarpetas) =>
    busqueda.listar(req)
  )
  busqueda.log('registrado')
}
