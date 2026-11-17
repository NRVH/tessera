// =============================================================================
// useArrastrePerfiles: estado y manejadores del arrastre para reordenar las pestañas de
// perfil (pestaña arrastrada y pestaña sobre la que se pasa). Lo llama `PestanasPerfil`.
// Depende de util/reordenarPorArrastre, que comparte con la barra de actividad la semántica
// direccional: a la derecha inserta DESPUÉS del destino y a la izquierda, ANTES.
// =============================================================================
import { useState } from 'react'
import type { DragEvent } from 'react'
import type { Perfil } from '../../../../main/perfiles/types'
import { reordenarPorArrastre } from '../../util/reordenarPorArrastre'

/** Arrastre de pestañas de perfil: ids en curso y un manejador por evento de arrastre. */
export function useArrastrePerfiles(
  perfiles: Perfil[],
  onReordenarPerfiles: (idsOrdenados: string[]) => void
): {
  arrastreId: string | null
  destinoArrastreId: string | null
  alEmpezar: (id: string, e: DragEvent) => void
  alPasarSobre: (id: string, e: DragEvent) => void
  alSalir: (id: string) => void
  alSoltar: (id: string, e: DragEvent) => void
  alTerminar: () => void
} {
  const [arrastreId, setArrastreId] = useState<string | null>(null)
  const [destinoArrastreId, setDestinoArrastreId] = useState<string | null>(null)

  function alSoltar(destinoId: string): void {
    if (arrastreId) {
      const siguiente = reordenarPorArrastre(perfiles.map((p) => p.id), arrastreId, destinoId)
      if (siguiente) onReordenarPerfiles(siguiente)
    }
    setArrastreId(null)
    setDestinoArrastreId(null)
  }

  return {
    arrastreId,
    destinoArrastreId,
    alEmpezar: (id, e) => {
      setArrastreId(id)
      e.dataTransfer.effectAllowed = 'move'
    },
    alPasarSobre: (id, e) => {
      if (arrastreId) {
        e.preventDefault()
        if (destinoArrastreId !== id) setDestinoArrastreId(id)
      }
    },
    alSalir: (id) => setDestinoArrastreId((prev) => (prev === id ? null : prev)),
    alSoltar: (id, e) => {
      e.preventDefault()
      alSoltar(id)
    },
    alTerminar: () => {
      setArrastreId(null)
      setDestinoArrastreId(null)
    }
  }
}
