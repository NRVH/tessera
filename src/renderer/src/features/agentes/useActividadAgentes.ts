// =============================================================================
// Actividad de los agentes de todos los perfiles: se suscribe a los cambios del
// main, se resincroniza al montar y al recuperar el foco, marca visto lo que de
// verdad se está mirando y poda lo de targets cerrados o hibernados.
// El modelo (estado pegajoso «terminó sin ver») vive en agentActivity.ts.
// =============================================================================
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Agente } from '../../../../main/profiles/types'
import type { AgentMotivoEspera } from '../../../../shared/agent-terminal-ipc'
import {
  applyActivity,
  clearActivityKeys,
  dejarDeVer,
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
  /** Claves que te esperan (lo dice el agente). */
  esperandoSet: Set<string>
  activityAttention: { unseenProfiles: Set<string>; workingProfiles: Set<string>; esperandoProfiles: Set<string> }
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
    // El agente de datos y el de la terminal no dependen del proyecto confirmado: se ven si su columna se ve.
    ccVisible: lay.agente === 'espacio' || lay.agente === 'terminal' ? !lay.cc.hidden : !ccHidden && vistaConfirmada
  })
}

/** Suscripción a los cambios y resincronización con la foto completa. */
function useSuscripcionActividad(claveVistaRef: { current: string | null }): void {
  useEffect(
    () =>
      window.tessera.agentTerminal.onActivity((msg) => {
        const key = agentTargetKey(msg.profileId, msg.projectHostPath, msg.agente as Agente)
        const isActive = key === claveVistaRef.current
        actualizarActividad((s) => applyActivity(s, key, msg.state, isActive, msg.motivo ?? null))
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
          const esperando = new Map<string, AgentMotivoEspera | null>()
          for (const msg of fotos) {
            const key = agentTargetKey(msg.profileId, msg.projectHostPath, msg.agente as Agente)
            vivos[key] = msg.state === 'working' ? 'working' : 'idle'
            if (msg.state === 'blocked') esperando.set(key, msg.motivo ?? null)
          }
          actualizarActividad((s) => sincronizarActividad(s, vivos, esperando))
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
  // Lo que dejas de mirar sin contestar vuelve a avisar; lo que miras queda visto.
  const vistaAnterior = useRef<string | null>(null)
  useEffect(() => {
    const anterior = vistaAnterior.current
    vistaAnterior.current = claveVistaActual
    if (anterior && anterior !== claveVistaActual) actualizarActividad((s) => dejarDeVer(s, anterior))
    if (claveVistaActual) actualizarActividad((s) => markSeen(s, claveVistaActual))
  }, [claveVistaActual])
  const targetsAgente: OpenAgentTarget[] = agentes.targetsAgente
  useEffect(() => {
    const open = new Set(targetsAgente.map((t) => t.key))
    actualizarActividad((s) => pruneActivity(s, open))
  }, [targetsAgente])
  // Al hibernar no llega un 'idle' final: sin esto el 'working' quedaría pegado. Con los targets
  // que no son pestaña de un perfil hibernado (la unión que ve la columna).
  const hibernados = agentes.hibernatedTargetKeys
  useEffect(() => {
    if (hibernados.size === 0) return
    actualizarActividad((s) => clearActivityKeys(s, hibernados))
  }, [hibernados])
  const activityAttention = useMemo(() => {
    const unseenProfiles = new Set<string>()
    const workingProfiles = new Set<string>()
    const esperandoProfiles = new Set<string>()
    for (const t of targetsAgente) {
      if (activity.unseen.has(t.key)) unseenProfiles.add(t.profileId)
      if (activity.raw[t.key] === 'working') workingProfiles.add(t.profileId)
      if (activity.esperando.has(t.key)) esperandoProfiles.add(t.profileId)
    }
    return { unseenProfiles, workingProfiles, esperandoProfiles }
  }, [targetsAgente, activity])
  const trabajandoSet = useMemo(
    () => new Set(Object.keys(activity.raw).filter((k) => activity.raw[k] === 'working')),
    [activity.raw]
  )
  const esperandoSet = useMemo(() => new Set(activity.esperando.keys()), [activity.esperando])
  return { activity, trabajandoSet, esperandoSet, activityAttention }
}
