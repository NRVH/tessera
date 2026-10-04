// =============================================================================
// Instancia mutable de un pane de diff: lo que sus efectos y los callbacks que
// Monaco registra una sola vez leen y escriben sin pasar por el render.
// Sustituye a los useRef sueltos; su identidad es estable durante la vida del pane.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { MutableRefObject, RefObject } from 'react'
import type { editor } from 'monaco-editor'
import type { ContenidoEnMemoria } from '../git'
import { ESTADO_INICIAL, type EstadoModo, type ModoDiff } from './modoDiff'
import type { DiffEditorPaneProps, DiffProblem, LensPreview } from './diffEditorTipos'

/** Setters de estado de React (estables) que necesitan los módulos de fuera del componente. */
export interface SettersDiff {
  setModoEfectivo: (m: ModoDiff) => void
  setHayPlegable: (v: boolean) => void
  setSaveError: (v: string | null) => void
  setEditable: (v: boolean) => void
  setNumCambios: (v: number | null) => void
  setLens: (v: LensPreview | null) => void
  setProblem: (v: DiffProblem | null) => void
}

/** Valores de las props que los callbacks de vida larga deben ver siempre actuales. */
export interface VivoDiff {
  modelKey: string | undefined
  contenido: ContenidoEnMemoria | undefined
  onSaved: (() => void) | undefined
  onDirtyChange: ((dirty: boolean) => void) | undefined
}

/** Estado mutable del pane de diff. */
export interface InstanciaDiff {
  hostRef: RefObject<HTMLDivElement>
  diffEditorRef: MutableRefObject<editor.IStandaloneDiffEditor | null>
  vivo: VivoDiff
  set: SettersDiff
  /** ¿El modelo MODIFIED instalado ahora viene del registro? (propiedad del modelo, no de la corrida). */
  installedShared: boolean
  /** Desuscriptor del dirty del registro. */
  dirtySub: (() => void) | null
  /** ¿El lado derecho quedó realmente editable? */
  editable: boolean
  estadoModo: EstadoModo
  ancho: number
  /** ¿Este diff tiene un solo lado (alta, borrado, commit raíz)? */
  unLado: boolean
  colapsar: boolean
  /** Pide saltar al primer cambio cuando Monaco termine de calcular; de un solo uso. */
  pendingReveal: boolean
  /** Contador que descarta los coloreados de la lupa ya superados. */
  lensReq: number
}

/** Extrae de las props los valores que se leen en vivo. */
export function vivoDeProps(p: DiffEditorPaneProps): VivoDiff {
  return {
    modelKey: p.modelKey,
    contenido: p.contenidoEnMemoria,
    onSaved: p.onSaved,
    onDirtyChange: p.onDirtyChange
  }
}

/** Crea la instancia con el estado de partida del pane. */
export function crearInstancia(
  unLado: boolean,
  colapsar: boolean,
  vivo: VivoDiff,
  set: SettersDiff
): InstanciaDiff {
  return {
    hostRef: { current: null },
    diffEditorRef: { current: null },
    vivo,
    set,
    installedShared: false,
    dirtySub: null,
    editable: false,
    estadoModo: ESTADO_INICIAL,
    ancho: 0,
    unLado,
    colapsar,
    pendingReveal: false,
    lensReq: 0
  }
}
