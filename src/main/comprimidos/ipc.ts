// =============================================================================
// Canales IPC del diff de comprimidos (`COMPRIMIDOS_CHANNELS`): el único sitio del área con
// `ipcMain`. Cada handler pasa la petición a UN método de `ComprimidosService` y no decide
// nada. El orden de registro es el de siempre. Lo registra `src/main/index.ts`; la prueba de
// integración lo registra sobre un `ipcMain` falso para ejercitar el contrato real.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  COMPRIMIDOS_CHANNELS,
  type CompararRequest,
  type EntradaRequest
} from '../../shared/comprimidos-ipc.ts'
import type { ComprimidosService } from './ComprimidosService.ts'

type Ipc = Pick<IpcMain, 'handle'>

export function registrarIpcComprimidos({
  ipc,
  comprimidos
}: {
  ipc: Ipc
  comprimidos: ComprimidosService
}): void {
  ipc.handle(COMPRIMIDOS_CHANNELS.COMPARAR, (_e: IpcMainInvokeEvent, req: CompararRequest) =>
    comprimidos.comparar(req)
  )
  ipc.handle(COMPRIMIDOS_CHANNELS.ENTRADA, (_e: IpcMainInvokeEvent, req: EntradaRequest) =>
    comprimidos.entrada(req)
  )
}
