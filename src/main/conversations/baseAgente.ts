// =============================================================================
// Carpeta host de credenciales de un (agente, cuenta): la `<base>` de la que leen el historial,
// el uso y el contexto (dentro viven `projects/…` de Claude y `sessions/…` de Codex).
// Depende de `AccountStore` solo por `get` y `hostDirFor`. Lo crea `agents/componer.ts` y lo usan los servicios.
// =============================================================================
import os from 'node:os'
import { join } from 'node:path'
import type { AccountStore } from '../agents/AccountStore'
import type { ConvAgent } from '../../shared/conversations-ipc'

/** Carpeta de credenciales de (agente, cuenta); `null` si la cuenta no existe o es de otro agente. */
export type BaseDeCuenta = (agente: ConvAgent, accountId: string, host: boolean) => string | null

/**
 * Base de un agente en modo nativo: el home real del usuario, respetando las variables que los
 * propios CLIs honran (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). Lee el entorno en cada llamada.
 */
export function baseNativaAgente(agente: ConvAgent): string {
  if (agente === 'codex') return process.env.CODEX_HOME?.trim() || join(os.homedir(), '.codex')
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(os.homedir(), '.claude')
}

/** Resuelve la base de una cuenta: la nativa en modo host, la de `AccountStore` en el resto. */
export function crearBaseDeCuenta(cuentas: Pick<AccountStore, 'get' | 'hostDirFor'>): BaseDeCuenta {
  return (agente, accountId, host) => {
    if (host) return baseNativaAgente(agente)
    const account = cuentas.get(accountId)
    if (!account || account.agente !== agente) return null
    return cuentas.hostDirFor(account)
  }
}
