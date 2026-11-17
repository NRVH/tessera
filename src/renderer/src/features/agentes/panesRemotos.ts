// =============================================================================
// Los panes de las ventanas de agente vistos desde la actualización nativa, que corre en la
// ventana principal: una API como la de un pane propio cuyas órdenes (preparar, relanzar,
// soltar) viajan por el main a la ventana dueña de la sesión. Así sus sesiones entran en el lote
// como las de la columna. Puro: el envío entra por parámetro (`test-panes-remotos.mts`).
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import type { EstadoAgentesNativos } from '../../../../shared/agentes-nativos-ipc.ts'
import { PERFIL_VENTANA_AGENTE, type PeticionPaneRemoto, type RespuestaPaneRemoto } from '../../../../shared/ventana-agente-ipc.ts'
import type { ApiPaneAgente } from './tipos.ts'

/** Cómo se manda una orden a la ventana dueña (en la app, `window.tessera.ventanaAgente.paneRemoto`). */
export type PedirPaneRemoto = (req: PeticionPaneRemoto) => Promise<RespuestaPaneRemoto['resultado']>

/**
 * Las APIs de las sesiones de ventanas de agente que la foto conoce y ningún pane propio tiene: las
 * de la columna mandan sobre su sesión, y un pane remoto nunca suplanta a uno local.
 */
export function panesRemotos(estado: EstadoAgentesNativos | null, locales: readonly ApiPaneAgente[], pedir: PedirPaneRemoto): ApiPaneAgente[] {
  if (!estado) return []
  const propias = new Set<string>()
  for (const api of locales) {
    try {
      const id = api.sesionId()
      if (id) propias.add(id)
    } catch {
      // Un pane desmontándose a medias no cuenta.
    }
  }
  return estado.sesiones
    .filter((s) => s.perfilId === PERFIL_VENTANA_AGENTE && !propias.has(s.sesionId))
    .map((s): ApiPaneAgente => {
      const orden = (accion: 'preparar' | 'liberar'): void => {
        void pedir({ sessionId: s.sesionId, accion }).catch(() => null)
      }
      return {
        clave: `${s.perfilId}|${s.rutaHostProyecto}|${s.agente}`,
        agente: s.agente,
        perfilId: s.perfilId,
        rutaHostProyecto: s.rutaHostProyecto,
        sesionId: () => s.sesionId,
        modoNativo: () => true,
        preparar: () => orden('preparar'),
        liberar: () => orden('liberar'),
        relanzar: async ({ banner, error }) => {
          const r = await pedir({ sessionId: s.sesionId, accion: 'relanzar', banner, ...(error ? { error } : {}) }).catch(() => 'fallo' as const)
          return r ?? 'fallo'
        },
        // La hibernación por inactividad no toca las ventanas de agente: no hay nada que fijar.
        reanudarCon: () => {},
        reanudarSiHuboDesde: () => {}
      }
    })
}
