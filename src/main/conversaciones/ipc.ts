// =============================================================================
// Registro de los canales IPC del historial de conversaciones (`CONVERSATION_CHANNELS`).
// Cada handler delega en `ServicioConversaciones`, que lista, borra y renombra.
// Solo lo importa la raíz de composición `src/main/agentes/componer.ts`.
// =============================================================================
import type { IpcMain } from 'electron'
import type { ServicioConversaciones } from './ServicioConversaciones'
import {
  CONVERSATION_CHANNELS,
  type PeticionBorrarConversacion,
  type PeticionListarConversaciones,
  type PeticionRenombrarConversacion
} from '../../shared/conversations-ipc'

/** Registra LIST, DELETE y RENAME; el orden de registro se conserva. */
export function registrarIpcConversaciones(deps: {
  ipc: Pick<IpcMain, 'handle'>
  conversaciones: ServicioConversaciones
}): void {
  const { ipc, conversaciones } = deps
  ipc.handle(CONVERSATION_CHANNELS.LIST, (_e, req: PeticionListarConversaciones) =>
    conversaciones.listar(req)
  )
  ipc.handle(CONVERSATION_CHANNELS.DELETE, (_e, req: PeticionBorrarConversacion) =>
    conversaciones.borrar(req)
  )
  ipc.handle(CONVERSATION_CHANNELS.RENAME, (_e, req: PeticionRenombrarConversacion) =>
    conversaciones.renombrar(req)
  )
}
