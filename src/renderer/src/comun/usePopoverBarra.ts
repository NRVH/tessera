// =============================================================================
// El cierre de los popovers de la barra de título (actualización de Tessera y agentes
// nativos): un clic fuera de su envoltura o Escape lo cierran. El panel es `PopoverBarra.tsx`.
// Decisiones: docs/decisiones/layout/marco-y-lienzo.md
// =============================================================================

import { useEffect, type RefObject } from 'react'

/** Cierra el popover con un `pointerdown` fuera de `contenedorRef` (botón y panel) y con Escape. */
export function useCerrarFueraOEscape(
  abierto: boolean,
  setAbierto: (v: boolean) => void,
  contenedorRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent): void => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto, setAbierto, contenedorRef])
}
