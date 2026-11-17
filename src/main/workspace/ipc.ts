// =============================================================================
// Canales IPC del workspace: `WORKSPACE_CHANNELS` (diálogo de proyecto, proyecto activo, raíz
// del explorador, escaneo de repos) van a UN método de `ServicioWorkspace`; los de
// `WORKSPACE_STATE_CHANNELS` (`workspace-state.json`: esqueleto de pestañas y ajustes globales)
// van al almacén `workspaceStateStore`, y tras guardar ajustes se avisa a la raíz de
// composición, que es quien sabe a quién afectan. Único sitio del área con `ipcMain`; el orden
// de registro es el de siempre. Lo registra `index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import {
  WORKSPACE_CHANNELS,
  type PeticionEscanearRepos,
  type PeticionFijarProyectoActivo,
  type PeticionFijarRaizArchivos
} from '../../shared/workspace-ipc'
import {
  WORKSPACE_STATE_CHANNELS,
  type AjustesWorkspace,
  type EstadoWorkspace
} from '../../shared/workspace-state-ipc'
import type { ServicioWorkspace } from './ServicioWorkspace'
import {
  cargarSesionesProyecto,
  cargarAjustesWorkspace,
  cargarEstadoWorkspace,
  guardarSesionesProyecto,
  guardarAjustesWorkspace,
  guardarEstadoWorkspace
} from './almacenEstadoWorkspace'

type Ipc = Pick<IpcMain, 'handle'>

/** Los canales `workspace:*`, y lo deja dicho en el log del servicio. */
export function registrarIpcWorkspace(deps: { ipc: Ipc; workspace: ServicioWorkspace }): void {
  const { ipc, workspace } = deps
  ipc.handle(WORKSPACE_CHANNELS.OPEN_PROJECT_DIALOG, () => workspace.abrirDialogoProyecto())
  ipc.handle(
    WORKSPACE_CHANNELS.SET_ACTIVE_PROJECT,
    (_e: IpcMainInvokeEvent, req: PeticionFijarProyectoActivo) => workspace.fijarProyectoActivo(req)
  )
  ipc.handle(WORKSPACE_CHANNELS.SET_FILES_ROOT, (_e: IpcMainInvokeEvent, req: PeticionFijarRaizArchivos) =>
    workspace.fijarRaizArchivos(req)
  )
  ipc.handle(WORKSPACE_CHANNELS.SCAN_REPOS, (_e: IpcMainInvokeEvent, req: PeticionEscanearRepos) =>
    workspace.escanearRepos(req)
  )
  workspace.log('registrado')
}

/**
 * Los canales de `workspace-state.json`. `alGuardarAjustes` corre DESPUÉS de persistir, con los
 * ajustes y el emisor: este canal llega por todos los caminos por los que cambian los ajustes.
 */
export function registrarIpcEstadoWorkspace(deps: {
  ipc: Ipc
  alGuardarAjustes: (ajustes: AjustesWorkspace, emisor: WebContents) => void
}): void {
  const { ipc } = deps
  ipc.handle(WORKSPACE_STATE_CHANNELS.LOAD, () => cargarEstadoWorkspace())
  ipc.handle(WORKSPACE_STATE_CHANNELS.SAVE, (_e: IpcMainInvokeEvent, estado: EstadoWorkspace) => {
    guardarEstadoWorkspace(estado)
  })
  ipc.handle(WORKSPACE_STATE_CHANNELS.LOAD_SETTINGS, () => cargarAjustesWorkspace())
  ipc.handle(
    WORKSPACE_STATE_CHANNELS.SAVE_SETTINGS,
    (e: IpcMainInvokeEvent, ajustes: AjustesWorkspace) => {
      guardarAjustesWorkspace(ajustes)
      deps.alGuardarAjustes(ajustes, e.sender)
    }
  )
  ipc.handle(WORKSPACE_STATE_CHANNELS.LOAD_SESIONES, () => cargarSesionesProyecto())
  ipc.handle(WORKSPACE_STATE_CHANNELS.SAVE_SESIONES, (_e: IpcMainInvokeEvent, sesiones: unknown) => {
    guardarSesionesProyecto(sesiones)
  })
}
