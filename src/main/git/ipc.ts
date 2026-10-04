// =============================================================================
// Canales IPC de git (`GIT_CHANNELS`): el único sitio del área con `ipcMain`. Cada handler pasa
// los campos de la petición a UN método de `GitService` y no decide nada. El orden de registro
// es el de siempre. Lo registra `index.ts`.
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
  type RutasRequest,
  type StageFileRequest,
  type UnstageFileRequest,
  type WorkingBlobRequest
} from '../../shared/git-ipc'
import type { GitService } from './GitService'

type Ipc = Pick<IpcMain, 'handle'>

/** Historia, blobs y estado: los diez primeros canales, en su orden de registro. */
function registrarConsultas(ipc: Ipc, git: GitService): void {
  ipc.handle(GIT_CHANNELS.LIST_COMMITS, (_e: IpcMainInvokeEvent, req?: ListCommitsRequest) =>
    git.listCommits(req?.branch, req?.limit, req?.repo)
  )
  ipc.handle(GIT_CHANNELS.LIST_BRANCHES, (_e: IpcMainInvokeEvent, req?: ListBranchesRequest) =>
    git.listBranches(req?.repo)
  )
  ipc.handle(GIT_CHANNELS.FILES_FOR_COMMIT, (_e: IpcMainInvokeEvent, req: FilesForCommitRequest) =>
    git.filesForCommit(req.hash, req.repo)
  )
  ipc.handle(GIT_CHANNELS.FILE_HISTORY, (_e: IpcMainInvokeEvent, req: FileHistoryRequest) =>
    git.fileHistory(req.path, req.repo)
  )
  ipc.handle(GIT_CHANNELS.BLOB_BYTES, (_e: IpcMainInvokeEvent, req: BlobBytesRequest) =>
    git.blobBytes(req)
  )
  ipc.handle(GIT_CHANNELS.BLOB_AT_COMMIT, (_e: IpcMainInvokeEvent, req: BlobAtCommitRequest) =>
    git.blobAtCommit(req.hash, req.path, req.repo)
  )
  ipc.handle(GIT_CHANNELS.PARENT_OF, (_e: IpcMainInvokeEvent, req: ParentOfRequest) =>
    git.parentOf(req.hash, req.repo)
  )
  ipc.handle(GIT_CHANNELS.WORKING_STATUS, () => git.workingStatus())
  ipc.handle(GIT_CHANNELS.MULTI_STATUS, (_e: IpcMainInvokeEvent, req: MultiStatusRequest) =>
    git.multiStatus(req.repos, req.prioritarios, req.gen)
  )
  ipc.handle(GIT_CHANNELS.WORKING_BLOB, (_e: IpcMainInvokeEvent, req: WorkingBlobRequest) =>
    git.workingBlob(req.path)
  )
}

/** Escrituras y lecturas de detalle: los trece canales que siguen, en su orden de registro. */
function registrarEscrituras(ipc: Ipc, git: GitService): void {
  ipc.handle(GIT_CHANNELS.DISCARD_CHANGES, (_e: IpcMainInvokeEvent, req: DiscardChangesRequest) =>
    git.discardChanges(req.path)
  )
  ipc.handle(GIT_CHANNELS.STAGE_FILE, (_e: IpcMainInvokeEvent, req: StageFileRequest) =>
    git.stageFile(req.path)
  )
  ipc.handle(GIT_CHANNELS.UNSTAGE_FILE, (_e: IpcMainInvokeEvent, req: UnstageFileRequest) =>
    git.unstageFile(req.path)
  )
  ipc.handle(GIT_CHANNELS.STAGE_FILES, (_e: IpcMainInvokeEvent, req: RutasRequest) =>
    git.stageFiles(req.paths)
  )
  ipc.handle(GIT_CHANNELS.UNSTAGE_FILES, (_e: IpcMainInvokeEvent, req: RutasRequest) =>
    git.unstageFiles(req.paths)
  )
  ipc.handle(GIT_CHANNELS.DISCARD_CHANGES_MANY, (_e: IpcMainInvokeEvent, req: RutasRequest) =>
    git.discardChangesMany(req.paths)
  )
  ipc.handle(GIT_CHANNELS.IGNORAR_GITIGNORE, (_e: IpcMainInvokeEvent, req: IgnorarRequest) =>
    git.ignorarEnGitignore(req.paths)
  )
  ipc.handle(GIT_CHANNELS.IGNORAR_EXCLUDE_LOCAL, (_e: IpcMainInvokeEvent, req: IgnorarRequest) =>
    git.ignorarEnExcludeLocal(req.paths)
  )
  ipc.handle(GIT_CHANNELS.COMMIT, (_e: IpcMainInvokeEvent, req: CommitRequest) =>
    git.commit(req.message, req.repo)
  )
  ipc.handle(GIT_CHANNELS.INDEX_BLOB, (_e: IpcMainInvokeEvent, req: IndexBlobRequest) =>
    git.indexBlob(req.path)
  )
  ipc.handle(GIT_CHANNELS.COMMIT_DETAIL, (_e: IpcMainInvokeEvent, req: CommitDetailRequest) =>
    git.commitDetail(req.hash, req.repo)
  )
  ipc.handle(GIT_CHANNELS.BRANCHES_CONTAINING, (_e: IpcMainInvokeEvent, req: BranchesContainingRequest) =>
    git.branchesContaining(req.hash, req.repo)
  )
  ipc.handle(GIT_CHANNELS.COMMITS_RAMA_ACTUAL, (_e: IpcMainInvokeEvent, req?: CommitsRamaActualRequest) =>
    git.commitsRamaActual(req?.repo, req?.hashes)
  )
}

/** Registra los 23 handlers de git en `ipc` y anuncia en el log si hay proyecto activo. */
export function registrarIpcGit(deps: { ipc: Ipc; git: GitService }): void {
  registrarConsultas(deps.ipc, deps.git)
  registrarEscrituras(deps.ipc, deps.git)
  deps.git.anunciarRegistro()
}
