// =============================================================================
// Store de los agentes: agente y cuenta elegidos, estado de sesión que reportan los
// panes, actividad (trabajando / terminó sin ver), qué targets tienen agente vivo y los
// hibernados que no son pestaña.
// Los efectos que lo alimentan viven en useAgentesApp y useActividadAgentes. Una acción
// que no cambia nada devuelve el mismo estado: con `{}` se avisaría a todos los oyentes.
// =============================================================================
import { create } from 'zustand'
import type { Agente } from '../../../../main/profiles/types'
import type { AgentPaneStatus } from './agentPaneTipos'
import { emptyActivityState, type ActivityState } from './agentActivity.ts'

/** Estado de los agentes de todos los perfiles. */
export interface EstadoAgentes {
  /** Agente elegido por perfil; sin entrada, el primero disponible. */
  selectedAgentByProfile: Record<string, Agente>
  /** Cuenta elegida por target de agente; se persiste. */
  accountByTarget: Record<string, string | null>
  agentStatus: Record<string, AgentPaneStatus>
  activity: ActivityState
  /** Targets con un agente de verdad en marcha, según los propios panes. */
  vivos: ReadonlySet<string>
  /** Cada incremento abre el panel del botón de agentes nativos. */
  tokenAbrirAgentes: number
  /**
   * Targets que NO son pestaña (el agente de datos y el de la terminal) cuya sesión cerró el main al
   * hibernar su perfil. Las pestañas lo llevan en su modelo; estos, aquí.
   */
  hibernadosFueraDePestanas: ReadonlySet<string>
}

/** Estado de los agentes. */
export const useStoreAgentes = create<EstadoAgentes>()(() => ({
  selectedAgentByProfile: {},
  accountByTarget: {},
  agentStatus: {},
  activity: emptyActivityState,
  vivos: new Set(),
  tokenAbrirAgentes: 0,
  hibernadosFueraDePestanas: new Set()
}))

/** Elige el agente de un perfil. */
export function selectAgent(profileId: string, agente: Agente): void {
  useStoreAgentes.setState((s) =>
    s.selectedAgentByProfile[profileId] === agente
      ? s
      : { selectedAgentByProfile: { ...s.selectedAgentByProfile, [profileId]: agente } }
  )
}

/** Elige la cuenta de un target de agente. */
export function selectAccount(targetKey: string, accountId: string | null): void {
  useStoreAgentes.setState((s) =>
    s.accountByTarget[targetKey] === accountId
      ? s
      : { accountByTarget: { ...s.accountByTarget, [targetKey]: accountId } }
  )
}

/** Anota el estado de sesión que reporta un pane (sin cambios si es el mismo). */
export function handleTargetStatus(key: string, status: AgentPaneStatus): void {
  useStoreAgentes.setState((s) =>
    s.agentStatus[key] === status ? s : { agentStatus: { ...s.agentStatus, [key]: status } }
  )
}

/** Anota si un target tiene un agente vivo (sin cambios si ya lo decía). */
export function handleTargetVivo(key: string, vivo: boolean): void {
  useStoreAgentes.setState((s) => {
    if (s.vivos.has(key) === vivo) return s
    const next = new Set(s.vivos)
    if (vivo) next.add(key)
    else next.delete(key)
    return { vivos: next }
  })
}

/** Aplica una transformación pura al estado de actividad. */
export function actualizarActividad(f: (s: ActivityState) => ActivityState): void {
  useStoreAgentes.setState((s) => ({ activity: f(s.activity) }))
}

/**
 * Aplica una transformación pura (las de `hibernacionFueraDePestanas.ts`) a los targets que no son
 * pestaña marcados como hibernados. Sin cambio (mismo conjunto), no avisa a nadie.
 */
export function actualizarHibernadosFueraDePestanas(f: (m: ReadonlySet<string>) => ReadonlySet<string>): void {
  useStoreAgentes.setState((s) => {
    const m = f(s.hibernadosFueraDePestanas)
    return m === s.hibernadosFueraDePestanas ? s : { hibernadosFueraDePestanas: m }
  })
}
