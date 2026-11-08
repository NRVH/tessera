// =============================================================================
// IPC del contexto global de los agentes: leerlo, guardarlo y avisar a las ventanas de que cambió. Único sitio
// con `ipcMain` del dominio; lo registra `src/main/reglas/componer.ts`.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

import type { IpcMain } from 'electron'
import { CONTEXTO_CHANNELS } from '../../shared/contexto-ipc.ts'
import type { ContextoGlobal } from '../../shared/contexto.ts'
import type { EmisorEventos } from '../util/emisorEventos.ts'
import type { AlmacenContextoGlobal } from './contextoGlobal.ts'

export function registrarIpcContexto(d: { ipc: Pick<IpcMain, 'handle'>; almacen: AlmacenContextoGlobal; eventos: EmisorEventos }): void {
  d.ipc.handle(CONTEXTO_CHANNELS.LEER, (): ContextoGlobal => d.almacen.leer())
  d.ipc.handle(CONTEXTO_CHANNELS.GUARDAR, (_e, raw: unknown): ContextoGlobal => d.almacen.guardar(raw))
  d.almacen.alCambiar((c) => d.eventos.emitir(CONTEXTO_CHANNELS.CAMBIO, c))
}
