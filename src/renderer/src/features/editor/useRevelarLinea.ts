// =============================================================================
// «Ve a esta línea» de PaneEditor: centra la línea pedida y pone el cursor ahí.
// La petición llega en dos momentos, con la pestaña ya abierta o recién creada;
// el destino pendiente en un ref es lo único que ambos caminos comparten.
// =============================================================================
import { useCallback, useEffect } from 'react'
import type { EditorRevelar } from './editorPaneTipos'
import type { PaneRefs } from './editorPaneRefs'

/** Devuelve la función que consume el destino pendiente, y salta cuando sube el token. */
export function useRevelarLinea(refs: PaneRefs, revelar: EditorRevelar | undefined): () => boolean {
  const aplicarRevelado = useCallback((): boolean => {
    const destino = refs.revelarPendiente.current
    const editorMonaco = refs.editor.current
    if (destino === null || !editorMonaco || editorMonaco.getModel() === null) return false
    refs.revelarPendiente.current = null
    const total = editorMonaco.getModel()?.getLineCount() ?? 1
    // El archivo pudo encoger entre la búsqueda y el clic: una línea de más deja el visor en blanco.
    const linea = Math.min(Math.max(1, destino.linea), total)
    editorMonaco.revealLineInCenter(linea)
    editorMonaco.setPosition({ lineNumber: linea, column: Math.max(1, destino.columna) })
    // Se viene de cerrar un modal: sin el foco, el cursor está puesto pero las teclas no llegan.
    editorMonaco.focus()
    return true
  }, [refs])

  useEffect(() => {
    if (!revelar || revelar.token === 0) return
    refs.revelarPendiente.current = { linea: revelar.linea, columna: revelar.columna }
    aplicarRevelado()
  }, [revelar, aplicarRevelado, refs])

  return aplicarRevelado
}
