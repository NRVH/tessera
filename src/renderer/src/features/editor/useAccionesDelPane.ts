// =============================================================================
// Peticiones que llegan a un PaneEditor desde fuera y disparan al subir su token:
// guardar, convertir codificación o fin de línea, recargar de disco y reabrir con
// otra codificación. Recargar y reabrir mutan el buffer compartido in-place.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { modelosTexto } from './registroModelosTexto'
import type { PeticionConversionEditor } from './editorPaneTipos'
import type { EscritoresAviso, PaneRefs } from './editorPaneRefs'

interface EntornoAcciones {
  refs: PaneRefs
  set: EscritoresAviso
  informarMeta: () => void
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Guardado pedido desde fuera (menú de la pestaña): el mismo camino que Ctrl+S. */
export function useGuardarPorToken(refs: PaneRefs, tokenGuardado: number | undefined): void {
  useEffect(() => {
    if (!tokenGuardado) return
    void refs.guardar.current?.()
  }, [tokenGuardado, refs])
}

/** Conversión pedida desde la barra de estado; el token evita repetirla. */
export function useConvertirPorToken(refs: PaneRefs, peticionConversion: PeticionConversionEditor | undefined): void {
  useEffect(() => {
    if (!peticionConversion || !peticionConversion.token || peticionConversion.token === refs.tokenConversion.current) return
    refs.tokenConversion.current = peticionConversion.token
    void refs.fnConvertir.current?.(peticionConversion)
  }, [peticionConversion, refs])
}

function restaurarVista(
  refs: PaneRefs,
  editorMonaco: editor.IStandaloneCodeEditor | null | undefined,
  estado: editor.ICodeEditorViewState | null
): void {
  // Solo si el editor sigue siendo el mismo: entre medias pudo cambiarse de pestaña.
  // Aparte del resto para no confundir este fallo con «no se pudo abrir el archivo».
  try {
    if (estado && refs.editor.current === editorMonaco) editorMonaco?.restoreViewState(estado)
  } catch {
    /* cosmético: el contenido ya está bien */
  }
}

/** Recarga desde disco al subir el token, conservando scroll y cursor. */
export function useRecargaPorToken(
  { refs, set, informarMeta }: EntornoAcciones,
  tokenRecarga: number | undefined,
  claveModelo: string | undefined
): void {
  useEffect(() => {
    if (!tokenRecarga || !claveModelo) return
    // Sin buffer adquirido no hay nada que recargar (la carga inicial falló): `reload`
    // rechazaría con un mensaje interno que taparía el motivo real.
    if (modelosTexto.contarRefs(claveModelo) === 0) return
    // `reload` usa `setValue`, que devuelve la vista al principio del archivo.
    const editorMonaco = refs.editor.current
    const estado = editorMonaco?.saveViewState() ?? null
    void modelosTexto
      .recargar(claveModelo)
      .then((shared) => {
        // Una recarga buena borra el aviso de una anterior que falló (p. ej. un ENOENT pasajero).
        set.setErrorCarga(null)
        // `reload` re-detecta codificación y fin de línea: la barra de estado debe enterarse.
        refs.encoding.current = shared.encoding
        informarMeta()
        restaurarVista(refs, editorMonaco, estado)
      })
      .catch((err: unknown) => {
        set.setErrorCarga(mensajeDe(err))
      })
  }, [tokenRecarga, claveModelo, informarMeta, refs, set])
}

/** Reabre con la codificación forzada: no escribe y descarta lo no guardado. */
export function useReabrirCodificacion(
  { refs, set, informarMeta }: EntornoAcciones,
  peticionReapertura: { token: number; encodingId: string } | undefined,
  claveModelo: string | undefined
): void {
  useEffect(() => {
    if (!peticionReapertura || !peticionReapertura.token || peticionReapertura.token === refs.tokenReapertura.current) {
      return
    }
    refs.tokenReapertura.current = peticionReapertura.token
    const clave = claveModelo
    if (!clave) return
    void modelosTexto
      .recargar(clave, { encodingForzado: peticionReapertura.encodingId })
      .then(() => {
        refs.encoding.current = modelosTexto.consultar(clave)?.encoding ?? refs.encoding.current
        informarMeta()
      })
      .catch((err: unknown) => {
        set.setErrorCarga(mensajeDe(err))
      })
  }, [peticionReapertura, claveModelo, informarMeta, refs, set])
}
