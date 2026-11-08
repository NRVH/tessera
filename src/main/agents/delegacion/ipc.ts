// =============================================================================
// IPC del indicador de tareas delegadas: único sitio con `ipcMain` de la delegación. El renderer solo lista,
// cancela y descarta; las tareas se lanzan por `tctx`, nunca desde aquí. Solo lo importa `agents/componer.ts`.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import type { IpcMain } from 'electron'
import { DELEGACION_CHANNELS, type VistaTarea } from '../../../shared/delegacion-ipc'
import type { ServicioDelegacion } from './ServicioDelegacion'

const esId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v)

/** Registra los canales de `DELEGACION_CHANNELS` (el de cambios lo emite el servicio). */
export function registrarIpcDelegacion(deps: {
  ipc: Pick<IpcMain, 'handle'>
  servicio: Pick<ServicioDelegacion, 'vistas' | 'cancelar' | 'descartar'>
}): void {
  deps.ipc.handle(DELEGACION_CHANNELS.LISTAR, (): VistaTarea[] => deps.servicio.vistas())
  deps.ipc.handle(DELEGACION_CHANNELS.CANCELAR, async (_e, id: unknown): Promise<void> => {
    if (esId(id)) await deps.servicio.cancelar(null, id)
  })
  deps.ipc.handle(DELEGACION_CHANNELS.DESCARTAR, (_e, id: unknown): void => {
    if (esId(id)) deps.servicio.descartar(id)
  })
}
