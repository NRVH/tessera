// =============================================================================
// Canales IPC de git (`GIT_CHANNELS`): el único sitio del área con `ipcMain`. Cada handler pasa
// los campos de la petición a UN método de la vista de SU proyecto (`ServicioGit.paraRaiz`) y no
// decide nada. El orden de registro es el de siempre. Lo registra `index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  GIT_CHANNELS,
  type PeticionBlobEnCommit,
  type PeticionBytesBlob,
  type PeticionRamasQueContienen,
  type PeticionDetalleCommit,
  type PeticionCommit,
  type PeticionCommitsRamaActual,
  type PeticionDescarteCambios,
  type PeticionHistorialArchivo,
  type PeticionArchivosCommit,
  type PeticionIgnorar,
  type PeticionBlobIndice,
  type PeticionListaRamas,
  type PeticionListaCommits,
  type PeticionEstadoRepos,
  type PeticionPrimerPadre,
  type PeticionGit,
  type PeticionRutasGit,
  type PeticionPrepararArchivo,
  type PeticionQuitarArchivoDelIndice,
  type PeticionBlobWorktree
} from '../../shared/git-ipc'
import type { ServicioGit } from './ServicioGit'
import { conPeticionHooks, hooksDeOperacion, PendienteHooks, pendienteDePeticion, prepararHooksOperacion } from './adaptadores/hooksGit'
import { entornoGit } from './adaptadores/configSegura'

type Ipc = Pick<IpcMain, 'handle'>

/** Registra un canal en la vista del proyecto de cada petición, nunca en la del anclado. */
type EnProyecto = <R>(canal: string, fn: (svc: ServicioGit, req: PeticionGit<R>) => unknown) => void

const escriturasDeInterfaz = new Set<string>([
  GIT_CHANNELS.COMMIT, GIT_CHANNELS.STAGE_FILE, GIT_CHANNELS.UNSTAGE_FILE,
  GIT_CHANNELS.STAGE_FILES, GIT_CHANNELS.UNSTAGE_FILES, GIT_CHANNELS.DISCARD_CHANGES,
  GIT_CHANNELS.DISCARD_CHANGES_MANY
])

async function escribirDesdeInterfaz<R>(evento: IpcMainInvokeEvent, canal: string, git: ServicioGit, req: PeticionGit<R>, operar: () => unknown): Promise<unknown> {
  return conPeticionHooks(evento.sender?.id ?? 0, req.resolucionHooks, async () => {
    const { resolucionHooks: _resolucion, ...peticion } = req
    try {
      const verbo = canal === GIT_CHANNELS.COMMIT ? 'commit'
        : canal === GIT_CHANNELS.DISCARD_CHANGES || canal === GIT_CHANNELS.DISCARD_CHANGES_MANY ? 'checkout' : 'add'
      await prepararHooksOperacion([canal, JSON.stringify(peticion)], await git.reposDeEscritura(req), entornoGit, hooksDeOperacion([verbo]))
      const resultado = await operar()
      const pendiente = pendienteDePeticion()
      return pendiente ? { ok: false, pendienteHooks: pendiente } : resultado
    } catch (error) {
      if (error instanceof PendienteHooks) return { ok: false, pendienteHooks: error.pendiente }
      throw error
    }
  })
}

/** Historia, blobs y estado: los diez primeros canales, en su orden de registro. */
function registrarConsultas(enProyecto: EnProyecto): void {
  enProyecto(GIT_CHANNELS.LIST_COMMITS, (git, req: PeticionGit<PeticionListaCommits>) =>
    git.listarCommits(req.rama, req.limite, req.repo)
  )
  enProyecto(GIT_CHANNELS.LIST_BRANCHES, (git, req: PeticionGit<PeticionListaRamas>) => git.listarRamas(req.repo))
  enProyecto(GIT_CHANNELS.FILES_FOR_COMMIT, (git, req: PeticionGit<PeticionArchivosCommit>) =>
    git.obtenerArchivosCommit(req.hash, req.repo)
  )
  enProyecto(GIT_CHANNELS.FILE_HISTORY, (git, req: PeticionGit<PeticionHistorialArchivo>) => git.leerHistorialArchivo(req.ruta, req.repo))
  enProyecto(GIT_CHANNELS.BLOB_BYTES, (git, req: PeticionGit<PeticionBytesBlob>) => git.blobBytes(req))
  enProyecto(GIT_CHANNELS.BLOB_AT_COMMIT, (git, req: PeticionGit<PeticionBlobEnCommit>) =>
    git.leerBlobEnCommit(req.hash, req.ruta, req.repo)
  )
  enProyecto(GIT_CHANNELS.PARENT_OF, (git, req: PeticionGit<PeticionPrimerPadre>) => git.obtenerPrimerPadre(req.hash, req.repo))
  enProyecto(GIT_CHANNELS.WORKING_STATUS, (git) => git.leerEstadoWorktree())
  enProyecto(GIT_CHANNELS.MULTI_STATUS, (git, req: PeticionGit<PeticionEstadoRepos>) =>
    git.leerEstadoRepos(req.repos, req.prioritarios, req.gen)
  )
  enProyecto(GIT_CHANNELS.WORKING_BLOB, (git, req: PeticionGit<PeticionBlobWorktree>) => git.leerBlobWorktree(req.ruta))
}

