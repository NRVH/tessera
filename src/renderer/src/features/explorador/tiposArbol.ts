// =============================================================================
// Tipos del árbol del explorador: el diálogo activo, el objetivo del menú contextual,
// las props de `ArbolArchivos` y `Arbol`, el estado que devuelven sus hooks y que reciben
// las funciones de operaciones, menú y teclado (`operacionesArbol` no importa de las otras).
// Solo tipos: no hay lógica ni imports de valor.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { EntradaArchivo } from '../../../../shared/archivos-ipc'
import type { ArchivoAbierto } from '../editor'
import type { DecoracionesWorktree } from '../git'
import type { FilaAplanada } from './aplanarArbol'
import type { FuentePegado } from './portapapelesArchivos'
import type {
  ElementoFantasma,
  EstadoSeleccion,
  FilaNodo,
  ModificadoresClic
} from './seleccionArbol'

/** Lo que el explorador necesita para montar un archivo de base de datos del proyecto. */
export interface BasesDeArchivoLateral {
  /** Id de la conexión montada que es este archivo, o null si no hay ninguna. */
  montadaDe: (rutaRel: string) => Promise<string | null>
  /** Da de alta (o reutiliza) la conexión del archivo y la monta en el proyecto. */
  montar: (rutaRel: string) => Promise<void>
  /** Quita la conexión de los montajes del proyecto (la conexión sigue en Conexiones). */
  desmontar: (conexionId: string) => void
}

/** Diálogo activo del árbol; `dir` es la carpeta contenedora ("" = raíz). */
export type DialogoArchivo =
  | { tipo: 'newFile' | 'newFolder'; dir: string }
  | { tipo: 'rename'; ruta: string; nombre: string }
  /** Borrado de uno o de varios: `rutas` ya viene minimizado y sin rutas virtuales. */
  | { tipo: 'delete'; rutas: string[]; nombres: string[]; hayCarpeta: boolean }
  | null

/**
 * Sobre qué se abrió el menú contextual. `objetivo` (acciones que escriben) y `legibles`
 * (las que solo leen) se calculan al abrir, para que la etiqueta prometa lo que se hace.
 */
export type DestinoMenu =
  | { tipo: 'nodo'; ruta: string; esDir: boolean; objetivo: string[]; legibles: string[] }
  | { tipo: 'raiz' }

/** Menú contextual abierto, con lo que hubo que preguntar al main antes de pintarlo. */
export interface EstadoMenu {
  x: number
  y: number
  destino: DestinoMenu
  pegable: FuentePegado
  /** Archivo de base de datos: la conexión que ya lo monta, o null si se ofrece montarlo. */
  bd: { montadaId: string | null } | null
}

/** Importación pendiente de confirmar: el destino ya tenía esos nombres. */
export interface ConflictoImportacion {
  rutasHost: string[]
  destDir: string
  conflictos: string[]
}

/** Props de `ArbolArchivos`, el árbol de UN proyecto. */
export interface PropsArbolArchivos {
  rutaHostProyecto: string
  nombreProyecto: string
  /**
   * ¿Es el árbol que se ve? Los demás siguen montados (`comun/useVivosRecientes`) pero no relistan con los
   * avisos del vigilante, que son del proyecto anclado: se refrescan una vez al volver a verse.
   */
  activo: boolean
  /** Alto de fila en px (lo decide el tamaño de letra de la interfaz). */
  altoFila: number
  /** Carpetas abiertas recordadas de una visita anterior a este proyecto. */
  expandidasIniciales?: Set<string>
  /** Reporta las carpetas abiertas para recordarlas entre remontajes. */
  onCambioExpandidas: (rutaHostProyecto: string, expandidas: Set<string>) => void
  archivoAbierto: ArchivoAbierto | null
  decoraciones: DecoracionesWorktree | null
  onAbrirArchivo: (archivo: ArchivoAbierto) => void
  onAbrirHistorialArchivo: (ruta: string) => void
  onDescartarCambios: (ruta: string) => void
  /** Ruta a desplegar y traer a la vista, con token para poder pedir la misma dos veces. */
  revelarRuta?: { ruta: string; token: number }
  basesDeArchivo?: BasesDeArchivoLateral
}

