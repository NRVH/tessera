// =============================================================================
// Preload: el explorador SFTP de una conexión SSH. Una función por canal con la petición del contrato
// tal cual, y las suscripciones al progreso y a la caída de una sesión. De los archivos SOLTADOS, las
// rutas las saca aquí `webUtils` y van directas al main: el renderer no las ve.
// Canales y formas: src/shared/sftp-ipc.ts.
// =============================================================================
import { ipcRenderer, webUtils } from 'electron'
import {
  SFTP_CHANNELS,
  type SftpAbrir,
  type SftpBorrar,
  type SftpCaida,
  type SftpCancelar,
  type SftpCerrar,
  type SftpConfirmarPlan,
  type SftpCrearCarpeta,
  type SftpDescargar,
  type SftpInicio,
  type SftpInicioTransferencia,
  type SftpListado,
  type SftpListar,
  type SftpOperacion,
  type SftpProgreso,
  type SftpRenombrar,
  type SftpResultado,
  type SftpSubir,
  type SftpSubirSoltados
} from '../shared/sftp-ipc'

/** El explorador SFTP. Las rutas que viajan son remotas; las del equipo se quedan en el main. */
export interface SftpApi {
  /** Abre (o reabre tras una caída) la sesión de una pestaña: devuelve la carpeta de inicio. */
  abrir: (req: SftpAbrir) => Promise<SftpResultado<SftpInicio>>
  listar: (req: SftpListar) => Promise<SftpResultado<SftpListado>>
  crearCarpeta: (req: SftpCrearCarpeta) => Promise<SftpResultado<null>>
  /** No pisa: si el destino existe, falla. */
  renombrar: (req: SftpRenombrar) => Promise<SftpResultado<null>>
  /** Borra archivos y carpetas enteras; la confirmación es de quien llama. */
  borrar: (req: SftpBorrar) => Promise<SftpResultado<SftpOperacion>>
  /** Diálogo nativo para la carpeta del equipo; `null` si se cancela; un plan si pisaría algo. */
  descargar: (req: SftpDescargar) => Promise<SftpResultado<SftpInicioTransferencia | null>>
  /** Diálogo nativo para elegir qué subir; `null` si se cancela; un plan si pisaría algo. */
  subir: (req: SftpSubir) => Promise<SftpResultado<SftpInicioTransferencia | null>>
  /** Sube lo soltado: las rutas las saca AQUÍ `webUtils.getPathForFile`. */
  subirSoltados: (req: Omit<SftpSubirSoltados, 'rutasLocales'>, archivos: File[]) => Promise<SftpResultado<SftpInicioTransferencia>>
  confirmarPlan: (req: SftpConfirmarPlan) => Promise<SftpResultado<SftpOperacion | null>>
  cancelar: (req: SftpCancelar) => Promise<void>
  /** Enseña en el gestor de archivos lo que bajó una descarga terminada. */
  mostrarDescarga: (req: SftpCancelar) => Promise<void>
  cerrar: (req: SftpCerrar) => Promise<void>
  /** Avance y fin de las operaciones. Devuelve la baja. */
  onProgreso: (cb: (p: SftpProgreso) => void) => () => void
  /** Una sesión se cayó. Devuelve la baja. */
  onCaida: (cb: (c: SftpCaida) => void) => () => void
}

export const sftp: SftpApi = {
  abrir: (req) => ipcRenderer.invoke(SFTP_CHANNELS.ABRIR, req),
  listar: (req) => ipcRenderer.invoke(SFTP_CHANNELS.LISTAR, req),
  crearCarpeta: (req) => ipcRenderer.invoke(SFTP_CHANNELS.CREAR_CARPETA, req),
  renombrar: (req) => ipcRenderer.invoke(SFTP_CHANNELS.RENOMBRAR, req),
  borrar: (req) => ipcRenderer.invoke(SFTP_CHANNELS.BORRAR, req),
  descargar: (req) => ipcRenderer.invoke(SFTP_CHANNELS.DESCARGAR, req),
  subir: (req) => ipcRenderer.invoke(SFTP_CHANNELS.SUBIR, req),
  subirSoltados: (req, archivos) => {
    // '' = no es un archivo del disco (un File construido en la página): el main lo descarta.
    const peticion: SftpSubirSoltados = { ...req, rutasLocales: archivos.map((a) => webUtils.getPathForFile(a)) }
    return ipcRenderer.invoke(SFTP_CHANNELS.SUBIR_SOLTADOS, peticion)
  },
  confirmarPlan: (req) => ipcRenderer.invoke(SFTP_CHANNELS.CONFIRMAR_PLAN, req),
  cancelar: (req) => ipcRenderer.invoke(SFTP_CHANNELS.CANCELAR, req),
  mostrarDescarga: (req) => ipcRenderer.invoke(SFTP_CHANNELS.MOSTRAR_DESCARGA, req),
  cerrar: (req) => ipcRenderer.invoke(SFTP_CHANNELS.CERRAR, req),
  onProgreso: (cb) => {
    const listener = (_e: unknown, p: SftpProgreso): void => cb(p)
    ipcRenderer.on(SFTP_CHANNELS.EV_PROGRESO, listener)
    return () => ipcRenderer.removeListener(SFTP_CHANNELS.EV_PROGRESO, listener)
  },
  onCaida: (cb) => {
    const listener = (_e: unknown, c: SftpCaida): void => cb(c)
    ipcRenderer.on(SFTP_CHANNELS.EV_CAIDA, listener)
    return () => ipcRenderer.removeListener(SFTP_CHANNELS.EV_CAIDA, listener)
  }
}
