// =============================================================================
// Tipos del motor de una consola SQL: su API para el pane, los diálogos que pide,
// el lote en curso y la bolsa de refs que comparten los hooks de `useConsola`.
// Solo tipos: lo importan `useConsola.ts` y sus piezas `useConsola*.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-motor.md
// =============================================================================

import type { editor } from 'monaco-editor'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type {
  DbBinds,
  DbConsolaInfo,
  DbEstadoTx,
  DbResolverTx,
  DbTxModo,
  DbValorBind
} from '../../../../../shared/db-explorador-ipc'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql'
import type { IndicadorPestana } from '../dbTabsModel'
import type { AccionPestana as AccionPestanaResultado, BarraTx, EstadoConsola } from './estadoConsola'
import type { MarcasLoteMonaco, ValidadorAvisos } from './monacoConsola'
import type { AccionParametros, CampoParametro, ValorCampo } from './parametrosConsola'
import type { AccionSalida, IrAPosicion } from './salidaConsola'

/** La API de IPC del explorador, tal como la expone el preload. */
export type ApiExplorador = Window['tessera']['dbExplorador']

/** Un valor mutable que vive lo que el hook: la misma forma que devuelve `useRef`. */
export interface Caja<T> {
  current: T
}

/** Un diálogo que la consola necesita que el usuario conteste. */
export type DialogoConsola =
  | {
      tipo: 'confirmar'
      titulo: string
      mensaje: string
      confirmar: string
      peligro: boolean
      resolver: (ok: boolean) => void
    }
  | {
      tipo: 'tx'
      tx: DbEstadoTx
      sentencias: number
      /** Para qué hay que resolverla («Para cerrar la consola…»). */
      contexto: string
      resolver: (r: DbResolverTx | null) => void
    }
  /** Los valores de los parámetros del lote (null = cancelado, no se ejecuta nada). */
  | {
      tipo: 'parametros'
      campos: CampoParametro[]
      iniciales: Record<string, ValorCampo>
      /** La frase de arriba («Valores para ejecutar la sentencia…»). */
      mensaje: string
      accion: AccionParametros
      dialecto: DialectoSql
      alias: string
      resolver: (binds: DbBinds | null) => void
    }

export interface OpcionesConsola {
  paneKey: string
  perfilId: string
  consola: DbConsolaInfo
  conexion: DbConnection
  visible: boolean
  /** El editor del pane (null hasta su primer `visible`). */
  editor: editor.IStandaloneCodeEditor | null
  /** Filas por página de los resultados (Configuración; se lee en cada petición). */
  filasPorPagina: number
  /** «Transacción al abrir» de Configuración (ver `DbConsolaPaneProps.txInicial`). */
  txInicial: DbTxModo
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
}

export interface ApiConsola {
  modelo: editor.ITextModel | null
  estado: EstadoConsola
  barraTx: BarraTx
  ejecutando: boolean
  /** El texto ya llegó del disco (hasta entonces el editor es de solo lectura). */
  cargado: boolean
  soloLectura: boolean
  /** Texto de estado de la barra cuando NO corre nada: «Cargando…», la pista, un error. */
  textoEstado: string | null
  /** El archivo cambió fuera de Tessera y hay cambios míos: la barra lo pregunta. */
  conflicto: boolean
  /** Lote que tiene marcas en el editor (los enlaces de la Salida solo valen para él). */
  loteMarcado: number | null
  cargandoMas: ReadonlySet<string>
  /** ■ tiene algo que parar: un lote en curso, una página de «cargar más» o un «Contar» en vuelo. */
  detenible: boolean
  contando: ReadonlySet<string>
  totales: Readonly<Record<string, number>>
  dialogo: DialogoConsola | null
  ejecutar: () => void
  ejecutarTodo: () => void
  detener: () => void
  alternarModoTx: () => void
  commit: () => void
  rollback: () => void
  pestana: (accion: AccionPestanaResultado, id: string) => void
  cargarMas: (id: string) => void
  contar: (id: string) => void
  volverAEjecutar: (id: string) => void
  irA: (ir: IrAPosicion) => void
  accionSalida: (a: AccionSalida) => void
  limpiarSalida: () => void
  cargarDelDisco: () => void
  conservarLaMia: () => void
  /** Esquema en que está la consola (`esquemaEfectivo`), para la barra y el selector. */
  esquemaActual: string | null
  /** Lo elegido en el selector; null = el de la conexión. */
  esquemaElegido: string | null
  /** Hay un cambio de esquema en vuelo (el botón espera). */
  cambiandoEsquema: boolean
  /** Fija el esquema de la consola (null = el de la conexión). */
  elegirEsquema: (esquema: string | null) => void
  /** Resultados con un «Traer todas» en marcha. */
  trayendo: ReadonlySet<string>
  /** Resultado -> «Se trajeron N filas; el resto no cabe en memoria…». */
  topes: Readonly<Record<string, string>>
  traerTodas: (id: string) => void
  detenerTraerTodas: (id: string) => void
  /** El plan de la sentencia del cursor o de la selección (una sola). */
  explicar: () => void
  /** Formatea la selección o, sin ella, todo el texto (una parada de deshacer). */
  formatear: () => void
  /** Inserta un SQL del historial en el cursor (en línea nueva si hace falta). */
  insertarSql: (sql: string) => void
  /** El popover del historial está abierto. */
  historialAbierto: boolean
  alternarHistorial: () => void
  cerrarHistorial: () => void
}

