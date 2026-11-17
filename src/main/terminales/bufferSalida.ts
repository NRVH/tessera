// =============================================================================
// Buffer de salida de una sesión de terminal (coalescing): apila los chunks del pty y los
// vuelca a los listeners en un solo lote por ventana, para no enviar un IPC por chunk.
// Opera sobre el `RegistroSesion` de `ServicioTerminal`, que es quien lo usa.
// =============================================================================
import type { RegistroSesion } from './tiposSesion.ts'

/**
 * Ventana de coalescing (ms): los chunks que llegan dentro de ella se vuelcan en un solo lote.
 * ~8 ms << un frame, así que el eco de teclas no se nota y una ráfaga de cientos de chunks
 * colapsa en un solo envío IPC.
 */
const VOLCADO_MS = 8

/** Programa un volcado del buffer si no hay uno pendiente. */
export function programarVolcado(registro: RegistroSesion): void {
  if (registro.temporizadorVolcado !== null) return
  registro.temporizadorVolcado = setTimeout(() => {
    registro.temporizadorVolcado = null
    volcarAhora(registro)
  }, VOLCADO_MS)
}

/** Vuelca el buffer a los listeners en un solo lote y cancela el volcado pendiente. */
export function volcarAhora(registro: RegistroSesion): void {
  if (registro.temporizadorVolcado !== null) {
    clearTimeout(registro.temporizadorVolcado)
    registro.temporizadorVolcado = null
  }
  if (registro.bufSalida.length === 0) return
  const datos = registro.bufSalida.join('')
  registro.bufSalida.length = 0
  for (const cb of registro.oyentesDatos) cb(datos)
}

/** Cancela el volcado pendiente y descarta el buffer (para una sesión que muere). */
export function descartarSalida(registro: RegistroSesion): void {
  if (registro.temporizadorVolcado !== null) {
    clearTimeout(registro.temporizadorVolcado)
    registro.temporizadorVolcado = null
  }
  registro.bufSalida.length = 0
}
