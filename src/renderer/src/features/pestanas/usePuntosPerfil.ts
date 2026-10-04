// =============================================================================
// Estado visual de los puntos de la banda: por perfil (hibernando, hibernado o
// activo) y por proyecto del perfil activo, con el estado de sesión del agente que
// muestra la columna. La lógica pura vive en profileDotState.ts.
// =============================================================================
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { computeProfileDotStates, computeProjectDotStates } from './profileDotState'
import { agentTargetKey } from './tabsModel'
import type { UseTabs } from './useTabs'
import { resolveSelectedAgent, useStoreAgentes, type AgentPaneStatus } from '../agentes'

/** Puntos de perfil y de proyecto de la banda. */
export function usePuntosPerfil(tabs: UseTabs): {
  profileDotStates: ReturnType<typeof computeProfileDotStates>
  projectDotStates: ReturnType<typeof computeProjectDotStates>
} {
  const { agentStatus, selectedAgentByProfile } = useStoreAgentes(
    useShallow((s) => ({ agentStatus: s.agentStatus, selectedAgentByProfile: s.selectedAgentByProfile }))
  )
  const profileDotStates = useMemo(
    () =>
      computeProfileDotStates({
        profileIds: tabs.profiles.map((p) => p.id),
        hibernatingProfiles: tabs.hibernatingProfiles,
        hibernatedProfiles: tabs.hibernatedProfiles,
        targets: tabs.allOpenTargets,
        agentStatus
      }),
    [tabs.profiles, tabs.hibernatingProfiles, tabs.hibernatedProfiles, tabs.allOpenTargets, agentStatus]
  )
  const projectDotStates = useMemo(() => {
    const agentStatusByProject: Record<string, AgentPaneStatus> = {}
    const ap = tabs.activeProfile
    // El mismo agente que muestra la columna.
    const agente = resolveSelectedAgent(ap?.id ?? null, selectedAgentByProfile)
    if (ap && agente) {
      for (const proj of tabs.openProjects) {
        const s = agentStatus[agentTargetKey(ap.id, proj.projectHostPath, agente)]
        if (s) agentStatusByProject[proj.projectHostPath] = s
      }
    }
    return computeProjectDotStates({ projects: tabs.openProjects, agentStatusByProject })
  }, [tabs.openProjects, tabs.activeProfile, agentStatus, selectedAgentByProfile])
  return { profileDotStates, projectDotStates }
}
