// =============================================================================
// Canales IPC de git (`GIT_CHANNELS`): el único sitio del área con `ipcMain`. Cada handler pasa
// los campos de la petición a UN método de la vista de SU proyecto (`GitService.paraRaiz`) y no
// decide nada. El orden de registro es el de siempre. Lo registra `index.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  GIT_CHANNELS,
  type BlobAtCommitRequest,
  type BlobBytesRequest,
  type BranchesContainingRequest,
  type CommitDetailRequest,
  type CommitRequest,
  type CommitsRamaActualRequest,
  type DiscardChangesRequest,
  type FileHistoryRequest,
  type FilesForCommitRequest,
  type IgnorarRequest,
  type IndexBlobRequest,
  type ListBranchesRequest,
  type ListCommitsRequest,
  type MultiStatusRequest,
  type ParentOfRequest,
  type PeticionGit,
  type RutasRequest,
  type StageFileRequest,
  type UnstageFileRequest,
  type WorkingBlobRequest
} from '../../shared/git-ipc'
import type { GitService } from './GitService'

type Ipc = Pick<IpcMain, 'handle'>

/** Registra un canal en la vista del proyecto de cada petición, nunca en la del anclado. */
type EnProyecto = <R>(canal: string, fn: (svc: GitService, req: PeticionGit<R>) => unknown) => void

/** Historia, blobs y estado: los diez primeros canales, en su orden de registro. */
function registrarConsultas(enProyecto: EnProyecto): void {
  enProyecto(GIT_CHANNELS.LIST_COMMITS, (git, req: PeticionGit<ListCommitsRequest>) =>
    git.listCommits(req.branch, req.limit, req.repo)
  )
  enProyecto(GIT_CHANNELS.LIST_BRANCHES, (git, req: PeticionGit<ListBranchesRequest>) => git.listBranches(req.repo))
  enProyecto(GIT_CHANNELS.FILES_FOR_COMMIT, (git, req: PeticionGit<FilesForCommitRequest>) =>
    git.filesForCommit(req.hash, req.repo)
  )
  enProyecto(GIT_CHANNELS.FILE_HISTORY, (git, req: PeticionGit<FileHistoryRequest>) => git.fileHistory(req.path, req.repo))
  enProyecto(GIT_CHANNELS.BLOB_BYTES, (git, req: PeticionGit<BlobBytesRequest>) => git.blobBytes(req))
  enProyecto(GIT_CHANNELS.BLOB_AT_COMMIT, (git, req: PeticionGit<BlobAtCommitRequest>) =>
    git.blobAtCommit(req.hash, req.path, req.repo)
  )
  enProyecto(GIT_CHANNELS.PARENT_OF, (git, req: PeticionGit<ParentOfRequest>) => git.parentOf(req.hash, req.repo))
  enProyecto(GIT_CHANNELS.WORKING_STATUS, (git) => git.workingStatus())
  enProyecto(GIT_CHANNELS.MULTI_STATUS, (git, req: PeticionGit<MultiStatusRequest>) =>
    git.multiStatus(req.repos, req.prioritarios, req.gen)
  )
  enProyecto(GIT_CHANNELS.WORKING_BLOB, (git, req: PeticionGit<WorkingBlobRequest>) => git.workingBlob(req.path))
}

/** Escrituras y lecturas de detalle: los trece canales que siguen, en su orden de registro. */
function registrarEscrituras(enProyecto: EnProyecto): void {
  enProyecto(GIT_CHANNELS.DISCARD_CHANGES, (git, req: PeticionGit<DiscardChangesRequest>) => git.discardChanges(req.path))
  enProyecto(GIT_CHANNELS.STAGE_FILE, (git, req: PeticionGit<StageFileRequest>) => git.stageFile(req.path))
  enProyecto(GIT_CHANNELS.UNSTAGE_FILE, (git, req: PeticionGit<UnstageFileRequest>) => git.unstageFile(req.path))
  enProyecto(GIT_CHANNELS.STAGE_FILES, (git, req: PeticionGit<RutasRequest>) => git.stageFiles(req.paths))
  enProyecto(GIT_CHANNELS.UNSTAGE_FILES, (git, req: PeticionGit<RutasRequest>) => git.unstageFiles(req.paths))
  enProyecto(GIT_CHANNELS.DISCARD_CHANGES_MANY, (git, req: PeticionGit<RutasRequest>) => git.discardChangesMany(req.paths))
  enProyecto(GIT_CHANNELS.IGNORAR_GITIGNORE, (git, req: PeticionGit<IgnorarRequest>) => git.ignorarEnGitignore(req.paths))
  enProyecto(GIT_CHANNELS.IGNORAR_EXCLUDE_LOCAL, (git, req: PeticionGit<IgnorarRequest>) =>
    git.ignorarEnExcludeLocal(req.paths)
  )
  enProyecto(GIT_CHANNELS.COMMIT, (git, req: PeticionGit<CommitRequest>) => git.commit(req.message, req.repo))
  enProyecto(GIT_CHANNELS.INDEX_BLOB, (git, req: PeticionGit<IndexBlobRequest>) => git.indexBlob(req.path))
  enProyecto(GIT_CHANNELS.COMMIT_DETAIL, (git, req: PeticionGit<CommitDetailRequest>) => git.commitDetail(req.hash, req.repo))
  enProyecto(GIT_CHANNELS.BRANCHES_CONTAINING, (git, req: PeticionGit<BranchesContainingRequest>) =>
    git.branchesContaining(req.hash, req.repo)
  )
  enProyecto(GIT_CHANNELS.COMMITS_RAMA_ACTUAL, (git, req: PeticionGit<CommitsRamaActualRequest>) =>
    git.commitsRamaActual(req.repo, req.hashes)
  )
}

/** Registra los 23 handlers de git en `ipc` y anuncia en el log si hay proyecto activo. */
export function registrarIpcGit(deps: { ipc: Ipc; git: GitService }): void {
  const enProyecto: EnProyecto = <R>(canal: string, fn: (svc: GitService, req: PeticionGit<R>) => unknown) => {
    deps.ipc.handle(canal, (_e: IpcMainInvokeEvent, req: PeticionGit<R>) => fn(deps.git.paraRaiz(req?.raiz), req))
  }
  registrarConsultas(enProyecto)
  registrarEscrituras(enProyecto)
  deps.git.anunciarRegistro()
}