type Poner<T> = Dispatch<SetStateAction<T>>

/** Todo el estado de un `ArbolArchivos` en un render: lo que devuelve `useArbol`. */
export interface Arbol {
  props: PropsArbolArchivos
  entradasRaiz: EntradaArchivo[] | null
  error: string | null
  filas: FilaAplanada[]
  clavesNodo: string[]
  filaPorClave: ReadonlyMap<string, FilaNodo>
  /** Rutas de una selección tal como se arrastran (primer segmento de la cadena). */
  rutasArrastre: (claves: Iterable<string>) => string[]
  /** Rutas de una selección para el resto de acciones (la hoja de la cadena). */
  rutasHoja: (claves: Iterable<string>) => string[]
  indicePorRevelar: number | null
  alternarExpandido: (rutaHoja: string) => void
  forzarRefresco: () => void
  setRutaPorRevelar: Poner<string | null>
  menu: EstadoMenu | null
  setMenu: Poner<EstadoMenu | null>
  menuGenRef: MutableRefObject<number>
  arbolRef: MutableRefObject<HTMLDivElement | null>
  dialogo: DialogoArchivo
  setDialogo: Poner<DialogoArchivo>
  errorDialogo: string | null
  setErrorDialogo: Poner<string | null>
  seleccion: EstadoSeleccion
  setSeleccion: Poner<EstadoSeleccion>
  clicPendienteRef: MutableRefObject<string | null>
  dirSeleccionado: string
  setDirSeleccionado: Poner<string>
  arrastrados: string[]
  setArrastrados: Poner<string[]>
  opError: string | null
  setOpError: Poner<string | null>
  conflictoImportacion: ConflictoImportacion | null
  setConflictoImportacion: Poner<ConflictoImportacion | null>
  rutasCortadas: ReadonlySet<string>
  fantasma: { lineas: ElementoFantasma[]; resto: number }
  arrastrarFuera: (rutas: readonly string[], icono: string) => void
}

/** Props de una fila del árbol (`FilaArbolArchivos`). */
export interface PropsFilaArbolArchivos {
  /** Fila de nodo ya aplanada: la expansión y la cadena vienen resueltas. */
  fila: FilaNodo
  rutaActiva: string | null
  decoraciones: DecoracionesWorktree | null
  /** Carpeta «actual» (destino de creación) para resaltarla. */
  dirSeleccionado: string
  /** Un boolean y no el Set: una fila no se repinta si cambia una selección que no la incluye. */
  seleccionada: boolean
  /** Fila líder de la selección (de la que se mide el rango de Mayús). */
  lider: boolean
  /** Rutas cortadas pendientes de pegar: se pintan atenuadas. */
  rutasCortadas: ReadonlySet<string>
  /** Rutas que se arrastran ahora dentro del árbol; vacío = no hay arrastre interno. */
  arrastrados: readonly string[]
  /** Líneas que pinta el fantasma del arrastre múltiple y cuántas se quedan fuera. */
  fantasma: { lineas: ElementoFantasma[]; resto: number }
  altoFila: number
  onAbrirArchivo: (archivo: ArchivoAbierto) => void
  /** Marca esta carpeta (o la del archivo) como la «actual» para crear. */
  onSeleccionarDir: (dir: string) => void
  /** Aplica el clic sobre la fila; devuelve true si además hay que activarla. */
  onClicFila: (clave: string, mods: ModificadoresClic, fase: 'abajo' | 'arriba') => boolean
  onAlternarExpandido: (rutaHoja: string) => void
  /** Empieza a arrastrar desde la fila; devuelve las rutas que se van a mover. */
  onIniciarArrastreNodo: (clave: string) => string[]
  /** Saca varias rutas por el arrastre nativo; el estado que lo apaga vive en el árbol. */
  onArrastreFuera: (rutas: readonly string[], icono: string) => void
  onTerminarArrastreNodo: () => void
  onMoverNodo: (srcs: readonly string[], destDir: string) => void
  /** Copia al proyecto lo soltado desde el sistema (rutas del host) dentro de `destDir`. */
  onImportarNodo: (rutasHost: string[], destDir: string) => void
  onMenuContextualNodo: (x: number, y: number, clave: string, esDir: boolean) => void
}
