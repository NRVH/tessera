// =============================================================================
// Tipos de la rejilla de datos: lo que recibe del dueño (edición, acciones) y el
// contexto que comparten sus piezas en cada render (refs, vista, geometría, estado).
// Solo tipos: lo importan `DbRejilla.tsx` y los módulos `rejilla/Rejilla*`, `useRejilla*`.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { DbCelda } from '../../../../../shared/db-explorador-ipc'
import type { DbRejillaProps } from '../propsBd'
import type { CambiosRejilla, RefFila, VistaFilas } from './cambiosRejilla'
import type { DatosRejilla, MapaRecortes } from './celdasRejilla'
import type { Celda, Seleccion } from './seleccionRejilla'
import type { Ventana } from './ventanaRejilla'

/** Lo que el dueño hace desde su barra (añadir, borrar lo seleccionado) o tras enviar. */
export interface AccionesEdicionRejilla {
  anadirFila: () => void
  borrarSeleccion: () => void
  /** Devuelve el foco a la rejilla (tras cerrar el diálogo de «Enviar» con éxito). */
  enfocar: () => void
}

/**
 * La edición de una pestaña de tabla. Sin ella —la consola, una tabla de solo lectura o
 * sin identidad de fila— la rejilla es de solo lectura.
 */
export interface EdicionRejilla {
  cambios: CambiosRejilla
  onCambios: (siguiente: CambiosRejilla) => void
  /** Por columna (de las que se pintan): null = editable; si no, el porqué. */
  motivosColumna: readonly (string | null)[]
  /** Mod+Intro o «Enviar»: el dueño abre la vista previa. */
  onEnviar: () => void
  /** Fila señalada por un envío que falló (su error va en el `title`). `token` la re-señala. */
  filaError: { ref: RefFila; mensaje: string; token: number } | null
  /** Cuántas filas abarca la selección (el botón «Borrar filas» del dueño). */
  onFilasSeleccionadas?: (n: number) => void
}

/** Props de la rejilla con la edición y las acciones que el dueño lanza. */
export interface DbRejillaEdicionProps extends DbRejillaProps {
  edicion?: EdicionRejilla | null
  /**
   * Se rellena con las acciones del dueño. Fuera de `edicion` a propósito: la edición se
   * retira mientras llega la relectura tras «Enviar», y justo entonces el dueño pide `enfocar`.
   */
  acciones?: { current: AccionesEdicionRejilla | null }
  /** Si `datos` es ESTE objeto, es la relectura tras «Enviar»: se conserva la posición. */
  conservarPosicionDe?: DatosRejilla | null
}

/** Paso del menú contextual de dos pasos. */
export type PasoMenu = 'raiz' | 'copiarComo' | 'exportar'

export interface MenuAbierto {
  x: number
  y: number
  paso: PasoMenu
}

/** El editor abierto: sobre qué celda y cómo arrancó. */
export interface EditorAbierto {
  ref: RefFila
  c: number
  valorInicial: string
  sucio: boolean
  seleccionar: boolean
  placeholder?: string
  token: number
}

/** Qué hay bajo un punto de la pantalla. */
export type Zona = { zona: 'fuera' } | { zona: 'num'; f: number } | { zona: 'celda'; f: number; c: number }

type Filas = readonly (readonly DbCelda[])[]

/** Refs y vista derivada de las props (las filas tal como se ven). */
export interface BaseRejilla {
  props: DbRejillaEdicionProps
  propsRef: MutableRefObject<DbRejillaEdicionProps>
  edicion: EdicionRejilla | null
  idBase: string
  raizRef: RefObject<HTMLDivElement>
  scrollRef: RefObject<HTMLDivElement>
  cabRef: RefObject<HTMLDivElement>
  cuerpoRef: RefObject<HTMLDivElement>
  numCols: number
  cambios: CambiosRejilla
  filasServidor: Filas
  numServidor: number
  /** Filas nuevas, que van arriba. */
  k: number
  filas: Filas
  recortes: MapaRecortes
  numFilas: number
  altoCab: number
  pk: ReadonlySet<string>
  firmaCols: string
}

/** Anchos de columna y ventana visible. */
export interface GeometriaRejilla {
  anchos: number[]
  pref: Float64Array
  anchoFijo: number
  anchoLienzo: number
  cambiarAncho: (c: number, ancho: number) => void
  ven: Ventana
  dims: { alto: number; ancho: number }
  recalcularRef: MutableRefObject<() => void>
}

type Fijar<T> = Dispatch<SetStateAction<T>>

/** Estado de interacción: selección, menú, visor, editor y asa de redimensionar. */
export interface EstadoRejilla {
  menu: MenuAbierto | null
  setMenu: Fijar<MenuAbierto | null>
  sel: Seleccion
  setSel: Fijar<Seleccion>
  visor: Celda | null
  setVisor: Fijar<Celda | null>
  editor: EditorAbierto | null
  setEditor: Fijar<EditorAbierto | null>
  redimensionando: number | null
  setRedimensionando: Fijar<number | null>
  tokenEditorRef: MutableRefObject<number>
  /** Celda que hay que llevar a la vista cuando la rejilla ya la pinte. */
  pendienteMostrarRef: MutableRefObject<Celda | null>
  /** La vista en la que están expresadas la selección y el visor. */
  vistaSelRef: MutableRefObject<VistaFilas>
  /** Segundo paso pedido por la entrada del menú que se acaba de pulsar. */
  pasoPendienteRef: MutableRefObject<PasoMenu | null>
  /** La entrada pulsada abre el editor: el foco NO vuelve a la rejilla al cerrar. */
  focoAlEditorRef: MutableRefObject<boolean>
}

/** El desplazamiento guardado y lo que lo mueve. */
export interface ScrollRejilla {
  posRef: MutableRefObject<{ top: number; left: number }>
  alDesplazar: () => void
}

/** Todo lo que comparten las piezas de la rejilla en un render. */
export type Rejilla = BaseRejilla & GeometriaRejilla & EstadoRejilla & ScrollRejilla
