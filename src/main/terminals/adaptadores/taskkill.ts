// =============================================================================
// Cómo acabó un `taskkill /T /F` (`matarArbolWindows`, en `pty.ts`): matar el árbol de un pty es lo
// que impide que un agente sobreviva a su sesión, y un `taskkill` que falla o que corta su tope deja
// procesos vivos sin que nadie lo sepa. Esto lo convierte en algo que anotar. Puro.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================

/** El desenlace de un `taskkill`. `sin-proceso`: algún pid ya no existía, que en un cierre es lo normal. */
export interface ResultadoTaskkill {
  estado: 'ok' | 'sin-proceso' | 'fallo' | 'tope'
  detalle?: string
}

/** `taskkill` sale con 128 cuando no encuentra algún pid (aunque mate los demás). */
const CODIGO_SIN_PROCESO = 128

/** Lo que importa del error de `execFile`. */
export interface ErrorEjecucion {
  code?: number | string | null
  killed?: boolean
  signal?: string | null
  message?: string
}

/** Clasifica lo que devolvió `execFile('taskkill', …)`: el tope de `execFile` mata a `taskkill` a medias. */
export function clasificarTaskkill(err: ErrorEjecucion | null, stderr = ''): ResultadoTaskkill {
  if (err === null) return { estado: 'ok' }
  if (err.killed === true || (err.signal !== undefined && err.signal !== null)) return { estado: 'tope' }
  if (err.code === CODIGO_SIN_PROCESO) return { estado: 'sin-proceso' }
  const texto = (stderr.trim() || err.message || '').replace(/\s*[\r\n]+\s*/g, ' | ').slice(0, 200)
  return { estado: 'fallo', detalle: `código ${String(err.code ?? '?')}${texto ? `: ${texto}` : ''}` }
}

/** Una línea de registro, o `null` si no hay nada que contar. */
export function notaTaskkill(r: ResultadoTaskkill): string | null {
  if (r.estado === 'ok' || r.estado === 'sin-proceso') return null
  if (r.estado === 'tope') return 'taskkill no acabó a tiempo: pudo dejar parte del árbol vivo'
  return `taskkill falló (${r.detalle ?? 'sin detalle'})`
}
