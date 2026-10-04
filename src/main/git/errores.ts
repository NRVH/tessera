// =============================================================================
// Utilidades de error, los rechazos comunes y el separador de campos de los módulos de git del main.
// Puro: sin electron, sin fs, sin git. Lo importan `historial`, `estado`, `preparar`,
// `descartes`, `clasificarDescartes`, `lotes`, `ignorar`, `blobs` y `NucleoGit`.
// =============================================================================

/** Separador de campos dentro de un registro (NUL, 0x00). */
export const FS = '\x00'

/** Rechazo de una ruta que no nombra un archivo (vacía, `.`, `..`, barra final, el repo entero). */
export const RUTA_NO_VALIDA = 'Ruta no válida.'

/** Git no llegó a contestar a la comprobación previa (techo de tiempo, cola, no arrancó): no se hace nada. */
export const GIT_NO_RESPONDE = 'git no respondió; inténtalo de nuevo.'

/**
 * Mensaje para el usuario de un fallo de git en una comprobación previa. Si git TERMINÓ con un
 * código de salida, contestó con un error definitivo (HEAD dañado, índice corrupto) y reintentar no
 * lo arregla: se dice cuál, con la primera línea de su stderr. Si no (matado por el techo, la cola
 * lo canceló, no arrancó), es `GIT_NO_RESPONDE`.
 */
export function errorDeGit(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; killed?: unknown; signal?: unknown }
  if (typeof e.code !== 'number' || e.killed === true || (e.signal !== undefined && e.signal !== null)) {
    return GIT_NO_RESPONDE
  }
  const linea = errStderr(err)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '')
  return linea ? `git falló: ${linea}` : `git falló (salida ${e.code}).`
}

/** El `stderr` que `execFile` adjunta al error, o '' si no hay. */
export function errStderr(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr?: unknown }).stderr
    if (typeof stderr === 'string') return stderr
  }
  return ''
}

/** Mensaje legible de cualquier valor lanzado. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** true si el error es un ENOENT de fs (archivo inexistente en disco). */
export function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ENOENT'
}
