// =============================================================================
// CSS de las dos superficies de git (Cambios y Log), acotado por clase raíz e inyectado
// una sola vez en un <style> propio, sin tocar la hoja global. La hoja se arma con los
// trozos de `estilos/` en un orden FIJO, que es el de la cascada.
// Lo usan GitPanel, GitLogPanel y el diff de comprimidos del editor.
// Decisiones: docs/decisiones/git/estilos-inyectados.md
// =============================================================================
import { CSS_COMPARTIDO } from './estilos/compartido'
import { CSS_CAMBIOS } from './estilos/cambios'
import { CSS_LOG_CHASIS } from './estilos/logChasis'
import { CSS_HISTORIAL_ARCHIVO } from './estilos/historialArchivo'
import { CSS_LOG_COLUMNAS } from './estilos/logColumnas'
import { CSS_LOG_RAMAS } from './estilos/logRamas'
import { CSS_LOG_FILTROS } from './estilos/logFiltros'
import { CSS_LOG_COMMITS } from './estilos/logCommits'
import { CSS_LOG_DETALLE } from './estilos/logDetalle'

const ESTILOS_ID = 'git-styles'

// Las alturas de fila no viven aquí: llegan como `--ui-row-h`/`--ui-head-h` desde
// `theme/densidad.ts`, porque cambian en caliente y `VirtualList` usa el mismo número.

/** La hoja entera, en el orden de la cascada: compartido, Cambios y la franja de Log. */
export const ESTILOS_GIT =
  CSS_COMPARTIDO +
  CSS_CAMBIOS +
  CSS_LOG_CHASIS +
  CSS_HISTORIAL_ARCHIVO +
  CSS_LOG_COLUMNAS +
  CSS_LOG_RAMAS +
  CSS_LOG_FILTROS +
  CSS_LOG_COMMITS +
  CSS_LOG_DETALLE

/**
 * Inyecta (o ACTUALIZA) el CSS de git. Idempotente: solo reescribe si el contenido
 * cambió, así el HMR de dev refleja los ajustes sin recargar la ventana.
 */
export function asegurarEstilosGit(): void {
  let style = document.getElementById(ESTILOS_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = ESTILOS_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== ESTILOS_GIT) style.textContent = ESTILOS_GIT
}
