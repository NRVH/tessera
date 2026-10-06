// =============================================================================
// El foco al ocultar o cerrar el agente de la terminal a pantalla completa: vuelve a la terminal que se
// ve. Solo mira que lo pedido pase de sí a no, así que vale igual para el conmutador de la barra de
// estado, para Ctrl+Alt+B / ⌥⌘B y para «Cerrar». Lo usa `TerminalsPanel`, que es quien sabe enfocarla.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import { useEffect, useRef } from 'react'

/**
 * Al ocultar o cerrar el agente de la terminal a pantalla completa, el teclado vuelve a la terminal: si
 * estaba en el agente se quedaría en un nodo que ya no se ve, y si estaba en el conmutador de la barra,
 * Espacio o Intro lo volverían a mostrar.
 */
export function useFocoAlOcultarAgente(visible: boolean, pantallaCompleta: boolean, enfocar: () => void): void {
  const antes = useRef(visible)
  const enfocarRef = useRef(enfocar)
  enfocarRef.current = enfocar
  useEffect(() => {
    const ocultado = antes.current && !visible
    antes.current = visible
    if (ocultado && pantallaCompleta) enfocarRef.current()
  }, [visible, pantallaCompleta])
}
