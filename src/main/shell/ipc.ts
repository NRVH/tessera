// =============================================================================
// Canales IPC de la integración con el sistema (`SHELL_WINDOWS_CHANNELS`,
// `SERVICIO_FINDER_CHANNELS` y `ESCRITORIO_LINUX_CHANNELS`): el único sitio del área con
// `ipcMain`. Cada handler pasa la petición a UNA función de la cola de aperturas o a UN método
// del servicio de su plataforma, y no decide nada. Orden de registro: aperturas, registro de
// Windows, Finder, escritorio de Linux. Lo registra `index.ts`.
// =============================================================================

import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  SHELL_WINDOWS_CHANNELS,
  type ProyectoAbierto,
  type TomarAperturasRequest
} from '../../shared/shell-windows-ipc'
import { SERVICIO_FINDER_CHANNELS } from '../../shared/servicio-finder-ipc'
import { ESCRITORIO_LINUX_CHANNELS } from '../../shared/escritorio-linux-ipc'
import type { EstadoIntegracion } from '../../shared/integracionShell'
import { conectarAvisoAperturas, tomarAperturas } from './aperturasPendientes'
import type { IntegracionShellService } from './IntegracionShellService'
import type { ServicioFinderService } from './ServicioFinderService'
import type { EscritorioLinuxService } from './EscritorioLinuxService'

export function registrarIpcShell(deps: {
  ipc: Pick<IpcMain, 'handle'>
  getWindow: () => BrowserWindow | null
  /** Los proyectos abiertos según lo persistido, mientras el renderer no restauró los suyos. */
  persistidos: () => readonly ProyectoAbierto[]
  integracionShell: IntegracionShellService
  servicioFinder: ServicioFinderService
  escritorioLinux: EscritorioLinuxService
}): void {
  const { ipc, integracionShell, servicioFinder, escritorioLinux } = deps
  // El empujón al renderer para que no sondee; perderlo no cuesta nada porque la cola sigue ahí.
  conectarAvisoAperturas(() => {
    const win = deps.getWindow()
    if (win === null || win.isDestroyed()) return
    win.webContents.send(SHELL_WINDOWS_CHANNELS.HAY_APERTURAS)
  })
  ipc.handle(
    SHELL_WINDOWS_CHANNELS.TOMAR_APERTURAS,
    (_e: IpcMainInvokeEvent, req: TomarAperturasRequest) => tomarAperturas(req, deps.persistidos)
  )
  ipc.handle(SHELL_WINDOWS_CHANNELS.INTEGRACION_ESTADO, () => integracionShell.estado())
  ipc.handle(
    SHELL_WINDOWS_CHANNELS.INTEGRACION_APLICAR,
    (_e: IpcMainInvokeEvent, pedido: EstadoIntegracion) => integracionShell.aplicar(pedido)
  )
  ipc.handle(SHELL_WINDOWS_CHANNELS.ABRIR_APPS_PREDETERMINADAS, () =>
    integracionShell.abrirAppsPredeterminadas()
  )
  ipc.handle(SERVICIO_FINDER_CHANNELS.ESTADO, () => servicioFinder.estado())
  ipc.handle(SERVICIO_FINDER_CHANNELS.APLICAR, (_e: IpcMainInvokeEvent, req: { activo: boolean }) =>
    servicioFinder.aplicar(req.activo === true)
  )
  ipc.handle(ESCRITORIO_LINUX_CHANNELS.ESTADO, () => escritorioLinux.estado())
  ipc.handle(ESCRITORIO_LINUX_CHANNELS.APLICAR, (_e: IpcMainInvokeEvent, req: { activo: boolean }) =>
    escritorioLinux.aplicar(req.activo === true)
  )
}
