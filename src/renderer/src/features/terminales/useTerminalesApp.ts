// =============================================================================
// Terminales de la ventana: qué proyectos tienen lista (todos los abiertos, de todos los perfiles),
// cuál se ve, cuáles están hibernados, y la creación perezosa de la primera terminal y la poda de
// los proyectos cerrados. Las pestañas SSH son del PERFIL: aquí se saben el perfil y el contexto de
// lo que se mira, se abren y se podan por perfiles vivos (cerrar un proyecto no las cierra, solo
// olvida cuál se miraba en él), y su nombre sigue al alias de su conexión.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================
import { useCallback, useEffect, useMemo } from 'react'
import { accionesSsh, conexionPorId, useStoreSsh } from '../ssh'
import { terminalProjectKey } from './shellTerminalsModel'
import { contextoSsh, contextosVivosSsh } from './sshTabsModel'
import { accionesTerminales } from './store'
import type { TerminalProjectTarget } from './terminalPaneTipos'
import { useStorePestanas, type UseTabs } from '../pestanas'

/** Proyectos con terminales, cuál se ve y a qué perfil y contexto pertenece la terminal. */
export interface TerminalesApp {
  terminalProjects: TerminalProjectTarget[]
  activeTerminalProjectKey: string | null
  hibernatedProjectKeys: Set<string>
  /** El perfil de la terminal: el del proyecto confirmado o, sin proyecto, el activo; `''` sin perfil. */
  perfilTerminal: string
  /** El contexto en que se mira la terminal: el proyecto (`perfil|ruta`) o el perfil solo (`perfil|`). */
  contextoTerminal: string
  /**
   * Abre una pestaña SSH del perfil con una conexión guardada, visible en el contexto actual, y la anota
   * entre las recientes del perfil. El alias, si se conoce (la conexión se acaba de guardar), evita
   * esperar a que llegue la lista.
   */
  conectarSsh: (perfilId: string, conexionId: string, alias?: string) => void
  /**
   * Abre una pestaña con el explorador SFTP de una conexión guardada, visible en el contexto actual. No la
   * anota entre las recientes: esas son las conexiones a las que se abrió una terminal.
   */
  abrirSftp: (perfilId: string, conexionId: string) => void
}

/**
 * Poda lo de las pestañas SSH que ya no existe: las de los perfiles cerrados y cuál se miraba en los
 * proyectos cerrados. Espera a que las pestañas hayan cargado: antes, «ningún perfil» quiere decir
 * «aún no hay datos»; después, que ya no queda ninguno.
 */
function usePodaSsh(tabs: UseTabs, terminalProjects: TerminalProjectTarget[]): void {
  const cargadas = useStorePestanas((s) => s.pestanasCargadas)
  const { profiles } = tabs
  useEffect(() => {
    if (!cargadas) return
    const perfilesVivos = profiles.map((p) => p.id)
    accionesTerminales.podarSsh(perfilesVivos, contextosVivosSsh(terminalProjects.map((p) => p.key), perfilesVivos))
  }, [cargadas, profiles, terminalProjects])
}

/** El nombre de una pestaña SSH sigue al alias de su conexión: lo pone al día cada vez que cambian las conexiones. */
function useAliasSsh(): void {
  const conexiones = useStoreSsh((s) => s.conexiones)
  useEffect(() => {
    accionesTerminales.sincronizarAliasSsh(new Map(conexiones.map((c) => [c.id, c.alias])))
  }, [conexiones])
}

/** Proyectos con terminales; estrena la primera al mirarlas, poda las de proyectos cerrados y lleva las SSH del perfil. */
export function useTerminalesApp(tabs: UseTabs, terminalVisible: boolean): TerminalesApp {
  const confirmed = tabs.confirmedTarget
  const activeTerminalProjectKey = confirmed
    ? terminalProjectKey(confirmed.profileId, confirmed.project.projectHostPath)
    : null
  const perfilTerminal = confirmed?.profileId ?? tabs.activeProfile?.id ?? ''
  const contextoTerminal = contextoSsh(perfilTerminal, confirmed ? confirmed.project.projectHostPath : null)
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
  usePodaSsh(tabs, terminalProjects)
  useAliasSsh()
  // Con el contexto del momento: una conexión de OTRO perfil se abre sin proyecto.
  // Toda apertura pasa por aquí (la lista y el riel), así que aquí se anota como reciente.
  const conectarSsh = useCallback(
    (perfilId: string, conexionId: string, alias?: string) => {
      const nombre = alias ?? conexionPorId(useStoreSsh.getState(), conexionId)?.alias ?? ''
      const contexto = perfilId === perfilTerminal ? contextoTerminal : contextoSsh(perfilId, null)
      accionesTerminales.abrirSsh(contexto, perfilId, conexionId, nombre)
      accionesSsh.registrarReciente(perfilId, conexionId)
    },
    [perfilTerminal, contextoTerminal]
  )
  const abrirSftp = useCallback(
    (perfilId: string, conexionId: string) => {
      const nombre = conexionPorId(useStoreSsh.getState(), conexionId)?.alias ?? ''
      const contexto = perfilId === perfilTerminal ? contextoTerminal : contextoSsh(perfilId, null)
      accionesTerminales.abrirSsh(contexto, perfilId, conexionId, nombre, true)
    },
    [perfilTerminal, contextoTerminal]
  )
  return { terminalProjects, activeTerminalProjectKey, hibernatedProjectKeys, perfilTerminal, contextoTerminal, conectarSsh, abrirSftp }
}
