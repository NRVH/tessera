// =============================================================================
// Actividad de los agentes de todos los perfiles: se suscribe a los cambios del
// main, se resincroniza al montar y al recuperar el foco, marca visto lo que de
// verdad se está mirando y poda lo de targets cerrados o hibernados.
// El modelo (estado pegajoso «terminó sin ver») vive en agentActivity.ts.
// =============================================================================
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Agente } from '../../../../main/profiles/types'
import {
  applyActivity,
  clearActivityKeys,
  markSeen,
  pruneActivity,
  sincronizarActividad,
  type ActivityState,
  type AgentWork
} from './agentActivity'
import { actualizarActividad, useStoreAgentes } from './store'
import type { AgentesApp } from './useAgentesApp'
import { agentTargetKey, type OpenAgentTarget, type UseTabs } from '../pestanas'
import { claveVista, useStoreMosaico } from '../mosaico'

/** Actividad y atención por perfil. */
export interface ActividadAgentes {
  activity: ActivityState
  /** Claves que trabajan ahora. */
  trabajandoSet: Set<string>
  activityAttention: { unseenProfiles: Set<string>; workingProfiles: Set<string> }
}

/** Qué se está mirando AHORA: la regla única de «visto» (suscripción y marca). */
function useClaveVista(tabs: UseTabs, agentes: AgentesApp, ccHidden: boolean): string | null {
  const { mosaicoActivo, enfocada, teselas } = useStoreMosaico(
    useShallow((s) => ({ mosaicoActivo: s.mosaicoActivo, enfocada: s.enfocada, teselas: s.teselas }))
  )
  const objetivoGit = tabs.objetivoGit
  const confirmed = tabs.confirmedTarget
  // Mientras el backend no confirma lo que ya enseñan las pestañas, nada cuenta como visto.
  const vistaConfirmada =
    objetivoGit !== null &&
    confirmed !== null &&
    objetivoGit.profileId === confirmed.profileId &&
    objetivoGit.project.projectHostPath === confirmed.project.projectHostPath
  const lay = agentes.lay
  return claveVista({
    mosaico: mosaicoActivo,
    enfocada,
    teselas,
    activeTargetKey: agentes.activeTargetKeyEfectivo,
    ccVisible: lay.agente === 'espacio' ? !lay.cc.hidden : !ccHidden && vistaConfirmada
  })
}

/** Suscripción a los cambios y resincronización con la foto completa. */
function useSuscripcionActividad(claveVistaRef: { current: string | null }): void {
  useEffect(
    () =>
      window.tessera.agentTerminal.onActivity((msg) => {
        const key = agentTargetKey(msg.profileId, msg.projectHostPath, msg.agente as Agente)
        const isActive = key === claveVistaRef.current
        actualizarActividad((s) => applyActivity(s, key, msg.state, isActive))
      }),
    [claveVistaRef]
  )
  // Un cambio puede perderse (recarga, crash del renderer): al montar y al volver el foco se pide la foto.
  useEffect(() => {
    const sincronizar = (): void => {
      void window.tessera.agentTerminal
        .activitySnapshot()
        .then((fotos) => {
          const vivos: Record<string, AgentWork> = {}
          for (const msg of fotos) {
            const key = agentTargetKey(msg.profileId, msg.projectHostPath, msg.agente as Agente)
            vivos[key] = msg.state === 'working' ? 'working' : 'idle'
          }
          actualizarActividad((s) => sincronizarActividad(s, vivos))
        })
        .catch(() => {
          // Sin foto se sigue con lo que haya: el main acabará emitiendo el cierre.
        })
    }
    sincronizar()
    window.addEventListener('focus', sincronizar)
    return () => window.removeEventListener('focus', sincronizar)
  }, [])
}

/** Actividad de los agentes, «visto» y poda. */
export function useActividadAgentes(
  tabs: UseTabs,
  agentes: AgentesApp,
  ccHidden: boolean
): ActividadAgentes {
  const activity = useStoreAgentes((s) => s.activity)
  const claveVistaActual = useClaveVista(tabs, agentes, ccHidden)
  // La suscripción se registra una vez y lee la regla al vuelo.
  const claveVistaRef = useRef(claveVistaActual)
  claveVistaRef.current = claveVistaActual
  useSuscripcionActividad(claveVistaRef)
  useEffect(() => {
    if (claveVistaActual) actualizarActividad((s) => markSeen(s, claveVistaActual))
  }, [claveVistaActual])
  const targetsAgente: OpenAgentTarget[] = agentes.targetsAgente
  useEffect(() => {
    const open = new Set(targetsAgente.map((t) => t.key))
    actualizarActividad((s) => pruneActivity(s, open))
  }, [targetsAgente])
  // Al hibernar no llega un 'idle' final: sin esto el 'working' quedaría pegado.
  useEffect(() => {
    if (tabs.hibernatedTargetKeys.size === 0) return
    actualizarActividad((s) => clearActivityKeys(s, tabs.hibernatedTargetKeys))
  }, [tabs.hibernatedTargetKeys])
  const activityAttention = useMemo(() => {
    const unseenProfiles = new Set<string>()
    const workingProfiles = new Set<string>()
    for (const t of targetsAgente) {
      if (activity.unseen.has(t.key)) unseenProfiles.add(t.profileId)
      if (activity.raw[t.key] === 'working') workingProfiles.add(t.profileId)
    }
    return { unseenProfiles, workingProfiles }
  }, [targetsAgente, activity])
  const trabajandoSet = useMemo(
    () => new Set(Object.keys(activity.raw).filter((k) => activity.raw[k] === 'working')),
    [activity.raw]
  )
  return { activity, trabajandoSet, activityAttention }
}
