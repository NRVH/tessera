// =============================================================================
// Puente entre el cierre nativo de una hija y el renderer que aloja sus panes.
// La confirmación solo se emite desde la principal después de devolver los anfitriones.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { ipcRenderer } from 'electron'
import { CANALES_FRANJA } from '../shared/franja-ipc'

export const franja = {
  alPedirAcople: (recibir: (perfil: string) => void): (() => void) => {
    const oyente = (_e: Electron.IpcRendererEvent, perfil: string): void => recibir(perfil)
    ipcRenderer.on(CANALES_FRANJA.PEDIR_ACOPLE, oyente)
    return () => ipcRenderer.removeListener(CANALES_FRANJA.PEDIR_ACOPLE, oyente)
  },
  cerrarAcoplada: (perfil: string): Promise<void> => ipcRenderer.invoke(CANALES_FRANJA.CERRAR_ACOPLADA, perfil),
  traerAlFrente: (perfil: string): Promise<boolean> => ipcRenderer.invoke(CANALES_FRANJA.TRAER_AL_FRENTE, perfil)
}
