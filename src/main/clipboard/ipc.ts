// =============================================================================
// Canales IPC del portapapeles (`CLIPBOARD_CHANNELS`): el único sitio del área con `ipcMain`.
// Se sirve desde el main porque `clipboard` no existe en un renderer con `sandbox`. Lee y
// escribe texto, vuelca la imagen a un PNG temporal, sondea qué hay y pega en el proyecto
// activo por `FileService.paste`; cada handler delega en `clipboardFiles.ts` o en el adaptador
// y no decide nada. El orden de registro es el de siempre. Lo registra `src/main/index.ts`.
// =============================================================================

import type { IpcMain } from 'electron'
import {
  CLIPBOARD_CHANNELS,
  type ClipboardPasteRequest,
  type ClipboardProbe,
  type ClipboardWriteMessage
} from '../../shared/clipboard-ipc'
import type { PasteResult } from '../../shared/files-ipc'
import type { FileService } from '../files/FileService'
import type { PortapapelesSistema } from './adaptadores/portapapelesElectron'
import { pasteFromClipboard, probeClipboard, saveClipboardImageToTemp } from './clipboardFiles'

type Ipc = Pick<IpcMain, 'handle'>

export function registrarIpcPortapapeles({
  ipc,
  portapapeles,
  archivos
}: {
  ipc: Ipc
  portapapeles: PortapapelesSistema
  /** El servicio de archivos del momento; null hasta que `componerArchivos` lo crea. */
  archivos: () => FileService | null
}): void {
  ipc.handle(CLIPBOARD_CHANNELS.READ, () => portapapeles.leerTexto())
  ipc.handle(CLIPBOARD_CHANNELS.WRITE, (_e, msg: ClipboardWriteMessage) => {
    // Lanza en vez de ignorar: el renderer daría la copia por buena con el portapapeles intacto.
    if (typeof msg?.text !== 'string') {
      throw new Error('clipboard:write esperaba { text: string }')
    }
    portapapeles.escribirTexto(msg.text)
  })
  // Imagen del portapapeles a un PNG temporal; null si no hay (el renderer pega texto).
  ipc.handle(CLIPBOARD_CHANNELS.SAVE_IMAGE, () =>
    saveClipboardImageToTemp(portapapeles, 'terminal_clip')
  )
  ipc.handle(CLIPBOARD_CHANNELS.PROBE, (): ClipboardProbe => {
    try {
      return probeClipboard(portapapeles)
    } catch (err) {
      // Un portapapeles que otra app tiene bloqueado no debe impedir abrir el menú.
      console.error('[tessera] sondeo del portapapeles fallido:', err)
      return { kind: 'none', count: 0, effect: 'copy', texto: '' }
    }
  })
  // El renderer solo dice DÓNDE; el origen y «copiar o cortar» los resuelve el main.
  ipc.handle(
    CLIPBOARD_CHANNELS.PASTE_INTO,
    async (_e, req: ClipboardPasteRequest): Promise<PasteResult> => {
      const files = archivos()
      if (files === null) throw new Error('No hay proyecto activo.')
      return pasteFromClipboard(portapapeles, req.destDir, (opts) => files.paste(opts))
    }
  )
}
