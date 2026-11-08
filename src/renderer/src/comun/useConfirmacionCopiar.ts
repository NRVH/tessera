// =============================================================================
// La confirmación pertenece al control que completó la copia.
// El temporizador se reinicia con cada éxito y se limpia al desmontar el control.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useEffect, useRef, useState } from 'react'

export function useConfirmacionCopiar(): { copiado: boolean; confirmar: () => void } {
  const [copiado, setCopiado] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(temporizador.current), [])
  const confirmar = (): void => {
    clearTimeout(temporizador.current)
    setCopiado(true)
    temporizador.current = setTimeout(() => setCopiado(false), 1500)
  }
  return { copiado, confirmar }
}
