// =============================================================================
// IPC del sandbox: el prevuelo de la red del anfitrión, los recursos de Docker y «Actualizar agentes». Único sitio
// con `ipcMain` del dominio; valida la petición y delega. Solo lo importa `src/main/agentes/componer.ts`.
// Decisiones: docs/decisiones/sandbox/red-del-anfitrion.md
// =============================================================================
import type { IpcMain } from 'electron'
import type { Perfil } from '../perfiles/types.ts'
import type { EmisorEventos } from '../util/emisorEventos.ts'
import { SANDBOX_RED_CHANNELS, type PeticionPrevuelo } from '../../shared/sandbox-red-ipc.ts'
import { SANDBOX_ESTADO_CHANNELS } from '../../shared/sandbox-estado-ipc.ts'
import { AGENTS_UPDATE_CHANNELS, type ProgresoActualizacionAgentes, type ResultadoActualizacionAgentes, type EstadoAgentesDocker } from '../../shared/agents-update-ipc.ts'
import type { GestorSandbox } from './GestorSandbox.ts'
import { actualizarImagenAgentes } from './actualizarImagenAgentes.ts'

/**
 * Registra `SANDBOX_RED.PREVUELO`. `perfiles` es una función porque la lista se reasigna al
 * guardar perfiles: se lee al atender, no al registrar.
 */
export function registrarIpcRedSandbox(deps: {
  ipc: Pick<IpcMain, 'handle'>
  sandbox: GestorSandbox
  perfiles: () => Perfil[]
}): void {
  deps.ipc.handle(SANDBOX_RED_CHANNELS.PREVUELO, async (_e, req: PeticionPrevuelo) => {
    const perfiles = deps.perfiles()
    const p = perfiles.find((x) => x.id === req.perfilId)
    if (!p) throw new Error(`perfil desconocido: ${req.perfilId}`)
    return deps.sandbox.prevueloRedHost(p, perfiles, req.medirTrafico)
  })
  // Los recursos de Docker para el semáforo del límite: sin petición, nada que validar.
  deps.ipc.handle(SANDBOX_ESTADO_CHANNELS.RECURSOS, () => deps.sandbox.recursos())
}

/** Registra `AGENTS_UPDATE`: el progreso sale por `PROGRESS` como `{ line }`; una segunda petición se une a la que corre. */
export function registrarIpcActualizarAgentes(deps: {
  ipc: Pick<IpcMain, 'handle'>
  sandbox: GestorSandbox
  eventos: EmisorEventos
  antesDeParar: () => Promise<void>
  estado: () => Promise<EstadoAgentesDocker>
}): void {
  let enVuelo: Promise<ResultadoActualizacionAgentes> | null = null
  deps.ipc.handle(AGENTS_UPDATE_CHANNELS.RUN, (): Promise<ResultadoActualizacionAgentes> => {
    enVuelo ??= actualizarImagenAgentes(deps.sandbox, (linea) => deps.eventos.emitir(AGENTS_UPDATE_CHANNELS.PROGRESS, { line: linea } satisfies ProgresoActualizacionAgentes), deps.antesDeParar).finally(() => {
      enVuelo = null
    })
    return enVuelo
  })
  deps.ipc.handle(AGENTS_UPDATE_CHANNELS.ESTADO, () => deps.estado())
}
