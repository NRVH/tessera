// =============================================================================
// useArrastrePerfiles: estado y manejadores del arrastre para reordenar las pestañas de
// perfil (pestaña arrastrada y pestaña sobre la que se pasa). Lo llama `ProfileTabs`.
// Depende de util/reorderByDrag, que comparte con la barra de actividad la semántica
// direccional: a la derecha inserta DESPUÉS del destino y a la izquierda, ANTES.
// =============================================================================
import { useState } from 'react'
import type { DragEvent } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import { reorderByDrag } from '../../util/reorderByDrag'

/** Arrastre de pestañas de perfil: ids en curso y un manejador por evento de arrastre. */
export function useArrastrePerfiles(
  profiles: Profile[],
  onReorderProfiles: (orderedIds: string[]) => void
): {
  dragId: string | null
  dragOverId: string | null
  alEmpezar: (id: string, e: DragEvent) => void
  alPasarSobre: (id: string, e: DragEvent) => void
  alSalir: (id: string) => void
  alSoltar: (id: string, e: DragEvent) => void
  alTerminar: () => void
} {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  function handleDrop(targetId: string): void {
    if (dragId) {
      const next = reorderByDrag(profiles.map((p) => p.id), dragId, targetId)
      if (next) onReorderProfiles(next)
    }
    setDragId(null)
    setDragOverId(null)
  }

  return {
    dragId,
    dragOverId,
    alEmpezar: (id, e) => {
      setDragId(id)
      e.dataTransfer.effectAllowed = 'move'
    },
    alPasarSobre: (id, e) => {
      if (dragId) {
        e.preventDefault()
        if (dragOverId !== id) setDragOverId(id)
      }
    },
    alSalir: (id) => setDragOverId((prev) => (prev === id ? null : prev)),
    alSoltar: (id, e) => {
      e.preventDefault()
      handleDrop(id)
    },
    alTerminar: () => {
      setDragId(null)
      setDragOverId(null)
    }
  }
}
