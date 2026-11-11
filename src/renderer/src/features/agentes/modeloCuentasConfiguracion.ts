// =============================================================================
// Disponibilidad de cuentas, estado de su sesión y detección del inicio de sesión.
// Funciones puras para Configuración, comprobables sin React ni terminal.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc.ts'
import { txCuentasConfiguracion } from './textosCuentasConfiguracion.ts'

export function tieneCuentasDocker(modo: 'serie' | 'nativo' | 'docker'): boolean {
  return modo !== 'nativo'
}

export function sesionIniciada(cuentas: readonly AgentAccount[], id: string): boolean {
  return cuentas.some((cuenta) => cuenta.id === id && cuenta.conSesion === true)
}

export function estadoCuenta(cuenta: Pick<AgentAccount, 'conSesion'>): string {
  const t = txCuentasConfiguracion()
  if (cuenta.conSesion === undefined) return t.sinComprobar
  return cuenta.conSesion ? t.conSesion : t.sinSesion
}
