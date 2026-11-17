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
  type PeticionTomarAperturas
} from '../../shared/shell-windows-ipc'
import { SERVICIO_FINDER_CHANNELS, type PeticionAplicarServicioFinder } from '../../shared/servicio-finder-ipc'
import { ESCRITORIO_LINUX_CHANNELS, type PeticionAplicarEscritorioLinux } from '../../shared/escritorio-linux-ipc'
import type { EstadoIntegracion } from '../../shared/integracionShell'
import { conectarAvisoAperturas, tomarAperturas } from './aperturasPendientes'
import type { ServicioIntegracionShell } from './ServicioIntegracionShell'
import type { ServicioAccionRapidaFinder } from './ServicioAccionRapidaFinder'
import type { ServicioEscritorioLinux } from './ServicioEscritorioLinux'

export function registrarIpcShell(deps: {
  ipc: Pick<IpcMain, 'handle'>
  ventana: () => BrowserWindow | null
  /** Los proyectos abiertos según lo persistido, mientras el renderer no restauró los suyos. */
  persistidos: () => readonly ProyectoAbierto[]
  integracionShell: ServicioIntegracionShell
  servicioFinder: ServicioAccionRapidaFinder
  escritorioLinux: ServicioEscritorioLinux
}): void {
  const { ipc, integracionShell, servicioFinder, escritorioLinux } = deps
  // El empujón al renderer para que no sondee; perderlo no cuesta nada porque la cola sigue ahí.
  conectarAvisoAperturas(() => {
    const ventanaActual = deps.ventana()
    if (ventanaActual === null || ventanaActual.isDestroyed()) return
    ventanaActual.webContents.send(SHELL_WINDOWS_CHANNELS.HAY_APERTURAS)
  })
  ipc.handle(
    SHELL_WINDOWS_CHANNELS.TOMAR_APERTURAS,
    (_e: IpcMainInvokeEvent, req: PeticionTomarAperturas) => tomarAperturas(req, deps.persistidos)
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
  ipc.handle(SERVICIO_FINDER_CHANNELS.APLICAR, (_e: IpcMainInvokeEvent, req: PeticionAplicarServicioFinder) =>
    servicioFinder.aplicar(req.activo === true)
  )
  ipc.handle(ESCRITORIO_LINUX_CHANNELS.ESTADO, () => escritorioLinux.estado())
  ipc.handle(ESCRITORIO_LINUX_CHANNELS.APLICAR, (_e: IpcMainInvokeEvent, req: PeticionAplicarEscritorioLinux) =>
    escritorioLinux.aplicar(req.activo === true)
  )
}
