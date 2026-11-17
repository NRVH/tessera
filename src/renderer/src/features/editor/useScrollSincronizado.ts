// =============================================================================
// Engancha el scroll sincronizado de la vista dividida a Monaco y a la vista renderizada:
// con las dos a la vista, mover una mueve la otra a la misma fracción de su recorrido. Las
// reglas y la guarda contra el eco son de `scrollSincronizado.ts`. Lo usa PaneEditor.
// Decisiones: docs/decisiones/editor/scroll-sincronizado-vista-dividida.md
// =============================================================================
import { useEffect } from 'react'
import type { PaneRefs } from './editorPaneRefs'
import { crearSincronizador, type Aplicador, type MedidaScroll } from './scrollSincronizado'
import type { VistaDelPane } from './useVistaDelPane'

/**
 * Sincroniza los dos lados mientras `vista.dividida` y la vista renderizada estén en el DOM.
 * Depende de `modeloToken` para re-suscribirse si el editor cambia de modelo (otro archivo
 * en el mismo pane): Monaco avisa del scroll por editor, no por modelo, pero el recorrido
 * cambia y la primera medida tras el cambio debe ser del nuevo.
 */
export function useScrollSincronizado(refs: PaneRefs, vista: VistaDelPane & { visible: boolean }): void {
  // `visible &&`: los panes están todos montados; en uno oculto la vista mide 0 y no hay nada
  // que seguir (ni que pagar), como en los demás efectos del pane.
  const activo = vista.visible && vista.dividida && vista.previa !== null && vista.previa !== 'html'
  useEffect(() => {
    const editorMonaco = refs.editor.current
    const el = vista.previaMdRef.current
    if (!activo || !editorMonaco || !el) return
    const aplicador: Aplicador = {
      medir: (lado): MedidaScroll =>
        lado === 'codigo'
          ? // Hasta el pie de la última línea, no el alto del scroll: este suma la barra horizontal
            // cuando hay desborde, y con la última línea a la vista le quedaría ese trozo.
            { desplazamiento: editorMonaco.getScrollTop(), alto: editorMonaco.getBottomForLineNumber(editorMonaco.getModel()?.getLineCount() ?? 1), visible: editorMonaco.getLayoutInfo().height }
          : { desplazamiento: el.scrollTop, alto: el.scrollHeight, visible: el.clientHeight },
      mover: (lado, desplazamiento) => {
        if (lado === 'codigo') editorMonaco.setScrollTop(desplazamiento)
        else el.scrollTop = desplazamiento
      }
    }
    const sinc = crearSincronizador(aplicador)
    const subEditor = editorMonaco.onDidScrollChange((e) => {
      if (e.scrollTopChanged) sinc.alMoverse('codigo')
    })
    const alMoverVista = (): void => {
      sinc.alMoverse('vista')
    }
    el.addEventListener('scroll', alMoverVista, { passive: true })
    return () => {
      subEditor.dispose()
      el.removeEventListener('scroll', alMoverVista)
    }
  }, [activo, refs, vista.previaMdRef, vista.modeloToken])
}
