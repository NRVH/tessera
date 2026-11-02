// =============================================================================
// Preload: «Continuar en…», que pasa el trabajo de la sesión de un pane a otro agente, modo o cuenta. Solo
// invoke; la copia y el traspaso los prepara el main. Canales y formas: src/shared/traspaso-ipc.ts.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { ipcRenderer } from 'electron'
import { TRASPASO_CHANNELS, type ContinuarEnRequest, type ContinuarEnResult } from '../shared/traspaso-ipc'

/** API del traspaso expuesta al renderer. */
export interface TraspasoApi {
  /** Prepara el destino; devuelve el id a pasar en su apertura y, con el mismo agente, la conversación a reanudar. */
  continuarEn: (req: ContinuarEnRequest) => Promise<ContinuarEnResult>
}

export const traspaso: TraspasoApi = {
  continuarEn: (req) => ipcRenderer.invoke(TRASPASO_CHANNELS.CONTINUAR_EN, req)
}