/** Escrituras y lecturas de detalle: los trece canales que siguen, en su orden de registro. */
function registrarEscrituras(enProyecto: EnProyecto): void {
  enProyecto(GIT_CHANNELS.DISCARD_CHANGES, (git, req: PeticionGit<PeticionDescarteCambios>) => git.descartarCambios(req.ruta))
  enProyecto(GIT_CHANNELS.STAGE_FILE, (git, req: PeticionGit<PeticionPrepararArchivo>) => git.prepararArchivo(req.ruta))
  enProyecto(GIT_CHANNELS.UNSTAGE_FILE, (git, req: PeticionGit<PeticionQuitarArchivoDelIndice>) => git.quitarArchivoDelIndice(req.ruta))
  enProyecto(GIT_CHANNELS.STAGE_FILES, (git, req: PeticionGit<PeticionRutasGit>) => git.prepararArchivos(req.rutas))
  enProyecto(GIT_CHANNELS.UNSTAGE_FILES, (git, req: PeticionGit<PeticionRutasGit>) => git.quitarArchivosDelIndice(req.rutas))
  enProyecto(GIT_CHANNELS.DISCARD_CHANGES_MANY, (git, req: PeticionGit<PeticionRutasGit>) => git.descartarCambiosVarios(req.rutas))
  enProyecto(GIT_CHANNELS.IGNORAR_GITIGNORE, (git, req: PeticionGit<PeticionIgnorar>) => git.ignorarEnGitignore(req.rutas))
  enProyecto(GIT_CHANNELS.IGNORAR_EXCLUDE_LOCAL, (git, req: PeticionGit<PeticionIgnorar>) =>
    git.ignorarEnExclusionLocal(req.rutas)
  )
  enProyecto(GIT_CHANNELS.COMMIT, (git, req: PeticionGit<PeticionCommit>) => git.commit(req.mensaje, req.repo))
  enProyecto(GIT_CHANNELS.INDEX_BLOB, (git, req: PeticionGit<PeticionBlobIndice>) => git.leerBlobIndice(req.ruta))
  enProyecto(GIT_CHANNELS.COMMIT_DETAIL, (git, req: PeticionGit<PeticionDetalleCommit>) => git.leerDetalleCommit(req.hash, req.repo))
  enProyecto(GIT_CHANNELS.BRANCHES_CONTAINING, (git, req: PeticionGit<PeticionRamasQueContienen>) =>
    git.obtenerRamasQueContienen(req.hash, req.repo)
  )
  enProyecto(GIT_CHANNELS.COMMITS_RAMA_ACTUAL, (git, req: PeticionGit<PeticionCommitsRamaActual>) =>
    git.commitsRamaActual(req.repo, req.hashes)
  )
}

/** Registra los 23 handlers de git en `ipc` y anuncia en el log si hay proyecto activo. */
export function registrarIpcGit(deps: { ipc: Ipc; git: ServicioGit }): void {
  const enProyecto: EnProyecto = <R>(canal: string, fn: (svc: ServicioGit, req: PeticionGit<R>) => unknown) => {
    deps.ipc.handle(canal, (evento: IpcMainInvokeEvent, req: PeticionGit<R>) => {
      const git = deps.git.paraRaiz(req?.raiz)
      const operar = (): unknown => fn(git, req)
      return escriturasDeInterfaz.has(canal)
        ? escribirDesdeInterfaz(evento, canal, git, req, operar)
        : operar()
    })
  }
  registrarConsultas(enProyecto)
  registrarEscrituras(enProyecto)
  deps.git.anunciarRegistro()
}
