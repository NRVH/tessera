// =============================================================================
// profileDotState: estado visual del punto de cada perfil y de cada proyecto (color,
// gris o spinner). Puro (sin React): combina la hibernación en vuelo, el estado del
// modelo y el estado de las sesiones de agente (`AgentPaneStatus`, solo tipo).
// Prioridad por perfil: hibernating > hibernated > waking (booting) > active. El modelo
// manda sobre un 'live' obsoleto, porque matar el contenedor no siempre avisa al pane
// a tiempo; entrar a un perfil despierta su proyecto de forma síncrona (reductor) antes
// de que el agente pase a 'booting', así que el spinner de «despertar» sigue funcionando.
// =============================================================================

import type { EstadoProyecto, OpenAgentTarget } from './tabsModel'
import type { AgentPaneStatus } from '../agentes'

/** Estado visual de un dot (perfil o proyecto): color, gris o spinner. */
export type ProfileDotState = 'active' | 'hibernating' | 'hibernated' | 'waking'
/** Alias legible para el dot de PROYECTO (mismos estados). */
export type ProjectDotState = ProfileDotState

export interface DotStateInputs {
  /** Todos los perfiles (por id) para los que calcular estado. */
  profileIds: string[]
  /** Perfiles con hibernación de perfil en vuelo (IPC). */
  hibernatingProfiles: Set<string>
  /** Perfiles hibernados según el modelo (todos sus proyectos 'hibernated'). */
  hibernatedProfiles: Set<string>
  /** Targets de agente abiertos (para mapear status de sesión -> perfil). */
  targets: OpenAgentTarget[]
  /** Estado de la sesión de cada target abierto, indexado por target.key. */
  agentStatus: Record<string, AgentPaneStatus>
}

export function computeProfileDotStates(input: DotStateInputs): Record<string, ProfileDotState> {
  // Deriva, por perfil, si tiene alguna sesión ARRANCANDO ('booting') o VIVA ('live')
  // a partir del status de sus targets de agente abiertos.
  const booting = new Set<string>()
  const live = new Set<string>()
  for (const t of input.targets) {
    const s = input.agentStatus[t.key]
    if (s === 'booting') booting.add(t.profileId)
    else if (s === 'live') live.add(t.profileId)
  }

  const out: Record<string, ProfileDotState> = {}
  for (const id of input.profileIds) {
    if (input.hibernatingProfiles.has(id)) out[id] = 'hibernating'
    else if (input.hibernatedProfiles.has(id)) out[id] = 'hibernated' // modelo manda (gris)
    else if (booting.has(id)) out[id] = 'waking'
    else if (live.has(id)) out[id] = 'active'
    else out[id] = 'active'
  }
  return out
}

/** Un proyecto abierto para el cálculo del dot: su identidad + estado del modelo. */
export interface ProjectDotEntry {
  projectHostPath: string
  estado: EstadoProyecto
}

export interface ProjectDotInputs {
  /** Proyectos del perfil ACTIVO (los que pinta ProjectTabs). */
  projects: ProjectDotEntry[]
  /**
   * Estado de la sesión de agente por projectHostPath, YA resuelto por el llamador
   * (`usePuntosPerfil` mapea projectHostPath -> target.key -> agentStatus). Así este módulo no
   * importa `agentTargetKey` (valor) y sigue corriendo bajo node en los tests.
   */
  agentStatusByProject: Record<string, AgentPaneStatus>
}

/**
 * Estado del dot de cada PROYECTO del perfil activo: hibernated(modelo: cualquier
 * estado que no sea 'active', gris) > waking(booting, spinner) > active(verde). El
 * proyecto amanece 'hibernated' cuando su PERFIL se hibernó y 'agente-hibernado' cuando
 * su agente se cerró por inactividad; el estado del modelo manda sobre un 'live' stale
 * del keep-alive. No hay estado 'hibernating' por proyecto —el spinner en vuelo vive en
 * el dot de PERFIL—.
 */
export function computeProjectDotStates(input: ProjectDotInputs): Record<string, ProjectDotState> {
  const out: Record<string, ProjectDotState> = {}
  for (const p of input.projects) {
    const s = input.agentStatusByProject[p.projectHostPath]
    if (p.estado !== 'active') out[p.projectHostPath] = 'hibernated'
    else if (s === 'booting') out[p.projectHostPath] = 'waking'
    else if (s === 'live') out[p.projectHostPath] = 'active'
    else out[p.projectHostPath] = 'active'
  }
  return out
}
