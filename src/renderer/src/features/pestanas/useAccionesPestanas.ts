// =============================================================================
// useAccionesPestanas: las acciones que `usePestanas` expone a la UI (abrir, activar, cerrar,
// reordenar, hibernar y CRUD de perfiles). Todas estables (deps vacías): leen el estado del
// momento con `leerPestanas()` y escriben con `despacharPestanas`. El diálogo nativo es efecto de
// aquí; el reductor recibe hechos.
// =============================================================================

import { useCallback } from 'react'
import { generarIdPerfilUnico } from './modeloPestanas'
import { despacharPestanas as dispatch, leerPestanas, marcarHibernando } from './store'
import type { UsePestanas } from './usePestanas'
import type { Perfil } from '../../../../main/perfiles/types'
import { iniciarTramo } from '../../util/diagnosticoRendimiento'
import type { ConfirmarReemplazo } from './confirmaciones'

type ProyectoElegido = { projectHostPath: string; name: string }

/** Acciones de proyecto que expone `usePestanas`. */
export type AccionesProyecto = Pick<
  UsePestanas,
  | 'setActiveProfile'
  | 'abrirProyectoEnPerfilActivo'
  | 'abrirProyectoEnPerfil'
  | 'abrirProyectoConocido'
  | 'reemplazarProyectoEnPerfilActivo'
  | 'setActiveProject'
  | 'wakeProject'
  | 'setActiveRepo'
  | 'reescanearRepos'
  | 'closeProject'
  | 'reordenarProyectos'
  | 'quitarAgenteDiferido'
  | 'hibernateProfile'
  | 'hibernarAgentes'
>

type AperturasProyecto = Pick<
  UsePestanas,
  'abrirProyectoEnPerfilActivo' | 'abrirProyectoEnPerfil' | 'abrirProyectoConocido' | 'reemplazarProyectoEnPerfilActivo'
>

/**
 * Diálogo nativo, compartido por abrir y reemplazar. Devuelve el proyecto elegido o null
 * (cancelado / sin perfil). `enPerfil` sustituye al perfil activo (mosaico).
 */
async function elegirCarpeta(enPerfil?: string): Promise<{ perfilId: string; proyecto: ProyectoElegido } | null> {
  const perfilId = enPerfil ?? leerPestanas().perfilActivoId
  if (perfilId === null) return null // sin perfil activo no hay dónde abrir
  const res = await window.tessera.workspace.abrirDialogoProyecto()
  if (res.canceled || !res.projectHostPath || !res.name) return null
  return { perfilId, proyecto: { projectHostPath: res.projectHostPath, name: res.name } }
}

/** Las acciones que abren o reemplazan proyectos (con o sin diálogo nativo). */
function useAperturasProyecto(): AperturasProyecto {
  // try/catch: el onClick es async y sin él un fallo del diálogo rechazaría la promesa en silencio.
  const abrirProyectoEnPerfilActivo = useCallback(
    async () => {
      try {
        const r = await elegirCarpeta()
        if (!r) return
        dispatch({ tipo: 'openProject', perfilId: r.perfilId, proyecto: r.proyecto })
      } catch (err) {
        console.error('[tabs] openProjectInActiveProfile falló:', err)
      }
    },
    []
  )

  // Abre en UN PERFIL CONCRETO sin cambiar el activo (casillas del mosaico). `alAbrir`
  // corre en el MISMO turno que la apertura: tras el `return` sería otro commit.
  const abrirProyectoEnPerfil = useCallback(
    async (perfilId: string, alAbrir?: (proyecto: ProyectoElegido) => void): Promise<ProyectoElegido | null> => {
      try {
        const r = await elegirCarpeta(perfilId)
        if (!r) return null
        dispatch({ tipo: 'openProject', perfilId: r.perfilId, proyecto: r.proyecto })
        alAbrir?.(r.proyecto)
        return r.proyecto
      } catch (err) {
        console.error('[tabs] openProjectInProfile falló:', err)
        return null
      }
    },
    []
  )

  // Abre o activa un proyecto de ruta ya conocida, sin diálogo.
  const abrirProyectoConocido = useCallback(
    (perfilId: string, proyecto: ProyectoElegido, opciones?: { agenteDiferido?: boolean }) => {
      dispatch({ tipo: 'openProject', perfilId, proyecto, agenteDiferido: opciones?.agenteDiferido })
    },
    []
  )

  // Primero el diálogo y la confirmación, y solo si ninguno se cancela se cierra el viejo y se
  // abre el nuevo: al revés, cancelar dejaría el tab vacío.
  const reemplazarProyectoEnPerfilActivo = useCallback(
    async (rutaAnterior: string, confirmar: ConfirmarReemplazo) => {
      try {
        const r = await elegirCarpeta()
        if (!r || !(await confirmar(r.proyecto))) return
        dispatch({ tipo: 'replaceProject', perfilId: r.perfilId, rutaAnterior, proyecto: r.proyecto })
      } catch (err) {
        console.error('[tabs] replaceProjectInActiveProfile falló:', err)
      }
    },
    []
  )

  return {
    abrirProyectoEnPerfilActivo,
    abrirProyectoEnPerfil,
    abrirProyectoConocido,
    reemplazarProyectoEnPerfilActivo
  }
}

/**
 * Acciones de proyecto. `reescanearProyectoActivo` es el de `useEscaneoRepos`: `reescanearRepos`
 * suelta su cancelador porque no hay efecto que limpiar (el dispatch lleva su propio
 * perfil y proyecto, y el reductor lo descarta si ya se cerró).
 */
