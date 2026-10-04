// =============================================================================
// Canales IPC del explorador de archivos (`FILE_CHANNELS`): el único sitio del área con
// `ipcMain`. Cada handler pasa la petición a UN método de `FileService` y no decide nada. Los
// canales que mueven o borran reconstruyen el payload campo a campo: así un `hostPaths` colado
// nunca llega al servicio y un `srcs` que no sea una lista de cadenas se queda vacío. El orden
// de registro es el de siempre. Lo registra `src/main/index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  FILE_CHANNELS,
  type CreateEntryRequest,
  type DeleteRequest,
  type ImportRequest,
  type ListDirRequest,
  type MoveRequest,
  type PasteRequest,
  type ReadFileRequest,
  type RenameRequest,
  type RutasRequest,
  type SaveUntitledRequest,
  type StartDragRequest,
  type WriteFileRequest
} from '../../shared/files-ipc'
import type { FileService } from './FileService'

type Ipc = Pick<IpcMain, 'handle'>

export function registrarIpcArchivos({ ipc, files }: { ipc: Ipc; files: FileService }): void {
  ipc.handle(FILE_CHANNELS.GET_ROOT, () => files.getRoot())
  ipc.handle(FILE_CHANNELS.LIST_DIR, (_e: IpcMainInvokeEvent, req: ListDirRequest) =>
    files.listDir(req.path)
  )
  ipc.handle(FILE_CHANNELS.READ_FILE, (_e: IpcMainInvokeEvent, req: ReadFileRequest) =>
    files.readFile(req.path, req.encoding)
  )
  ipc.handle(FILE_CHANNELS.EXISTS, (_e: IpcMainInvokeEvent, req: ReadFileRequest) =>
    files.existeRuta(req.path)
  )
  ipc.handle(FILE_CHANNELS.WRITE_FILE, (_e: IpcMainInvokeEvent, req: WriteFileRequest) =>
    files.writeFile(req.path, req.content, req.encoding)
  )
  ipc.handle(FILE_CHANNELS.SAVE_UNTITLED, (_e: IpcMainInvokeEvent, req: SaveUntitledRequest) =>
    files.saveUntitled(req)
  )
  ipc.handle(FILE_CHANNELS.FORGET_UNTITLED, (_e: IpcMainInvokeEvent, id: string) => {
    files.olvidarSinTitulo(id)
  })
  ipc.handle(FILE_CHANNELS.READ_BINARY, (_e: IpcMainInvokeEvent, req: ReadFileRequest) =>
    files.readBinary(req.path)
  )
  ipc.handle(FILE_CHANNELS.READ_DOCX, (_e: IpcMainInvokeEvent, req: ReadFileRequest) =>
    files.readDocx(req.path)
  )
  ipc.handle(FILE_CHANNELS.READ_ZIP, (_e: IpcMainInvokeEvent, req: ReadFileRequest) =>
    files.readZip(req.path)
  )
  ipc.handle(FILE_CHANNELS.REVEAL_IN_FOLDER, (_e: IpcMainInvokeEvent, req: ReadFileRequest) =>
    files.reveal(req.path)
  )
  ipc.handle(FILE_CHANNELS.OPEN_PATH, (_e: IpcMainInvokeEvent, req: ReadFileRequest) =>
    files.openPath(req.path)
  )
  ipc.handle(FILE_CHANNELS.CREATE_FILE, (_e: IpcMainInvokeEvent, req: CreateEntryRequest) =>
    files.createEntry(req.dir, req.name, 'file')
  )
  ipc.handle(FILE_CHANNELS.CREATE_DIR, (_e: IpcMainInvokeEvent, req: CreateEntryRequest) =>
    files.createEntry(req.dir, req.name, 'dir')
  )
  ipc.handle(FILE_CHANNELS.RENAME, (_e: IpcMainInvokeEvent, req: RenameRequest) =>
    files.rename(req.path, req.newName)
  )
  // Los tipos de TS no existen en runtime, y estos son los canales capaces de borrar.
  ipc.handle(FILE_CHANNELS.MOVE, (_e: IpcMainInvokeEvent, req: MoveRequest) =>
    files.moveMany(comoRutas(req?.srcs), typeof req?.destDir === 'string' ? req.destDir : '')
  )
  ipc.handle(FILE_CHANNELS.IMPORT, (_e: IpcMainInvokeEvent, req: ImportRequest) =>
    files.importFromHost(
      comoRutas(req?.hostPaths),
      typeof req?.destDir === 'string' ? req.destDir : '',
      req?.overwrite === true
    )
  )
  ipc.handle(FILE_CHANNELS.PASTE, (_e: IpcMainInvokeEvent, req: PasteRequest) =>
    files.paste({
      destDir: typeof req?.destDir === 'string' ? req.destDir : '',
      srcs: comoRutas(req?.srcs),
      op: req?.op === 'cortar' ? 'cortar' : 'copiar'
    })
  )
  ipc.handle(FILE_CHANNELS.ABS_PATH, (_e: IpcMainInvokeEvent, req: RutasRequest) =>
    Promise.all(comoRutas(req?.paths).map((p) => files.absPath(p)))
  )
  ipc.handle(FILE_CHANNELS.FILE_URL, (_e: IpcMainInvokeEvent, req: ReadFileRequest) =>
    files.fileUrl(req.path)
  )
  ipc.handle(FILE_CHANNELS.DELETE, (_e: IpcMainInvokeEvent, req: DeleteRequest) =>
    files.deleteMany(comoRutas(req?.paths))
  )
  // El arrastre arranca en el `webContents` que vive el gesto del ratón, no en la ventana guardada.
  ipc.handle(FILE_CHANNELS.START_DRAG, (e: IpcMainInvokeEvent, req: StartDragRequest) =>
    files.startDrag(e.sender, comoRutas(req?.paths), typeof req?.icono === 'string' ? req.icono : '')
  )
  // Deja escrito con qué raíz arranca el explorador.
  const { name } = files.getRoot()
  console.log(
    `[files] ${name ? `registrado; raíz del proyecto lista (nombre="${name}")` : 'registrado; sin proyecto activo (a la espera de setActiveProject)'}`
  )
}

/**
 * Normaliza a lista de rutas lo que llegue por IPC: un payload que no sea un array, o que
 * traiga elementos que no son cadenas, se convierte en una lista vacía en vez de recorrerse.
 */
function comoRutas(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
