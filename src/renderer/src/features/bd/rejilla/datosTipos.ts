// =============================================================================
// Tipos de la pestaña de datos (`DbDatosPane`): el resultado leído, lo que falta del
// lector, el envío abierto y el NÚCLEO estable de la pestaña (refs y setters, el mismo
// objeto en todos los renders), que es lo único que leen sus acciones asíncronas.
// Solo tipos: lo importan `DbDatosPane.tsx` y los módulos `rejilla/datos*`, `Datos*`.
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type {
  DbColumnaResultado,
  DbErrorSql,
  DbIdentidadFila,
  DbRefObjeto,
  DbRespuesta,
  DbTablaAbierta,
  DbValor
} from '../../../../../shared/db-explorador-ipc'
import type { DbFiltroGuiado } from '../../../../../shared/filtroGuiado'
import type { EstadoEnvio } from '../DialogoEnvio'
import type { DbDatosPaneProps } from '../propsBd'
import type { OrdenRejilla } from '../panesBd'
import type { ColumnaFiltrable, ErrorBarraFiltro, FiltroTabla } from '../filtro/modeloFiltro'
import type { ExportadorBd } from './useExportarBd'
import type { CambiosRejilla, ResultadoEnvio } from './cambiosRejilla'
import type { DatosRejilla } from './celdasRejilla'
import type { AccionesEdicionRejilla, EdicionRejilla } from './rejillaTipos'
import type { OrigenPagina } from './traerTodas'

/** Lo que se consulta: el modo aplicado, lo escrito en cada uno y el orden de la cabecera. */
export type Filtro = FiltroTabla

export interface Resultado {
  /** TODAS las columnas del resultado (con la oculta del ROWID, si la hay). */
  columnas: DbColumnaResultado[]
  datos: DatosRejilla
  clavePrimaria: string[]
  /** El objeto que se consultó de verdad (el destino, si era un sinónimo). */
  objetoReal: DbRefObjeto
  /** La identidad de fila que dio el main (ausente = versión anterior: no se edita). */
  identidad: DbIdentidadFila | undefined
  /** Las columnas que el main dice que no se editan, con su motivo. */
  noEditables: DbTablaAbierta['noEditables']
  /** Con el ROWID, las columnas cuyo valor leído compara el main. */
  comparables: DbTablaAbierta['comparables']
  ms: number
  /** Contado, o conocido por haber llegado al final; null si no se sabe. */
  total: number | null
  /** Filas de la primera página: lo que se conserva al soltar memoria. */
  filasPrimeraPagina: number
}

export interface SinLector {
  motivo: string
  /** «Volver a ejecutar» lo arregla (con el tope de memoria, no). */
  reejecutable: boolean
  /** Es el tope de memoria: el lector sigue vivo y al volver a verse se mira si ya cabe. */
  tope?: boolean
}

/** Fin de una página de «más filas»; `detenida` = cancelada con el lector aún vivo. */
export type FinPagina = 'ok' | 'fallo' | 'descartada' | 'ocupado' | 'detenida'

/** El diálogo de «Enviar» abierto: lo que se mandará y cómo va. */
export interface Envio {
  conv: Extract<ResultadoEnvio, { ok: true }>
  identidad: DbIdentidadFila
  objeto: DbRefObjeto
  lineas: string[]
  resumen: string
  estado: EstadoEnvio
}

type Fijar<T> = Dispatch<SetStateAction<T>>
type Ref<T> = MutableRefObject<T>

