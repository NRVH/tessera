// =============================================================================
// Web Worker del layout del grafo de commits. Corre `computeGraphLayout` FUERA del
// hilo de UI: con el historial completo de un repo grande (decenas de miles de
// commits) el cálculo es O(commits × lanes) y, en el hilo principal, congelaba la
// interfaz ("La aplicación no responde"). Aquí el hilo de UI queda libre.
//
// Protocolo: recibe { id, commits:[{hash,parents}] }, responde { id, layout }. El
// `id` permite al hook descartar respuestas de peticiones ya superadas (el usuario
// siguió commiteando mientras se calculaba una versión vieja).
// =============================================================================

import { computeGraphLayout, type GraphCommitInput, type GraphLayout } from './graphLayout'

interface LayoutRequest {
  id: number
  commits: GraphCommitInput[]
}

interface LayoutResponse {
  id: number
  layout: GraphLayout
}

// `self` en un worker dedicado no es Window; se tipa a mano para evitar la firma de
// dos argumentos de Window.postMessage (que en el worker es de uno).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null
  postMessage: (msg: LayoutResponse) => void
}

ctx.onmessage = (e): void => {
  const { id, commits } = e.data
  ctx.postMessage({ id, layout: computeGraphLayout(commits) })
}
