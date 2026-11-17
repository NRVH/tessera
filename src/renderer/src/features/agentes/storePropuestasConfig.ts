// =============================================================================
// Store de las propuestas de configuración que dejan los agentes con `tctx config proponer`: las pendientes,
// tal como las tiene el main, y la que se revisa. Lo leen `CapaPropuestasConfig` y la sección de Docker del
// diálogo del contexto, que avisa de la pendiente de su nivel aunque la notificación ya se haya ido.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================
import { create } from 'zustand'
import type { AgenteConConfig, CapaCompartida, PropuestaConfig } from '../../../../shared/configAgente-ipc.ts'

interface EstadoPropuestasConfig {
  pendientes: readonly PropuestaConfig[]
  /** La propuesta que se revisa, o `null`. */
  abierta: PropuestaConfig | null
}

export const useStorePropuestasConfig = create<EstadoPropuestasConfig>()(() => ({ pendientes: [], abierta: null }))

/** La pendiente más reciente para una capa y un agente, o `null`. En el global puede haber una por perfil. */
export function propuestaPara(pendientes: readonly PropuestaConfig[], capa: CapaCompartida, agente: AgenteConConfig): PropuestaConfig | null {
  let ultima: PropuestaConfig | null = null
  for (const p of pendientes) {
    if (p.agente !== agente || p.nivel !== capa.tipo) continue
    if (capa.tipo === 'perfil' && p.profileId !== capa.perfilId) continue
    if (!ultima || p.en > ultima.en) ultima = p
  }
  return ultima
}

/** Vuelve a pedir las pendientes al main; resuelve con ellas. */
export async function refrescarPropuestasConfig(): Promise<readonly PropuestaConfig[]> {
  const lista = await window.tessera.configAgente.propuestas()
  useStorePropuestasConfig.setState({ pendientes: lista })
  return lista
}

export function revisarPropuestaConfig(p: PropuestaConfig): void {
  useStorePropuestasConfig.setState({ abierta: p })
}

/** Cierra la revisión y refresca las pendientes: si se resolvió, ya no está. */
export function cerrarPropuestaConfig(): void {
  useStorePropuestasConfig.setState({ abierta: null })
  void refrescarPropuestasConfig().catch(() => undefined)
}
