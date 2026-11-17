// =============================================================================
// IPC de «Continuar en…»: único sitio con `ipcMain` del dominio del traspaso; la petición la valida y la
// atiende `ServicioTraspaso`. Solo lo importa `src/main/agentes/componer.ts`.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import type { IpcMain } from 'electron'
import { TRASPASO_CHANNELS, type ResultadoContinuarEn } from '../../shared/traspaso-ipc'
import type { ServicioTraspaso } from './ServicioTraspaso'

/** Registra los canales de `TRASPASO_CHANNELS`. */
export function registrarIpcTraspaso(deps: { ipc: Pick<IpcMain, 'handle'>; traspaso: Pick<ServicioTraspaso, 'continuarEn'> }): void {
  deps.ipc.handle(TRASPASO_CHANNELS.CONTINUAR_EN, (_e, req: unknown): Promise<ResultadoContinuarEn> => deps.traspaso.continuarEn(req))
}
