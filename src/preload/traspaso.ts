// =============================================================================
// Preload: «Continuar en…», que pasa el trabajo de la sesión de un pane a otro agente, modo o cuenta. Solo
// invoke; la copia y el traspaso los prepara el main. Canales y formas: src/shared/traspaso-ipc.ts.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { ipcRenderer } from 'electron'
import { TRASPASO_CHANNELS, type PeticionContinuarEn, type ResultadoContinuarEn } from '../shared/traspaso-ipc'

/** API del traspaso expuesta al renderer. */
export interface ApiTraspaso {
  /** Prepara el destino; devuelve el id a pasar en su apertura y, con el mismo agente, la conversación a reanudar. */
  continuarEn: (req: PeticionContinuarEn) => Promise<ResultadoContinuarEn>
}

export const traspaso: ApiTraspaso = {
  continuarEn: (req) => ipcRenderer.invoke(TRASPASO_CHANNELS.CONTINUAR_EN, req)
}
