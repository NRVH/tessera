// =============================================================================
// Tipos del pane de diff: qué pedir a cada lado, las props del componente, el
// aviso ya traducido y las filas de la lupa del scrollbar. Solo tipos, sin JSX ni DOM.
// Lo usan PaneDiffEditor y los módulos diffEditor* que lo reparten.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { ReactNode } from 'react'
import type { EstadoArchivo } from '../../../../shared/git-ipc'
import type { ContenidoEnMemoria } from '../git'

/** Origen del contenido de un lado del diff. */
export type OrigenLadoDiff = 'commit' | 'empty' | 'worktree' | 'index'

/** Qué pedir a un lado del diff, discriminado por `source`. */
export interface LadoDiff {
  origen: OrigenLadoDiff
  /** Presente solo cuando source==='commit'. */
  hash?: string
  /** Ruta (POSIX) a pedir. */
  ruta: string
}

/** Un diff a mostrar: metadatos de commit/archivo y qué pedir a cada lado. */
export interface DestinoDiff {
  /** Hash del commit seleccionado (para el encabezado). */
  commitHash: string
  estado: EstadoArchivo
  /** Ruta a mostrar (destino en el caso de un rename). */
  ruta: string
  /** Ruta origen, solo para rename (status 'R'). */
  rutaAnterior?: string
  antes: LadoDiff
  despues: LadoDiff
}

/** Un problema al abrir el diff, ya traducido a lenguaje de usuario. */
export interface ProblemaDiff {
  titulo: string
  pista?: string
  /** Solo en fallos inesperados: el error crudo tras un desplegable. */
  detalle?: string
}

/** Props del pane de diff. */
export interface PropsPaneDiffEditor {
  destino: DestinoDiff
  /** Pane activo; el inactivo se oculta con display:none sin desmontarse. */
  visible: boolean
  /** Abre el archivo en la línea mirada. Sin él, el botón se apaga en vez de esconderse. */
  onSaltarAlFuente?: (linea: number) => void
  /** Clave del buffer compartido del lado derecho; solo cuenta si el diff es editable. */
  claveModelo?: string
  /** Tras un guardado exitoso: App recuenta el working-tree. */
  onGuardado?: () => void
  /** Eleva el estado sucio del buffer compartido a App. */
  onCambioSucio?: (sucio: boolean) => void
  /** Señal de recarga desde disco: re-lee el buffer compartido mutándolo. 0/undefined = ninguna. */
  tokenRecarga?: number
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
  aviso?: ProblemaDiff | null
}

/** Marca de una fila de la lupa: añadida, cambiada, borrada (del original) o contexto. */
export type TipoFilaLupa = 'add' | 'change' | 'del' | null

/** Una fila del mini-diff de la lupa, ya coloreada; `center` es la línea apuntada. */
export interface FilaLupa {
  clave: string
  num: number
  html: string
  tipo: TipoFilaLupa
  centro: boolean
}

/** Un preview de la lupa: filas y posición del cursor. */
export interface PreviaLupa {
  filas: FilaLupa[]
  x: number
  y: number
}
