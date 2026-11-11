// =============================================================================
// Las cuentas de Docker en las que un perfil puede delegar, también las globales: las de Claude Code y Codex con su sesión
// iniciada en su carpeta del equipo. Lo usa el aviso de arranque (solo se anuncia `tctx delegar` si hay alguna)
// y la elección de cuenta. Solo mira el disco: no crea ni mueve nada.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTES_DELEGABLES, type AgenteDelegable } from '../../../shared/delegacion-ipc'
import type { AgentAccount } from '../../../shared/agent-accounts-ipc'
import type { AccountStore } from '../AccountStore'

/** El archivo que deja cada CLI al iniciar sesión, en la carpeta de la cuenta. */
const ARCHIVO_CREDENCIAL: Record<AgenteDelegable, string> = {
  'claude-code': '.credentials.json',
  codex: 'auth.json'
}

/** ¿Tiene la cuenta su sesión iniciada? */
export function conCredencial(accounts: Pick<AccountStore, 'hostDirFor'>, cuenta: AgentAccount): boolean {
  const agente = cuenta.agente as AgenteDelegable
  if (!AGENTES_DELEGABLES.includes(agente)) return false
  try {
    return existsSync(join(accounts.hostDirFor(cuenta), ARCHIVO_CREDENCIAL[agente]))
  } catch {
    return false
  }
}

/** Las cuentas de Claude Code y Codex que el perfil puede usar, con o sin sesión. */
export function cuentasDelPerfil(accounts: Pick<AccountStore, 'disponibles'>, profileId: string): AgentAccount[] {
  return AGENTES_DELEGABLES.flatMap((a) => accounts.disponibles(profileId, a))
}

/** ¿Hay alguna en la que delegar? */
export function hayCuentasParaDelegar(accounts: Pick<AccountStore, 'disponibles' | 'hostDirFor'>, profileId: string): boolean {
  return cuentasDelPerfil(accounts, profileId).some((c) => conCredencial(accounts, c))
}
