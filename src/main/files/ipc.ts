// =============================================================================
// Canales IPC del explorador de archivos (`FILE_CHANNELS`): el único sitio del área con
// `ipcMain`. Cada handler con rutas pasa la petición a UN método de la vista de SU proyecto
// (`FileService.paraRaiz`), sin decidir nada más. Los canales que mueven o borran reconstruyen el
// payload campo a campo: así un `hostPaths` colado nunca llega al servicio y un `srcs` que no sea
// una lista de cadenas se queda vacío. Lo registra `src/main/index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  FILE_CHANNELS,
  type CreateEntryRequest,
  type DeleteRequest,
  type EnProyecto,
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
  /** Registra un canal cuyas rutas son de un proyecto: se atiende en la vista del suyo, nunca del anclado. */
  const enProyecto = <R extends EnProyecto, T>(
    canal: string,
    fn: (svc: FileService, req: R, e: IpcMainInvokeEvent) => T
  ): void => {
    ipc.handle(canal, (e: IpcMainInvokeEvent, req: R) => fn(files.paraRaiz(req?.raiz), req, e))
  }

  ipc.handle(FILE_CHANNELS.GET_ROOT, () => files.getRoot())
  enProyecto(FILE_CHANNELS.LIST_DIR, (svc, req: ListDirRequest) => svc.listDir(req.path))
  enProyecto(FILE_CHANNELS.READ_FILE, (svc, req: ReadFileRequest) => svc.readFile(req.path, req.encoding))
  enProyecto(FILE_CHANNELS.EXISTS, (svc, req: ReadFileRequest) => svc.existeRuta(req.path))
  enProyecto(FILE_CHANNELS.WRITE_FILE, (svc, req: WriteFileRequest) => svc.writeFile(req.path, req.content, req.encoding))
  // Sin título no es de ningún proyecto: su ruta la eligió el usuario en el diálogo nativo.
  ipc.handle(FILE_CHANNELS.SAVE_UNTITLED, (_e: IpcMainInvokeEvent, req: SaveUntitledRequest) =>
    files.saveUntitled(req)
  )
  ipc.handle(FILE_CHANNELS.FORGET_UNTITLED, (_e: IpcMainInvokeEvent, id: string) => {
    files.olvidarSinTitulo(id)
  })
  enProyecto(FILE_CHANNELS.READ_BINARY, (svc, req: ReadFileRequest) => svc.readBinary(req.path))
  enProyecto(FILE_CHANNELS.READ_DOCX, (svc, req: ReadFileRequest) => svc.readDocx(req.path))
  enProyecto(FILE_CHANNELS.READ_ZIP, (svc, req: ReadFileRequest) => svc.readZip(req.path))
  enProyecto(FILE_CHANNELS.REVEAL_IN_FOLDER, (svc, req: ReadFileRequest) => svc.reveal(req.path))
  enProyecto(FILE_CHANNELS.OPEN_PATH, (svc, req: ReadFileRequest) => svc.openPath(req.path))
  enProyecto(FILE_CHANNELS.CREATE_FILE, (svc, req: CreateEntryRequest) => svc.createEntry(req.dir, req.name, 'file'))
  enProyecto(FILE_CHANNELS.CREATE_DIR, (svc, req: CreateEntryRequest) => svc.createEntry(req.dir, req.name, 'dir'))
  enProyecto(FILE_CHANNELS.RENAME, (svc, req: RenameRequest) => svc.rename(req.path, req.newName))
  // Los tipos de TS no existen en runtime, y estos son los canales capaces de borrar.
  enProyecto(FILE_CHANNELS.MOVE, (svc, req: MoveRequest) =>
    svc.moveMany(comoRutas(req?.srcs), typeof req?.destDir === 'string' ? req.destDir : '')
  )
  enProyecto(FILE_CHANNELS.IMPORT, (svc, req: ImportRequest) =>
    svc.importFromHost(comoRutas(req?.hostPaths), typeof req?.destDir === 'string' ? req.destDir : '', req?.overwrite === true)
  )
  enProyecto(FILE_CHANNELS.PASTE, (svc, req: PasteRequest) =>
    svc.paste({
      destDir: typeof req?.destDir === 'string' ? req.destDir : '',
      srcs: comoRutas(req?.srcs),
      op: req?.op === 'cortar' ? 'cortar' : 'copiar'
    })
  )
  enProyecto(FILE_CHANNELS.ABS_PATH, (svc, req: RutasRequest) => Promise.all(comoRutas(req?.paths).map((p) => svc.absPath(p))))
  enProyecto(FILE_CHANNELS.FILE_URL, (svc, req: ReadFileRequest) => svc.fileUrl(req.path))
  enProyecto(FILE_CHANNELS.DELETE, (svc, req: DeleteRequest) => svc.deleteMany(comoRutas(req?.paths)))
  // El arrastre arranca en el `webContents` que vive el gesto del ratón, no en la ventana guardada.
  enProyecto(FILE_CHANNELS.START_DRAG, (svc, req: StartDragRequest, e) =>
    svc.startDrag(e.sender, comoRutas(req?.paths), typeof req?.icono === 'string' ? req.icono : '')
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
