// =============================================================================
// Contrato IPC del cierre garantizado: el main intercepta el cierre, elimina de verdad
// los contenedores de Tessera (rm -f, desmontaje y verificación) y solo entonces sale,
// para que el siguiente arranque parta de cero.
// Solo main -> renderer (PROGRESS, para el overlay): el renderer no controla el
// cierre, lo refleja.
// Decisiones: docs/decisiones/app/cierre-ordenado.md
// =============================================================================

export const SHUTDOWN_CHANNELS = {
  /** main->renderer: progreso del cierre. Dispara/actualiza el overlay. */
  PROGRESS: 'shutdown:progress'
} as const

/**
 * Fase del cierre, para el texto y la barra.
 *
 * `aborted` es la única que NO termina en la muerte del proceso: se emite cuando el
 * cierre se cancela a mitad (hoy, cuando una actualización no logra arrancar su
 * instalador). El overlay debe OCULTARSE al recibirla y devolver la app al usuario,
 * en vez de quedarse congelado sobre una app que ya no se va a cerrar.
 */
export type ShutdownPhase = 'stopping' | 'unmounting' | 'verifying' | 'installing' | 'done' | 'aborted'

export interface ShutdownProgress {
  phase: ShutdownPhase
  /** Contenedores ya detenidos. */
  done: number
  /** Total de contenedores a detener (0 si no había ninguno). */
  total: number
  /** Texto legible para el overlay. */
  label: string
  /**
   * Subtítulo del overlay. Si falta, el overlay usa el suyo por fase (compatible
   * hacia atrás con todo emisor que no lo mande).
   *
   * Existe porque el texto de la fase `installing` estaba clavado en el overlay
   * diciendo "Tessera volverá a abrirse sola al terminar", y eso es MENTIRA en el
   * camino de aplicar-al-cerrar: ahí el instalador corre sin `--force-run` y la app
   * se queda cerrada a propósito. Quién relanza sólo lo sabe el main (es él quien
   * decide `relanzar`), así que la frase la manda él en vez de que el renderer la
   * adivine a partir de la fase.
   */
  sub?: string
}
