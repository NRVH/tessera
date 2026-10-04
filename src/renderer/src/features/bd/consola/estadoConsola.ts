// =============================================================================
// Estado de una consola SQL: el reducer puro que junta el lote en curso, las pestañas de
// resultado, la Salida, la sesión que informa el main y la pista de la barra. `useConsola`
// lo aplica con su `despachar` síncrono y ejecuta los efectos; aquí no hay ni un `await`.
// Es la API del estado: reexporta los tipos, la decisión del lote y la barra de tx.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbEstadoSesion } from '../../../../../shared/db-explorador-ipc.ts'
import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import { dialectoDeMotor } from '../../../../../shared/sql/dialectosSql.ts'
import type { IndicadorPestana } from '../dbTabsModel.ts'
import { estadoInicialResultados } from '../resultados/pestanasResultado.ts'
import { enCurso } from './lote.ts'
import type { AccionConsola, EstadoConsola, ResultadoConsola } from './modeloConsola.ts'
import { reducirLote } from './reductorLote.ts'
import { reducirResultados, reducirSesionYSalida } from './reductorResultados.ts'
import { salidaVacia } from './salidaConsola.ts'

export {
  MOTIVO_LIBERADA,
  PISTA_SIN_SENTENCIA,
  resultadoDeRespuesta,
  type AccionConsola,
  type AccionPestana,
  type EstadoConsola,
  type ResultadoConsola
} from './modeloConsola.ts'
export { decidirLote, explicarPideValores, peligros, prevueloLote } from './decisionLote.ts'
export {
  TITULO_SOLO_LECTURA,
  TITULO_TX_ARCHIVO,
  estadoBarraTx,
  pasoAAutoRequiereResolver,
  type BarraTx
} from './barraTx.ts'

/** El estado de una consola recién abierta; un aviso de sesión que ya estaba no se repite. */
export function estadoInicialConsola(motor: DbMotor, sesion: DbEstadoSesion | null = null): EstadoConsola {
  return {
    motor,
    dialecto: dialectoDeMotor(motor),
    sesion,
    lote: null,
    resultados: estadoInicialResultados<ResultadoConsola>(),
    salida: salidaVacia(),
    pista: null,
    lectoresPorCerrar: [],
    ultimoAvisoEn: sesion && sesion.aviso ? sesion.aviso.en : null
  }
}

/** Id para el próximo lote: mayor que el del lote actual y que el de las pestañas. */
export function nuevoLoteId(e: EstadoConsola): number {
  return Math.max(e.lote ? e.lote.id : 0, e.resultados.lote) + 1
}

/** Aplica una acción: una acción = un estado coherente, o el MISMO si no cambia nada. */
export function reducirConsola(e: EstadoConsola, a: AccionConsola): EstadoConsola {
  switch (a.tipo) {
    case 'loteCreado':
    case 'prevueloRechazado':
    case 'sentenciaIniciada':
    case 'sentenciaTerminada':
    case 'planTerminado':
    case 'sentenciaLocal':
    case 'detener':
      return reducirLote(e, a)
    case 'pagina':
    case 'lectorCerrado':
    case 'liberar':
    case 'pestana':
      return reducirResultados(e, a)
    default:
      return reducirSesionYSalida(e, a)
  }
}

// --- Derivados -------------------------------------------------------------------------

/** El usuario eligió una pestaña durante el lote en curso (deja de auto-activar). */
export function usuarioEligioPestana(e: EstadoConsola): boolean {
  return e.resultados.eligioEnLote
}

/** ¿Hay algo ejecutándose o en cola? (■ habilitado, «¿Detener y cerrar?»). */
export function ejecutando(e: EstadoConsola): boolean {
  return enCurso(e.lote)
}

/**
 * Indicadores de la pestaña de la consola (el modelo de pestañas elige UNO por
 * prioridad): ejecutando, tx pendiente (o fallida: también se pierde al cerrar),
 * sesión perdida y error en el último lote.
 */
export function indicadoresConsola(e: EstadoConsola): Set<IndicadorPestana> {
  const out = new Set<IndicadorPestana>()
  if (ejecutando(e)) out.add('ejecutando')
  const s = e.sesion
  if (s && (s.tx === 'pendiente' || s.tx === 'fallida')) out.add('txPendiente')
  if (s && s.fase === 'perdida') out.add('sesionPerdida')
  if (e.lote && e.lote.sentencias.some((x) => x.estado === 'error')) out.add('error')
  return out
}
