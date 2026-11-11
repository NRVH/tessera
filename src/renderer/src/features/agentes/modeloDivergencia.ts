// =============================================================================
// Las decisiones del diálogo de una conversación cuyas dos copias divergieron: cuál es la más reciente, en qué
// orden van los botones (la recomendada a la derecha, como principal) y cómo se nombra cada lado.
// Puro, para probarlo con `node`.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import type { CopiaConversacion, EleccionDivergencia } from '../../../../shared/traspaso-ipc.ts'

/** Un extremo del traspaso: dónde corre y, en Docker, el nombre de la cuenta. */
export interface ExtremoTraspaso {
  modo: 'nativo' | 'docker'
  nombre: string
}

/** La que cambió por última vez; sin fechas que comparar, la de origen, que es desde donde se pide continuar. */
export function masReciente(copias: { origen: CopiaConversacion; destino: CopiaConversacion }): EleccionDivergencia {
  const { origen, destino } = copias
  if (origen.modificada === null || destino.modificada === null) return 'origen'
  return destino.modificada > origen.modificada ? 'destino' : 'origen'
}

/** El orden de los botones: el de la más reciente al final, donde va el principal. */
export function ordenBotones(reciente: EleccionDivergencia): EleccionDivergencia[] {
  return reciente === 'origen' ? ['destino', 'origen'] : ['origen', 'destino']
}

/**
 * Cómo se nombra cada lado. Entre el equipo y Docker basta con eso; entre dos cuentas de Docker, sus nombres.
 * `lugar` es el destino como sitio («su equipo», «la cuenta «X»»).
 */
export function nombresDeLados(
  origen: ExtremoTraspaso,
  destino: ExtremoTraspaso,
  t: { tuEquipo: string; docker: string; cuenta: (nombre: string) => string; citada: (nombre: string) => string }
): { origen: string; destino: string; lugar: string } {
  const ambosDocker = origen.modo === 'docker' && destino.modo === 'docker'
  const corto = (e: ExtremoTraspaso): string => (e.modo === 'nativo' ? t.tuEquipo : ambosDocker ? t.citada(e.nombre) : t.docker)
  return { origen: corto(origen), destino: corto(destino), lugar: destino.modo === 'nativo' ? t.tuEquipo : t.cuenta(destino.nombre) }
}
