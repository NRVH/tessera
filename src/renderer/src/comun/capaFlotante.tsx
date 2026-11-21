// =============================================================================
// La capa flotante: el sitio donde se pintan, por portal, los menús y popovers que no pueden
// colgar de quien los abre (una zona con `container-type` o `overflow: hidden` los recortaría).
// Es un `div` dentro de `.shell` y fuera de `.shell-main`, en la ventana principal y en cada
// hija desacoplada, así que hereda el color del perfil (`--perfil` va en línea en `.shell`).
// No crea contexto de apilamiento ni de contención: sus hijos son `position: fixed`.
// Decisiones: docs/decisiones/renderer/boton-dividido-y-capa-flotante.md
// =============================================================================

import './capaFlotante.css'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ContextoDocumento, useDocumentoActual } from './contextoDocumento'
import { despedir } from './despedida.ts'

/** El id del `div` de la capa. Uno solo por documento. */
export const ID_CAPA_FLOTANTE = 'capa-flotante'

/** El contenedor de la capa; lo monta cada ventana una sola vez, dentro de `.shell`. */
export function CapaFlotante(): React.JSX.Element {
  return <div id={ID_CAPA_FLOTANTE} className="capa-flotante" />
}

/**
 * Pinta `children` en la capa flotante del documento activo (o `documento` si se pasa). Si la capa
 * no existe todavía (un montaje fuera de `App`, como en una prueba) cae al `<body>` de ese documento.
 */
export function EnCapaFlotante({ children, documento }: { children: ReactNode; documento?: Document }): React.JSX.Element {
  const doc = useDocumentoActual(documento)
  const envoltura = useRef<HTMLDivElement>(null)
  // Lo que se pinta aquí (menús y popovers) entra con `movimiento.css` y, al quitarse, se despide con su salida. Los
  // diálogos no pasan por aquí: van a su propia capa (`Modal`).
  useLayoutEffect(() => {
    const e = envoltura
    return () => e.current?.querySelectorAll<HTMLElement>(':scope > *').forEach((el) => despedir(el, 'flotante'))
  }, [])
  return createPortal(
    <ContextoDocumento.Provider value={doc}>
      <div ref={envoltura} className="mov-flotante">
        {children}
      </div>
    </ContextoDocumento.Provider>,
    doc.getElementById(ID_CAPA_FLOTANTE) ?? doc.body
  )
}
