// =============================================================================
// Modo de cada proyecto (nativo o contenedor): alternarlo desde su pestaña, forzarlo
// a nativo y decidir el de un proyecto recién elegido (directo o con el modal).
// El espacio de datos y el agente de la terminal viven siempre en nativo y su modo no se puede cambiar.
// =============================================================================
import { useCallback } from 'react'
import type { DefaultProjectMode } from '../../../../shared/workspace-state-ipc'
import type { DecideProjectMode } from './useTabs'
import { asegurarModoNativo, useStorePestanas } from './store'
import { editorTargetKey } from '../editor'
import { useStoreAjustes } from '../ajustes'

/** Acciones sobre el modo de los proyectos. */
export interface ModoProyecto {
  toggleWindowsMode: (profileId: string, projectHostPath: string) => void
  forzarModoWindows: (profileId: string, projectHostPath: string) => void
  /** Decide y aplica el modo antes de abrir el proyecto; false = el usuario canceló. */
  decideProjectMode: DecideProjectMode
}

/** Sin carpetas que bloquear: ninguna lo es. */
function nunca(): boolean {
  return false
}

/** Pregunta el modo con el modal; resuelve null si se cancela. */
function preguntarModo(name: string): Promise<'windows' | 'docker' | null> {
  return new Promise((resolve) => useStorePestanas.setState({ modeAsk: { name, resolve } }))
}

/**
 * Modo de los proyectos; `esEspacioDeDatos` y `esCarpetaAgenteTerminal` bloquean el cambio en esas
 * carpetas, que viven en nativo (un cambio remontaría su agente en un contenedor sin `tdb` ni `tssh`).
 */
export function useModoProyecto(
  esEspacioDeDatos: (projectHostPath: string) => boolean,
  esCarpetaAgenteTerminal: (projectHostPath: string) => boolean = nunca
): ModoProyecto {
  const toggleWindowsMode = useCallback(
    (profileId: string, projectHostPath: string) => {
      if (esEspacioDeDatos(projectHostPath) || esCarpetaAgenteTerminal(projectHostPath)) return
      useStorePestanas.setState((s) => {
        const key = editorTargetKey(profileId, projectHostPath)
        const next = new Set(s.windowsModeKeys)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return { windowsModeKeys: next }
      })
    },
    [esEspacioDeDatos, esCarpetaAgenteTerminal]
  )
  const forzarModoWindows = useCallback(
    (profileId: string, projectHostPath: string) => asegurarModoNativo(editorTargetKey(profileId, projectHostPath)),
    []
  )
  // Fija el modo ANTES de abrir: el agente y la terminal nacen ya con el modo correcto.
  const decideProjectMode = useCallback<DecideProjectMode>(async (profileId, projectHostPath, name) => {
    let mode: DefaultProjectMode = useStoreAjustes.getState().defaultProjectMode
    if (mode === 'ask') {
      const choice = await preguntarModo(name)
      if (choice === null) return false
      mode = choice
    }
    const key = editorTargetKey(profileId, projectHostPath)
    useStorePestanas.setState((s) => {
      const has = s.windowsModeKeys.has(key)
      if (mode === 'windows') return has ? {} : { windowsModeKeys: new Set(s.windowsModeKeys).add(key) }
      if (!has) return {}
      const next = new Set(s.windowsModeKeys)
      next.delete(key)
      return { windowsModeKeys: next }
    })
    return true
  }, [])
  return { toggleWindowsMode, forzarModoWindows, decideProjectMode }
}
