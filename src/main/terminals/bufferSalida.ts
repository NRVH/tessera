// =============================================================================
// Buffer de salida de una sesión de terminal (coalescing): apila los chunks del pty y los
// vuelca a los listeners en un solo lote por ventana, para no enviar un IPC por chunk.
// Opera sobre el `SessionRecord` de `TerminalService`, que es quien lo usa.
// =============================================================================
import type { SessionRecord } from './tiposSesion.ts'

/**
 * Ventana de coalescing (ms): los chunks que llegan dentro de ella se vuelcan en un solo lote.
 * ~8 ms << un frame, así que el eco de teclas no se nota y una ráfaga de cientos de chunks
 * colapsa en un solo envío IPC.
 */
const FLUSH_MS = 8

/** Programa un volcado del buffer si no hay uno pendiente. */
export function programarVolcado(record: SessionRecord): void {
  if (record.flushTimer !== null) return
  record.flushTimer = setTimeout(() => {
    record.flushTimer = null
    volcarAhora(record)
  }, FLUSH_MS)
}

/** Vuelca el buffer a los listeners en un solo lote y cancela el volcado pendiente. */
export function volcarAhora(record: SessionRecord): void {
  if (record.flushTimer !== null) {
    clearTimeout(record.flushTimer)
    record.flushTimer = null
  }
  if (record.outBuf.length === 0) return
  const data = record.outBuf.join('')
  record.outBuf.length = 0
  for (const cb of record.listeners) cb(data)
}

/** Cancela el volcado pendiente y descarta el buffer (para una sesión que muere). */
export function descartarSalida(record: SessionRecord): void {
  if (record.flushTimer !== null) {
    clearTimeout(record.flushTimer)
    record.flushTimer = null
  }
  record.outBuf.length = 0
}
