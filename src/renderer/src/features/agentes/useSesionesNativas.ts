// =============================================================================
// Actualizar los agentes de tu equipo (sesiones nativas): el hook de la
// actualización, si hay algo abierto donde corre un agente nativo (un proyecto, el
// espacio de datos o el agente de la terminal) y cómo se nombran y ordenan las
// sesiones en su popover.
// =============================================================================
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { InfoSesionesAgentes } from './sesionesPopoverAgentes'
import { txSesion } from './textosSesion.ts'
import { useStoreAgenteTerminal } from './storeAgenteTerminal'
import { useActualizacionNativa, type UseActualizacionNativa } from './useActualizacionNativa'
import type { ActividadAgentes } from './useActividadAgentes'
import { agentTargetKey, tintaPerfil, type UseTabs } from '../pestanas'
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
  const { espaciosAbiertos, dbWorkspacePaths } = useStoreBd(
    useShallow((s) => ({ espaciosAbiertos: s.espaciosAbiertos, dbWorkspacePaths: s.dbWorkspacePaths }))
  )
  const terminal = useStoreAgenteTerminal(useShallow((s) => ({ abiertos: s.abiertos, rutas: s.rutas })))
  // Los agentes corren nativos salvo que elijan Docker: con algo abierto, hay donde actualizarlos.
  const hayProyectoNativo = tabs.allOpenProjects.length > 0 || espaciosAbiertos.size > 0 || terminal.abiertos.size > 0
  const infoSesionesAgentes = useMemo((): InfoSesionesAgentes => {
    const perfiles = new Map<string, { nombre: string; color: string | null }>()
    for (const p of tabs.profiles) perfiles.set(p.id, { nombre: p.nombre, color: p.color ? tintaPerfil(p.color) : null })
    const nombres: Record<string, string> = {}
    for (const p of tabs.allOpenProjects) nombres[editorTargetKey(p.profileId, p.projectHostPath)] = p.name
    // El agente del espacio de datos y el de la terminal se nombran por la vista donde viven.
    for (const [profileId, ruta] of Object.entries(dbWorkspacePaths)) nombres[editorTargetKey(profileId, ruta)] = txSesion().basesDeDatos
    for (const [profileId, ruta] of Object.entries(terminal.rutas)) nombres[editorTargetKey(profileId, ruta)] = txSesion().terminal
    const orden = new Map(ordenarCandidatos(candidatosMosaico).map((c, i) => [c.key, i]))
    const posicion: InfoSesionesAgentes['posicion'] = (s) => orden.get(agentTargetKey(s.profileId, s.projectHostPath, s.agente))
    return { perfiles, nombresProyecto: nombres, posicion }
  }, [tabs.profiles, tabs.allOpenProjects, dbWorkspacePaths, terminal.rutas, candidatosMosaico])
  return { actualizacionNativa, hayProyectoNativo, infoSesionesAgentes }
}
