// =============================================================================
// Tipos del árbol del explorador: el diálogo activo, el objetivo del menú contextual,
// las props de `FileTree` y `Arbol`, el estado que devuelven sus hooks y que reciben
// las funciones de operaciones, menú y teclado (`operacionesArbol` no importa de las otras).
// Solo tipos: no hay lógica ni imports de valor.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { FileEntry } from '../../../../shared/files-ipc'
import type { OpenFile } from '../editor'
import type { WorktreeDecorations } from '../git'
import type { FlatRow } from './treeFlatten'
import type { FuentePegado } from './fileClipboard'
import type {
  ElementoFantasma,
  EstadoSeleccion,
  FilaNodo,
  ModificadoresClic
} from './seleccionArbol'

/** Lo que el explorador necesita para montar un archivo de base de datos del proyecto. */
export interface BasesDeArchivoSidebar {
  /** Id de la conexión montada que es este archivo, o null si no hay ninguna. */
  montadaDe: (relPath: string) => Promise<string | null>
  /** Da de alta (o reutiliza) la conexión del archivo y la monta en el proyecto. */
  montar: (relPath: string) => Promise<void>
  /** Quita la conexión de los montajes del proyecto (la conexión sigue en Conexiones). */
  desmontar: (conexionId: string) => void
}

/** Diálogo activo del árbol; `dir` es la carpeta contenedora ("" = raíz). */
export type FileDialog =
  | { kind: 'newFile' | 'newFolder'; dir: string }
  | { kind: 'rename'; path: string; name: string }
  /** Borrado de uno o de varios: `paths` ya viene minimizado y sin rutas virtuales. */
  | { kind: 'delete'; paths: string[]; nombres: string[]; hayCarpeta: boolean }
  | null

/**
 * Sobre qué se abrió el menú contextual. `objetivo` (acciones que escriben) y `legibles`
 * (las que solo leen) se calculan al abrir, para que la etiqueta prometa lo que se hace.
 */
export type MenuTarget =
  | { kind: 'nodo'; path: string; isDir: boolean; objetivo: string[]; legibles: string[] }
  | { kind: 'raiz' }

/** Menú contextual abierto, con lo que hubo que preguntar al main antes de pintarlo. */
export interface EstadoMenu {
  x: number
  y: number
  target: MenuTarget
  pegable: FuentePegado
  /** Archivo de base de datos: la conexión que ya lo monta, o null si se ofrece montarlo. */
  bd: { montadaId: string | null } | null
}

/** Importación pendiente de confirmar: el destino ya tenía esos nombres. */
export interface ConflictoImportacion {
  hostPaths: string[]
  destDir: string
  conflicts: string[]
}

/** Props de `FileTree`, el árbol de UN proyecto. */
export interface PropsFileTree {
  projectHostPath: string
  projectName: string
  /** Alto de fila en px (lo decide el tamaño de letra de la interfaz). */
  altoFila: number
  /** Carpetas abiertas recordadas de una visita anterior a este proyecto. */
  initialExpanded?: Set<string>
  /** Reporta las carpetas abiertas para recordarlas entre remontajes. */
  onExpandedChange: (projectHostPath: string, expanded: Set<string>) => void
  openFile: OpenFile | null
  decorations: WorktreeDecorations | null
  onOpenFile: (file: OpenFile) => void
  onOpenFileHistory: (path: string) => void
  onDiscardChanges: (path: string) => void
  /** Ruta a desplegar y traer a la vista, con token para poder pedir la misma dos veces. */
  revelarRuta?: { path: string; token: number }
  basesDeArchivo?: BasesDeArchivoSidebar
}

type Poner<T> = Dispatch<SetStateAction<T>>

/** Todo el estado de un `FileTree` en un render: lo que devuelve `useArbol`. */
export interface Arbol {
  props: PropsFileTree
  rootEntries: FileEntry[] | null
  error: string | null
  rows: FlatRow[]
  clavesNodo: string[]
  filaPorClave: ReadonlyMap<string, FilaNodo>
  /** Rutas de una selección tal como se arrastran (primer segmento de la cadena). */
  rutasArrastre: (claves: Iterable<string>) => string[]
  /** Rutas de una selección para el resto de acciones (la hoja de la cadena). */
  rutasHoja: (claves: Iterable<string>) => string[]
  revealIndex: number | null
  toggleExpand: (leafPath: string) => void
  bumpRefresh: () => void
  setRevealPath: Poner<string | null>
  menu: EstadoMenu | null
  setMenu: Poner<EstadoMenu | null>
  menuGenRef: MutableRefObject<number>
  treeRef: MutableRefObject<HTMLDivElement | null>
  dialog: FileDialog
  setDialog: Poner<FileDialog>
  dialogError: string | null
  setDialogError: Poner<string | null>
  seleccion: EstadoSeleccion
  setSeleccion: Poner<EstadoSeleccion>
  clicPendienteRef: MutableRefObject<string | null>
  selectedDir: string
  setSelectedDir: Poner<string>
  arrastrados: string[]
  setArrastrados: Poner<string[]>
  opError: string | null
  setOpError: Poner<string | null>
  importConflict: ConflictoImportacion | null
  setImportConflict: Poner<ConflictoImportacion | null>
  cutPaths: ReadonlySet<string>
  fantasma: { lineas: ElementoFantasma[]; resto: number }
  arrastrarFuera: (rutas: readonly string[], icono: string) => void
}

/** Props de una fila del árbol (`TreeRow`). */
export interface TreeRowProps {
  /** Fila de nodo ya aplanada: la expansión y la cadena vienen resueltas. */
  row: FilaNodo
  activePath: string | null
  decorations: WorktreeDecorations | null
  /** Carpeta «actual» (destino de creación) para resaltarla. */
  selectedDir: string
  /** Un boolean y no el Set: una fila no se repinta si cambia una selección que no la incluye. */
  seleccionada: boolean
  /** Fila líder de la selección (de la que se mide el rango de Mayús). */
  lider: boolean
  /** Rutas cortadas pendientes de pegar: se pintan atenuadas. */
  cutPaths: ReadonlySet<string>
  /** Rutas que se arrastran ahora dentro del árbol; vacío = no hay arrastre interno. */
  arrastrados: readonly string[]
  /** Líneas que pinta el fantasma del arrastre múltiple y cuántas se quedan fuera. */
  fantasma: { lineas: ElementoFantasma[]; resto: number }
  altoFila: number
  onOpenFile: (file: OpenFile) => void
  /** Marca esta carpeta (o la del archivo) como la «actual» para crear. */
  onSelectDir: (dir: string) => void
  /** Aplica el clic sobre la fila; devuelve true si además hay que activarla. */
  onClicFila: (clave: string, mods: ModificadoresClic, fase: 'abajo' | 'arriba') => boolean
  onToggleExpand: (leafPath: string) => void
  /** Empieza a arrastrar desde la fila; devuelve las rutas que se van a mover. */
  onDragStartNode: (clave: string) => string[]
  /** Saca varias rutas por el arrastre nativo; el estado que lo apaga vive en el árbol. */
  onArrastreFuera: (rutas: readonly string[], icono: string) => void
  onDragEndNode: () => void
  onMoveNode: (srcs: readonly string[], destDir: string) => void
  /** Copia al proyecto lo soltado desde el sistema (rutas del host) dentro de `destDir`. */
  onImportNode: (hostPaths: string[], destDir: string) => void
  onNodeContextMenu: (x: number, y: number, clave: string, isDir: boolean) => void
}
