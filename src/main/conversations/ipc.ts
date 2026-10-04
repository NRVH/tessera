// =============================================================================
// Registro de los canales IPC del historial de conversaciones (`CONVERSATION_CHANNELS`).
// Cada handler delega en `ServicioConversaciones`, que lista, borra y renombra.
// Solo lo importa la raíz de composición `src/main/agents/componer.ts`.
// =============================================================================
import type { IpcMain } from 'electron'
import type { ServicioConversaciones } from './ServicioConversaciones'
import {
  CONVERSATION_CHANNELS,
  type DeleteConversationRequest,
  type ListConversationsRequest,
  type RenameConversationRequest
} from '../../shared/conversations-ipc'

/** Registra LIST, DELETE y RENAME; el orden de registro se conserva. */
export function registrarIpcConversaciones(deps: {
  ipc: Pick<IpcMain, 'handle'>
  conversaciones: ServicioConversaciones
}): void {
  const { ipc, conversaciones } = deps
  ipc.handle(CONVERSATION_CHANNELS.LIST, (_e, req: ListConversationsRequest) =>
    conversaciones.listar(req)
  )
  ipc.handle(CONVERSATION_CHANNELS.DELETE, (_e, req: DeleteConversationRequest) =>
    conversaciones.borrar(req)
  )
  ipc.handle(CONVERSATION_CHANNELS.RENAME, (_e, req: RenameConversationRequest) =>
    conversaciones.renombrar(req)
  )
}
