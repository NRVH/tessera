// =============================================================================
// Textos derivados del estado de actualización. Módulo PURO (sin React, DOM ni IPC)
// para probarlo con `node` a secas, compartido por el botón de la barra de título y la
// categoría Actualizaciones de Configuración. El tiempo se formatea aquí y no viaja
// formateado en `UpdateState`: el main difunde `ultimoChequeoMs` como epoch, y una
// cadena «hace 3 min» se quedaría rancia entre difusiones.
// =============================================================================

/**
 * Cada cuánto refrescan las vistas su "hace N min". Vive aquí para que las dos
 * superficies que lo pintan no puedan latir a ritmos distintos.
 */
export const TICK_ULTIMO_CHEQUEO_MS = 30_000

/**
 * "Comprobado hace N min". Acota deltas negativos a propósito: un salto de reloj hacia
 * atrás no debe producir "hace -4 min".
 */
export function textoUltimoChequeo(ultimoMs: number | null, ahoraMs: number): string {
  if (ultimoMs === null) return 'Aún no se ha comprobado'
  const min = Math.floor(Math.max(0, ahoraMs - ultimoMs) / 60_000)
  if (min < 1) return 'Comprobado hace un momento'
  if (min < 60) return `Comprobado hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Comprobado hace ${h} h`
  return `Comprobado hace ${Math.floor(h / 24)} d`
}
