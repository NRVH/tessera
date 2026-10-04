// =============================================================================
// IPC de la hibernación: registra `HIBERNATE.PROFILE` y delega en `HibernationController`.
// Único sitio con `ipcMain` del dominio; solo lo importa `src/main/agents/componer.ts`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { HIBERNATE_CHANNELS, type HibernateProfileRequest } from '../../shared/hibernate-ipc'
import type { HibernationController } from './HibernationController'

/** Registra la hibernación por perfil y lo deja dicho en su log. */
export function registrarIpcHibernacion(deps: {
  ipc: Pick<IpcMain, 'handle'>
  hibernacion: HibernationController
}): void {
  deps.ipc.handle(HIBERNATE_CHANNELS.PROFILE, (_e: IpcMainInvokeEvent, req: HibernateProfileRequest) =>
    deps.hibernacion.hibernateProfile(req.profileId)
  )
  deps.hibernacion.log('registrado')
}
