// =============================================================================
// Carpeta host de credenciales de un (agente, cuenta): la `<base>` de la que leen el historial,
// el uso y el contexto (dentro viven `projects/…` de Claude y `sessions/…` de Codex).
// Depende de `AlmacenCuentas` solo por `obtener` y `dirHostDe`. Lo crea `agentes/componer.ts` y lo usan los servicios.
// =============================================================================
import os from 'node:os'
import { join } from 'node:path'
import type { AlmacenCuentas } from '../agentes/AlmacenCuentas'
import type { AgenteConversacion } from '../../shared/conversations-ipc'
import { CARPETA_NATIVA_AGENTE } from '../../shared/configAgente-ipc.ts'

/** Carpeta de credenciales de (agente, cuenta); `null` si la cuenta no existe o es de otro agente. */
export type BaseDeCuenta = (agente: AgenteConversacion, cuentaId: string, host: boolean) => string | null

/**
 * Base de un agente en modo nativo: el home real del usuario, respetando las variables que los
 * propios CLIs honran (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). Lee el entorno en cada llamada.
 */
export function baseNativaAgente(agente: AgenteConversacion): string {
  if (agente === 'codex') return process.env.CODEX_HOME?.trim() || join(os.homedir(), CARPETA_NATIVA_AGENTE.codex)
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(os.homedir(), CARPETA_NATIVA_AGENTE['claude-code'])
}

/** Resuelve la base de una cuenta: la nativa en modo host, la de `AccountStore` en el resto. */
export function crearBaseDeCuenta(cuentas: Pick<AlmacenCuentas, 'obtener' | 'dirHostDe'>): BaseDeCuenta {
  return (agente, cuentaId, host) => {
    if (host) return baseNativaAgente(agente)
    const cuenta = cuentas.obtener(cuentaId)
    if (!cuenta || cuenta.agente !== agente) return null
    return cuentas.dirHostDe(cuenta)
  }
}

/** Como `crearBaseDeCuenta`, para quien solo lee: no crea ni mueve carpetas (`AccountStore.rutaDe`). */
export function crearBaseDeCuentaDeLectura(cuentas: Pick<AlmacenCuentas, 'obtener' | 'rutaDe'>): BaseDeCuenta {
  return (agente, cuentaId, host) => {
    if (host) return baseNativaAgente(agente)
    const cuenta = cuentas.obtener(cuentaId)
    if (!cuenta || cuenta.agente !== agente) return null
    return cuentas.rutaDe(cuenta)
  }
}
