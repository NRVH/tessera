// =============================================================================
// Recarga en vivo de las pestañas que cambiaron por fuera (el agente, un checkout,
// otro editor): escucha al watcher y sube los tokens de recarga; a las sucias solo
// les pregunta si su archivo sigue en disco. La decisión vive en recargaEnVivo.ts.
// =============================================================================
import { useEffect, useRef } from 'react'
import { panesAComprobar, panesARecargar } from './recargaEnVivo'
import { textModels } from './textModelRegistry'
import { subirTokens, useStoreEditor } from './store'
import type { EditorApp } from './useEditorApp'

/** Suscribe la recarga en vivo; se registra UNA vez y lee todo por ref. */
export function useRecargaEnVivo(editor: EditorApp): void {
  const { paneKey } = editor
  // Por ref: con las pestañas o el sucio en las deps, cada tecla reengancharía el listener.
  const vivoRef = useRef(editor)
  vivoRef.current = editor
  useEffect(() => {
    return window.tessera.files.onChanged((ev) => {
      const e = vivoRef.current
      // Con un cambio de proyecto en vuelo las rutas son de la raíz NUEVA: no se recarga nada.
      if (!e.proyectoAsentado) return
      const entrada = {
        tabs: e.editorTabs.tabs,
        cambiadas: ev.paths,
        parcial: ev.parcial,
        sucios: useStoreEditor.getState().dirtyTabIds,
        targetKey: e.activeEditorKey,
        paneKey
      }
      for (const pk of panesAComprobar(entrada)) void textModels.revisarBorrado(pk)
      const tocar = panesARecargar(entrada)
      if (tocar.length === 0) return
      useStoreEditor.setState((s) => ({ reloadTokens: subirTokens(s.reloadTokens, tocar) }))
    })
  }, [paneKey])
}
