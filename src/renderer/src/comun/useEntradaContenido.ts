// =============================================================================
// El fundido de entrada de un contenido que se abre o cambia (otro archivo, otro diff, otro modo, otra rama): relanza
// la animación del contenedor cuando cambia `clave`, sin desmontar a sus hijos (el host de Monaco nunca se desmonta).
// Lo que se escribe no cambia la clave, así que no anima nada.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useLayoutEffect, useRef } from 'react'
import { ventanaDeNodo } from '../util/ventanaDe'

export function useEntradaContenido(clave: string, visible = true, externa?: React.RefObject<HTMLDivElement>): React.RefObject<HTMLDivElement> {
  const propia = useRef<HTMLDivElement>(null)
  const ref = externa ?? propia
  useLayoutEffect(() => {
    const elemento = ref.current
    if (!elemento || !visible) return
    elemento.classList.remove('editor-contenido-entrada')
    // Resolver el estilo sin la clase permite reiniciar la animación sin medir el layout.
    void ventanaDeNodo(elemento).getComputedStyle(elemento).animationName
    elemento.classList.add('editor-contenido-entrada')
  }, [clave, visible, ref])
  return ref
}
