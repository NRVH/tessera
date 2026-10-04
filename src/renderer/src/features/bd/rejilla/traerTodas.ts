// =============================================================================
// «Traer todas»: cuántas filas pedir en cada vuelta (páginas de `DB_PAGINA_MAX`, sin pasarse
// del presupuesto de celdas), cuándo parar y cómo decirlo. El bucle lo lleva el dueño (la
// pestaña de datos o un resultado de consola); la decisión vive aquí. Puro y neutral.
// Detener no es perder el lector: lo traído se queda y todo sigue disponible.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-memoria.md
// =============================================================================

import { DB_PAGINA_MAX, type DbErrorSql } from '../../../../../shared/db-explorador-ipc.ts'
import { formatoEntero } from './celdasRejilla.ts'

/** Lo que se le pregunta al presupuesto de celdas (lo cumple `RegistroCeldas`). */
export interface MedidorCeldas {
  /** ¿Caben `extra` celdas más? Suelta las ocultas menos usadas si así caben. */
  cabe(extra: number): boolean
  /** Lo que cabría soltando todas las ocultas, sin soltar nada. */
  alcanzable(): number
}

/**
 * Filas de la siguiente página: `maxFilas`, o las que quepan si no caben todas. 0 =
 * no cabe ninguna más (parar y decirlo).
 */
export function filasSiguientePagina(medidor: MedidorCeldas, columnas: number, maxFilas: number = DB_PAGINA_MAX): number {
  const cols = Number.isFinite(columnas) && columnas >= 1 ? Math.trunc(columnas) : 1
  const max = Number.isFinite(maxFilas) && maxFilas >= 1 ? Math.trunc(maxFilas) : 1
  const libres = medidor.alcanzable()
  const filas = Math.min(max, Math.floor((Number.isFinite(libres) && libres > 0 ? libres : 0) / cols))
  if (filas <= 0) return 0
  // Aquí se sueltan, de verdad, las ocultas que hagan falta para esta página.
  return medidor.cabe(filas * cols) ? filas : 0
}

/**
 * ¿Se suelta ya el «tope de memoria» de una rejilla parada, para que la carga al
 * desplazar siga? Solo si se ve, tiene el tope puesto y su lector vivo, y cabe UNA página
 * con las filas por página de AHORA: el dueño vuelve a preguntar también cuando cambia
 * ese ajuste (bajarlo puede hacer que la página siguiente quepa). `cabe` puede soltar rejillas ocultas: por eso no se le
 * pregunta si no hace falta.
 */
export function reanudarTrasTope(
  p: { visible: boolean; tope: boolean; hayLector: boolean; columnas: number; filasPorPagina: number },
  medidor: Pick<MedidorCeldas, 'cabe'>
): boolean {
  if (!p.visible || !p.tope || !p.hayLector) return false
  return medidor.cabe(p.filasPorPagina * p.columnas)
}

export type PasoTraerTodas =
  | { tipo: 'pedir'; filas: number }
  /** El servidor no tiene más filas. */
  | { tipo: 'completo' }
  /** El presupuesto de memoria no admite ni una fila más. */
  | { tipo: 'tope' }
  /** El usuario pulsó Detener (o se lanzó otra consulta). */
  | { tipo: 'detenido' }

export interface EstadoTraerTodas {
  hayMas: boolean
  detenido: boolean
  columnas: number
}

/** La siguiente vuelta del bucle. */
export function siguientePaso(
  e: EstadoTraerTodas,
  medidor: MedidorCeldas,
  maxFilas: number = DB_PAGINA_MAX
): PasoTraerTodas {
  if (e.detenido) return { tipo: 'detenido' }
  if (!e.hayMas) return { tipo: 'completo' }
  const filas = filasSiguientePagina(medidor, e.columnas, maxFilas)
  return filas > 0 ? { tipo: 'pedir', filas } : { tipo: 'tope' }
}

/** Quién espera la página de «más filas» que volvió con error. */
export type OrigenPagina = 'desplazar' | 'traerTodas'

/**
 * Qué hacer con una página que volvió con error (ver la cabecera):
 *   · `seguir`: Detener de «Traer todas». Nada que decir ni que soltar; el lector sigue.
 *   · `detenida`: Detener de una página al desplazar. Se dice en la píldora, pero el
 *     lector NO se suelta (el main lo sigue sirviendo).
 *   · `perdido`: cualquier otro fallo. El main ya no sirve ese lector: se avisa y se
 *     suelta.
 */
export type TrasFalloPagina = 'seguir' | 'detenida' | 'perdido'

export function trasFalloPagina(e: Pick<DbErrorSql, 'motivo'>, origen: OrigenPagina): TrasFalloPagina {
  if (e.motivo !== 'cancelada') return 'perdido'
  return origen === 'traerTodas' ? 'seguir' : 'detenida'
}

/** Motivo de la píldora al llegar al tope de memoria (ver la cabecera). */
export function motivoTopeTraerTodas(cargadas: number): string {
  const n = formatoEntero(cargadas)
  return `Se trajeron ${n} ${cargadas === 1 ? 'fila' : 'filas'}; el resto no cabe en memoria: expórtalo a archivo`
}

/** Lo que dice la píldora mientras trae: cuántas van. */
export function textoTrayendo(cargadas: number): string {
  return `Trayendo filas… ${formatoEntero(cargadas)}`
}

/**
 * Por qué «Traer todas» no se puede ahora, o null si se puede. Decide si la entrada
 * del menú de la rejilla va apagada; el motivo en sí lo enseña la píldora, que es
 * donde se ve el estado de las filas (`ContextMenu` no lleva `title` por entrada).
 */
export function motivoSinTraerTodas(e: {
  hayDatos: boolean
  hayMas: boolean
  trayendo: boolean
  /** Motivo por el que ya no se leen más filas (el de la píldora), o null. */
  sinLector: string | null
}): string | null {
  if (!e.hayDatos) return 'Todavía no hay datos'
  if (e.trayendo) return 'Ya se están trayendo todas las filas'
  if (!e.hayMas) return 'Ya están todas las filas cargadas'
  if (e.sinLector) return e.sinLector
  return null
}
