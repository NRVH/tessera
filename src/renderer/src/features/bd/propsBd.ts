// =============================================================================
// propsBd: las JUNTAS de la vista de bases de datos, las props de cada componente
// que otro monta (árbol, panes, rejilla), solo tipos. El estado de la vista es de
// `useBdApp`; nada de rutas del host (las consolas se nombran por id). `visible` es
// «pestaña activa de la vista 'db' del perfil que se ve, fuera del mosaico», y un
// pane no pide datos ni crea Monaco antes de su primer `visible`. En la rejilla, el
// ciclo del orden de varias columnas (`ciclarOrden`) es del dueño de los datos.
// Decisiones: docs/decisiones/bd/ui-area-pestanas-y-panes.md
// =============================================================================

import type { CSSProperties } from 'react'
import type { DbConnection, DbMotor } from '../../../../shared/db-ipc'
import type {
  DbColumnaResultado,
  DbConsolaInfo,
  DbEstadoSesion,
  DbFormatoFilas,
  DbRefObjeto,
  DbRespuesta,
  DbTxModo,
  DbValor
} from '../../../../shared/db-explorador-ipc'
import type { DbPane, IndicadorPestana } from './dbTabsModel'
import type { RevelarBd } from './dbVistaEstado'
import type { DatosRejilla } from './rejilla/celdasRejilla'
import type { OrdenRejilla } from './panesBd'

/** Petición con token: cambiar el token re-dispara aunque el valor sea el mismo. */
export interface PeticionToken<T> {
  valor: T
  token: number
}

export interface DbArbolProps {
  perfilId: string | null
  /** Conexiones del perfil activo, ya ordenadas (`db.list`). */
  conexiones: readonly DbConnection[]
  /** El registro todavía no respondió: el árbol pinta "Cargando…" en línea. */
  cargandoConexiones: boolean
  /** Consolas del perfil activo (archivos del espacio de datos). */
  consolas: readonly DbConsolaInfo[]
  /** Estado de las sesiones vivas, para el punto de sesión de cada conexión. */
  sesiones: readonly DbEstadoSesion[]
  expandidos: ReadonlySet<string>
  onAlternarExpandido: (clave: string, abierto?: boolean) => void
  onPlegarTodo: () => void
  seleccion: string | null
  onSeleccion: (clave: string | null) => void
  /** "Mostrar en el árbol": claves a desplegar y fila a revelar. */
  revelar: RevelarBd | null
  altoFila: number
  varsDensidad: CSSProperties
  /** Abre (o activa) una pestaña fija. */
  onAbrir: (pane: DbPane) => void
  /**
   * Nueva consola. `conexionId` null = "en contexto": la decide `useBdApp` (pestaña
   * activa, la única conexión, o un menú para elegir).
   */
  onNuevaConsola: (conexionId: string | null) => void
  /**
   * Se borró una conexión y ya no queda la conocida de su id en `perfilId`: `useBdApp` la desmonta
   * de los proyectos de ESE perfil y poda allí sus pestañas (la copia
   * pegada en otro perfil comparte el id, y lo del otro perfil es de su original).
   */
  onConexionEliminada: (conexionId: string, perfilId: string) => void
  /** Algo cambió en las consolas (renombrar, borrar): `useBdApp` vuelve a listarlas. */
  onConsolasCambiaron: () => void
  /** Petición de abrir el diálogo de alta (acción del estado vacío). */
  pedirNuevaConexion: PeticionToken<null> | null
  /** Petición de abrir el diálogo de edición de una conexión (candado de la consola). */
  pedirEditarConexion: PeticionToken<string> | null
}

export interface DbDatosPaneProps {
  paneKey: string
  conexion: DbConnection
  objeto: DbRefObjeto
  visible: boolean
  altoFila: number
  /**
   * Filas por página (Configuración › «Bases de datos», ya saneadas). Se lee en cada
   * lectura, no al montar: cambiarla vale para la SIGUIENTE página y no relee nada.
   */
  filasPorPagina: number
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
  onAbrirConsola: (conexionId: string, textoInicial?: string) => void
  /** "Ver definición" de una vista: abre su pestaña de fuente. */
  onAbrir: (pane: DbPane) => void
}

