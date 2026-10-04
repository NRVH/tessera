// =============================================================================
// Canales IPC de la descompilación de Java (`JAVA_CHANNELS`): el único sitio del área con
// `ipcMain`. Cada handler pasa la petición a UN método de `JavaService` y no decide nada. El
// orden de registro es el de siempre. Lo registra `src/main/index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { JAVA_CHANNELS, type DescompilarRequest } from '../../shared/java-ipc.ts'
import type { JavaService } from './JavaService.ts'

type Ipc = Pick<IpcMain, 'handle'>

export function registrarIpcJava({ ipc, java }: { ipc: Ipc; java: JavaService }): void {
  ipc.handle(JAVA_CHANNELS.DECOMPILE, (_e: IpcMainInvokeEvent, req: DescompilarRequest) =>
    java.descompilar(req)
  )
  ipc.handle(JAVA_CHANNELS.RUNTIMES, () => java.estado())
  ipc.handle(JAVA_CHANNELS.REDETECT, () => java.redetectar())
  ipc.handle(JAVA_CHANNELS.PICK_JAVA, () => java.elegirJava())
  ipc.handle(JAVA_CHANNELS.FORGET_JAVA, () => java.olvidarJava())
}