export interface InfoLote {
  loteId: number
  /** Texto del que salieron las sentencias (el modelo al pulsar, o el SQL a re-ejecutar). */
  fuente: string
  /** Las sentencias tienen offsets del modelo (marcas, «ir a la posición»). */
  conModelo: boolean
  /** `getAlternativeVersionId` del modelo al lanzar: «Ejecutar las N restantes» exige el mismo. */
  version: number | null
  /** Los binds de cada sentencia, en su orden, decididos UNA vez antes de crear el lote. */
  binds: ReadonlyArray<DbBinds | undefined>
  /** Producción: el usuario confirmó ESTE lote; viaja como `confirmado` con cada sentencia. */
  confirmado?: boolean
}

/** Cómo llegan los parámetros a `correr`. */
export interface OpcionesCorrer {
  /** Ya decididos, uno por sentencia (continuar un lote): no se pregunta. */
  binds?: ReadonlyArray<DbBinds | undefined>
  /** Valores que ya se conocen (re-ejecutar un resultado): si cubren todo, no se pregunta. */
  fijos?: DbBinds
}

/** La sentencia que corre: lo que ■ cancela y lo que «Forzar» vigila. */
export interface EjecucionEnCurso {
  ejecucionId: string
  loteId: number
  indice: number
}

/** Los refs de una consola: una bolsa ESTABLE que reciben todas las piezas del hook. */
export interface RefsConsola {
  estadoRef: Caja<EstadoConsola>
  esquemaElegidoRef: Caja<string | null>
  modeloRef: Caja<editor.ITextModel | null>
  edRef: Caja<editor.IStandaloneCodeEditor | null>
  visibleRef: Caja<boolean>
  soloLecturaRef: Caja<boolean>
  conexionRef: Caja<DbConnection>
  consolaRef: Caja<DbConsolaInfo>
  onIndicadorRef: Caja<(i: ReadonlySet<IndicadorPestana>) => void>
  filasPorPaginaRef: Caja<number>
  txInicialRef: Caja<DbTxModo>
  cargadoRef: Caja<boolean>
  guardadoRef: Caja<string | null>
  conflictoRef: Caja<{ texto: string } | null>
  escrituraRef: Caja<Promise<void> | null>
  temporizadorRef: Caja<ReturnType<typeof setTimeout> | null>
  errorGuardadoRef: Caja<string | null>
  aplicandoDiscoRef: Caja<boolean>
  leyendoRef: Caja<boolean>
  borradaRef: Caja<boolean>
  desmontadoRef: Caja<boolean>
  dialogoRef: Caja<DialogoConsola | null>
  ejecucionRef: Caja<EjecucionEnCurso | null>
  stopRef: Caja<ReturnType<typeof setTimeout> | null>
  infoLoteRef: Caja<InfoLote | null>
  marcasRef: Caja<MarcasLoteMonaco | null>
  validadorRef: Caja<ValidadorAvisos | null>
  /** Cuándo se vio por última vez cada pestaña de resultado. */
  usoRef: Caja<Map<string, number>>
  txEnCursoRef: Caja<boolean>
  /** Espejos síncronos de `cargandoMas` y `contando`: dos clics seguidos no esperan al render. */
  cargandoMasRef: Caja<ReadonlySet<string>>
  contandoRef: Caja<ReadonlySet<string>>
  /** Id de resultado -> `peticionId` de su página de «cargar más» en vuelo (lo que ■ cancela). */
  masEnVueloRef: Caja<Map<string, string>>
  /** Id de resultado -> `peticionId` de su «Contar» en vuelo. */
  conteosEnVueloRef: Caja<Map<string, string>>
  /** «Traer todas» en marcha: id de resultado -> su marca de Detener. */
  trayendoRef: Caja<Map<string, { detenido: boolean }>>
  /** Lo último usado en los parámetros de ESTA consola, por clave (se pierde al cerrarla). */
  valoresParamRef: Caja<ReadonlyMap<string, DbValorBind>>
  cambiandoEsquemaRef: Caja<boolean>
}
