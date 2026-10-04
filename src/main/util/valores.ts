// =============================================================================
// Comprobaciones de valores desconocidos que repetía cada módulo del main: ¿es un objeto plano
// de JSON?, y el mensaje de cualquier cosa lanzada. Puro y sin imports, para que lo pueda
// cargar cualquier módulo (también los que prueba `node` a secas) sin arrastrar nada.
// =============================================================================

/** ¿Es un objeto (no `null` ni un array)? Lo que llega por IPC o de un JSON se mira así. */
export function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** El mensaje de un error cualquiera (lo lanzado puede no ser un `Error`). */
export function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
