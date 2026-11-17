// =============================================================================
// usePestanas: hook que envuelve el reducer puro de modeloPestanas (su estado vive en el store
// de pestañas) y le añade el mundo impuro. Compone: carga inicial y persistencia
// (usePersistenciaPestanas), escaneo de repos (useEscaneoRepos), sincronización del
// backend (useSincronizacionBackend) y las acciones (useAccionesPestanas), y re-expone los
// selectores aplicados al estado actual. Si el IPC falla se loguea y el estado NO se
// revierte. Decisiones: docs/decisiones/renderer/objetivo-de-git-derivado.md
// =============================================================================

import { useMemo } from 'react'
import {
  seleccionarPerfilActivo,
  seleccionarProyectosPerfilActivo,
  seleccionarRutaObjetivoGit,
  seleccionarProyectoActivoGlobal,
  seleccionarRutaActivaGlobal,
  seleccionarRepoActivoGlobal,
  seleccionarReposProyectoActivo,
  seleccionarTodosLosDestinosAbiertos,
  seleccionarTodosLosProyectosAbiertos,
  seleccionarClavesDestinoHibernados,
  seleccionarObjetivoGitMostrado,
  seleccionarPerfiles,
  type ObjetivoGit,
  type DestinoAgenteAbierto,
  type ReferenciaProyectoAbierto,
  type ProyectoAbiertoDePerfil,
  type EstadoArbolPestanas,
  type AgentesDeProyecto
} from './modeloPestanas'
import { useStorePestanas, type ObjetivoConfirmado, type ObjetivoVisto } from './store'
import { useCargaInicialPestanas, usePersistenciaPestanas } from './usePersistenciaPestanas'
import { useEscaneoRepos } from './useEscaneoRepos'
import { useSincronizacionBackend } from './useSincronizacionBackend'
import { useAccionesCrudPerfiles, useAccionesProyecto } from './useAccionesPestanas'
import type { Perfil } from '../../../../main/perfiles/types'
import type { RepoDetectado } from '../../../../shared/workspace-ipc'
import type { ConfirmarReemplazo } from './confirmaciones'

export type { ObjetivoConfirmado, ObjetivoVisto }

/** Superficie que el hook expone a la UI: estado leído por selectores + acciones. */
export interface UsePestanas {
  // --- Selectores (derivados del estado actual) -----------------------------
  /** Perfiles (nivel 1). */
  perfiles: Perfil[]
  /** Perfil activo, o null mientras cargan / si no hay ninguno. */
  perfilActivo: Perfil | null
  /** Proyectos abiertos del perfil activo (nivel 2). */
  proyectosAbiertos: ProyectoAbiertoDePerfil[]
  /** Proyecto activo global OPTIMISTA (el activo del perfil activo), o null.
   *  Cambia al instante con el clic; lo usa la banda de tabs para el resaltado. */
  proyectoActivo: ProyectoAbiertoDePerfil | null
  /**
   * Repos escaneados del proyecto activo (nivel 3), o `null` si aún no se ha
   * escaneado / no hay proyecto activo. Lista vacía = carpeta sin repos.
   */
  reposProyectoActivo: RepoDetectado[] | null
  /**
   * Perfil y proyecto que se VEN, en el mismo commit que el clic. De aquí PINTA todo lo
   * que cuelga de un proyecto (explorador, editor, columna del agente, terminal, mosaico):
   * sus peticiones de archivos llevan su proyecto y no esperan al backend.
   */
  objetivoVisto: ObjetivoVisto | null
  /**
   * Objetivo CONFIRMADO por el backend tras setActiveProject: perfil + proyecto
   * + REPO ya re-apuntados. null = sin proyecto activo. Solo para lo que PIDE al
   * main contra la raíz anclada sin decir su proyecto (búsqueda, montar bases, los
   * avisos del vigilante), nunca para pintar.
   */
  objetivoConfirmado: ObjetivoConfirmado | null
  /**
   * Objetivo de GIT del perfil que se está MOSTRANDO: lo que se pinta y lo que se pide.
   * Cada petición de git lleva su proyecto (`raiz`), así que no espera al confirmado.
   */
  objetivoGit: ObjetivoGit | null
  /**
   * TODOS los targets de agente abiertos, de TODOS los perfiles (no solo el
   * activo): cada (perfil, proyecto, agente) abierto. Es lo que el multiplexado
   * keep-alive monta como N sesiones vivas en paralelo.
   */
  todosLosDestinosAbiertos: DestinoAgenteAbierto[]
  /**
   * TODOS los proyectos abiertos de TODOS los perfiles, con su nombre. Lo consume el
   * MOSAICO para titular sus casillas y para su selector (incluidos perfiles no activos).
   */
  todosLosProyectosAbiertos: ReferenciaProyectoAbierto[]
  /**
   * Claves de los targets abiertos cuyo AGENTE está hibernado en el modelo (de todos los
   * perfiles): con su perfil o por inactividad. La columna de agente las usa para relanzar la
   * sesión de un pane al despertarlo. Set nuevo por render solo cuando cambia el conjunto (memo).
   */
  clavesDestinoHibernados: Set<string>

