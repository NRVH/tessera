// =============================================================================
// Tipos del lateral de bases de datos (`DbArbol`) y de sus piezas: las props locales, el
// estado de la interacción y el CONTEXTO de cada render (`CtxArbol`), que reciben las
// funciones de acciones, menú, teclado y pintado en vez de ser clausuras del componente.
// Solo tipos: no añade nada al cargar.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { DbArbolProps } from './propsBd'
import type { DbArchivoElegido, DbConexionAjena, DbConnection, DbMotor, DriverRequerido } from '../../../../shared/db-ipc'
import type { DbConsolaInfo, DbResolverTx } from '../../../../shared/db-explorador-ipc'
import type { Plataforma } from '../../../../shared/plataforma'
import type { ContextMenuEntry } from '../../comun/ContextMenu'
import type { AnclaPopover } from './DbEsquemasPopover'
import type { NivelPopover } from './nivelBasesBd'
import type { CargaBd, FilaBd } from './arbolBd'
import type { BorradoDeFila, FilaArbol, OpcionesTxArbol, motivosCabeceraArbol } from './filasArbolBd'

/**
 * Extensión LOCAL de las props: los nombres de los proyectos donde está montada una
 * conexión, para el diálogo de eliminar. Opcional: el padre puede no pasarla.
 */
export interface DbArbolPropsExtra {
  proyectosMontada?: (conexionId: string) => readonly string[]
  /**
   * Las conexiones AJENAS del perfil (las que esta versión no sabe abrir: de un motor que
   * no conoce, o guardadas de una forma que no reconoce), en el orden en que las da el
   * main (no se reordenan aquí). Opcional: sin ella no se pinta ninguna.
   */
  ajenas?: readonly DbConexionAjena[]
  /**
   * El aviso del main cuando el registro ENTERO tiene un formato que esta versión no
   * reconoce (`DbListaConexiones.aviso`), o null. Entonces las listas llegan vacías sin
   * que el perfil lo esté: el cuerpo enseña el aviso en vez de «Sin conexiones», y las
   * altas se apagan con su porqué (`motivosCabeceraArbol`), porque el main las rechazaría.
   */
  avisoFormato?: string | null
}

/** Las props con los valores por defecto ya puestos. */
export type PropsArbol = DbArbolProps &
  Pick<DbArbolPropsExtra, 'proyectosMontada'> & { ajenas: readonly DbConexionAjena[]; avisoFormato: string | null }

type Setter<T> = Dispatch<SetStateAction<T>>

export interface AvisoArbol {
  tono: 'ok' | 'error' | 'info'
  texto: string
  detalle?: string
  accion?: { etiqueta: string; hacer: () => void }
}

export interface EstadoDialogo {
  conexionId: string | null
  abrirClientes?: boolean
  requiereDriver?: DriverRequerido | null
  enfocarPassword?: boolean
  /** Alta precargada con un archivo SOLTADO sobre el árbol (motores de archivo). */
  archivoInicial?: { motor: DbMotor; elegido: DbArchivoElegido }
}

/** Lo que espera confirmación para borrarse: lo mismo que borra la tecla (`borradoDeFila`). */
type Confirmacion = BorradoDeFila

export interface PeticionTx {
  titulo: string
  mensaje: string
  /** Etiquetas de los botones y la nota bajo el mensaje (ver `opcionesTxArbol`). */
  opciones: OpcionesTxArbol
  onResolver: (r: DbResolverTx) => void
}

/**
 * El popover del «N de M» abierto. `nivel`/`base`: el de las BASES de una conexión con nivel
 * «Bases», o el de los esquemas de UNA base; sin ellos, el de siempre.
 */
export interface PopoverArbol {
  conexionId: string
  ancla: AnclaPopover
  nivel?: NivelPopover
  base?: string
}

/** La base de claves a la que se aplica un filtro, y la fila que la pinta. */
export interface FiltroClaves {
  conexionId: string
  indice: number
  clave: string
}

