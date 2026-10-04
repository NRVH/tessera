// =============================================================================
// Terminales de shell de la ventana: qué proyectos tienen lista (todos los abiertos,
// de todos los perfiles), cuál se ve, cuáles están hibernados, y la creación
// perezosa de la primera terminal y la poda de los proyectos cerrados.
// =============================================================================
import { useEffect, useMemo } from 'react'
import { terminalProjectKey } from './shellTerminalsModel'
import { accionesTerminales } from './store'
import type { TerminalProjectTarget } from './terminalPaneTipos'
import type { UseTabs } from '../pestanas'

/** Proyectos con terminales y cuál se ve. */
export interface TerminalesApp {
  terminalProjects: TerminalProjectTarget[]
  activeTerminalProjectKey: string | null
  hibernatedProjectKeys: Set<string>
}

/** Proyectos con terminales; estrena la primera al mirarlas y poda las de proyectos cerrados. */
export function useTerminalesApp(tabs: UseTabs, terminalVisible: boolean): TerminalesApp {
  const confirmed = tabs.confirmedTarget
  const activeTerminalProjectKey = confirmed
    ? terminalProjectKey(confirmed.profileId, confirmed.project.projectHostPath)
    : null
  // Una terminal cuelga del PROYECTO: se deduplica la dimensión de agente.
  const terminalProjects = useMemo<TerminalProjectTarget[]>(() => {
    const seen = new Map<string, TerminalProjectTarget>()
    for (const t of tabs.allOpenTargets) {
      const key = terminalProjectKey(t.profileId, t.projectHostPath)
      if (!seen.has(key)) seen.set(key, { profileId: t.profileId, projectHostPath: t.projectHostPath, key })
    }
    return [...seen.values()]
  }, [tabs.allOpenTargets])
  // El backend ya mató las sesiones de los hibernados: sus panes las relanzan al despertar.
  // Solo los hibernados ENTEROS (con su perfil): con 'agente-hibernado' la shell sigue viva,
  // y soltar aquí su sesión la dejaría huérfana y abriría otra al volver.
  const hibernatedProjectKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const p of tabs.allOpenProjects) {
      if (p.estado === 'hibernated') keys.add(terminalProjectKey(p.profileId, p.projectHostPath))
    }
    return keys
  }, [tabs.allOpenProjects])
  // Perezoso: la primera terminal nace al mirar el proyecto con el panel abierto, no al abrirlo.
  useEffect(() => {
    if (!terminalVisible || activeTerminalProjectKey === null) return
    accionesTerminales.asegurar(activeTerminalProjectKey)
  }, [terminalVisible, activeTerminalProjectKey])
  useEffect(() => {
    accionesTerminales.podar(terminalProjects.map((p) => p.key))
  }, [terminalProjects])
  return { terminalProjects, activeTerminalProjectKey, hibernatedProjectKeys }
}
