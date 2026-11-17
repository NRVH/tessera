// =============================================================================
// El hueco de la derecha de la tira de pestañas donde el pane VISIBLE pinta sus acciones
// (el modo de vista de un archivo con vista previa), por portal. Lo da `AreaEditor` y lo
// lee `PaneEditor`: así el pane conserva el estado de sus botones y la tira no los conoce.
// =============================================================================
import { createContext } from 'react'

export const HuecoAccionesTira = createContext<HTMLElement | null>(null)
