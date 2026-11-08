// =============================================================================
// Dónde está el cursor de cada archivo abierto (por `textModelKey`: target y ruta), para guardarlo con la
// sesión del proyecto y volver a él al reabrir. Lo escribe el editor al mover el cursor; lo lee quien
// guarda la sesión, avisado por `alMoverCursor`. Fuera de un store: mover el cursor no repinta nada.
// Decisiones: docs/decisiones/workspace/sesion-de-cada-proyecto.md
// =============================================================================

/** Una posición del cursor, en base 1. */
export interface PosicionCursor {
  linea: number
  columna: number
}

const posiciones = new Map<string, PosicionCursor>()
const oyentes = new Set<() => void>()

/** Anota dónde quedó el cursor de un archivo y avisa a quien guarda la sesión. */
export function recordarCursor(modelKey: string, linea: number, columna: number): void {
  const prev = posiciones.get(modelKey)
  if (prev?.linea === linea && prev.columna === columna) return
  posiciones.set(modelKey, { linea, columna })
  for (const f of oyentes) f()
}

/** La última posición del cursor de un archivo, si se movió. */
export function cursorDe(modelKey: string): PosicionCursor | undefined {
  return posiciones.get(modelKey)
}

/** Avisa de cada movimiento del cursor; devuelve cómo dejar de escuchar. */
export function alMoverCursor(f: () => void): () => void {
  oyentes.add(f)
  return () => oyentes.delete(f)
}
