// =============================================================================
// useAreaRenombrar: el diálogo «Renombrar consola» del menú de la pestaña. El main es
// la autoridad: si rechaza el nombre, el diálogo sigue abierto con su motivo. Lo
// llama `DbArea`, que pinta el diálogo.
// =============================================================================

import { useState } from 'react'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc'
import type { DbTab } from './dbTabsModel'

/** El diálogo abierto: de qué consola y con qué nombre y error. */
interface RenombrarConsola {
  perfilId: string
  consolaId: string
  nombre: string
  error: string | null
}

/** Estado y acciones del diálogo de renombrar (ver la cabecera). */
interface AreaRenombrar {
  renombrar: RenombrarConsola | null
  setRenombrar: (r: RenombrarConsola | null) => void
  pedirRenombrar: (tabId: string) => void
  confirmarRenombrar: (nombre: string) => Promise<void>
}

/** Renombrar una consola desde su pestaña (ver la cabecera). */
export function useAreaRenombrar(
  perfilId: string | null,
  tabs: readonly DbTab[],
  consolasActuales: readonly DbConsolaInfo[] | null,
  onConsolasCambiaron: (perfilId: string) => void
): AreaRenombrar {
  const [renombrar, setRenombrar] = useState<RenombrarConsola | null>(null)
  const pedirRenombrar = (tabId: string): void => {
    if (perfilId === null) return
    const tab = tabs.find((t) => t.id === tabId)
    if (tab?.pane.kind !== 'consola') return
    const consolaId = tab.pane.consolaId
    const nombre = consolasActuales?.find((c) => c.id === consolaId)?.nombre ?? ''
    setRenombrar({ perfilId, consolaId, nombre, error: null })
  }
  const confirmarRenombrar = async (nombre: string): Promise<void> => {
    if (!renombrar) return
    const r = await window.tessera.dbExplorador.renombrarConsola(renombrar.perfilId, renombrar.consolaId, nombre.trim())
    if (!r.ok) {
      // El diálogo sigue abierto con el motivo (nombre repetido, caracteres no
      // válidos): los mensajes del main ya vienen sin rutas.
      setRenombrar((prev) => (prev ? { ...prev, nombre, error: r.error.mensaje } : prev))
      return
    }
    setRenombrar(null)
    onConsolasCambiaron(renombrar.perfilId)
  }
  return { renombrar, setRenombrar, pedirRenombrar, confirmarRenombrar }
}
