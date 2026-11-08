// =============================================================================
// Disponibilidad de cuentas, estado de uso y detección del inicio de sesión.
// Funciones puras para Configuración, comprobables sin React ni terminal.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc.ts'
import type { UsageSnapshot } from '../../../../shared/usage-ipc.ts'
import { formatoPorcentaje } from './formatoUso.ts'
import { txCuentasConfiguracion } from './textosCuentasConfiguracion.ts'

export function tieneCuentasDocker(modo: 'serie' | 'nativo' | 'docker'): boolean {
  return modo !== 'nativo'
}

export function sesionIniciada(cuentas: readonly AgentAccount[], id: string): boolean {
  return cuentas.some((cuenta) => cuenta.id === id && cuenta.conSesion === true)
}

/** La ventana con mayor consumo es la que limita la cuenta. */
export function estadoCuenta(cuenta: Pick<AgentAccount, 'conSesion'>, uso: Pick<UsageSnapshot, 'windows'> | null): string {
  const t = txCuentasConfiguracion()
  if (cuenta.conSesion === undefined) return t.sinComprobar
  if (!cuenta.conSesion) return t.sinSesion
  const ventana = uso?.windows.reduce<(NonNullable<typeof uso>['windows'])[number] | null>(
    (mayor, actual) => !mayor || actual.percent > mayor.percent ? actual : mayor, null)
  if (!ventana) return t.conSesion
  if (ventana.percent > 95) {
    const reinicio = ventana.resetsAt ? t.reinicio(new Date(ventana.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : ''
    return t.estado(t.agotada, reinicio)
  }
  return t.estado(t.conSesion, t.uso(ventana.label, formatoPorcentaje(ventana.percent)))
}
