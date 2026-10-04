// =============================================================================
// `Date.now()` como estado de React, refrescado cada `tickMs` mientras `activo`: el reloj de
// los «hace N min», que derivan de la hora y no del estado y sin latido se congelarían.
// Lo usan el botón de actualización, el de los agentes nativos y Configuración › Actualizaciones.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { latirReloj } from './reloj'

/**
 * La hora, que late cada `tickMs` solo con `activo` (un popover cerrado no re-renderiza la
 * barra de título cada 30 s). Al reactivarse se pone en hora; al montar no hace falta.
 */
export function useAhora(tickMs: number, activo = true): number {
  const [ahora, setAhora] = useState(() => Date.now())
  const recienMontadoRef = useRef(true)
  useEffect(() => {
    // El estado nació en hora al montar: ponerla otra vez solo costaría un render.
    const ponerEnHora = !recienMontadoRef.current
    recienMontadoRef.current = false
    if (!activo) return
    return latirReloj(setAhora, tickMs, ponerEnHora)
  }, [activo, tickMs])
  return ahora
}
