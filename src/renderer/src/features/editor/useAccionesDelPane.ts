// =============================================================================
// Peticiones que llegan a un EditorPane desde fuera y disparan al subir su token:
// guardar, convertir codificación o fin de línea, recargar de disco y reabrir con
// otra codificación. Recargar y reabrir mutan el buffer compartido in-place.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { textModels } from './textModelRegistry'
import type { EditorConvertReq } from './editorPaneTipos'
import type { EscritoresAviso, RefsPane } from './editorPaneRefs'

interface EntornoAcciones {
  refs: RefsPane
  set: EscritoresAviso
  reportMeta: () => void
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Guardado pedido desde fuera (menú de la pestaña): el mismo camino que Ctrl+S. */
export function useGuardarPorToken(refs: RefsPane, saveToken: number | undefined): void {
  useEffect(() => {
    if (!saveToken) return
    void refs.save.current?.()
  }, [saveToken, refs])
}

/** Conversión pedida desde la barra de estado; el token evita repetirla. */
export function useConvertirPorToken(refs: RefsPane, convert: EditorConvertReq | undefined): void {
  useEffect(() => {
    if (!convert || !convert.token || convert.token === refs.convertToken.current) return
    refs.convertToken.current = convert.token
    void refs.convertFn.current?.(convert)
  }, [convert, refs])
}

function restaurarVista(
  refs: RefsPane,
  ed: editor.IStandaloneCodeEditor | null | undefined,
  estado: editor.ICodeEditorViewState | null
): void {
  // Solo si el editor sigue siendo el mismo: entre medias pudo cambiarse de pestaña.
  // Aparte del resto para no confundir este fallo con «no se pudo abrir el archivo».
  try {
    if (estado && refs.editor.current === ed) ed?.restoreViewState(estado)
  } catch {
    /* cosmético: el contenido ya está bien */
  }
}

/** Recarga desde disco al subir el token, conservando scroll y cursor. */
export function useRecargaPorToken(
  { refs, set, reportMeta }: EntornoAcciones,
  reloadToken: number | undefined,
  modelKey: string | undefined
): void {
  useEffect(() => {
    if (!reloadToken || !modelKey) return
    // Sin buffer adquirido no hay nada que recargar (la carga inicial falló): `reload`
    // rechazaría con un mensaje interno que taparía el motivo real.
    if (textModels.refCount(modelKey) === 0) return
    // `reload` usa `setValue`, que devuelve la vista al principio del archivo.
    const ed = refs.editor.current
    const estado = ed?.saveViewState() ?? null
    void textModels
      .reload(modelKey)
      .then((shared) => {
        // Una recarga buena borra el aviso de una anterior que falló (p. ej. un ENOENT pasajero).
        set.setLoadError(null)
        // `reload` re-detecta codificación y fin de línea: la barra de estado debe enterarse.
        refs.encoding.current = shared.encoding
        reportMeta()
        restaurarVista(refs, ed, estado)
      })
      .catch((err: unknown) => {
        set.setLoadError(mensajeDe(err))
      })
  }, [reloadToken, modelKey, reportMeta, refs, set])
}

/** Reabre con la codificación forzada: no escribe y descarta lo no guardado. */
export function useReabrirCodificacion(
  { refs, set, reportMeta }: EntornoAcciones,
  reopenEncoding: { token: number; encodingId: string } | undefined,
  modelKey: string | undefined
): void {
  useEffect(() => {
    if (!reopenEncoding || !reopenEncoding.token || reopenEncoding.token === refs.reopenToken.current) {
      return
    }
    refs.reopenToken.current = reopenEncoding.token
    const key = modelKey
    if (!key) return
    void textModels
      .reload(key, { forcedEncoding: reopenEncoding.encodingId })
      .then(() => {
        refs.encoding.current = textModels.peek(key)?.encoding ?? refs.encoding.current
        reportMeta()
      })
      .catch((err: unknown) => {
        set.setLoadError(mensajeDe(err))
      })
  }, [reopenEncoding, modelKey, reportMeta, refs, set])
}
