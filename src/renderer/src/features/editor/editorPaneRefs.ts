// =============================================================================
// Refs y avisos que EditorPane comparte con los hooks que lo componen.
// Los refs viven en un objeto de identidad estable (uno por pane) y los efectos
// registrados una sola vez leen por él el valor ACTUAL de las props espejadas.
// Lo usan EditorPane y sus hooks; no sale de la carpeta del editor.
// =============================================================================
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { editor, IDisposable } from 'monaco-editor'
import type { EditorConvertReq, EditorPaneProps } from './editorPaneTipos'

interface Ref<T> {
  current: T
}

/** Refs de un EditorPane; el objeto es el mismo durante toda la vida del pane. */
export interface RefsPane {
  host: Ref<HTMLDivElement | null>
  editor: Ref<editor.IStandaloneCodeEditor | null>
  revelarPendiente: Ref<{ linea: number; columna: number } | null>
  /** Versión alternativa del último guardado (solo buffers sin título). */
  savedVersion: Ref<number>
  modelKey: Ref<string | undefined>
  /** El modelo puesto en el editor es del registro: lo suelta la carga, nunca se dispone aquí. */
  modeloCompartido: Ref<boolean>
  dirtySub: Ref<(() => void) | null>
  borradoSub: Ref<(() => void) | null>
  untitledId: Ref<string | undefined>
  onSaveUntitled: Ref<EditorPaneProps['onSaveUntitled']>
  save: Ref<(() => Promise<void>) | null>
  /** Id del buffer sin título ya inicializado. */
  untitledInited: Ref<string | null>
  onSaved: Ref<EditorPaneProps['onSaved']>
  onDirtyChange: Ref<EditorPaneProps['onDirtyChange']>
  onBorradoChange: Ref<EditorPaneProps['onBorradoChange']>
  onMeta: Ref<EditorPaneProps['onMeta']>
  onModoVista: Ref<EditorPaneProps['onModoVista']>
  encoding: Ref<string>
  convertFn: Ref<((req: EditorConvertReq) => Promise<void>) | null>
  convertToken: Ref<number>
  reopenToken: Ref<number>
  /** Listener de cambios del modelo local (solo buffers sin título). */
  changeSub: Ref<IDisposable | null>
}

function crearRefs(props: EditorPaneProps): RefsPane {
  return {
    host: { current: null },
    editor: { current: null },
    revelarPendiente: { current: null },
    savedVersion: { current: 0 },
    modelKey: { current: props.modelKey },
    modeloCompartido: { current: false },
    dirtySub: { current: null },
    borradoSub: { current: null },
    untitledId: { current: props.untitledId },
    onSaveUntitled: { current: props.onSaveUntitled },
    save: { current: null },
    untitledInited: { current: null },
    onSaved: { current: props.onSaved },
    onDirtyChange: { current: props.onDirtyChange },
    onBorradoChange: { current: props.onBorradoChange },
    onMeta: { current: props.onMeta },
    onModoVista: { current: props.onModoVista },
    encoding: { current: 'utf8' },
    convertFn: { current: null },
    convertToken: { current: 0 },
    reopenToken: { current: 0 },
    changeSub: { current: null }
  }
}

/** Crea los refs del pane y espeja en ellos, en cada render, las props que leen los efectos. */
export function useRefsPane(props: EditorPaneProps): RefsPane {
  const [refs] = useState(() => crearRefs(props))
  refs.modelKey.current = props.modelKey
  refs.untitledId.current = props.untitledId
  refs.onSaveUntitled.current = props.onSaveUntitled
  refs.onSaved.current = props.onSaved
  refs.onDirtyChange.current = props.onDirtyChange
  refs.onBorradoChange.current = props.onBorradoChange
  refs.onMeta.current = props.onMeta
  refs.onModoVista.current = props.onModoVista
  return refs
}

/** Escritores de los tres avisos del pane; su identidad no cambia entre renders. */
export interface EscritoresAviso {
  setLoadError: Dispatch<SetStateAction<string | null>>
  setNotice: Dispatch<SetStateAction<string | null>>
  setSaveError: Dispatch<SetStateAction<string | null>>
}

/** Estado de los avisos del pane: error de carga, aviso informativo y error de guardado. */
export function useAvisosPane(): {
  loadError: string | null
  notice: string | null
  saveError: string | null
  set: EscritoresAviso
} {
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const set = useMemo(() => ({ setLoadError, setNotice, setSaveError }), [])
  return { loadError, notice, saveError, set }
}

/** Funciones estables que elevan a App el estado sucio y la codificación/fin de línea. */
export function useNotificacionesPane(refs: RefsPane): {
  applyDirty: (next: boolean) => void
  reportMeta: () => void
} {
  const reportMeta = useCallback((): void => {
    const model = refs.editor.current?.getModel()
    if (!model) {
      refs.onMeta.current?.(null)
      return
    }
    refs.onMeta.current?.({
      encodingId: refs.encoding.current,
      eol: model.getEOL() === '\r\n' ? 'CRLF' : 'LF'
    })
  }, [refs])
  const applyDirty = useCallback(
    (next: boolean) => {
      refs.onDirtyChange.current?.(next)
    },
    [refs]
  )
  return { applyDirty, reportMeta }
}
