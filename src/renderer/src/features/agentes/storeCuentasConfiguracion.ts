// =============================================================================
// Estado de la sección de cuentas de una fila de Configuración.
// Store aislado por perfil y agente con lista, uso y diálogos abiertos.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { createStore } from 'zustand/vanilla'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import type { UsageSnapshot } from '../../../../shared/usage-ipc'
import type { ConfirmacionCuenta } from './controlesCuenta'

export interface EstadoCuentasConfiguracion {
  desplegado: boolean
  cuentas: AgentAccount[]
  usos: Record<string, UsageSnapshot | null>
  error: string | null
  creando: boolean
  editando: string | null
  confirmacion: ConfirmacionCuenta | null
  login: AgentAccount | null
}

export function crearStoreCuentasConfiguracion() {
  return createStore<EstadoCuentasConfiguracion>(() => ({
    desplegado: false, cuentas: [], usos: {}, error: null,
    creando: false, editando: null, confirmacion: null, login: null
  }))
}
