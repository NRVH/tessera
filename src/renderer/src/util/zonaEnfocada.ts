// =============================================================================
// zonaEnfocada: en cuál de las zonas grandes de la ventana está trabajando el usuario: la columna
// lateral, la franja inferior, o ninguna (el editor y el agente, sin icono en el riel). Alimenta
// los dos niveles de resaltado del riel: color para la zona con el foco, gris para la abierta.
// Sigue el FOCO y no el ratón, y escucha también `mousedown` porque las zonas no enfocables no
// disparan `focusin`. El propio riel, la barra de título y la de estado no cambian la zona.
// =============================================================================

import { useEffect, useState } from 'react'

/** Zona con el foco. `null` = el editor, el agente, o nada en concreto. */
export type ZonaEnfocada = 'lateral' | 'inferior' | null

/** Raíces de cada zona. Los cuatro paneles laterales comparten `aside.sidebar`. */
const SEL_LATERAL = 'aside.sidebar'
const SEL_INFERIOR = '.terminal-panel, .git-log-panel'
/**
 * CROMO: lo único que NO cambia la zona. Es una lista de excepciones y no de zonas
 * neutras: lo desconocido (el centro vacío, un modal, el marco) es NEUTRO, y solo estas
 * tres superficies se ignoran, para que pulsar un icono del riel no lo apague en el
 * mismo gesto que lo enciende.
 */
const SEL_CROMO = '.activity-bar, .tabs-bar, .status-bar'

/**
 * Resuelve la zona de un elemento, o `undefined` si es cromo y por tanto no debe
 * cambiar nada. Distinguir "neutra" de "no aplica" es lo que evita que el riel se
 * apague al pulsar sus propios iconos.
 */
function zonaDe(el: Element): ZonaEnfocada | undefined {
  if (el.closest(SEL_CROMO)) return undefined
  if (el.closest(SEL_LATERAL)) return 'lateral'
  if (el.closest(SEL_INFERIOR)) return 'inferior'
  return null
}

export function useZonaEnfocada(): ZonaEnfocada {
  const [zona, setZona] = useState<ZonaEnfocada>(null)
  useEffect(() => {
    const alTocar = (e: Event): void => {
      const el = e.target instanceof Element ? e.target : null
      if (!el) return
      const z = zonaDe(el)
      if (z !== undefined) setZona(z)
    }
    // Ambos en fase de CAPTURA: un `mousedown` con `stopPropagation` (los hay, en
    // las filas que gestionan su propio foco) no debe dejar al riel desactualizado.
    document.addEventListener('focusin', alTocar, true)
    document.addEventListener('mousedown', alTocar, true)
    return () => {
      document.removeEventListener('focusin', alTocar, true)
      document.removeEventListener('mousedown', alTocar, true)
    }
  }, [])
  return zona
}
