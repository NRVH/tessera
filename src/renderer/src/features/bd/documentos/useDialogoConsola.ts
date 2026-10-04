// =============================================================================
// La pregunta pendiente de una consola de MongoDB o de Redis: una a la vez, y cancelada si
// la consola se desmonta o ya hay otra abierta (la segunda no apila velos).
// Solo depende de React.
// =============================================================================

import { useCallback, useRef, useState } from 'react'
import type { Dialogo, PeticionDialogo } from './consolaComun'

/** El diálogo abierto y `pedirConfirmacion`, que resuelve con lo que elija el usuario. */
export function useDialogoConsola(desmontadoRef: React.MutableRefObject<boolean>): {
  dialogo: Dialogo | null
  dialogoRef: React.MutableRefObject<Dialogo | null>
  pedirConfirmacion: (d: PeticionDialogo) => Promise<boolean>
} {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)
  const dialogoRef = useRef<Dialogo | null>(null)
  const pedirConfirmacion = useCallback(
    (d: PeticionDialogo): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        if (dialogoRef.current || desmontadoRef.current) {
          resolve(false)
          return
        }
        const abierto: Dialogo = {
          ...d,
          resolver: (ok) => {
            dialogoRef.current = null
            setDialogo(null)
            resolve(ok)
          }
        }
        dialogoRef.current = abierto
        setDialogo(abierto)
      }),
    [desmontadoRef]
  )
  return { dialogo, dialogoRef, pedirConfirmacion }
}
