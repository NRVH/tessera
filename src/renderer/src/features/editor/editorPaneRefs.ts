// =============================================================================
// Refs y avisos que PaneEditor comparte con los hooks que lo componen.
// Los refs viven en un objeto de identidad estable (uno por pane) y los efectos
// registrados una sola vez leen por él el valor ACTUAL de las props espejadas.
// Lo usan PaneEditor y sus hooks; no sale de la carpeta del editor.
// =============================================================================
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { editor, IDisposable } from 'monaco-editor'
import type { PeticionConversionEditor, PropsPaneEditor } from './editorPaneTipos'

interface Ref<T> {
  current: T
}

/** Refs de un PaneEditor; el objeto es el mismo durante toda la vida del pane. */
export interface PaneRefs {
  host: Ref<HTMLDivElement | null>
  editor: Ref<editor.IStandaloneCodeEditor | null>
  revelarPendiente: Ref<{ linea: number; columna: number } | null>
  /** Versión alternativa del último guardado (solo buffers sin título). */
  versionGuardada: Ref<number>
  claveModelo: Ref<string | undefined>
  /** El modelo puesto en el editor es del registro: lo suelta la carga, nunca se dispone aquí. */
  modeloCompartido: Ref<boolean>
  subSucio: Ref<(() => void) | null>
  borradoSub: Ref<(() => void) | null>
  sinTituloId: Ref<string | undefined>
  onGuardarSinTitulo: Ref<PropsPaneEditor['onGuardarSinTitulo']>
  guardar: Ref<(() => Promise<void>) | null>
  /** Id del buffer sin título ya inicializado. */
  sinTituloIniciado: Ref<string | null>
  onGuardado: Ref<PropsPaneEditor['onGuardado']>
  onCambioSucio: Ref<PropsPaneEditor['onCambioSucio']>
  onCambioBorrado: Ref<PropsPaneEditor['onCambioBorrado']>
  onMeta: Ref<PropsPaneEditor['onMeta']>
  onModoVista: Ref<PropsPaneEditor['onModoVista']>
  encoding: Ref<string>
  fnConvertir: Ref<((req: PeticionConversionEditor) => Promise<void>) | null>
  tokenConversion: Ref<number>
  tokenReapertura: Ref<number>
  /** Listener de cambios del modelo local (solo buffers sin título). */
  subCambio: Ref<IDisposable | null>
}

function crearRefs(props: PropsPaneEditor): PaneRefs {
  return {
    host: { current: null },
    editor: { current: null },
    revelarPendiente: { current: null },
    versionGuardada: { current: 0 },
    claveModelo: { current: props.claveModelo },
    modeloCompartido: { current: false },
    subSucio: { current: null },
    borradoSub: { current: null },
    sinTituloId: { current: props.sinTituloId },
    onGuardarSinTitulo: { current: props.onGuardarSinTitulo },
    guardar: { current: null },
    sinTituloIniciado: { current: null },
    onGuardado: { current: props.onGuardado },
    onCambioSucio: { current: props.onCambioSucio },
    onCambioBorrado: { current: props.onCambioBorrado },
    onMeta: { current: props.onMeta },
    onModoVista: { current: props.onModoVista },
    encoding: { current: 'utf8' },
    fnConvertir: { current: null },
    tokenConversion: { current: 0 },
    tokenReapertura: { current: 0 },
    subCambio: { current: null }
  }
}

/** Crea los refs del pane y espeja en ellos, en cada render, las props que leen los efectos. */
export function useRefsPane(props: PropsPaneEditor): PaneRefs {
  const [refs] = useState(() => crearRefs(props))
  refs.claveModelo.current = props.claveModelo
  refs.sinTituloId.current = props.sinTituloId
  refs.onGuardarSinTitulo.current = props.onGuardarSinTitulo
  refs.onGuardado.current = props.onGuardado
  refs.onCambioSucio.current = props.onCambioSucio
  refs.onCambioBorrado.current = props.onCambioBorrado
  refs.onMeta.current = props.onMeta
  refs.onModoVista.current = props.onModoVista
  return refs
}

/** Escritores de los tres avisos del pane; su identidad no cambia entre renders. */
export interface EscritoresAviso {
  setErrorCarga: Dispatch<SetStateAction<string | null>>
  setAviso: Dispatch<SetStateAction<string | null>>
  setErrorGuardado: Dispatch<SetStateAction<string | null>>
}

/** Estado de los avisos del pane: error de carga, aviso informativo y error de guardado. */
export function useAvisosPane(): {
  errorCarga: string | null
  aviso: string | null
  errorGuardado: string | null
  set: EscritoresAviso
} {
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)
  const set = useMemo(() => ({ setErrorCarga, setAviso, setErrorGuardado }), [])
  return { errorCarga, aviso, errorGuardado, set }
}

/** Funciones estables que elevan a App el estado sucio y la codificación/fin de línea. */
export function useNotificacionesPane(refs: PaneRefs): {
  aplicarSucio: (siguiente: boolean) => void
  informarMeta: () => void
} {
  const informarMeta = useCallback((): void => {
    const modelo = refs.editor.current?.getModel()
    if (!modelo) {
      refs.onMeta.current?.(null)
      return
    }
    refs.onMeta.current?.({
      encodingId: refs.encoding.current,
      eol: modelo.getEOL() === '\r\n' ? 'CRLF' : 'LF'
    })
  }, [refs])
  const aplicarSucio = useCallback(
    (siguiente: boolean) => {
      refs.onCambioSucio.current?.(siguiente)
    },
    [refs]
  )
  return { aplicarSucio, informarMeta }
}
