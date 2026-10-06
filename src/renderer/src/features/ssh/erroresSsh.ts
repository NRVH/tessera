// =============================================================================
// El mensaje de un error de las conexiones SSH que cruzó el IPC: el main lo escribe en español y
// sin rutas, así que se enseña tal cual, solo sin el envoltorio con que Electron lo entrega.
// Depende de `shared/dockerErrors` (`normalizarErrorIpc`, que no toca la plataforma).
// =============================================================================

import { normalizarErrorIpc } from '../../../../shared/dockerErrors'

/** El texto del error, sin «Error invoking remote method…» ni «Error:» delante. */
export function mensajeDeErrorSsh(err: unknown): string {
  const texto = normalizarErrorIpc(err instanceof Error ? err.message : String(err))
  return texto === '' ? 'Error desconocido' : texto
}
