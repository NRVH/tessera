// =============================================================================
// GET por la pila de red de Chromium (`net.request`): hereda el proxy, los certificados y el
// seguimiento de redirecciones del sistema, que `node:https` no hace. Llega por `SistemaUpdate`
// a la descarga del zip de macOS (`descargaMac.ts`), que escucha la respuesta por su cuenta.
// =============================================================================

import { net, type ClientRequest } from 'electron'

/** Abre una petición GET sin enviarla: el llamador cuelga sus oyentes y llama a `end()`. */
export function peticionGet(url: string): ClientRequest {
  return net.request({ url, method: 'GET' })
}
