// =============================================================================
// Canales IPC del portapapeles (`CLIPBOARD_CHANNELS`): el único sitio del área con `ipcMain`.
// Se sirve desde el main porque `clipboard` no existe en un renderer con `sandbox`. Lee y
// escribe texto, vuelca la imagen a un PNG temporal, sondea qué hay y pega en el proyecto
// activo por `ServicioArchivos.pegar`; cada handler delega en `archivosPortapapeles.ts` o en el adaptador
// y no decide nada. El orden de registro es el de siempre. Lo registra `src/main/index.ts`.
// =============================================================================

import type { IpcMain } from 'electron'
import {
  CLIPBOARD_CHANNELS,
  type PeticionPegarPortapapeles,
  type SondaPortapapeles,
  type MensajeEscribirPortapapeles
} from '../../shared/portapapeles-ipc'
import type { ResultadoPegar } from '../../shared/archivos-ipc'
import type { ServicioArchivos } from '../archivos/ServicioArchivos'
import type { PortapapelesSistema } from './adaptadores/portapapelesElectron'
import { pegarDesdePortapapeles, sondearPortapapeles, guardarImagenPortapapelesEnTemporal } from './archivosPortapapeles'
import { txArchivos } from '../archivos/textos.ts'

type Ipc = Pick<IpcMain, 'handle'>

export function registrarIpcPortapapeles({
  ipc,
  portapapeles,
  archivos
}: {
  ipc: Ipc
  portapapeles: PortapapelesSistema
  /** El servicio de archivos del momento; null hasta que `componerArchivos` lo crea. */
  archivos: () => ServicioArchivos | null
}): void {
  ipc.handle(CLIPBOARD_CHANNELS.READ, () => portapapeles.leerTexto())
  ipc.handle(CLIPBOARD_CHANNELS.WRITE, (_e, msg: MensajeEscribirPortapapeles) => {
    // Lanza en vez de ignorar: el renderer daría la copia por buena con el portapapeles intacto.
    if (typeof msg?.text !== 'string') {
      throw new Error('clipboard:write esperaba { text: string }')
    }
    portapapeles.escribirTexto(msg.text)
  })
  // Imagen del portapapeles a un PNG temporal; null si no hay (el renderer pega texto).
  ipc.handle(CLIPBOARD_CHANNELS.SAVE_IMAGE, () =>
    guardarImagenPortapapelesEnTemporal(portapapeles, 'terminal_clip')
  )
  ipc.handle(CLIPBOARD_CHANNELS.PROBE, (): SondaPortapapeles => {
    try {
      return sondearPortapapeles(portapapeles)
    } catch (err) {
      // Un portapapeles que otra app tiene bloqueado no debe impedir abrir el menú.
      console.error('[tessera] sondeo del portapapeles fallido:', err)
      return { tipo: 'none', cuantos: 0, efecto: 'copy', texto: '' }
    }
  })
  // El renderer solo dice DÓNDE; el origen y «copiar o cortar» los resuelve el main.
  ipc.handle(
    CLIPBOARD_CHANNELS.PASTE_INTO,
    async (_e, req: PeticionPegarPortapapeles): Promise<ResultadoPegar> => {
      const servicioArchivos = archivos()
      if (servicioArchivos === null) throw new Error(txArchivos().sinProyecto)
      const proyecto = servicioArchivos.paraRaiz(req?.raiz)
      return pegarDesdePortapapeles(portapapeles, req.destDir, (opts) => proyecto.pegar(opts))
    }
  )
}
