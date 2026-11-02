// =============================================================================
// Cómo se nombra en los diálogos de la copia el historial de una cuenta (o el nativo de un agente) y
// cuánto trae: lo comparten exportar e importar. Puro, con los textos de `textosCopia.ts`.
// Decisiones: docs/decisiones/configuracion/historial-en-la-copia.md
// =============================================================================

import type { FuenteHistorial } from '../../../../../shared/copia-configuracion-ipc'
import { formatoBytes } from '../../../util/formatoBytes'
import { txCopia } from './textosCopia.ts'

/** «Claude Code · Trabajo», o «Claude Code · este equipo» en la nativa; con el perfil delante si se da. */
export function etiquetaFuente(f: FuenteHistorial, perfil?: string): string {
  const t = txCopia()
  const cuenta = f.perfil === null ? t.exportar.deEsteEquipo : f.predeterminada ? t.predeterminada : (f.cuenta ?? '')
  return [perfil, t.agentes[f.agente], cuenta].filter((x) => x).join(' · ')
}

/** «12 conversaciones · 3.4 MB». */
export function detalleFuente(f: Pick<FuenteHistorial, 'conversaciones' | 'bytes'>): string {
  return txCopia().exportar.historialFila(f.conversaciones, formatoBytes(f.bytes))
}

export function totalHistorial(fuentes: readonly FuenteHistorial[]): { conversaciones: number; bytes: number } {
  return {
    conversaciones: fuentes.reduce((n, f) => n + f.conversaciones, 0),
    bytes: fuentes.reduce((n, f) => n + f.bytes, 0)
  }
}
