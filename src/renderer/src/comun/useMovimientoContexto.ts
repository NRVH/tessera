// =============================================================================
// Un cambio de contexto entrega sus paneles y contenido listos en el mismo fotograma.
// Cancela las entradas del panel y del contenido tras aplicar el contexto nuevo.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useLayoutEffect, useRef } from 'react'

export function useMovimientoContexto(contexto: string): void {
  const anterior = useRef(contexto)
  useLayoutEffect(() => {
    if (anterior.current === contexto) return
    anterior.current = contexto
    for (const animacion of document.getAnimations()) {
      const destino = (animacion.effect as KeyframeEffect | null)?.target
      if (animacion instanceof CSSTransition && animacion.transitionProperty === 'opacity' && destino instanceof Element && destino.classList.contains('xterm-screen')) animacion.cancel()
      if (animacion instanceof CSSAnimation && ['mov-panel-entra', 'mov-contenido-funde', 'editor-fundido'].includes(animacion.animationName)) animacion.cancel()
    }
  }, [contexto])
}