  // --- Acciones (transiciones) ----------------------------------------------
  /** Cambia el perfil activo; su proyecto-activo recordado pasa a ser el global. */
  setActiveProfile: (perfilId: string) => void
  /** Abre el diálogo nativo y, si no se cancela, abre el proyecto en el perfil activo. */
  abrirProyectoEnPerfilActivo: () => Promise<void>
  /**
   * Abre el diálogo y añade el proyecto elegido a ESE perfil (no al activo), sin
   * cambiar el perfil activo. Devuelve el proyecto abierto, o null si se canceló.
   */
  abrirProyectoEnPerfil: (
    perfilId: string,
    alAbrir?: (proyecto: { projectHostPath: string; name: string }) => void
  ) => Promise<{ projectHostPath: string; name: string } | null>
  /**
   * Abre/activa un proyecto de ruta ya conocida (la acuña el main), sin diálogo. Con
   * `agenteDiferido`, si el proyecto se crea nace con el agente sin arrancar.
   */
  abrirProyectoConocido: (
    perfilId: string,
    proyecto: { projectHostPath: string; name: string },
    opciones?: { agenteDiferido?: boolean }
  ) => void
  /** Quita la marca de agente diferido de un proyecto (el usuario pidió su agente). */
  quitarAgenteDiferido: (perfilId: string, rutaHostProyecto: string) => void
  /**
   * Abre el diálogo nativo y, si no se cancela y `confirmar` lo aprueba con la carpeta elegida,
   * REEMPLAZA `rutaAnterior` por ella en el mismo hueco de la banda (cerrar actual + abrir nuevo en
   * un gesto). Cancelar cualquiera de los dos no cierra nada.
   */
  reemplazarProyectoEnPerfilActivo: (rutaAnterior: string, confirmar: ConfirmarReemplazo) => Promise<void>
  /**
   * Marca un proyecto ya abierto como activo dentro de su perfil; con `entrar`, además pasa a ese
   * perfil en la misma acción, sin despertar el proyecto que el perfil tenía activo.
   */
  setActiveProject: (perfilId: string, rutaHostProyecto: string, opciones?: { entrar?: boolean }) => void
  /**
   * DESPIERTA un proyecto hibernado sin activarlo (ver la acción `wakeProject`): lo
   * usa el mosaico, donde traer a una casilla un proyecto dormido no debe mover dónde
   * aterriza la vista normal de ese perfil.
   */
  wakeProject: (perfilId: string, rutaHostProyecto: string) => void
  /**
   * Marca el repo activo del proyecto (dentro del perfil activo). Re-dispara el
   * candado de orden: el backend re-apunta a ese repoHostPath y, al resolver, se
   * confirma. No-op si el repo no está en la lista escaneada del proyecto.
   */
  setActiveRepo: (rutaHostProyecto: string, rutaHostRepo: string) => void
  /**
   * Fuerza un re-escaneo de repos del proyecto activo (botón "Recargar" de git).
   * Idempotente: si nada cambió, no re-renderiza.
   */
  reescanearRepos: () => void
  /** Cierra un proyecto de un perfil (elige un vecino si era el activo). */
  closeProject: (perfilId: string, rutaHostProyecto: string) => void
  /**
   * Reordena las pestañas de proyecto de ese perfil. No hace nada si `rutasOrdenadas` no
   * son exactamente sus rutas abiertas; no cambia el proyecto activo.
   */
  reordenarProyectos: (perfilId: string, rutasOrdenadas: string[]) => void
  /** Hiberna un PERFIL entero: marca todos sus proyectos y mata su contenedor (IPC). */
  hibernateProfile: (perfilId: string) => void
  /**
   * Marca como 'agente-hibernado' un proyecto cuyo agente cerró el main por inactividad.
   * Solo toca el modelo, y solo si el proyecto estaba 'active'.
   */
  hibernarAgentes: (perfilId: string, rutaHostProyecto: string) => void
  /** Perfiles con la hibernación en vuelo (spinner en el dot hasta que Docker cierra). */
  perfilIdsHibernando: Set<string>
  /** Perfiles hibernados según el modelo (todos sus proyectos 'hibernated'): dot gris. */
  perfilIdsHibernados: Set<string>

  // --- CRUD de perfiles (nivel 1). Persisten a disco automáticamente. ----------
  /** Crea un perfil nuevo (id derivado del nombre) con 1 agente claude-code y lo activa. */
  addProfile: (nombre: string, color: string) => void
  /** Renombra un perfil (el id NO cambia). */
  renameProfile: (perfilId: string, nombre: string) => void
  /** Cambia el color de un perfil. */
  recolorProfile: (perfilId: string, color: string) => void
  /**
   * Activa/desactiva `redHost` del perfil: con true su contenedor se lanza con
   * `--network host`. Aplica al RE-CREAR el contenedor (hibernar+abrir o reiniciar).
   */
  setProfileRedHost: (perfilId: string, redHost: boolean) => void
  /** Fija las reglas del perfil para sus agentes (normalizadas; vacías, las quitan). */
  setProfileReglas: (perfilId: string, reglas: string) => void
  /** Elimina un perfil (y cierra sus sesiones/contenedor). */
  deleteProfile: (perfilId: string) => void
  /** Reordena los perfiles a la secuencia de ids dada (drag & drop). */
  reorderProfiles: (idsOrdenados: string[]) => void
}

