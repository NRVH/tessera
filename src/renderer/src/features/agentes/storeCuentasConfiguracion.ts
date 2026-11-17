// =============================================================================
// Estado de la sección de cuentas de una fila de Configuración.
// Store aislado por perfil y agente con la lista y los diálogos abiertos.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { createStore } from 'zustand/vanilla'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import type { ConfirmacionCuenta } from './controlesCuenta'

export interface EstadoCuentasConfiguracion {
  desplegado: boolean
  cuentas: CuentaAgente[]
  error: string | null
  creando: boolean
  editando: string | null
  confirmacion: ConfirmacionCuenta | null
  login: CuentaAgente | null
}

export function crearStoreCuentasConfiguracion() {
  return createStore<EstadoCuentasConfiguracion>(() => ({
    desplegado: false, cuentas: [], error: null,
    creando: false, editando: null, confirmacion: null, login: null
  }))
}
