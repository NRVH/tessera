// =============================================================================
// Preload: la copia de la configuración para llevarla a otro equipo (exportar e importar en
// tres pasos), y el aviso de la copia que llega del sistema. Ningún secreto cruza: se quedan en el main.
// Canales y formas: src/shared/copia-configuracion-ipc.ts.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  COPIA_CONFIGURACION_CHANNELS as C,
  type ResultadoAbrir,
  type ArchivoPedido,
  type PeticionConexiones,
  type PeticionDescifrar,
  type ResultadoDescifrar,
  type PeticionDiffArchivo,
  type ResultadoDiffArchivo,
  type PeticionExportar,
  type ResultadoExportar,
  type FuenteHistorial,
  type PeticionOlvidarCopia,
  type PeticionPreviaHistorial,
  type ResultadoConexiones
} from '../shared/copia-configuracion-ipc'
import type { SeleccionConexiones } from '../shared/seleccionCopia'

export interface ApiCopiaConfiguracion {
  /** Pide dónde guardar y guarda la copia cifrada con la frase. */
  exportar: (req: PeticionExportar) => Promise<ResultadoExportar>
  /** Elige el archivo y lee su cabecera, sin descifrar. */
  abrir: () => Promise<ResultadoAbrir>
  /** Descifra con la frase: perfiles, agentes, ajustes y la lista de conexiones (sus secretos se quedan en el main). */
  descifrar: (token: string, frase: string) => Promise<ResultadoDescifrar>
  /** Da de alta las conexiones y el historial elegidos del archivo abierto; después ya no está abierto. */
  conexiones: (token: string, seleccion: SeleccionConexiones) => Promise<ResultadoConexiones>
  /** Cuántas conversaciones y cuánto ocupan por cuenta, para el diálogo de exportar. */
  previaHistorial: (req: PeticionPreviaHistorial) => Promise<FuenteHistorial[]>
  /** Las dos versiones de un archivo de agente distinto, solo si el usuario pide ver el diff. */
  diffArchivo: (token: string, archivo: ArchivoPedido) => Promise<ResultadoDiffArchivo>
  /** Suelta el archivo abierto sin importar. */
  olvidar: (token: string) => Promise<void>
  /** Abre la copia que llegó del sistema (doble clic en un `.tessera`), o `null` si no hay ninguna. */
  tomarPendiente: () => Promise<ResultadoAbrir | null>
  /** Avisa de que llegó una copia del sistema; devuelve cómo dejar de escuchar. */
  alHaberPendiente: (cb: () => void) => () => void
}

export const copiaConfiguracion: ApiCopiaConfiguracion = {
  exportar: (req) => ipcRenderer.invoke(C.EXPORTAR, req),
  abrir: () => ipcRenderer.invoke(C.ABRIR),
  descifrar: (token, frase) => ipcRenderer.invoke(C.DESCIFRAR, { token, frase } satisfies PeticionDescifrar),
  conexiones: (token, seleccion) =>
    ipcRenderer.invoke(C.CONEXIONES, { token, seleccion } satisfies PeticionConexiones),
  previaHistorial: (req) => ipcRenderer.invoke(C.PREVIA_HISTORIAL, req),
  diffArchivo: (token, archivo) => ipcRenderer.invoke(C.DIFF_ARCHIVO, { token, archivo } satisfies PeticionDiffArchivo),
  olvidar: (token) => ipcRenderer.invoke(C.OLVIDAR, { token } satisfies PeticionOlvidarCopia),
  tomarPendiente: () => ipcRenderer.invoke(C.TOMAR_PENDIENTE),
  alHaberPendiente: (cb) => {
    const oyente = (): void => cb()
    ipcRenderer.on(C.HAY_PENDIENTE, oyente)
    return () => ipcRenderer.removeListener(C.HAY_PENDIENTE, oyente)
  }
}