export interface ArrastreArbol {
  id: string
  sobre: string | null
}

/** El estado de la interacción sin efecto propio (`useArbolEstado`). */
export interface EstadoUiArbol {
  busqueda: string | null
  setBusqueda: Setter<string | null>
  menu: { x: number; y: number; items: ContextMenuEntry[] } | null
  setMenu: Setter<{ x: number; y: number; items: ContextMenuEntry[] } | null>
  popover: PopoverArbol | null
  setPopover: Setter<PopoverArbol | null>
  confirmacion: Confirmacion | null
  setConfirmacion: Setter<Confirmacion | null>
  renombrando: { consola: DbConsolaInfo; error: string | null } | null
  setRenombrando: Setter<{ consola: DbConsolaInfo; error: string | null } | null>
  /** «Filtrar claves…» de una base de claves abierto: su base y el patrón de ahora. */
  filtrandoClaves: (FiltroClaves & { actual: string }) | null
  setFiltrandoClaves: Setter<(FiltroClaves & { actual: string }) | null>
  peticionTx: PeticionTx | null
  setPeticionTx: Setter<PeticionTx | null>
  probando: string | null
  setProbando: Setter<string | null>
  ordenLocal: { base: readonly DbConnection[]; ids: string[] } | null
  setOrdenLocal: Setter<{ base: readonly DbConnection[]; ids: string[] } | null>
  /** Hay un ARCHIVO del sistema encima del árbol (se resalta el cuerpo como destino). */
  soltandoArchivo: boolean
  setSoltandoArchivo: Setter<boolean>
  listaRef: RefObject<HTMLDivElement>
  busquedaRef: RefObject<HTMLInputElement>
  menuPorTeclado: MutableRefObject<number>
  ultimoCierrePopover: MutableRefObject<{ conexionId: string; base?: string; en: number } | null>
}

/** Desplazar la lista hasta una fila (`useArbolDesplazar`). */
export interface DesplazarArbol {
  desplazar: { clave: string; token: number } | null
  idxDesplazar: number
  llevarA: (clave: string) => void
  moverA: (i: number) => void
}

/** Todo el estado del lateral: el de la interacción y el que va con su efecto. */
interface EstadoArbol extends EstadoUiArbol, DesplazarArbol {
  dialogo: EstadoDialogo | null
  setDialogo: Setter<EstadoDialogo | null>
  setAviso: Setter<AvisoArbol | null>
  arrastre: ArrastreArbol | null
  setArrastre: Setter<ArrastreArbol | null>
}

/** Lo derivado de las props y del estado en cada render (`useArbolFilas`). */
export interface DatosArbol {
  conexionesVista: readonly DbConnection[]
  porId: Map<string, DbConnection>
  filasBd: FilaBd[]
  reintentar: (carga: CargaBd) => void
  filas: readonly FilaArbol[]
  idxSel: number
  filaSel: FilaArbol | null
  /** La conexión de lo seleccionado (aunque la fila esté plegada fuera de la vista). */
  conexionSel: string | null
  /** El porqué de cada acción de la cabecera (y del menú del hueco) que se apaga, o null. */
  motivos: ReturnType<typeof motivosCabeceraArbol>
  /** «Nueva consola»: además, apagada con la conexión seleccionada de una familia sin consola. */
  motivoNuevaConsola: string | null
}

/** El contexto de un render de `DbArbol`, que reciben sus funciones de módulo. */
export interface CtxArbol {
  p: PropsArbol
  e: EstadoArbol
  d: DatosArbol
  plataforma: Plataforma
  /** Cómo se llama el almacén de contraseñas del sistema. */
  almacen: string
  dbx: typeof window.tessera.dbExplorador
  idBase: string
  /** «Doble clic para abrir» (o el acorde de la plataforma), para los tooltips. */
  pistaAbrir: string
}
