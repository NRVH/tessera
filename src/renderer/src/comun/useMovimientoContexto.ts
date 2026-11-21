// =============================================================================
// Un cambio de contexto entrega sus paneles y contenido listos en el mismo fotograma.
// Cancela las entradas del panel y del contenido tras aplicar el contexto nuevo, en la
// ventana principal y en las hijas desacopladas.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useLayoutEffect, useRef } from 'react'
import { esAnimacionCss, todosLosDocumentos } from '../util/ventanaDe'

const ENTRADAS = ['mov-panel-entra', 'mov-contenido-funde', 'editor-fundido']

/**
 * `contexto` es todo lo que cambia el contenido; `entorno`, solo el perfil y el proyecto. La
 * vista del lateral se funde al cambiar de vista, pero un perfil con otra vista elegida la trae al momento.
 */
export function useMovimientoContexto(contexto: string, entorno: string): void {
  const anterior = useRef(contexto)
  const entornoAnterior = useRef(entorno)
  useLayoutEffect(() => {
    if (anterior.current === contexto) return
    anterior.current = contexto
    const nombres = entornoAnterior.current === entorno ? ENTRADAS : [...ENTRADAS, 'mov-lateral-funde']
    entornoAnterior.current = entorno
    for (const doc of todosLosDocumentos()) {
      for (const animacion of doc.getAnimations()) {
        if (esAnimacionCss(animacion) && nombres.includes(animacion.animationName)) animacion.cancel()
      }
    }
  }, [contexto, entorno])
}
