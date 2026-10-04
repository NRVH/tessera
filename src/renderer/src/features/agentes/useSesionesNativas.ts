// =============================================================================
// Actualizar los agentes de tu equipo (sesiones nativas): el hook de la
// actualización, si hay algún proyecto abierto en modo nativo (las consolas de
// datos cuentan) y cómo se nombran y ordenan las sesiones en su popover.
// =============================================================================
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { InfoSesionesAgentes } from './sesionesPopoverAgentes'
import { useActualizacionNativa, type UseActualizacionNativa } from './useActualizacionNativa'
import type { ActividadAgentes } from './useActividadAgentes'
import { agentTargetKey, tintaPerfil, useStorePestanas, type UseTabs } from '../pestanas'
import { useStoreBd } from '../bd'
import { ordenarCandidatos, type CandidatoMosaico } from '../mosaico'
import { editorTargetKey } from '../editor'

/** Estado de las sesiones nativas para el botón de la barra de título. */
export interface SesionesNativas {
  actualizacionNativa: UseActualizacionNativa
  hayProyectoNativo: boolean
  infoSesionesAgentes: InfoSesionesAgentes
}

/** Actualización de agentes nativos y la información que pinta su botón. */
export function useSesionesNativas(
  tabs: UseTabs,
  actividad: ActividadAgentes,
  candidatosMosaico: CandidatoMosaico[]
): SesionesNativas {
  // Vive aquí y no en el botón: registra las APIs de todos los panes y su resultado es pegajoso.
  const actualizacionNativa = useActualizacionNativa(actividad.activity.unseen)
  const windowsModeKeys = useStorePestanas((s) => s.windowsModeKeys)
  const { espaciosAbiertos, dbWorkspacePaths } = useStoreBd(
    useShallow((s) => ({ espaciosAbiertos: s.espaciosAbiertos, dbWorkspacePaths: s.dbWorkspacePaths }))
  )
  // Cruza el modo con lo ABIERTO: el modo recuerda también proyectos cerrados.
  const hayProyectoNativo = useMemo(() => {
    if (tabs.allOpenProjects.some((p) => windowsModeKeys.has(editorTargetKey(p.profileId, p.projectHostPath)))) return true
    for (const profileId of espaciosAbiertos) {
      const ruta = dbWorkspacePaths[profileId]
      if (ruta !== undefined && windowsModeKeys.has(editorTargetKey(profileId, ruta))) return true
    }
    return false
  }, [tabs.allOpenProjects, windowsModeKeys, espaciosAbiertos, dbWorkspacePaths])
  const infoSesionesAgentes = useMemo((): InfoSesionesAgentes => {
    const perfiles = new Map<string, { nombre: string; color: string | null }>()
    for (const p of tabs.profiles) perfiles.set(p.id, { nombre: p.nombre, color: p.color ? tintaPerfil(p.color) : null })
    const nombres: Record<string, string> = {}
    for (const p of tabs.allOpenProjects) nombres[editorTargetKey(p.profileId, p.projectHostPath)] = p.name
    // El agente del espacio de datos se nombra por la vista donde vive.
    for (const [profileId, ruta] of Object.entries(dbWorkspacePaths)) nombres[editorTargetKey(profileId, ruta)] = 'Bases de datos'
    const orden = new Map(ordenarCandidatos(candidatosMosaico).map((c, i) => [c.key, i]))
    const posicion: InfoSesionesAgentes['posicion'] = (s) => orden.get(agentTargetKey(s.profileId, s.projectHostPath, s.agente))
    return { perfiles, nombresProyecto: nombres, posicion }
  }, [tabs.profiles, tabs.allOpenProjects, dbWorkspacePaths, candidatosMosaico])
  return { actualizacionNativa, hayProyectoNativo, infoSesionesAgentes }
}
