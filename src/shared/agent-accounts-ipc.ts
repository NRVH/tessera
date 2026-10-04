// =============================================================================
// Contrato IPC de las cuentas de agente del modo contenedor (main <-> preload <-> renderer):
// como mucho una por (perfil, agente), privada del perfil; la cuenta solo decide qué
// credencial se monta, no el aislamiento del contenedor. Lo sirve `src/main/agents/ipc.ts`.
// Decisiones: docs/decisiones/agentes/cuentas-una-por-perfil-y-agente.md
// =============================================================================

import type { AgentKind } from './agent-terminal-ipc'

/** Una cuenta de agente (login con nombre), aislada a su perfil. Espejo del main. */
export interface AgentAccount {
  /** Id estable (uuid para las creadas; `default-<perfil>-<agente>` para la migrada). */
  id: string
  /** Nombre visible que pone el usuario ("Personal", "Trabajo"). */
  nombre: string
  agente: AgentKind
  /** Perfil dueño de la cuenta (siempre presente: toda cuenta es privada del perfil). */
  profileId: string
  /**
   * Cuenta migrada que apunta a la carpeta legacy `./.tessera/perfiles/<id>/<sub>`
   * (sin subcarpeta por cuenta), para no perder el login que ya existía. No editable
   * por el usuario; no se puede eliminar (se recrea vacía si se cierra sesión).
   */
  isDefault?: boolean
}

export const AGENT_ACCOUNT_CHANNELS = {
  /** invoke: la cuenta de (perfil, agente), o lista vacía si aún no hay ninguna. */
  LIST: 'agentAccounts:list',
  /** invoke: crea la cuenta (registro + carpeta vacía) y la devuelve. */
  CREATE: 'agentAccounts:create',
  /** invoke: cierra sesión (borra el/los archivo(s) de credencial; la cuenta queda). */
  LOGOUT: 'agentAccounts:logout',
  /** invoke: elimina la cuenta por completo (carpeta + registro). */
  DELETE: 'agentAccounts:delete'
} as const

export interface ListAccountsRequest {
  profileId: string
  agente: AgentKind
}

export interface CreateAccountRequest {
  /** Nombre visible; no vacío. */
  nombre: string
  agente: AgentKind
  /** Perfil dueño de la cuenta (toda cuenta es privada del perfil). */
  profileId: string
}

export interface LogoutAccountRequest {
  id: string
}

export interface DeleteAccountRequest {
  id: string
}