/** Refs de la pestaña: lo que leen los callbacks asíncronos en vez de su cierre. */
export interface RefsDatos {
  propsRef: Ref<DbDatosPaneProps>
  /** El último filtro que FUNCIONÓ. */
  aplicadoRef: Ref<Filtro>
  /** La última consulta intentada (la repiten los botones del aviso de bloqueo). */
  intentoRef: Ref<{ filtro: Filtro; maxFilas?: number }>
  botonExportarRef: Ref<HTMLButtonElement | null>
  cambiosRef: Ref<CambiosRejilla>
  tokenErrorRef: Ref<number>
  accionesRef: Ref<AccionesEdicionRejilla | null>
  envioRef: Ref<Envio | null>
  /** `peticionId` del envío en vuelo (con él se detiene), o null. */
  envioIdRef: Ref<string | null>
  /** El último envío quedó con el COMMIT INCIERTO y aún no se ha aclarado. */
  envioInciertoRef: Ref<boolean>
  /** La pregunta «Descartar N cambios» abierta, con quien espera la respuesta. */
  descarteRef: Ref<{ promesa: Promise<boolean>; resolver: (ok: boolean) => void } | null>
  peticionRef: Ref<string | null>
  cargandoRef: Ref<boolean>
  lectorRef: Ref<string | null>
  contarRef: Ref<string | null>
  /** `peticionId` de la página de «más filas» en vuelo (la clave con la que se detiene). */
  masRef: Ref<string | null>
  cargandoMasRef: Ref<boolean>
  /** La página de «más filas» en vuelo, para que «Traer todas» la espere en vez de pisarla. */
  paginaRef: Ref<Promise<FinPagina> | null>
  /** Quién espera la página en vuelo: «Traer todas» ADOPTA la de desplazar. */
  origenPaginaRef: Ref<OrigenPagina>
  /** Id de la vuelta de «Traer todas» en marcha; a null la para (entre páginas). */
  traerRef: Ref<string | null>
  resRef: Ref<Resultado | null>
  /** Última vez que se vio (`performance.now()`, el reloj del presupuesto de celdas). */
  usoRef: Ref<number>
  haSidoVisibleRef: Ref<boolean>
  whereRef: RefObject<HTMLInputElement>
  /** La barra guiada: al volver a ella desde «SQL», el foco va a su primer control. */
  guiadoRef: RefObject<HTMLDivElement>
}

/** Estado del filtro: la barra que se ve, lo escrito y lo aplicado. */
export interface EstadoFiltroDatos {
  modo: Filtro['modo']
  guiadoTxt: DbFiltroGuiado
  errorGuiado: ErrorBarraFiltro | null
  whereTxt: string
  aplicado: Filtro
}

/** Estado de la lectura: resultado, errores, lector y trabajo en curso. */
export interface EstadoLecturaDatos {
  cargando: boolean
  res: Resultado | null
  error: DbErrorSql | null
  errorCampo: DbErrorSql | null
  detenida: boolean
  cargandoMas: boolean
  contando: boolean
  sinLector: SinLector | null
  hayLector: boolean
  trayendo: boolean
  /** Lo que se ve se leyó SIN ESPERAR a un bloqueo: la barra lo marca. */
  sinEsperar: boolean
  menuExportar: { x: number; y: number } | null
}

/** Estado de la edición: lo pendiente, el envío y la pregunta de descartar. */
export interface EstadoEdicionDatos {
  cambios: CambiosRejilla
  filaError: EdicionRejilla['filaError']
  filasSel: number
  envio: Envio | null
  descarte: { n: number } | null
  /** Los datos de la relectura tras «Enviar»: la rejilla conserva su sitio. */
  conservarPara: DatosRejilla | null
}

type Setters<T> = { [K in keyof T as `set${Capitalize<string & K>}`]: Fijar<T[K]> }

/** Todo el estado de la pestaña, con sus valores del render. */
export type EstadoDatos = EstadoFiltroDatos & EstadoLecturaDatos & EstadoEdicionDatos

/** El núcleo ESTABLE: refs y setters, el mismo objeto en todos los renders. */
export type NucleoDatos = RefsDatos &
  Setters<EstadoFiltroDatos> &
  Setters<EstadoLecturaDatos> &
  Setters<EstadoEdicionDatos>

/** Las acciones con identidad ESTABLE (van a deps de efectos, a `edicion` y a hijos). */
export interface AccionesDatos {
  consultar: (filtro: Filtro, opciones?: { maxFilas?: number; conservar?: boolean; sinEsperar?: boolean }) => Promise<void>
  cargarMas: () => Promise<void>
  traerTodas: () => Promise<void>
  contar: () => Promise<void>
  liberar: () => void
  ponerCambios: (c: CambiosRejilla) => void
  pedirDescarte: () => Promise<boolean>
  abrirEnvio: () => void
  cerrarEnvio: () => void
  cerrarMenuExportar: () => void
  valorCompleto: (f: number, c: number) => Promise<DbRespuesta<DbValor>>
}

/** Lo que se deriva del resultado: columnas visibles, si se puede editar y la edición de la rejilla. */
export interface DerivadosDatos {
  columnasVisibles: DbColumnaResultado[]
  editable: boolean
  edicionViva: boolean
  motivoNoEditable: string | null
  columnasFiltro: ColumnaFiltrable[]
  ordenRejilla: OrdenRejilla[]
  edicion: EdicionRejilla | null
}

/** Todo lo de un render de la pestaña: núcleo, acciones, props, estado y derivados. */
export interface VistaDatos {
  n: NucleoDatos
  a: AccionesDatos
  props: DbDatosPaneProps
  e: EstadoDatos
  d: DerivadosDatos
  exportador: ExportadorBd
}
