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
import type { PropsPaneDiffEditor, ProblemaDiff, PreviaLupa } from './diffEditorTipos'

/** Setters de estado de React (estables) que necesitan los módulos de fuera del componente. */
export interface EscritoresDiff {
  setModoEfectivo: (m: ModoDiff) => void
  setHayPlegable: (v: boolean) => void
  setErrorGuardado: (v: string | null) => void
  setEditable: (v: boolean) => void
  setNumCambios: (v: number | null) => void
  setLupa: (v: PreviaLupa | null) => void
  setProblema: (v: ProblemaDiff | null) => void
}

/** Valores de las props que los callbacks de vida larga deben ver siempre actuales. */
export interface VivoDiff {
  claveModelo: string | undefined
  contenido: ContenidoEnMemoria | undefined
  onGuardado: (() => void) | undefined
  onCambioSucio: ((sucio: boolean) => void) | undefined
}

/** Estado mutable del pane de diff. */
export interface InstanciaDiff {
  hostRef: RefObject<HTMLDivElement>
  diffEditorRef: MutableRefObject<editor.IStandaloneDiffEditor | null>
  vivo: VivoDiff
  set: EscritoresDiff
  /** ¿El modelo MODIFIED instalado ahora viene del registro? (propiedad del modelo, no de la corrida). */
  compartidoInstalado: boolean
  /** Desuscriptor del dirty del registro. */
  subSucio: (() => void) | null
  /** ¿El lado derecho quedó realmente editable? */
  editable: boolean
  estadoModo: EstadoModo
  ancho: number
  /** ¿Este diff tiene un solo lado (alta, borrado, commit raíz)? */
  unLado: boolean
  colapsar: boolean
  /** Pide saltar al primer cambio cuando Monaco termine de calcular; de un solo uso. */
  revelarPendiente: boolean
  /** Contador que descarta los coloreados de la lupa ya superados. */
  peticionLupa: number
}

/** Extrae de las props los valores que se leen en vivo. */
export function vivoDeProps(p: PropsPaneDiffEditor): VivoDiff {
  return {
    claveModelo: p.claveModelo,
    contenido: p.contenidoEnMemoria,
    onGuardado: p.onGuardado,
    onCambioSucio: p.onCambioSucio
  }
}

/** Crea la instancia con el estado de partida del pane. */
export function crearInstancia(
  unLado: boolean,
  colapsar: boolean,
  vivo: VivoDiff,
  set: EscritoresDiff
): InstanciaDiff {
  return {
    hostRef: { current: null },
    diffEditorRef: { current: null },
    vivo,
    set,
    compartidoInstalado: false,
    subSucio: null,
    editable: false,
    estadoModo: ESTADO_INICIAL,
    ancho: 0,
    unLado,
    colapsar,
    revelarPendiente: false,
    peticionLupa: 0
  }
}
