// =============================================================================
// Qué enseña el selector de cuenta del agente (su popover): la cuenta del sistema, si el agente puede
// correr nativo, y sus cuentas de Docker, cada una marcada si es la que usa y con las acciones que
// admite (cerrar sesión, eliminar). Puro: lo prueba `test-selector-cuenta.mts`; `PopoverCuenta.tsx`
// lo pinta.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md, docs/decisiones/agentes/modo-por-agente.md
// =============================================================================

import type { AgentAccount } from '../../../../shared/agent-accounts-ipc.ts'
import { esAgenteManual } from '../../../../shared/agentesManuales.ts'

/** La cuenta del sistema en el selector: no se ofrece, se ofrece, o es la que usa el agente. */
export type NativaEnSelector = 'no' | 'disponible' | 'actual'

/** Una cuenta de Docker en el selector. */
export interface FilaCuenta {
  cuenta: AgentAccount
  actual: boolean
  /** Un agente manual no lo ofrece: Tessera no sabe qué archivos son su credencial. */
  puedeCerrarSesion: boolean
  /** La predeterminada no se renombra: su nombre es el del idioma de la interfaz. */
  puedeRenombrar: boolean
  /** La predeterminada no se elimina. */
  puedeEliminar: boolean
}

export interface VistaSelectorCuenta {
  /** La tarjeta de la cuenta del sistema; null si el agente no puede correr nativo. */
  nativa: { actual: boolean } | null
  docker: FilaCuenta[]
}

/**
 * El nombre que se enseña de una cuenta: el de la predeterminada es de la interfaz, en su idioma
 * (el registro guarda uno fijo); el de las demás, el que puso el usuario.
 */
export function nombreVisible(cuenta: AgentAccount, predeterminada: string): string {
  return cuenta.isDefault ? predeterminada : cuenta.nombre
}

/**
 * La vista del selector. `actual` es la cuenta de Docker en uso, o null si el agente corre nativo o aún
 * no tiene; sale aunque la lista vaya un paso por detrás de una recién creada.
 */
export function vistaSelectorCuenta(
  cuentas: readonly AgentAccount[],
  actual: AgentAccount | null,
  nativa: NativaEnSelector = 'no'
): VistaSelectorCuenta {
  const lista = actual === null || cuentas.some((c) => c.id === actual.id) ? cuentas : [...cuentas, actual]
  return {
    nativa: nativa === 'no' ? null : { actual: nativa === 'actual' },
    // Cualquiera se administra, no solo la que usa: si otro pane la tiene abierta, el diálogo lo avisa
    // y ese pane la suelta (`retiroDeCuentas.ts`).
    docker: lista.map((c) => ({
      cuenta: c,
      actual: nativa !== 'actual' && c.id === actual?.id,
      puedeCerrarSesion: !esAgenteManual(c.agente),
      puedeRenombrar: !c.isDefault,
      puedeEliminar: !c.isDefault
    }))
  }
}
