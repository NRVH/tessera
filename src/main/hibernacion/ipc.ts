// =============================================================================
// IPC de la hibernación: registra `HIBERNATE.PROFILE` y delega en `ControladorHibernacion`.
// Único sitio con `ipcMain` del dominio; solo lo importa `src/main/agentes/componer.ts`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { HIBERNATE_CHANNELS, type PeticionHibernarPerfil } from '../../shared/hibernacion-ipc'
import type { ControladorHibernacion } from './ControladorHibernacion'

/** Registra la hibernación por perfil y lo deja dicho en su log. */
export function registrarIpcHibernacion(deps: {
  ipc: Pick<IpcMain, 'handle'>
  hibernacion: ControladorHibernacion
}): void {
  deps.ipc.handle(HIBERNATE_CHANNELS.PROFILE, (_e: IpcMainInvokeEvent, req: PeticionHibernarPerfil) =>
    deps.hibernacion.hibernarPerfil(req.perfilId)
  )
  deps.hibernacion.log('registrado')
}
