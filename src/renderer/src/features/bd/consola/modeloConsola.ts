// =============================================================================
// Tipos del estado de una consola SQL (resultado, estado, acciones) y las utilidades
// pequeñas que comparten sus sub-reductores. Puro: sin DOM, React ni Monaco.
// Lo reexporta `estadoConsola.ts`, que es por donde lo importa el resto de la app.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type {
  DbBinds,
  DbColumnaResultado,
  DbErrorSql,
  DbEstadoSesion,
  DbPagina,
  DbPlan,
  DbRespuesta,
  DbResultadoSentencia,
  DbTiempos
} from '../../../../../shared/db-explorador-ipc.ts'
import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { ClaseSentencia, PeligroSentencia, RefObjeto } from '../../../../../shared/sql/clasificarSql.ts'
import type { Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import type { DatosRejilla } from '../rejilla/celdasRejilla.ts'
import { ID_SALIDA, type EstadoResultados, type ResultadoConLector } from '../resultados/pestanasResultado.ts'
import type { Lote } from './lote.ts'
import { agregarSalida, type NuevaEntrada, type SalidaConsola } from './salidaConsola.ts'

/** Pista de la barra cuando «Ejecutar» no encuentra sentencia bajo el cursor. */
export const PISTA_SIN_SENTENCIA = 'Coloca el cursor en una sentencia o selecciona texto'

/** Motivo de «Volver a ejecutar» tras soltar filas por el presupuesto de memoria. */
export const MOTIVO_LIBERADA = 'Se soltaron filas para liberar memoria; vuelve a ejecutar para verlas'

/** Un conjunto de filas de una sentencia, tal como lo pinta su pestaña. */
export interface ResultadoConsola extends ResultadoConLector {
  /** Cómo pedir más (no nulo SI Y SOLO SI quedan filas legibles). */
  readonly lector: string | null
  readonly loteId: number
  /** Posición de la sentencia en su lote (0-based). */
  readonly sentencia: number
  /** Lo que se envió (para «Volver a ejecutar» y el tooltip). */
  readonly sql: string
  readonly clase: ClaseSentencia
  readonly columnas: readonly DbColumnaResultado[]
  /** Filas cargadas; null si la primera página no se pudo leer (`errorDatos`). */
  readonly datos: DatosRejilla | null
  readonly errorDatos: string | null
  /** Filas de la primera página: lo que se conserva al liberar memoria. */
  readonly filasPrimeraPagina: number
  readonly tiempos: DbTiempos
  /** RETURNING: filas afectadas además de las devueltas. */
  readonly afectadas: number | null
  /** No se puede volver a leer sin re-ejecutar algo que escribe. */
  readonly noReleible: boolean
  /** Alguna página se obtuvo re-ejecutando la consulta. */
  readonly reejecutada: boolean
  /** Ya no hay lector aunque quedaran filas: el motivo («Volver a ejecutar»). */
  readonly sinLector: string | null
  /**
   * La tabla ÚNICA de la sentencia (`Sentencia.tablaUnica`, nombres plegados), o null
   * con JOIN, varias tablas, DUAL o WITH. Da la tabla de «Copiar como INSERT» y es la
   * condición del valor completo de una celda (se busca la fila por su PK).
   */
  readonly tabla: RefObjeto | null
  /** Esquema de la sesión al terminar la sentencia: el de `tabla` si no lo escribió. */
  readonly esquemaSesion: string | null
  /**
   * Los parámetros con que se ejecutó. Viajan con todo lo que la vuelve a leer:
   * «Volver a ejecutar» y exportar la consulta; sin ellos, el main la rechazaría.
   */
  readonly binds?: DbBinds
  /**
   * La pestaña es un PLAN («Explicar plan»), no filas: `columnas` vacías, sin `datos`
   * ni lector. `DbResultados` pinta el árbol del plan en vez de la rejilla.
   */
  readonly plan?: DbPlan
}

/** El estado entero de una consola SQL (lo que guarda el `despachar` de `useConsola`). */
export interface EstadoConsola {
  readonly motor: DbMotor
  readonly dialecto: DialectoSql
  /** Último estado de sesión del main (null = aún no hay sesión). */
  readonly sesion: DbEstadoSesion | null
  readonly lote: Lote | null
  readonly resultados: EstadoResultados<ResultadoConsola>
  readonly salida: SalidaConsola
  /** Pista de la barra («Coloca el cursor…»), o null. */
  readonly pista: string | null
  /** Lectores de pestañas sustituidas o cerradas: el hook los cierra y drena. */
  readonly lectoresPorCerrar: readonly string[]
  /** `en` del último aviso de sesión escrito en la Salida. */
  readonly ultimoAvisoEn: number | null
}

/** Una sentencia que el prevuelo de solo lectura bloquea. `indice` = posición en el lote. */
export interface Bloqueo {
  indice: number
  motivo: string
}

/** Resultado del prevuelo de solo lectura: todo pasa, o las sentencias bloqueadas. */
export type Prevuelo ={ ok: true } | { ok: false; bloqueadas: Bloqueo[] }

export interface Peligro {
  /** Posición en el lote. */
  indice: number
  tipo: PeligroSentencia
  verbo: string
  /** Frase para el diálogo: «DELETE sin WHERE: afecta a todas las filas de la tabla». */
  motivo: string
  /** Primera línea de la sentencia, recortada, para el extracto monoespaciado. */
  extracto: string
}

/** Lo que se puede hacer con una pestaña de resultado desde su menú o su cabecera. */
export type AccionPestana = 'activar' | 'fijar' | 'desfijar' | 'cerrar' | 'cerrarOtras' | 'cerrarTodas'

type Posicion = { linea: number; columna: number }

/** Las acciones del reducer de la consola (`reducirConsola`). */
export type AccionConsola =
  /** Empieza un lote (ya partido). Aún no se ha enviado nada. */
  | { tipo: 'loteCreado'; lote: Lote }
  /** El prevuelo de solo lectura lo bloqueó entero: no se envía nada. */
  | { tipo: 'prevueloRechazado'; loteId: number; bloqueadas: readonly Bloqueo[]; ahora: number }
  /** Se envió la sentencia `indice` del lote. `esquema`: el actual, si el hook lo sabe. */
  | { tipo: 'sentenciaIniciada'; loteId: number; indice: number; ahora: number; esquema?: string | null }
  /**
   * Llegó su resultado (un `ok:false` se convierte con `resultadoDeRespuesta`).
   * `posicionModelo`: línea y columna del error en el modelo, que calcula quien tiene Monaco.
   */
  | {
      tipo: 'sentenciaTerminada'
      loteId: number
      indice: number
      resultado: DbResultadoSentencia
      sentencia?: Sentencia
      esquema: string | null
      ahora: number
      posicionModelo?: Posicion | null
      /** Los parámetros con que se envió (se guardan en su pestaña de resultado). */
      binds?: DbBinds
    }
  /** Llegó el PLAN de un lote de plan; un `ok:false` es el ✗ de una sentencia. */
  | {
      tipo: 'planTerminado'
      loteId: number
      indice: number
      respuesta: DbRespuesta<DbPlan>
      esquema: string | null
      ahora: number
      posicionModelo?: Posicion | null
      binds?: DbBinds
    }
  /** Decidida sin ir al servidor: comando del cliente (⊘) o bloqueada por solo lectura. */
  | {
      tipo: 'sentenciaLocal'
      loteId: number
      indice: number
      estado: 'cliente' | 'bloqueada'
      motivo: string
      ahora: number
      esquema?: string | null
    }
  /** Stop: no se envía nada más; la que corre termina por su cuenta. */
  | { tipo: 'detener'; loteId: number; ahora: number }
  /** Llegó otra página de un resultado (`id` = pestaña). */
  | { tipo: 'pagina'; id: string; pagina: DbPagina }
  /** El lector ya no existe en el main (noReleible, sesión cerrada…). */
  | { tipo: 'lectorCerrado'; id: string; motivo: string }
  /** Presupuesto de celdas: suelta lo que va tras la primera página. */
  | { tipo: 'liberar'; id: string }
  /** Nuevo estado de sesión (evento del main o consulta al montar). */
  | { tipo: 'sesion'; sesion: DbEstadoSesion | null; ahora: number }
  /** Respuesta de Commit / Rollback. `ms`: lo que tardó el invoke. */
  | { tipo: 'tx'; op: 'commit' | 'rollback'; respuesta: DbRespuesta<DbEstadoSesion>; ms: number; ahora: number }
  | { tipo: 'pestana'; accion: AccionPestana; id: string }
  | { tipo: 'pista'; texto: string | null }
  /** Una línea suelta en la Salida (p. ej. «El servidor no responde a la cancelación»). */
  | { tipo: 'salida'; entrada: NuevaEntrada; ahora: number }
  | { tipo: 'limpiarSalida' }
  | { tipo: 'drenarLectores' }

/** La acción de tipo `T`, ya estrechada. */
export type AccionDe<T extends AccionConsola['tipo']> = Extract<AccionConsola, { tipo: T }>

/** Un `ok:false` como el resultado de error de una sentencia (0 ms: no llegó a correr). */
export function errorComoResultado(error: DbErrorSql): DbResultadoSentencia {
  return { tipo: 'error', error, tiempos: { totalMs: 0, ejecucionMs: 0, lecturaMs: 0 } }
}

/**
 * Convierte la respuesta de `ejecutar` en un resultado de sentencia: un `ok:false`
 * (no llegó al servidor: ocupada, solo lectura, sin secreto…) se trata como un ✗ más.
 */
export function resultadoDeRespuesta(r: DbRespuesta<DbResultadoSentencia>): DbResultadoSentencia {
  if (r.ok) return r.valor
  return errorComoResultado(r.error)
}

/** La Salida de `e` con `nuevas` añadidas a la hora `ahora`. */
export function conSalida(e: EstadoConsola, nuevas: readonly NuevaEntrada[], ahora: number): SalidaConsola {
  return agregarSalida(e.salida, nuevas, ahora)
}

/** `previos` más `nuevos`; el MISMO arreglo si no hay nuevos (identidad estable). */
export function conLectores(previos: readonly string[], nuevos: readonly string[]): readonly string[] {
  return nuevos.length === 0 ? previos : previos.concat(nuevos)
}

/** Activa «Salida»; el MISMO estado si ya lo estaba. */
export function activarSalida(r: EstadoResultados<ResultadoConsola>): EstadoResultados<ResultadoConsola> {
  return r.activa === ID_SALIDA ? r : { ...r, activa: ID_SALIDA }
}
