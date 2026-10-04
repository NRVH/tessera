// =============================================================================
// Silencia la cancelación que Monaco deja sin capturar al desechar un editor: su resaltado
// de apariciones arma un retardo de 50 ms tras cada movimiento del cursor o del foco, y
// desechar el editor (o su modelo) antes rechaza esa promesa sin que nadie la espere. Solo
// esa cancelación (`name` y `message` «Canceled»): cualquier otro rechazo sigue su curso.
// Sin DOM al cargar; lo usan los editores de las consolas y `test-silencio-cancelaciones.mts`.
// =============================================================================

/** Lo que se usa de `window`: dónde escuchar los rechazos sin capturar. */
export interface ObjetivoRechazos {
  addEventListener(tipo: 'unhandledrejection', f: (e: Event) => void): void
  removeEventListener(tipo: 'unhandledrejection', f: (e: Event) => void): void
}

/** Tiempo que sigue el filtro tras soltarlo: el evento llega en una tarea posterior al desecho. */
const GRACIA_MS = 1000

/** ¿Es la `CancellationError` de Monaco, y no un error cualquiera que mencione «Canceled»? */
export function esCancelacionMonaco(razon: unknown): boolean {
  return razon instanceof Error && razon.name === 'Canceled' && razon.message === 'Canceled'
}

function alRechazo(e: Event): void {
  if (esCancelacionMonaco((e as Event & { reason?: unknown }).reason)) e.preventDefault()
}

const retenidos = new Map<ObjetivoRechazos, number>()

/**
 * Activa el filtro mientras viva un editor y devuelve con qué soltarlo, que se llama
 * DESPUÉS de desecharlo. Se cuenta por objetivo: varios editores comparten un solo oyente.
 */
export function retenerSilencioCancelaciones(
  objetivo: ObjetivoRechazos = window,
  graciaMs: number = GRACIA_MS
): () => void {
  const n = retenidos.get(objetivo) ?? 0
  if (n === 0) objetivo.addEventListener('unhandledrejection', alRechazo)
  retenidos.set(objetivo, n + 1)
  let soltado = false
  return () => {
    if (soltado) return
    soltado = true
    setTimeout(() => {
      const quedan = (retenidos.get(objetivo) ?? 1) - 1
      if (quedan > 0) {
        retenidos.set(objetivo, quedan)
        return
      }
      retenidos.delete(objetivo)
      objetivo.removeEventListener('unhandledrejection', alRechazo)
    }, graciaMs)
  }
}
