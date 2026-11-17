// =============================================================================
// Preload: la ventana de agente. Abrir una, con qué nace, qué agente enseña, y el relevo de la
// actualización nativa entre ventanas: la principal actúa sobre un pane de otra ventana y esta
// atiende el encargo y responde. Canales y formas: `src/shared/ventana-agente-ipc.ts`.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  VENTANA_AGENTE_CHANNELS,
  type DatosVentanaAgente,
  type EncargoPaneRemoto,
  type PeticionPaneRemoto,
  type RespuestaPaneRemoto
} from '../shared/ventana-agente-ipc'
import type { IdAgente } from '../shared/agentesManuales'

export interface ApiVentanaAgente {
  /** Abre una ventana de agente nueva. */
  abrir: () => Promise<void>
  /** Con qué nació esta ventana; null si no es una ventana de agente. */
  datos: () => Promise<DatosVentanaAgente | null>
  /** El agente que esta ventana enseña ahora (para reabrirla igual tras actualizar). */
  fijarActivo: (agente: IdAgente) => void
  /** (Principal) Actúa sobre el pane de otra ventana; devuelve el resultado de relanzar o null. */
  paneRemoto: (req: PeticionPaneRemoto) => Promise<RespuestaPaneRemoto['resultado']>
  /** (Ventana de agente) Atiende los encargos de la principal; devuelve cómo dejar de atenderlos. */
  alRecibirEncargo: (cb: (e: EncargoPaneRemoto) => void) => () => void
  /** (Ventana de agente) Responde a un encargo. */
  responder: (r: RespuestaPaneRemoto) => void
}

export const ventanaAgente: ApiVentanaAgente = {
  abrir: () => ipcRenderer.invoke(VENTANA_AGENTE_CHANNELS.ABRIR),
  datos: () => ipcRenderer.invoke(VENTANA_AGENTE_CHANNELS.DATOS),
  fijarActivo: (agente) => ipcRenderer.send(VENTANA_AGENTE_CHANNELS.ACTIVO, agente),
  paneRemoto: (req) => ipcRenderer.invoke(VENTANA_AGENTE_CHANNELS.PANE_REMOTO, req),
  alRecibirEncargo: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, encargo: EncargoPaneRemoto): void => cb(encargo)
    ipcRenderer.on(VENTANA_AGENTE_CHANNELS.ENCARGO, oyente)
    return () => ipcRenderer.removeListener(VENTANA_AGENTE_CHANNELS.ENCARGO, oyente)
  },
  responder: (r) => ipcRenderer.send(VENTANA_AGENTE_CHANNELS.RESPUESTA, r)
}
