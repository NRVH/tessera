// =============================================================================
// Canales IPC del explorador de archivos (`FILE_CHANNELS`): el único sitio del área con
// `ipcMain`. Cada handler con rutas pasa la petición a UN método de la vista de SU proyecto
// (`ServicioArchivos.paraRaiz`), sin decidir nada más. Los canales que mueven o borran reconstruyen el
// payload campo a campo: así un `rutasHost` colado nunca llega al servicio y un `srcs` que no sea
// una lista de cadenas se queda vacío. Lo registra `src/main/index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  FILE_CHANNELS,
  type PeticionCrearEntrada,
  type PeticionBorrar,
  type EnProyecto,
  type PeticionImportar,
  type PeticionListarDirectorio,
  type PeticionMover,
  type PeticionPegar,
  type PeticionLeerArchivo,
  type PeticionRenombrar,
  type PeticionRutas,
  type PeticionGuardarSinTitulo,
  type PeticionIniciarArrastre,
  type PeticionEscribirArchivo
} from '../../shared/archivos-ipc'
import type { ServicioArchivos } from './ServicioArchivos'

type Ipc = Pick<IpcMain, 'handle'>

export function registrarIpcArchivos({ ipc, archivos }: { ipc: Ipc; archivos: ServicioArchivos }): void {
  /** Registra un canal cuyas rutas son de un proyecto: se atiende en la vista del suyo, nunca del anclado. */
  const enProyecto = <R extends EnProyecto, T>(
    canal: string,
    fn: (svc: ServicioArchivos, req: R, e: IpcMainInvokeEvent) => T
  ): void => {
    ipc.handle(canal, (e: IpcMainInvokeEvent, req: R) => fn(archivos.paraRaiz(req?.raiz), req, e))
  }

  ipc.handle(FILE_CHANNELS.GET_ROOT, () => archivos.obtenerRaiz())
  enProyecto(FILE_CHANNELS.LIST_DIR, (svc, req: PeticionListarDirectorio) => svc.listarDirectorio(req.ruta))
  enProyecto(FILE_CHANNELS.READ_FILE, (svc, req: PeticionLeerArchivo) => svc.leerArchivo(req.ruta, req.encoding))
  enProyecto(FILE_CHANNELS.EXISTS, (svc, req: PeticionLeerArchivo) => svc.existeRuta(req.ruta))
  enProyecto(FILE_CHANNELS.WRITE_FILE, (svc, req: PeticionEscribirArchivo) => svc.escribirArchivo(req.ruta, req.contenido, req.encoding))
  // Sin título no es de ningún proyecto: su ruta la eligió el usuario en el diálogo nativo.
  ipc.handle(FILE_CHANNELS.SAVE_UNTITLED, (_e: IpcMainInvokeEvent, req: PeticionGuardarSinTitulo) =>
    archivos.guardarSinTitulo(req)
  )
  ipc.handle(FILE_CHANNELS.FORGET_UNTITLED, (_e: IpcMainInvokeEvent, id: string) => {
    archivos.olvidarSinTitulo(id)
  })
  enProyecto(FILE_CHANNELS.READ_BINARY, (svc, req: PeticionLeerArchivo) => svc.leerBinario(req.ruta))
  enProyecto(FILE_CHANNELS.READ_ZIP, (svc, req: PeticionLeerArchivo) => svc.leerZip(req.ruta))
  enProyecto(FILE_CHANNELS.REVEAL_IN_FOLDER, (svc, req: PeticionLeerArchivo) => svc.revelar(req.ruta))
  enProyecto(FILE_CHANNELS.OPEN_PATH, (svc, req: PeticionLeerArchivo) => svc.abrirRuta(req.ruta))
  enProyecto(FILE_CHANNELS.CREATE_FILE, (svc, req: PeticionCrearEntrada) => svc.crearEntrada(req.dir, req.nombre, 'file'))
  enProyecto(FILE_CHANNELS.CREATE_DIR, (svc, req: PeticionCrearEntrada) => svc.crearEntrada(req.dir, req.nombre, 'dir'))
  enProyecto(FILE_CHANNELS.RENAME, (svc, req: PeticionRenombrar) => svc.renombrar(req.ruta, req.nombreNuevo))
  // Los tipos de TS no existen en runtime, y estos son los canales capaces de borrar.
  enProyecto(FILE_CHANNELS.MOVE, (svc, req: PeticionMover) =>
    svc.moverVarios(comoRutas(req?.srcs), typeof req?.destDir === 'string' ? req.destDir : '')
  )
  enProyecto(FILE_CHANNELS.IMPORT, (svc, req: PeticionImportar) =>
    svc.importarDesdeHost(comoRutas(req?.rutasHost), typeof req?.destDir === 'string' ? req.destDir : '', req?.sobrescribir === true)
  )
  enProyecto(FILE_CHANNELS.PASTE, (svc, req: PeticionPegar) =>
    svc.pegar({
      destDir: typeof req?.destDir === 'string' ? req.destDir : '',
      srcs: comoRutas(req?.srcs),
      op: req?.op === 'cortar' ? 'cortar' : 'copiar'
    })
  )
  enProyecto(FILE_CHANNELS.ABS_PATH, (svc, req: PeticionRutas) => Promise.all(comoRutas(req?.rutas).map((p) => svc.rutaAbs(p))))
  enProyecto(FILE_CHANNELS.FILE_URL, (svc, req: PeticionLeerArchivo) => svc.urlArchivo(req.ruta))
  enProyecto(FILE_CHANNELS.DELETE, (svc, req: PeticionBorrar) => svc.borrarVarios(comoRutas(req?.rutas)))
  // El arrastre arranca en el `webContents` que vive el gesto del ratón, no en la ventana guardada.
  enProyecto(FILE_CHANNELS.START_DRAG, (svc, req: PeticionIniciarArrastre, e) =>
    svc.iniciarArrastre(e.sender, comoRutas(req?.rutas), typeof req?.icono === 'string' ? req.icono : '')
  )
  // Deja escrito con qué raíz arranca el explorador.
  const { nombre } = archivos.obtenerRaiz()
  console.log(
    `[files] ${nombre ? `registrado; raíz del proyecto lista (nombre="${nombre}")` : 'registrado; sin proyecto activo (a la espera de setActiveProject)'}`
  )
}

/**
 * Normaliza a lista de rutas lo que llegue por IPC: un payload que no sea un array, o que
 * traiga elementos que no son cadenas, se convierte en una lista vacía en vez de recorrerse.
 */
function comoRutas(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
