// =============================================================================
// IPC del sandbox: el prevuelo de la red del anfitrión y «Actualizar agentes». Único sitio
// con `ipcMain` del dominio; valida la petición y delega. Solo lo importa `src/main/agents/componer.ts`.
// Decisiones: docs/decisiones/sandbox/red-del-anfitrion.md
// =============================================================================
import type { IpcMain } from 'electron'
import type { Profile } from '../profiles/types.ts'
import type { EmisorEventos } from '../util/emisorEventos.ts'
import { SANDBOX_RED_CHANNELS, type PrevueloRequest } from '../../shared/sandbox-red-ipc.ts'
import { AGENTS_UPDATE_CHANNELS, type AgentsUpdateResult } from '../../shared/agents-update-ipc.ts'
import type { SandboxManager } from './SandboxManager.ts'
import { actualizarImagenAgentes } from './actualizarImagenAgentes.ts'

/**
 * Registra `SANDBOX_RED.PREVUELO`. `perfiles` es una función porque la lista se reasigna al
 * guardar perfiles: se lee al atender, no al registrar.
 */
export function registrarIpcRedSandbox(deps: {
  ipc: Pick<IpcMain, 'handle'>
  sandbox: SandboxManager
  perfiles: () => Profile[]
}): void {
  deps.ipc.handle(SANDBOX_RED_CHANNELS.PREVUELO, async (_e, req: PrevueloRequest) => {
    const profiles = deps.perfiles()
    const p = profiles.find((x) => x.id === req.profileId)
    if (!p) throw new Error(`perfil desconocido: ${req.profileId}`)
    return deps.sandbox.prevueloRedHost(p, profiles, req.medirTrafico)
  })
}

/** Registra `AGENTS_UPDATE.RUN`: el progreso sale por `AGENTS_UPDATE.PROGRESS` como `{ line }`. */
export function registrarIpcActualizarAgentes(deps: {
  ipc: Pick<IpcMain, 'handle'>
  sandbox: SandboxManager
  eventos: EmisorEventos
}): void {
  deps.ipc.handle(AGENTS_UPDATE_CHANNELS.RUN, (): Promise<AgentsUpdateResult> =>
    actualizarImagenAgentes(deps.sandbox, (line) => deps.eventos.emitir(AGENTS_UPDATE_CHANNELS.PROGRESS, { line }))
  )
}
