// =============================================================================
// Tipos del pane de diff: qué pedir a cada lado, las props del componente, el
// aviso ya traducido y las filas de la lupa del scrollbar. Solo tipos, sin JSX ni DOM.
// Lo usan DiffEditorPane y los módulos diffEditor* que lo reparten.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { ReactNode } from 'react'
import type { FileStatus } from '../../../../shared/git-ipc'
import type { ContenidoEnMemoria } from '../git'

/** Origen del contenido de un lado del diff. */
export type DiffSideSource = 'commit' | 'empty' | 'worktree' | 'index'

/** Qué pedir a un lado del diff, discriminado por `source`. */
export interface DiffSide {
  source: DiffSideSource
  /** Presente solo cuando source==='commit'. */
  hash?: string
  /** Ruta (POSIX) a pedir. */
  path: string
}

/** Un diff a mostrar: metadatos de commit/archivo y qué pedir a cada lado. */
export interface DiffTarget {
  /** Hash del commit seleccionado (para el encabezado). */
  commitHash: string
  status: FileStatus
  /** Ruta a mostrar (destino en el caso de un rename). */
  path: string
  /** Ruta origen, solo para rename (status 'R'). */
  oldPath?: string
  before: DiffSide
  after: DiffSide
}

/** Un problema al abrir el diff, ya traducido a lenguaje de usuario. */
export interface DiffProblem {
  title: string
  hint?: string
  /** Solo en fallos inesperados: el error crudo tras un desplegable. */
  detail?: string
}

/** Props del pane de diff. */
export interface DiffEditorPaneProps {
  target: DiffTarget
  /** Pane activo; el inactivo se oculta con display:none sin desmontarse. */
  visible: boolean
  /** Abre el archivo en la línea mirada. Sin él, el botón se apaga en vez de esconderse. */
  onSaltarAlFuente?: (linea: number) => void
  /** Clave del buffer compartido del lado derecho; solo cuenta si el diff es editable. */
  modelKey?: string
  /** Tras un guardado exitoso: App recuenta el working-tree. */
  onSaved?: () => void
  /** Eleva el estado sucio del buffer compartido a App. */
  onDirtyChange?: (dirty: boolean) => void
  /** Señal de recarga desde disco: re-lee el buffer compartido mutándolo. 0/undefined = ninguna. */
  reloadToken?: number
  /** Esconde los fragmentos sin cambios. Ajuste global y recordado, baja como prop. */
  colapsarSinCambios?: boolean
  /** El usuario pulsó el botón de colapsar; App lo persiste. */
  onColapsarSinCambios?: (valor: boolean) => void
  /** Los dos lados ya resueltos por quien monta el pane; su presencia apaga la edición. */
  contenidoEnMemoria?: ContenidoEnMemoria
  /** Sustituye el rótulo de identidad de la cabecera. */
  identidad?: ReactNode
  /** Se pinta entre la cabecera y el editor. */
  sobreElHost?: ReactNode
  /** Aviso puesto por quien monta el pane; manda sobre el que el pane se da a sí mismo. */
  aviso?: DiffProblem | null
}

/** Marca de una fila de la lupa: añadida, cambiada, borrada (del original) o contexto. */
export type LensRowKind = 'add' | 'change' | 'del' | null

/** Una fila del mini-diff de la lupa, ya coloreada; `center` es la línea apuntada. */
export interface LensRow {
  key: string
  num: number
  html: string
  kind: LensRowKind
  center: boolean
}

/** Un preview de la lupa: filas y posición del cursor. */
export interface LensPreview {
  rows: LensRow[]
  x: number
  y: number
}
