// =============================================================================
// Arrastrar para reordenar una lista de agentes (las pestañas o la lista de Configuración): da
// las props de arrastre de cada elemento y quién se arrastra y sobre quién. El id arrastrado
// viaja por estado y no por `dataTransfer`, porque `dragover` no puede leer el payload.
// =============================================================================

import { useState } from 'react'
import type { IdAgente } from '../../../../shared/agentesManuales'

export type PropsArrastre = Pick<
  React.HTMLAttributes<HTMLElement>,
  'onDragStart' | 'onDragOver' | 'onDragLeave' | 'onDrop' | 'onDragEnd'
> & { draggable: boolean }

/** `onSoltar` recibe el arrastrado y aquel sobre el que se suelta. */
export function useArrastreOrden(onSoltar: (id: IdAgente, destino: IdAgente) => void) {
  const [arrastrado, setArrastrado] = useState<IdAgente | null>(null)
  const [sobre, setSobre] = useState<IdAgente | null>(null)
  const limpiar = (): void => {
    setArrastrado(null)
    setSobre(null)
  }
  const arrastre = (id: IdAgente): PropsArrastre => ({
    draggable: true,
    onDragStart: (e) => {
      setArrastrado(id)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e) => {
      if (!arrastrado || arrastrado === id) return
      e.preventDefault()
      if (sobre !== id) setSobre(id)
    },
    onDragLeave: () => setSobre((s) => (s === id ? null : s)),
    onDrop: (e) => {
      e.preventDefault()
      if (arrastrado && arrastrado !== id) onSoltar(arrastrado, id)
      limpiar()
    },
    onDragEnd: limpiar
  })
  return { arrastre, arrastrado, sobre }
}