export function useAccionesProyecto(reescanearProyectoActivo: () => () => void): AccionesProyecto {
  const aperturas = useAperturasProyecto()

  const activarPerfil = useCallback((perfilId: string) => {
    iniciarTramo('perfil:cambio')
    dispatch({ tipo: 'setActiveProfile', perfilId })
  }, [])

  const activarProyecto = useCallback((perfilId: string, rutaHostProyecto: string, opciones?: { entrar?: boolean }) => {
    const entrar = opciones?.entrar === true
    if (entrar && leerPestanas().perfilActivoId !== perfilId) iniciarTramo('perfil:cambio')
    dispatch({ tipo: 'setActiveProject', perfilId, rutaHostProyecto, ...(entrar ? { entrar } : {}) })
  }, [])

  const despertarProyecto = useCallback((perfilId: string, rutaHostProyecto: string) => {
    dispatch({ tipo: 'wakeProject', perfilId, rutaHostProyecto })
  }, [])

  // El repo activo solo tiene sentido en el perfil ACTIVO: el profileId sale del estado.
  const activarRepo = useCallback((rutaHostProyecto: string, rutaHostRepo: string) => {
    const perfilId = leerPestanas().perfilActivoId
    if (perfilId === null) return
    dispatch({ tipo: 'setActiveRepo', perfilId, rutaHostProyecto, rutaHostRepo })
  }, [])

  const reescanearRepos = useCallback(() => {
    reescanearProyectoActivo()
  }, [reescanearProyectoActivo])

  const cerrarProyecto = useCallback((perfilId: string, rutaHostProyecto: string) => {
    dispatch({ tipo: 'closeProject', perfilId, rutaHostProyecto })
  }, [])

  const reordenarProyectos = useCallback((perfilId: string, rutasOrdenadas: string[]) => {
    dispatch({ tipo: 'reordenarProyectos', perfilId, rutasOrdenadas })
  }, [])

  const quitarAgenteDiferido = useCallback((perfilId: string, rutaHostProyecto: string) => {
    dispatch({ tipo: 'quitarAgenteDiferido', perfilId, rutaHostProyecto })
  }, [])

  // El perfil queda en `hibernando` (spinner en su dot) hasta que el IPC resuelve, que
  // es cuando Docker ya paró el contenedor. La hibernación es por PERFIL.
  const hibernarPerfil = useCallback((perfilId: string) => {
    dispatch({ tipo: 'hibernateProfile', perfilId })
    marcarHibernando(perfilId, true)
    window.tessera.hibernacion
      .hibernarPerfil(perfilId)
      .catch((err) => console.error('[tabs] hibernacion.hibernarPerfil falló:', err))
      .finally(() => marcarHibernando(perfilId, false))
  }, [])

  // Solo marca el modelo: el agente ya lo cerró el main en la ronda de inactividad.
  const hibernarAgentes = useCallback((perfilId: string, rutaHostProyecto: string) => {
    dispatch({ tipo: 'hibernarAgentes', perfilId, rutaHostProyecto })
  }, [])

  return {
    setActiveProfile: activarPerfil,
    ...aperturas,
    setActiveProject: activarProyecto,
    wakeProject: despertarProyecto,
    setActiveRepo: activarRepo,
    reescanearRepos,
    closeProject: cerrarProyecto,
    reordenarProyectos,
    quitarAgenteDiferido,
    hibernateProfile: hibernarPerfil,
    hibernarAgentes
  }
}

/** Acciones del CRUD de perfiles que expone `usePestanas`. */
export type AccionesCrudPerfiles = Pick<
  UsePestanas,
  'addProfile' | 'renameProfile' | 'recolorProfile' | 'setProfileRedHost' | 'setProfileReglas' | 'deleteProfile' | 'reorderProfiles'
>

/** CRUD de perfiles: construyen el hecho y despachan; `usePersistenciaPestanas` guarda a disco. */
export function useAccionesCrudPerfiles(): AccionesCrudPerfiles {
  const anadirPerfil = useCallback((nombre: string, color: string) => {
    const limpio = nombre.trim()
    if (limpio === '') return
    const id = generarIdPerfilUnico(limpio, leerPestanas().perfiles)
    const perfil: Perfil = {
      id,
      nombre: limpio,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#61afef',
      agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
      sandbox: { habilitado: false },
      clavesSshPermitidas: []
    }
    dispatch({ tipo: 'addProfile', profile: perfil })
  }, [])

  const renombrarPerfil = useCallback((perfilId: string, nombre: string) => {
    dispatch({ tipo: 'renameProfile', perfilId, nombre })
  }, [])

  const cambiarColorPerfil = useCallback((perfilId: string, color: string) => {
    dispatch({ tipo: 'recolorProfile', perfilId, color })
  }, [])

  const fijarRedHostPerfil = useCallback((perfilId: string, redHost: boolean) => {
    dispatch({ tipo: 'setProfileRedHost', perfilId, redHost })
  }, [])

  const fijarReglasPerfil = useCallback((perfilId: string, reglas: string) => {
    dispatch({ tipo: 'setProfileReglas', perfilId, reglas })
  }, [])

  const eliminarPerfil = useCallback((perfilId: string) => {
    dispatch({ tipo: 'deleteProfile', perfilId })
    // Guardar la lista nunca borra: lo del perfil solo se borra con esta orden.
    window.tessera.deleteProfile(perfilId).catch((err) => {
      console.error('[tabs] deleteProfile falló:', err)
    })
  }, [])

  const reordenarPerfiles = useCallback((idsOrdenados: string[]) => {
    dispatch({ tipo: 'reorderProfiles', idsOrdenados })
  }, [])

  return { addProfile: anadirPerfil, renameProfile: renombrarPerfil, recolorProfile: cambiarColorPerfil, setProfileRedHost: fijarRedHostPerfil, setProfileReglas: fijarReglasPerfil, deleteProfile: eliminarPerfil, reorderProfiles: reordenarPerfiles }
}
