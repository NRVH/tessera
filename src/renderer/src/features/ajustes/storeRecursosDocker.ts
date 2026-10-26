// =============================================================================
// Lo que Docker tiene en este equipo (memoria, núcleos, contenedores vivos): lo lee el semáforo del
// límite de contenedores y la apertura de cada agente. Se pide al arrancar con los ajustes ya
// leídos, al abrir la sección y cuando Docker vuelve; sin respuesta queda en `null`, nunca una conjetura.
// =============================================================================

import { useEffect } from 'react'
import { create } from 'zustand'
import type { RecursosDocker } from '../../../../shared/sandbox-estado-ipc'
import { useStoreAjustes } from './store'

interface EstadoRecursos {
  /** null hasta la primera respuesta, o si Docker no contesta. */
  recursos: RecursosDocker | null
}

export const useStoreRecursosDocker = create<EstadoRecursos>()(() => ({ recursos: null }))

/** Pide los recursos al main; un fallo los deja en `null`. */
export async function refrescarRecursosDocker(): Promise<void> {
  try {
    useStoreRecursosDocker.setState({ recursos: await window.tessera.estadoDocker.recursos() })
  } catch {
    useStoreRecursosDocker.setState({ recursos: null })
  }
}

/** Mantiene al día los recursos de Docker: al cargar los ajustes y en cada cambio de disponibilidad. */
export function useVigilarRecursosDocker(): void {
  const cargados = useStoreAjustes((s) => s.settingsLoaded)
  useEffect(() => {
    if (!cargados) return
    void refrescarRecursosDocker()
    return window.tessera.estadoDocker.onCambio(() => void refrescarRecursosDocker())
  }, [cargados])
}
