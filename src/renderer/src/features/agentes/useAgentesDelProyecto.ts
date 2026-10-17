// =============================================================================
// Los agentes de cada proyecto desde los stores: la fuente (manuales y ocultos, de los ajustes)
// y una función estable `agentesDe(perfil, proyecto)` que sabe el modo del proyecto. La usan la
// columna, el modelo de pestañas y el mosaico.
// =============================================================================
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { IdAgente } from '../../../../shared/agentesManuales'
import { useStorePestanas } from '../pestanas'
import { editorTargetKey } from '../editor'
import { useStoreAgentes } from './store'
import { agentesDelProyecto, pestanasEstables, type FuenteAgentes } from './agentesDelProyecto.ts'

/** La fuente de agentes manuales y ocultos, con identidad estable mientras no cambie. */
export function useFuenteAgentes(): FuenteAgentes {
  const { nativos, dockerPorPerfil, ocultosPorPerfil, ordenPorPerfil } = useStoreAgentes(
    useShallow((s) => ({
      nativos: s.agentesNativos,
      dockerPorPerfil: s.agentesDockerPorPerfil,
      ocultosPorPerfil: s.agentesOcultosPorPerfil,
      ordenPorPerfil: s.ordenAgentesPorPerfil
    }))
  )
  return useMemo(
    () => ({ nativos, dockerPorPerfil, ocultosPorPerfil, ordenPorPerfil }),
    [nativos, dockerPorPerfil, ocultosPorPerfil, ordenPorPerfil]
  )
}

export type AgentesDe = (profileId: string, projectHostPath: string) => IdAgente[]

/** Cómo se llama un agente de un proyecto, entero y corto: el de su pestaña (también los manuales). */
export function useNombresAgente(): (profileId: string, projectHostPath: string, id: IdAgente) => { nombre: string; corta: string } {
  const fuente = useFuenteAgentes()
  const windowsModeKeys = useStorePestanas((s) => s.windowsModeKeys)
  return useCallback(
    (profileId: string, projectHostPath: string, id: IdAgente) => {
      const sitio = windowsModeKeys.has(editorTargetKey(profileId, projectHostPath)) ? 'proyecto-nativo' : 'proyecto-docker'
      const x = pestanasEstables(fuente, profileId, sitio).find((t) => t.id === id)
      return x ? { nombre: x.nombre, corta: x.corta } : { nombre: id, corta: id }
    },
    [fuente, windowsModeKeys]
  )
}

/** `agentesDe(perfil, proyecto)`: las pestañas de agente de ese proyecto, según su modo. */
export function useAgentesDe(): AgentesDe {
  const fuente = useFuenteAgentes()
  const windowsModeKeys = useStorePestanas((s) => s.windowsModeKeys)
  return useCallback(
    (profileId: string, projectHostPath: string) =>
      agentesDelProyecto(fuente, profileId, windowsModeKeys.has(editorTargetKey(profileId, projectHostPath))),
    [fuente, windowsModeKeys]
  )
}
