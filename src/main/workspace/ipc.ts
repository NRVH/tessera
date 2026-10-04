// =============================================================================
// Canales IPC del workspace: `WORKSPACE_CHANNELS` (diálogo de proyecto, proyecto activo, raíz
// del explorador, escaneo de repos) van a UN método de `WorkspaceService`; los de
// `WORKSPACE_STATE_CHANNELS` (`workspace-state.json`: esqueleto de pestañas y ajustes globales)
// van al almacén `workspaceStateStore`, y tras guardar ajustes se avisa a la raíz de
// composición, que es quien sabe a quién afectan. Único sitio del área con `ipcMain`; el orden
// de registro es el de siempre. Lo registra `index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import {
  WORKSPACE_CHANNELS,
  type ScanReposRequest,
  type SetActiveProjectRequest,
  type SetFilesRootRequest
} from '../../shared/workspace-ipc'
import {
  WORKSPACE_STATE_CHANNELS,
  type WorkspaceSettings,
  type WorkspaceState
} from '../../shared/workspace-state-ipc'
import type { WorkspaceService } from './WorkspaceService'
import {
  loadWorkspaceSettings,
  loadWorkspaceState,
  saveWorkspaceSettings,
  saveWorkspaceState
} from './workspaceStateStore'

type Ipc = Pick<IpcMain, 'handle'>

/** Los canales `workspace:*`, y lo deja dicho en el log del servicio. */
export function registrarIpcWorkspace(deps: { ipc: Ipc; workspace: WorkspaceService }): void {
  const { ipc, workspace } = deps
  ipc.handle(WORKSPACE_CHANNELS.OPEN_PROJECT_DIALOG, () => workspace.openProjectDialog())
  ipc.handle(
    WORKSPACE_CHANNELS.SET_ACTIVE_PROJECT,
    (_e: IpcMainInvokeEvent, req: SetActiveProjectRequest) => workspace.setActiveProject(req)
  )
  ipc.handle(WORKSPACE_CHANNELS.SET_FILES_ROOT, (_e: IpcMainInvokeEvent, req: SetFilesRootRequest) =>
    workspace.setFilesRoot(req)
  )
  ipc.handle(WORKSPACE_CHANNELS.SCAN_REPOS, (_e: IpcMainInvokeEvent, req: ScanReposRequest) =>
    workspace.scanRepos(req)
  )
  workspace.log('registrado')
}

/**
 * Los canales de `workspace-state.json`. `alGuardarAjustes` corre DESPUÉS de persistir, con los
 * ajustes y el emisor: este canal llega por todos los caminos por los que cambian los ajustes.
 */
export function registrarIpcEstadoWorkspace(deps: {
  ipc: Ipc
  alGuardarAjustes: (settings: WorkspaceSettings, emisor: WebContents) => void
}): void {
  const { ipc } = deps
  ipc.handle(WORKSPACE_STATE_CHANNELS.LOAD, () => loadWorkspaceState())
  ipc.handle(WORKSPACE_STATE_CHANNELS.SAVE, (_e: IpcMainInvokeEvent, state: WorkspaceState) => {
    saveWorkspaceState(state)
  })
  ipc.handle(WORKSPACE_STATE_CHANNELS.LOAD_SETTINGS, () => loadWorkspaceSettings())
  ipc.handle(
    WORKSPACE_STATE_CHANNELS.SAVE_SETTINGS,
    (e: IpcMainInvokeEvent, settings: WorkspaceSettings) => {
      saveWorkspaceSettings(settings)
      deps.alGuardarAjustes(settings, e.sender)
    }
  )
}
