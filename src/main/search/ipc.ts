// =============================================================================
// Canales IPC de la búsqueda en archivos (`SEARCH_CHANNELS`): el único sitio del área con
// `ipcMain`. Cada handler pasa la petición a UN método de `SearchService` y no decide nada. El
// orden de registro es el de siempre. Lo registra `index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  SEARCH_CHANNELS,
  type CancelarBusqueda,
  type CarpetasRequest,
  type IniciarBusqueda
} from '../../shared/search-ipc'
import type { SearchService } from './SearchService'

/** Registra arrancar, cancelar y listar carpetas, y lo deja dicho en el log del servicio. */
export function registrarIpcBusqueda(deps: {
  ipc: Pick<IpcMain, 'handle'>
  search: SearchService
}): void {
  const { ipc, search } = deps
  ipc.handle(SEARCH_CHANNELS.START, (_e: IpcMainInvokeEvent, req: IniciarBusqueda) =>
    search.iniciar(req)
  )
  ipc.handle(SEARCH_CHANNELS.CANCEL, (_e: IpcMainInvokeEvent, req: CancelarBusqueda) => {
    search.cancelar(req.busquedaId)
  })
  ipc.handle(SEARCH_CHANNELS.CARPETAS, (_e: IpcMainInvokeEvent, req: CarpetasRequest) =>
    search.listar(req)
  )
  search.log('registrado')
}
