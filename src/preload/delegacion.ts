// =============================================================================
// API del indicador de tareas delegadas: consulta, cancelación, descarte y lista completa por evento.
// Solo expone los canales del contrato compartido y devuelve la limpieza de cada escucha.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { ipcRenderer } from 'electron'
import { DELEGACION_CHANNELS, type VistaTareaPanel } from '../shared/delegacion-ipc'

export interface DelegacionApi {
  listar: () => Promise<VistaTareaPanel[]>
  cancelar: (id: string) => Promise<void>
  descartar: (id: string) => Promise<void>
  alCambiar: (cb: (tareas: VistaTareaPanel[]) => void) => () => void
}

export const delegacion: DelegacionApi = {
  listar: () => ipcRenderer.invoke(DELEGACION_CHANNELS.LISTAR),
  cancelar: (id) => ipcRenderer.invoke(DELEGACION_CHANNELS.CANCELAR, id),
  descartar: (id) => ipcRenderer.invoke(DELEGACION_CHANNELS.DESCARTAR, id),
  alCambiar: (cb) => {
    const recibir = (_evento: Electron.IpcRendererEvent, tareas: VistaTareaPanel[]): void => cb(tareas)
    ipcRenderer.on(DELEGACION_CHANNELS.CAMBIO, recibir)
    return () => ipcRenderer.removeListener(DELEGACION_CHANNELS.CAMBIO, recibir)
  }
}