/** Perfiles hibernados según el modelo: con proyectos abiertos y TODOS 'hibernated'. */
function perfilesHibernados(porPerfil: EstadoArbolPestanas['porPerfil']): Set<string> {
  const s = new Set<string>()
  for (const [id, pestanas] of Object.entries(porPerfil)) {
    if (pestanas.proyectosAbiertos.length > 0 && pestanas.proyectosAbiertos.every((p) => p.estado === 'hibernated')) {
      s.add(id)
    }
  }
  return s
}

/** Estado de pestañas, selectores y acciones de la ventana (ver `UsePestanas`). */
/** `agentesDe` da las pestañas de agente de cada proyecto (su modo y los agentes manuales); estable. */
export function usePestanas(agentesDe?: AgentesDeProyecto): UsePestanas {
  const estado = useStorePestanas((s) => s.pestanas)

  useCargaInicialPestanas()

  const perfilActivoId = estado.perfilActivoId
  const rutaActivaGlobal = seleccionarRutaActivaGlobal(estado)
  const proyectoActivoGlobal = seleccionarProyectoActivoGlobal(estado)
  const repoActivoGlobal = seleccionarRepoActivoGlobal(estado)
  const reposProyectoActivo = seleccionarReposProyectoActivo(estado)
  // Memoizado sobre `state`: lo consumen efectos de la vista de git y un objeto nuevo
  // por render los re-dispararía en cada tecla.
  const objetivoGit = useMemo(() => seleccionarObjetivoGitMostrado(estado), [estado])
  const objetivoVisto = useMemo<ObjetivoVisto | null>(
    () => (perfilActivoId !== null && proyectoActivoGlobal !== null ? { perfilId: perfilActivoId, proyecto: proyectoActivoGlobal } : null),
    [perfilActivoId, proyectoActivoGlobal]
  )
  // Ruta de la vista de GIT: repoHostPath del repo activo, o la contenedora sin repo.
  const rutaObjetivoGit = seleccionarRutaObjetivoGit(estado)
  // Ruta del EXPLORADOR: SIEMPRE la contenedora, nunca un repo; solo cambia al activar otra pestaña.
  const rutaRaizArchivos = proyectoActivoGlobal?.rutaHostProyecto ?? null

  const reescanearProyectoActivo = useEscaneoRepos(perfilActivoId, rutaActivaGlobal)
  const objetivoConfirmado = useSincronizacionBackend(
    perfilActivoId,
    rutaRaizArchivos,
    rutaObjetivoGit,
    proyectoActivoGlobal,
    repoActivoGlobal
  )

  const acciones = useAccionesProyecto(reescanearProyectoActivo)
  const accionesPerfil = useAccionesCrudPerfiles()

  const perfilIdsHibernando = useStorePestanas((s) => s.hibernando)

  const perfilIdsHibernados = useMemo(() => perfilesHibernados(estado.porPerfil), [estado.porPerfil])

  usePersistenciaPestanas(estado)

  // Los tres memos dan identidad estable a sus conjuntos: `todosLosDestinosAbiertos` alimenta una
  // cadena de memos y dos efectos de poda de `useEditorApp`, y sin memo se recalcularían
  // en cada render (uno por frame al arrastrar un splitter). Los selectores solo leen
  // `state.byProfile` (y los `profiles` que reciben): depender de `state` anularía el memo.
  const clavesDestinoHibernados = useMemo(
    () => seleccionarClavesDestinoHibernados(estado, estado.perfiles, agentesDe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estado.porPerfil, estado.perfiles, agentesDe]
  )

  const todosLosDestinosAbiertos = useMemo(
    () => seleccionarTodosLosDestinosAbiertos(estado, estado.perfiles, agentesDe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estado.porPerfil, estado.perfiles, agentesDe]
  )

  const todosLosProyectosAbiertos = useMemo(
    () => seleccionarTodosLosProyectosAbiertos(estado, estado.perfiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estado.porPerfil, estado.perfiles]
  )

  return {
    perfiles: seleccionarPerfiles(estado),
    perfilActivo: seleccionarPerfilActivo(estado),
    proyectosAbiertos: seleccionarProyectosPerfilActivo(estado),
    proyectoActivo: proyectoActivoGlobal,
    reposProyectoActivo,
    objetivoVisto,
    objetivoConfirmado,
    objetivoGit,
    todosLosDestinosAbiertos,
    todosLosProyectosAbiertos,
    clavesDestinoHibernados,
    ...acciones,
    perfilIdsHibernando,
    perfilIdsHibernados,
    ...accionesPerfil
  }
}
