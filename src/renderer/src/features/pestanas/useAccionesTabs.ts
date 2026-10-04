// =============================================================================
// useAccionesTabs: las acciones que `useTabs` expone a la UI (abrir, activar, cerrar,
// reordenar, hibernar y CRUD de perfiles). Todas estables (deps vacías o solo `pickFolder…`):
// leen el estado del momento con `leerTabs()` y escriben con `despacharTabs`. El
// diálogo nativo y la decisión de modo son efectos de aquí; el reductor recibe hechos.
// =============================================================================

import { useCallback } from 'react'
import { uniqueProfileId } from './tabsModel'
import { despacharTabs as dispatch, leerTabs, marcarHibernando } from './store'
import type { DecideProjectMode, UseTabs } from './useTabs'
import type { Profile } from '../../../../main/profiles/types'
import { iniciarTramo } from '../../util/diagnosticoRendimiento'

type ProyectoElegido = { projectHostPath: string; name: string }

/** Acciones de proyecto que expone `useTabs`. */
export type AccionesProyecto = Pick<
  UseTabs,
  | 'setActiveProfile'
  | 'openProjectInActiveProfile'
  | 'openProjectInProfile'
  | 'openKnownProject'
  | 'replaceProjectInActiveProfile'
  | 'setActiveProject'
  | 'wakeProject'
  | 'setActiveRepo'
  | 'rescanRepos'
  | 'closeProject'
  | 'reordenarProyectos'
  | 'quitarAgenteDiferido'
  | 'hibernateProfile'
  | 'hibernarAgentes'
>

type AperturasProyecto = Pick<
  UseTabs,
  'openProjectInActiveProfile' | 'openProjectInProfile' | 'openKnownProject' | 'replaceProjectInActiveProfile'
>

/**
 * Diálogo nativo + decisión de modo, compartido por abrir y reemplazar. Devuelve el
 * proyecto elegido o null (cancelado / sin perfil). `decideMode` decide y APLICA el
 * modo SOLO si el proyecto es nuevo (re-elegir uno abierto no debe tocar su sesión
 * viva); devolver false lo CANCELA. `enPerfil` sustituye al perfil activo (mosaico).
 */
async function pickFolderAndDecideMode(
  decideMode?: DecideProjectMode,
  enPerfil?: string
): Promise<{ profileId: string; project: ProyectoElegido } | null> {
  const profileId = enPerfil ?? leerTabs().activeProfileId
  if (profileId === null) return null // sin perfil activo no hay dónde abrir
  const res = await window.tessera.workspace.openProjectDialog()
  if (res.canceled || !res.projectHostPath || !res.name) return null
  const alreadyOpen =
    leerTabs().byProfile[profileId]?.openProjects.some(
      (p) => p.projectHostPath === res.projectHostPath
    ) ?? false
  if (!alreadyOpen && decideMode && !(await decideMode(profileId, res.projectHostPath, res.name))) {
    return null
  }
  return { profileId, project: { projectHostPath: res.projectHostPath, name: res.name } }
}

/** Las acciones que abren o reemplazan proyectos (con o sin diálogo nativo). */
function useAperturasProyecto(): AperturasProyecto {
  // try/catch: el onClick es async y sin él un fallo del diálogo rechazaría la promesa en silencio.
  const openProjectInActiveProfile = useCallback(
    async (decideMode?: DecideProjectMode) => {
      try {
        const r = await pickFolderAndDecideMode(decideMode)
        if (!r) return
        dispatch({ type: 'openProject', profileId: r.profileId, project: r.project })
      } catch (err) {
        console.error('[tabs] openProjectInActiveProfile falló:', err)
      }
    },
    []
  )

  // Abre en UN PERFIL CONCRETO sin cambiar el activo (casillas del mosaico). `alAbrir`
  // corre en el MISMO turno que la apertura: tras el `return` sería otro commit.
  const openProjectInProfile = useCallback(
    async (
      profileId: string,
      decideMode?: DecideProjectMode,
      alAbrir?: (project: ProyectoElegido) => void
    ): Promise<ProyectoElegido | null> => {
      try {
        const r = await pickFolderAndDecideMode(decideMode, profileId)
        if (!r) return null
        dispatch({ type: 'openProject', profileId: r.profileId, project: r.project })
        alAbrir?.(r.project)
        return r.project
      } catch (err) {
        console.error('[tabs] openProjectInProfile falló:', err)
        return null
      }
    },
    []
  )

  // Abre o activa un proyecto de ruta ya conocida, sin diálogo. NO decide el modo:
  // quien llame con un proyecto NUEVO debe fijarlo antes de despachar.
  const openKnownProject = useCallback(
    (profileId: string, project: ProyectoElegido, opciones?: { agenteDiferido?: boolean }) => {
      dispatch({ type: 'openProject', profileId, project, agenteDiferido: opciones?.agenteDiferido })
    },
    []
  )

  // Primero el diálogo y solo si NO se cancela se cierra el viejo y se abre el nuevo:
  // al revés, cancelar dejaría el tab vacío.
  const replaceProjectInActiveProfile = useCallback(
    async (oldPath: string, decideMode?: DecideProjectMode) => {
      try {
        const r = await pickFolderAndDecideMode(decideMode)
        if (!r) return
        dispatch({ type: 'replaceProject', profileId: r.profileId, oldPath, project: r.project })
      } catch (err) {
        console.error('[tabs] replaceProjectInActiveProfile falló:', err)
      }
    },
    []
  )

  return {
    openProjectInActiveProfile,
    openProjectInProfile,
    openKnownProject,
    replaceProjectInActiveProfile
  }
}

