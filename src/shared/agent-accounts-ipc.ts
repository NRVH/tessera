// =============================================================================
// Contrato IPC de las cuentas de agente del modo contenedor (main <-> preload <-> renderer):
// las privadas de un perfil y las globales, disponibles en todos, cada una con su carpeta de
// credenciales y su contenedor. Lo sirve `src/main/agents/ipc.ts`.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import type { IdAgente, IdAgenteManual } from './agentesManuales'

/** Una cuenta de agente (login con nombre), aislada a su perfil. Espejo del main. */
export interface AgentAccount {
  /** Id estable (uuid para las creadas; `default-<perfil>-<agente>` para la migrada). */
  id: string
  /** Nombre visible que pone el usuario ("Personal", "Trabajo"). */
  nombre: string
  /** Uno de serie o uno manual (`m-…`). */
  agente: IdAgente
  /** Perfil dueño de la cuenta; en una global, `PERFIL_CUENTAS_GLOBALES`. */
  profileId: string
  /** Disponible en todos los perfiles, con una sola carpeta y un solo contenedor. */
  global?: boolean
  /**
   * Cuenta migrada que apunta a la carpeta legacy `./.tessera/perfiles/<id>/<sub>`
   * (sin subcarpeta por cuenta), para no perder el login que ya existía. No editable
   * por el usuario; no se puede eliminar (se recrea vacía si se cierra sesión). La de un
   * agente manual (`CUENTA_AGENTE_MANUAL`) es su carpeta del perfil y no está en el registro.
   */
  isDefault?: boolean
  /**
   * Si la carpeta de la cuenta tiene la sesión iniciada (Claude Code y Codex). Solo lo trae la lista: lo mira el main
   * al listar, en el disco del equipo.
   */
  conSesion?: boolean
}

/**
 * El dueño de las cuentas globales y la base de sus contenedores. Lleva el separador de `perfilDeCuenta`, que ningún
 * id de perfil lleva, y vale como nombre de contenedor y de carpeta.
 */
export const PERFIL_CUENTAS_GLOBALES = 'cuentas--globales'

const PREFIJO_CUENTA_GLOBAL = 'global-'

/** El id de una cuenta global nueva. */
export function idCuentaGlobal(unico: string): string {
  return `${PREFIJO_CUENTA_GLOBAL}${unico}`
}

/** ¿Es el id de una cuenta global? Va en el id porque quien elige el contenedor solo conoce ese dato. */
export function esCuentaGlobal(id: string): boolean {
  return id.startsWith(PREFIJO_CUENTA_GLOBAL)
}

/** Lo más largo que puede ser el nombre de una cuenta: el main lo exige y el campo del renderer lo limita. */
export const MAX_NOMBRE_CUENTA = 40

export const AGENT_ACCOUNT_CHANNELS = {
  /** invoke: las cuentas de (perfil, agente), en orden de creación; vacía si aún no hay ninguna. */
  LIST: 'agentAccounts:list',
  /** invoke: crea una cuenta (registro + carpeta vacía) y la devuelve; lanza con un nombre repetido. */
  CREATE: 'agentAccounts:create',
  /** invoke: cambia el nombre visible y devuelve la cuenta; lanza con uno vacío o repetido, o en la predeterminada. */
  RENAME: 'agentAccounts:rename',
  /** invoke: cierra sesión (borra el/los archivo(s) de credencial; la cuenta queda). No en un agente manual. */
  LOGOUT: 'agentAccounts:logout',
  /** invoke: elimina la cuenta por completo (carpeta + registro). */
  DELETE: 'agentAccounts:delete',
  /** invoke: al eliminar un agente manual de Docker, cierra sus sesiones del perfil y borra sus cuentas y carpetas. */
  OLVIDAR_AGENTE_MANUAL: 'agentAccounts:olvidarAgenteManual'
} as const

export interface ListAccountsRequest {
  profileId: string
  agente: IdAgente
}

export interface CreateAccountRequest {
  /** Nombre visible; no vacío. */
  nombre: string
  agente: IdAgente
  /** Perfil desde el que se crea; en una global no la ata a él. */
  profileId: string
  /** Disponible en todos los perfiles: solo Claude Code y Codex. */
  global?: boolean
}

export interface RenameAccountRequest {
  id: string
  /** Nombre visible nuevo; no vacío. */
  nombre: string
}

export interface LogoutAccountRequest {
  id: string
}

export interface DeleteAccountRequest {
  id: string
}

export interface OlvidarAgenteManualRequest {
  profileId: string
  agente: IdAgenteManual
}
