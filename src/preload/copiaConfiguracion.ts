// =============================================================================
// Preload: la copia de la configuración para llevarla a otro equipo (exportar e importar en
// tres pasos), y el aviso de la copia que llega del sistema. Ningún secreto cruza: se quedan en el main.
// Canales y formas: src/shared/copia-configuracion-ipc.ts.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  COPIA_CONFIGURACION_CHANNELS as C,
  type AbrirResult,
  type DescifrarResult,
  type ExportarRequest,
  type ExportarResult,
  type ResultadoConexiones
} from '../shared/copia-configuracion-ipc'
import type { SeleccionConexiones } from '../shared/seleccionCopia'

export interface CopiaConfiguracionApi {
  /** Pide dónde guardar y guarda la copia cifrada con la frase. */
  exportar: (req: ExportarRequest) => Promise<ExportarResult>
  /** Elige el archivo y lee su cabecera, sin descifrar. */
  abrir: () => Promise<AbrirResult>
  /** Descifra con la frase: perfiles, agentes, ajustes y la lista de conexiones (sus secretos se quedan en el main). */
  descifrar: (token: string, frase: string) => Promise<DescifrarResult>
  /** Da de alta las conexiones elegidas del archivo abierto; después ya no está abierto. */
  conexiones: (token: string, seleccion: SeleccionConexiones) => Promise<ResultadoConexiones>
  /** Suelta el archivo abierto sin importar. */
  olvidar: (token: string) => Promise<void>
  /** Abre la copia que llegó del sistema (doble clic en un `.tessera`), o `null` si no hay ninguna. */
  tomarPendiente: () => Promise<AbrirResult | null>
  /** Avisa de que llegó una copia del sistema; devuelve cómo dejar de escuchar. */
  onPendiente: (cb: () => void) => () => void
}

export const copiaConfiguracion: CopiaConfiguracionApi = {
  exportar: (req) => ipcRenderer.invoke(C.EXPORTAR, req),
  abrir: () => ipcRenderer.invoke(C.ABRIR),
  descifrar: (token, frase) => ipcRenderer.invoke(C.DESCIFRAR, { token, frase }),
  conexiones: (token, seleccion) => ipcRenderer.invoke(C.CONEXIONES, { token, seleccion }),
  olvidar: (token) => ipcRenderer.invoke(C.OLVIDAR, { token }),
  tomarPendiente: () => ipcRenderer.invoke(C.TOMAR_PENDIENTE),
  onPendiente: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(C.HAY_PENDIENTE, listener)
    return () => ipcRenderer.removeListener(C.HAY_PENDIENTE, listener)
  }
}
