// =============================================================================
// Terminales de la ventana: qué proyectos tienen lista (todos los abiertos, de todos los perfiles),
// cuál se ve, cuáles están hibernados, y la creación perezosa de la primera terminal y la poda de
// los proyectos cerrados. Las pestañas SSH son del PERFIL: aquí se saben el perfil y el contexto de
// lo que se mira, se abren y se podan por perfiles vivos (cerrar un proyecto no las cierra, solo
// olvida cuál se miraba en él), y su nombre sigue al alias de su conexión.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================
import { useCallback, useEffect, useMemo } from 'react'
import { conexionPorId, useStoreSsh } from '../ssh'
import { claveProyectoTerminal } from './modeloTerminalesShell'
import { contextoSsh, contextosVivosSsh } from './modeloPestanasSsh'
import { hayTerminalQueEnsenar } from './activoTerminales'
import { accionesTerminales, useStoreTerminales } from './store'
import type { DestinoProyectoTerminal } from './terminalPaneTipos'
import { useStorePestanas, type UsePestanas } from '../pestanas'

/** Proyectos con terminales, cuál se ve y a qué perfil y contexto pertenece la terminal. */
export interface TerminalesApp {
  proyectosTerminal: DestinoProyectoTerminal[]
  claveProyectoTerminalActivo: string | null
  clavesProyectoHibernado: Set<string>
  /** El perfil de la terminal: el activo; `''` sin perfil. */
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
function usePodaSsh(pestanas: UsePestanas, proyectosTerminal: DestinoProyectoTerminal[]): void {
  const cargadas = useStorePestanas((s) => s.pestanasCargadas)
  // También cuando llegan las pestañas guardadas del arranque anterior: pueden ser de un perfil que ya no está.
  const perfilesConPestanas = useStoreTerminales((s) => Object.keys(s.ssh.porPerfil).join('\u0000'))
  const { perfiles } = pestanas
  useEffect(() => {
    if (!cargadas) return
    const perfilesVivos = perfiles.map((p) => p.id)
    accionesTerminales.podarSsh(perfilesVivos, contextosVivosSsh(proyectosTerminal.map((p) => p.clave), perfilesVivos))
  }, [cargadas, perfiles, proyectosTerminal, perfilesConPestanas])
}

/** El nombre de una pestaña SSH sigue al alias de su conexión: lo pone al día cada vez que cambian las conexiones. */
function useAliasSsh(): void {
  const conexiones = useStoreSsh((s) => s.conexiones)
  useEffect(() => {
    accionesTerminales.sincronizarAliasSsh(new Map(conexiones.map((c) => [c.id, c.alias])))
  }, [conexiones])
}

/** Proyectos con terminales; estrena la primera al mirarlas, poda las de proyectos cerrados y lleva las SSH del perfil. */
export function useTerminalesApp(pestanas: UsePestanas, terminalVisible: boolean): TerminalesApp {
  // Lo que se VE (`objetivoVisto`): la shell arranca en la ruta de su proyecto y no espera al backend.
  // Sin proyecto, la terminal es del perfil activo.
  const perfilTerminal = pestanas.objetivoVisto?.perfilId ?? pestanas.perfilActivo?.id ?? ''
  const proyecto = pestanas.objetivoVisto?.proyecto ?? null
  const claveProyectoTerminalActivo = proyecto ? claveProyectoTerminal(perfilTerminal, proyecto.rutaHostProyecto) : null
  const contextoTerminal = contextoSsh(perfilTerminal, proyecto ? proyecto.rutaHostProyecto : null)
  // Una terminal cuelga del PROYECTO: se deduplica la dimensión de agente.
  const proyectosTerminal = useMemo<DestinoProyectoTerminal[]>(() => {
    const vistos = new Map<string, DestinoProyectoTerminal>()
    for (const t of pestanas.todosLosDestinosAbiertos) {
      const clave = claveProyectoTerminal(t.profileId, t.projectHostPath)
      if (!vistos.has(clave)) vistos.set(clave, { perfilId: t.profileId, rutaHostProyecto: t.projectHostPath, clave })
    }
    return [...vistos.values()]
  }, [pestanas.todosLosDestinosAbiertos])
  // El backend ya mató las sesiones de los hibernados: sus panes las relanzan al despertar.
  // Solo los hibernados ENTEROS (con su perfil): con 'agente-hibernado' la shell sigue viva,
  // y soltar aquí su sesión la dejaría huérfana y abriría otra al volver.
  const clavesProyectoHibernado = useMemo(() => {
    const claves = new Set<string>()
    for (const p of pestanas.todosLosProyectosAbiertos) {
      if (p.estado === 'hibernated') claves.add(claveProyectoTerminal(p.profileId, p.projectHostPath))
    }
    return claves
  }, [pestanas.todosLosProyectosAbiertos])
  // Perezoso: la primera terminal nace al mirar el proyecto con el panel abierto, no al abrirlo.
  useEffect(() => {
    if (!terminalVisible || claveProyectoTerminalActivo === null) return
    accionesTerminales.asegurar(claveProyectoTerminalActivo)
  }, [terminalVisible, claveProyectoTerminalActivo])
  useEffect(() => {
    accionesTerminales.podar(proyectosTerminal.map((p) => p.clave))
  }, [proyectosTerminal])
  usePodaSsh(pestanas, proyectosTerminal)
  useAliasSsh()
  // Con el contexto del momento: una conexión de OTRO perfil se abre sin proyecto.
  const conectarSsh = useCallback(
    (perfilId: string, conexionId: string, alias?: string) => {
      const nombre = alias ?? conexionPorId(useStoreSsh.getState(), conexionId)?.alias ?? ''
      const contexto = perfilId === perfilTerminal ? contextoTerminal : contextoSsh(perfilId, null)
      accionesTerminales.abrirSsh(contexto, perfilId, conexionId, nombre)
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
  return { proyectosTerminal, claveProyectoTerminalActivo, clavesProyectoHibernado, perfilTerminal, contextoTerminal, conectarSsh, abrirSftp }
}


/**
 * ¿Hay alguna terminal que enseñar? Para quien decide sin montar el panel: si la columna de la terminal se
 * pliega junto a su agente y si se le ofrece maximizarse sobre ellas.
 */
export function useHayTerminalQueEnsenar(t: Pick<TerminalesApp, 'proyectosTerminal' | 'claveProyectoTerminalActivo' | 'perfilTerminal' | 'contextoTerminal'>): boolean {
  return useStoreTerminales((s) =>
    hayTerminalQueEnsenar({
      proyectos: t.proyectosTerminal,
      claveProyectoActivo: t.claveProyectoTerminalActivo,
      terminales: s.terminalesShell,
      perfilId: t.perfilTerminal,
      contexto: t.contextoTerminal,
      ssh: s.ssh
    })
  )
}
