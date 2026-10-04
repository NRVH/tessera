// =============================================================================
// Lo que se lee del estado de la máquina de una sesión sin tocarlo: el DTO del contrato para
// `dbx:ev:sesion` y las invariantes que fija `test-maquina-sesion`. Puro; lo reexporta
// `maquinaSesion.ts`, de donde lo importan el gestor y las pruebas.
// Decisiones: docs/decisiones/bd/transacciones-maquina-de-estados.md
// =============================================================================

import type { DbEstadoSesion, DbRefSesion } from '../../../../shared/db-explorador-ipc.ts'
import type { EstadoMaquinaSesion } from '../maquinaSesion.ts'

/** Invariantes violadas (vacío = todo en orden). */
export function invariantesRotas(e: EstadoMaquinaSesion): string[] {
  const rotas: string[] = []
  if ((e.fase === 'cerrada' || e.fase === 'perdida') && e.tx !== 'ninguna') {
    rotas.push(`fase ${e.fase} con tx ${e.tx}`)
  }
  if (e.soloLectura && e.txModo !== 'auto') rotas.push('solo lectura en modo Manual')
  if (e.soloLectura && e.tx !== 'ninguna') rotas.push(`solo lectura con tx ${e.tx}`)
  if (e.tx === 'ninguna' && e.sentenciasEnTx !== 0) rotas.push(`sentenciasEnTx=${e.sentenciasEnTx} sin tx`)
  if (e.sentenciasEnTx < 0) rotas.push('sentenciasEnTx negativo')
  if ((e.fase === 'ocupada') !== (e.ocupadaDesde !== undefined)) {
    rotas.push(`fase ${e.fase} con ocupadaDesde=${String(e.ocupadaDesde)}`)
  }
  return rotas
}

/** DTO del contrato para `dbx:ev:sesion` / `dbx:sesiones`. */
export function aEstadoSesion(
  e: EstadoMaquinaSesion,
  ref: DbRefSesion,
  conexionId: string,
  driver?: DbEstadoSesion['driver']
): DbEstadoSesion {
  const dto: DbEstadoSesion = {
    ref,
    conexionId,
    fase: e.fase,
    txModo: e.txModo,
    tx: e.tx,
    sentenciasEnTx: e.sentenciasEnTx,
    esquema: e.esquema,
    soloLectura: e.soloLectura
  }
  if (e.ocupadaDesde !== undefined) dto.ocupadaDesde = e.ocupadaDesde
  if (driver) dto.driver = driver
  if (e.aviso) dto.aviso = e.aviso
  return dto
}
