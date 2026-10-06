// =============================================================================
// La capa flotante: el sitio donde se pintan, por portal, los menús y popovers que no pueden
// colgar de quien los abre (una zona con `container-type` o `overflow: hidden` los recortaría).
// Es un `div` de `App.tsx`, DENTRO de `.shell` y fuera de `.shell-main`, así que hereda el color
// del perfil (`--perfil` va en línea en `.shell`), cosa que no pasa con un portal a `<body>`.
// No crea contexto de apilamiento ni de contención: sus hijos son `position: fixed`.
// Decisiones: docs/decisiones/renderer/boton-dividido-y-capa-flotante.md
// =============================================================================

import './capaFlotante.css'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** El id del `div` de la capa. Uno solo en toda la ventana. */
export const ID_CAPA_FLOTANTE = 'capa-flotante'

/** El contenedor de la capa; lo monta `App.tsx` una sola vez, dentro de `.shell`. */
export function CapaFlotante(): React.JSX.Element {
  return <div id={ID_CAPA_FLOTANTE} className="capa-flotante" />
}

/**
 * Pinta `children` en la capa flotante. Si la capa no existe todavía (un montaje fuera de
 * `App`, como en una prueba) cae a `<body>`: se ve, aunque sin el color del perfil.
 */
export function EnCapaFlotante({ children }: { children: ReactNode }): React.JSX.Element {
  return createPortal(children, document.getElementById(ID_CAPA_FLOTANTE) ?? document.body)
}
