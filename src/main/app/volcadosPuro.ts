// =============================================================================
// Qué hacer al arrancar con los volcados de caída que dejó el registrador de Electron: cuáles son
// nuevos desde la última revisión (para anotarlos en `crash.log`) y cuáles sobran para conservar
// solo los más recientes. Si se graban lo decide `opcionExperimentalActiva` (`shared/salud.ts`).
// Puro; lo usa `volcados.ts`.
// Decisiones: docs/decisiones/app/volcados-de-caida.md
// =============================================================================

/** Cuántos volcados se conservan: cada uno pesa unos MB y basta con los últimos. */
export const VOLCADOS_CONSERVADOS = 10

export interface Volcado {
  ruta: string
  /** Fecha de modificación, en ms. */
  mtimeMs: number
}

export interface DecisionVolcados {
  /** Los posteriores a la última revisión, del más antiguo al más reciente. */
  nuevos: Volcado[]
  /** Los que pasan del tope, empezando por los más antiguos. */
  borrar: Volcado[]
  /** Hasta dónde queda revisado (no retrocede aunque se borren todos). */
  revisadoHasta: number
}

export function decidirVolcados(
  lista: Volcado[],
  revisadoHasta: number,
  conservar = VOLCADOS_CONSERVADOS
): DecisionVolcados {
  const porFecha = [...lista].sort((a, b) => a.mtimeMs - b.mtimeMs)
  const nuevos = porFecha.filter((v) => v.mtimeMs > revisadoHasta)
  const sobran = Math.max(0, porFecha.length - Math.max(0, conservar))
  return {
    nuevos,
    borrar: porFecha.slice(0, sobran),
    revisadoHasta: porFecha.reduce((m, v) => Math.max(m, v.mtimeMs), revisadoHasta)
  }
}