export interface DbFuentePaneProps {
  paneKey: string
  conexion: DbConnection
  objeto: DbRefObjeto
  /**
   * 'fuente' (por defecto): la fuente o la definición (canal FUENTE). 'ddl': «Ver
   * DDL» (canal DDL), una sola parte con su aviso si el main lo reconstruyó.
   */
  modo?: 'fuente' | 'ddl'
  visible: boolean
  onAbrirConsola: (conexionId: string, textoInicial?: string) => void
}

/**
 * La rejilla de solo lectura. La usan la pestaña de datos y las pestañas de
 * resultado de la consola: el DUEÑO de los datos (quién pide páginas, quién cuenta)
 * es el pane; la rejilla solo pinta, selecciona, copia y avisa de que se acerca al
 * final.
 */
export interface DbRejillaProps {
  columnas: readonly DbColumnaResultado[]
  /** Lo cargado hasta ahora (`anexarPagina`); null = aún nada. */
  datos: DatosRejilla | null
  /** Hay una página en vuelo: no se vuelve a pedir y se pinta la fila de carga. */
  cargandoMas: boolean
  /** Se acerca al final y `datos.hayMas`: el dueño pide la siguiente página. */
  onCargarMas?: () => void
  /** Total contado (bajo demanda), o null si no se contó. */
  total: number | null
  contando: boolean
  onContar?: () => void
  /**
   * Orden actual para las flechas de la cabecera (de VARIAS columnas, con su prioridad;
   * `ordenEnRejilla`). null = sin orden (los resultados de la consola).
   */
  orden: readonly OrdenRejilla[] | null
  /**
   * Clic en la cabecera (`multiple` = con Mayús). La pestaña de datos cicla el orden
   * (`ciclarOrden`) y reordena en el SERVIDOR. Sin la función, la cabecera no ordena.
   */
  onOrdenar?: (columna: number, multiple: boolean) => void
  /** Columnas de la clave primaria: llave en la cabecera. */
  clavePrimaria?: readonly string[]
  /** La píldora avisa de que sin ORDER BY ni PK las páginas no son estables (PG). */
  sinOrdenEstable?: boolean
  /** Ya no se puede leer más (sesión cerrada, memoria liberada): el motivo. */
  sinLector?: string | null
  onVolverAEjecutar?: () => void
  altoFila: number
  visible: boolean
  etiquetaAria: string

  // --- Segunda entrega: uso diario -------------------------------------------------
  // La rejilla pinta los menús y el visor; lo que necesita al servidor lo hace el
  // DUEÑO por estas funciones (la pestaña de datos y la consola leen de sitios
  // distintos). Sin la función, la entrada del menú no aparece.

  /** Motor de la conexión: literales de «Copiar como INSERT». */
  motor: DbMotor
  /** Tabla de «Copiar como INSERT», YA citada; ausente = `tabla`. */
  tablaInsert?: string
  /** «Traer todas»: el dueño lee páginas hasta el final o hasta el tope de memoria. */
  onTraerTodas?: () => void
  /** Hay un «Traer todas» en marcha: la píldora lo dice y ofrece detenerlo. */
  trayendoTodas?: boolean
  onDetenerTraerTodas?: () => void
  /** Exportar a archivo en ese formato; el dueño decide el origen (tabla, consulta, filas). */
  onExportar?: (formato: DbFormatoFilas) => void
  /** Exportación en marcha (de `useExportarBd`): la píldora enseña el progreso y Detener. */
  exportando?: { filas: number } | null
  onCancelarExportacion?: () => void
  /**
   * Valor COMPLETO de una celda recortada (fila y columna de `datos`). Sin ella, el
   * visor enseña lo cargado y `razonSinValorCompleto` explica por qué no hay más.
   */
  onValorCompleto?: (fila: number, columna: number) => Promise<DbRespuesta<DbValor>>
  razonSinValorCompleto?: string
}

export interface DbConsolaPaneProps {
  paneKey: string
  perfilId: string
  consola: DbConsolaInfo
  conexion: DbConnection
  visible: boolean
  altoFila: number
  /** Alto del bloque de resultados (global, persistido). */
  altoResultados: number
  onAltoResultados: (px: number) => void
  /** Filas por página de los resultados (como en la pestaña de datos). */
  filasPorPagina: number
  /**
   * «Transacción al abrir» de Configuración: el modo que pinta la barra mientras la
   * consola no tiene sesión, y el que se manda en la petición que la crea.
   */
  txInicial: DbTxModo
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
  /** Candado "Solo lectura": abre el diálogo de edición de la conexión. */
  onEditarConexion: (conexionId: string) => void
}
