// =============================================================================
// Engancha el scroll sincronizado de la vista dividida a Monaco y a la vista renderizada:
// con las dos a la vista, mover una mueve la otra a la misma fracción de su recorrido. Las
// reglas y la guarda contra el eco son de `scrollSincronizado.ts`. Lo usa EditorPane.
// Decisiones: docs/decisiones/editor/scroll-sincronizado-vista-dividida.md
// =============================================================================
import { useEffect } from 'react'
import type { RefsPane } from './editorPaneRefs'
import { crearSincronizador, type Aplicador, type MedidaScroll } from './scrollSincronizado'
import type { VistaDelPane } from './useVistaDelPane'

/**
 * Sincroniza los dos lados mientras `vista.dividida` y la vista renderizada estén en el DOM.
 * Depende de `modeloToken` para re-suscribirse si el editor cambia de modelo (otro archivo
 * en el mismo pane): Monaco avisa del scroll por editor, no por modelo, pero el recorrido
 * cambia y la primera medida tras el cambio debe ser del nuevo.
 */
export function useScrollSincronizado(refs: RefsPane, vista: VistaDelPane & { visible: boolean }): void {
  // `visible &&`: los panes están todos montados; en uno oculto la vista mide 0 y no hay nada
  // que seguir (ni que pagar), como en los demás efectos del pane.
  const activo = vista.visible && vista.dividida && vista.previa !== null && vista.previa !== 'html'
  useEffect(() => {
    const ed = refs.editor.current
    const el = vista.mdPreviewRef.current
    if (!activo || !ed || !el) return
    const aplicador: Aplicador = {
      medir: (lado): MedidaScroll =>
        lado === 'codigo'
          ? { top: ed.getScrollTop(), alto: ed.getScrollHeight(), visible: ed.getLayoutInfo().height }
          : { top: el.scrollTop, alto: el.scrollHeight, visible: el.clientHeight },
      mover: (lado, top) => {
        if (lado === 'codigo') ed.setScrollTop(top)
        else el.scrollTop = top
      }
    }
    const sinc = crearSincronizador(aplicador)
    const subEditor = ed.onDidScrollChange((e) => {
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
  }, [activo, refs, vista.mdPreviewRef, vista.modeloToken])
}
