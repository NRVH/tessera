// =============================================================================
// Las cuentas de Docker en las que un perfil puede delegar, también las globales: las de Claude Code y Codex con su sesión
// iniciada en su carpeta del equipo. Lo usa el aviso de arranque (solo se anuncia `tctx delegar` si hay alguna)
// y la elección de cuenta. Solo mira el disco: no crea ni mueve nada.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTES_DELEGABLES, type AgenteDelegable } from '../../../shared/delegacion-ipc'
import type { CuentaAgente } from '../../../shared/agent-accounts-ipc'
import type { AlmacenCuentas } from '../AlmacenCuentas'

/** El archivo que deja cada CLI al iniciar sesión, en la carpeta de la cuenta. */
const ARCHIVO_CREDENCIAL: Record<AgenteDelegable, string> = {
  'claude-code': '.credentials.json',
  codex: 'auth.json'
}

/** ¿Tiene la cuenta su sesión iniciada? */
export function conCredencial(cuentas: Pick<AlmacenCuentas, 'dirHostDe'>, cuenta: CuentaAgente): boolean {
  const agente = cuenta.agente as AgenteDelegable
  if (!AGENTES_DELEGABLES.includes(agente)) return false
  try {
    return existsSync(join(cuentas.dirHostDe(cuenta), ARCHIVO_CREDENCIAL[agente]))
  } catch {
    return false
  }
}

/** Las cuentas de Claude Code y Codex que el perfil puede usar, con o sin sesión. */
export function cuentasDelPerfil(cuentas: Pick<AlmacenCuentas, 'disponibles'>, perfilId: string): CuentaAgente[] {
  return AGENTES_DELEGABLES.flatMap((a) => cuentas.disponibles(perfilId, a))
}

/** ¿Hay alguna en la que delegar? */
export function hayCuentasParaDelegar(cuentas: Pick<AlmacenCuentas, 'disponibles' | 'dirHostDe'>, perfilId: string): boolean {
  return cuentasDelPerfil(cuentas, perfilId).some((c) => conCredencial(cuentas, c))
}