/**
 * Acciones de proyecto. `rescanActiveProject` es el de `useEscaneoRepos`: `rescanRepos`
 * suelta su cancelador porque no hay efecto que limpiar (el dispatch lleva su propio
 * perfil y proyecto, y el reductor lo descarta si ya se cerró).
 */
export function useAccionesProyecto(rescanActiveProject: () => () => void): AccionesProyecto {
  const aperturas = useAperturasProyecto()

  const setActiveProfile = useCallback((profileId: string) => {
    iniciarTramo('perfil:cambio')
    dispatch({ type: 'setActiveProfile', profileId })
  }, [])

  const setActiveProject = useCallback((profileId: string, projectHostPath: string) => {
    dispatch({ type: 'setActiveProject', profileId, projectHostPath })
  }, [])

  const wakeProject = useCallback((profileId: string, projectHostPath: string) => {
    dispatch({ type: 'wakeProject', profileId, projectHostPath })
  }, [])

  // El repo activo solo tiene sentido en el perfil ACTIVO: el profileId sale del estado.
  const setActiveRepo = useCallback((projectHostPath: string, repoHostPath: string) => {
    const profileId = leerTabs().activeProfileId
    if (profileId === null) return
    dispatch({ type: 'setActiveRepo', profileId, projectHostPath, repoHostPath })
  }, [])

  const rescanRepos = useCallback(() => {
    rescanActiveProject()
  }, [rescanActiveProject])

  const closeProject = useCallback((profileId: string, projectHostPath: string) => {
    dispatch({ type: 'closeProject', profileId, projectHostPath })
  }, [])

  const reordenarProyectos = useCallback((profileId: string, orderedPaths: string[]) => {
    dispatch({ type: 'reordenarProyectos', profileId, orderedPaths })
  }, [])

  const quitarAgenteDiferido = useCallback((profileId: string, projectHostPath: string) => {
    dispatch({ type: 'quitarAgenteDiferido', profileId, projectHostPath })
  }, [])

  // El perfil queda en `hibernando` (spinner en su dot) hasta que el IPC resuelve, que
  // es cuando Docker ya paró el contenedor. La hibernación es por PERFIL.
  const hibernateProfile = useCallback((profileId: string) => {
    dispatch({ type: 'hibernateProfile', profileId })
    marcarHibernando(profileId, true)
    window.tessera.hibernate
      .profile(profileId)
      .catch((err) => console.error('[tabs] hibernate.profile falló:', err))
      .finally(() => marcarHibernando(profileId, false))
  }, [])

  // Solo marca el modelo: el agente ya lo cerró el main en la ronda de inactividad.
  const hibernarAgentes = useCallback((profileId: string, projectHostPath: string) => {
    dispatch({ type: 'hibernarAgentes', profileId, projectHostPath })
  }, [])

  return {
    setActiveProfile,
    ...aperturas,
    setActiveProject,
    wakeProject,
    setActiveRepo,
    rescanRepos,
    closeProject,
    reordenarProyectos,
    quitarAgenteDiferido,
    hibernateProfile,
    hibernarAgentes
  }
}

/** Acciones del CRUD de perfiles que expone `useTabs`. */
export type AccionesCrudPerfiles = Pick<
  UseTabs,
  'addProfile' | 'renameProfile' | 'recolorProfile' | 'setProfileRedHost' | 'deleteProfile' | 'reorderProfiles'
>

/** CRUD de perfiles: construyen el hecho y despachan; `usePersistenciaTabs` guarda a disco. */
export function useAccionesCrudPerfiles(): AccionesCrudPerfiles {
  const addProfile = useCallback((nombre: string, color: string) => {
    const clean = nombre.trim()
    if (clean === '') return
    const id = uniqueProfileId(clean, leerTabs().profiles)
    const profile: Profile = {
      id,
      nombre: clean,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#61afef',
      agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
      sandbox: { habilitado: false }
    }
    dispatch({ type: 'addProfile', profile })
  }, [])

  const renameProfile = useCallback((profileId: string, nombre: string) => {
    dispatch({ type: 'renameProfile', profileId, nombre })
  }, [])

  const recolorProfile = useCallback((profileId: string, color: string) => {
    dispatch({ type: 'recolorProfile', profileId, color })
  }, [])

  const setProfileRedHost = useCallback((profileId: string, redHost: boolean) => {
    dispatch({ type: 'setProfileRedHost', profileId, redHost })
  }, [])

  const deleteProfile = useCallback((profileId: string) => {
    dispatch({ type: 'deleteProfile', profileId })
  }, [])

  const reorderProfiles = useCallback((orderedIds: string[]) => {
    dispatch({ type: 'reorderProfiles', orderedIds })
  }, [])

  return { addProfile, renameProfile, recolorProfile, setProfileRedHost, deleteProfile, reorderProfiles }
}
