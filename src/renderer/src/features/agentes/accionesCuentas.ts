// =============================================================================
// Operaciones IPC compartidas de alta, renombre y retiro de cuentas.
// Notifica a los panes tras una mutación; Configuración usa un emisor sin registrar.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import type { IdAgente } from '../../../../shared/agentesManuales'
import { avisarRenombre, avisarRetiro, type PaneConCuenta } from './retiroDeCuentas'

/** Configuración avisa a todos los panes sin inscribirse como uno de ellos. */
export const EMISOR_CONFIGURACION: PaneConCuenta = {
  usa: () => false,
  alRetirar: () => {},
  alRenombrar: () => {}
}

export function crearCuenta(profileId: string, agente: IdAgente, nombre: string) {
  return window.tessera.agentAccounts.create({ profileId, agente, nombre })
}

export async function renombrarCuenta(id: string, nombre: string, yo: PaneConCuenta): Promise<void> {
  await window.tessera.agentAccounts.rename(id, nombre)
  avisarRenombre(id, yo)
}

export async function retirarCuenta(id: string, motivo: 'logout' | 'eliminada', yo: PaneConCuenta): Promise<void> {
  if (motivo === 'logout') await window.tessera.agentAccounts.logout(id)
  else await window.tessera.agentAccounts.remove(id)
  avisarRetiro(id, motivo, yo)
}
