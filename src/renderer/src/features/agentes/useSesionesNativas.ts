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
import { useVigilarActualizacionDocker } from './storeActualizacionDocker'
import { useActualizacionNativa, type UseActualizacionNativa } from './useActualizacionNativa'
import type { ActividadAgentes } from './useActividadAgentes'
import { claveDestinoAgente, tintaPerfil, type UsePestanas } from '../pestanas'
import { useStoreBd } from '../bd'
import { ordenarCandidatos, type CandidatoMosaico } from '../mosaico'
import { claveDestinoEditor } from '../editor'

/** Estado de las sesiones nativas para el botón de la barra de título. */
export interface SesionesNativas {
  actualizacionNativa: UseActualizacionNativa
  hayProyectoNativo: boolean
  infoSesionesAgentes: InfoSesionesAgentes
}

/** Actualización de agentes nativos y la información que pinta su botón. */
export function useSesionesNativas(
  pestanas: UsePestanas,
  actividad: ActividadAgentes,
  candidatosMosaico: CandidatoMosaico[]
): SesionesNativas {
  // Vive aquí y no en el botón: registra las APIs de todos los panes y su resultado es pegajoso.
  const actualizacionNativa = useActualizacionNativa(actividad.estadoActividad.sinVer)
  useVigilarActualizacionDocker(Math.max(actualizacionNativa.estado?.claude.comprobadoEn ?? 0, actualizacionNativa.estado?.codex.comprobadoEn ?? 0) || null)
  const { espaciosAbiertos, rutasWorkspaceDb } = useStoreBd(
    useShallow((s) => ({ espaciosAbiertos: s.espaciosAbiertos, rutasWorkspaceDb: s.rutaEspacioDatosPorPerfil }))
  )
  const terminal = useStoreAgenteTerminal(useShallow((s) => ({ abiertos: s.abiertos, rutas: s.rutas })))
  // Los agentes corren nativos salvo que elijan Docker: con algo abierto, hay donde actualizarlos.
  const hayProyectoNativo = pestanas.todosLosProyectosAbiertos.length > 0 || espaciosAbiertos.size > 0 || terminal.abiertos.size > 0
  const infoSesionesAgentes = useMemo((): InfoSesionesAgentes => {
    const perfiles = new Map<string, { nombre: string; color: string | null }>()
    for (const p of pestanas.perfiles) perfiles.set(p.id, { nombre: p.nombre, color: p.color ? tintaPerfil(p.color) : null })
    const nombres: Record<string, string> = {}
    for (const p of pestanas.todosLosProyectosAbiertos) nombres[claveDestinoEditor(p.profileId, p.projectHostPath)] = p.name
    // El agente del espacio de datos y el de la terminal se nombran por la vista donde viven.
    for (const [perfilId, ruta] of Object.entries(rutasWorkspaceDb)) nombres[claveDestinoEditor(perfilId, ruta)] = txSesion().basesDeDatos
    for (const [perfilId, ruta] of Object.entries(terminal.rutas)) nombres[claveDestinoEditor(perfilId, ruta)] = txSesion().terminal
    const orden = new Map(ordenarCandidatos(candidatosMosaico).map((c, i) => [c.key, i]))
    const posicion: InfoSesionesAgentes['posicion'] = (s) => orden.get(claveDestinoAgente(s.perfilId, s.rutaHostProyecto, s.agente))
    return { perfiles, nombresProyecto: nombres, posicion }
  }, [pestanas.perfiles, pestanas.todosLosProyectosAbiertos, rutasWorkspaceDb, terminal.rutas, candidatosMosaico])
  return { actualizacionNativa, hayProyectoNativo, infoSesionesAgentes }
}
