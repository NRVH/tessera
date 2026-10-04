// =============================================================================
// Preload: git del proyecto activo (estado, historial, diff, preparar y descartar).
// Rutas siempre relativas a la contenedora; el estado parcial de los repos llega por suscripción.
// Canales y formas: src/shared/git-ipc.ts.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  GIT_CHANNELS,
  type BlobResult,
  type BlobBytesRequest,
  type BlobBytesResult,
  type Branch,
  type Commit,
  type DiscardChangesResult,
  type ResultadoArchivo,
  type ResultadoDescarte,
  type ResultadoIgnorar,
  type FileChange,
  type FileHistoryResult,
  type ParentOfResult,
  type RepoStatus,
  type RepoStatusParcial,
  type WorkingChange,
  type WriteResult,
  type CommitResult,
  type CommitDetail,
  type CommitsRamaActualResult
} from '../shared/git-ipc'

/**
 * API de git expuesta al renderer. Solo lectura (historia + diff); todas las
 * rutas son RELATIVAS al proyecto (POSIX), igual que en FilesApi.
 */
export interface GitApi {
  /**
   * Historia de commits del proyecto. Sin `branch`: todas las ramas (como
   * siempre); con `branch`: acotada a esa rama. `limit` acota el número de commits
   * (git --max-count); undefined/0 -> historial completo.
   */
  listCommits: (branch?: string, limit?: number, repo?: string) => Promise<Commit[]>
  /** Ramas locales del repo activo, para el selector del grafo. */
  listBranches: (repo?: string) => Promise<Branch[]>
  /** Archivos tocados por un commit. */
  filesForCommit: (hash: string, repo?: string) => Promise<FileChange[]>
  /** Commits que tocaron un archivo, cruzando renames. */
  fileHistory: (path: string, repo?: string) => Promise<FileHistoryResult>
  /** Contenido de un archivo en un commit dado. */
  blobAtCommit: (hash: string, path: string, repo?: string) => Promise<BlobResult>
  /** Bytes crudos de un lado del diff (commit/índice/disco), para los visores binarios. */
  blobBytes: (req: BlobBytesRequest) => Promise<BlobBytesResult>
  /** Primer padre (DAG real) de un commit; parentHash null si es raíz. */
  parentOf: (hash: string, repo?: string) => Promise<ParentOfResult>
  /** Cambios del working-tree del repo activo: staged, unstaged, untracked, renames y conflictos, con ambos ejes (index/worktree) por archivo. */
  workingStatus: () => Promise<WorkingChange[]>
  /** Rama + cambios de VARIOS repos de la contenedora, en una sola llamada. */
  /**
   * Estado de varios repos. `prioritarios` son los que se están VIENDO (se
   * atienden primero) y `gen` marca la petición para poder tirar los goteos de una
   * anterior. Ambos opcionales: sin ellos se comporta como siempre.
   */
  multiStatus: (
    repos: string[],
    prioritarios?: string[],
    gen?: number
  ) => Promise<RepoStatus[]>
  /**
   * Escucha el goteo: un repo que ya tiene su estado mientras los demás siguen en
   * camino. Devuelve la baja, como el resto de `onX` de este puente.
   */
  onStatusParcial: (cb: (p: RepoStatusParcial) => void) => () => void
  /** Contenido ACTUAL en disco de un archivo del working-tree (lado "after" del diff working-vs-HEAD). */
  workingBlob: (path: string) => Promise<BlobResult>
  /** Descarta los cambios locales del working-tree de un archivo (revierte trackeado; borra untracked con confirmación). */
  discardChanges: (path: string) => Promise<DiscardChangesResult>
  /** Añade un archivo al índice (stage). */
  stageFile: (path: string) => Promise<WriteResult>
  /** Quita un archivo del índice (unstage). */
  unstageFile: (path: string) => Promise<WriteResult>
  /** Prepara VARIOS archivos de una vez (un proceso de git por repo). */
  stageFiles: (paths: string[]) => Promise<ResultadoArchivo[]>
  /** Quita VARIOS archivos del índice de una vez. */
  unstageFiles: (paths: string[]) => Promise<ResultadoArchivo[]>
  /** Descarta VARIOS archivos con UNA sola confirmación. */
  discardChangesMany: (paths: string[]) => Promise<ResultadoDescarte[]>
  /**
   * Añade patrones al .gitignore de la raíz del repo (se commitea). Solo las
   * rutas: si una carpeta está entera lo decide el main preguntándoselo a git —
   * el renderer no conoce los archivos que git ya rastrea (ver IgnorarRequest).
   */
  ignorarEnGitignore: (paths: string[]) => Promise<ResultadoIgnorar>
  /** Añade patrones a .git/info/exclude (local: nunca se sube). */
  ignorarEnExcludeLocal: (paths: string[]) => Promise<ResultadoIgnorar>
  /** Crea un commit con lo staged. `repo` = en cuál (omitido: el activo). */
  commit: (message: string, repo?: string) => Promise<CommitResult>
  /** Contenido de un archivo en el índice (versión staged). */
  indexBlob: (path: string) => Promise<BlobResult>
  /** Detalle completo de un commit (cuerpo del mensaje + committer); null si no existe. */
  commitDetail: (hash: string, repo?: string) => Promise<CommitDetail | null>
  /** Ramas (locales y remotas) que contienen un commit, por nombre corto. */
  branchesContaining: (hash: string, repo?: string) => Promise<string[]>
  /**
   * Hashes alcanzables desde HEAD: los commits que el log tiñe como "de tu rama".
   *
   * `hashes` acota la pregunta a los commits CARGADOS y la respuesta a su
   * subconjunto: sin él viaja la historia entera del repo. Ver el request.
   */
  commitsRamaActual: (repo?: string, hashes?: readonly string[]) => Promise<CommitsRamaActualResult>
}

export const git: GitApi = {
  listCommits: (branch, limit, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.LIST_COMMITS, { branch, limit, repo }),
  listBranches: (repo) => ipcRenderer.invoke(GIT_CHANNELS.LIST_BRANCHES, { repo }),
  filesForCommit: (hash, repo) => ipcRenderer.invoke(GIT_CHANNELS.FILES_FOR_COMMIT, { hash, repo }),
  fileHistory: (path, repo) => ipcRenderer.invoke(GIT_CHANNELS.FILE_HISTORY, { path, repo }),
  blobAtCommit: (hash, path, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.BLOB_AT_COMMIT, { hash, path, repo }),
  blobBytes: (req) => ipcRenderer.invoke(GIT_CHANNELS.BLOB_BYTES, req),
  parentOf: (hash, repo) => ipcRenderer.invoke(GIT_CHANNELS.PARENT_OF, { hash, repo }),
  workingStatus: () => ipcRenderer.invoke(GIT_CHANNELS.WORKING_STATUS),
  multiStatus: (repos, prioritarios, gen) =>
    ipcRenderer.invoke(GIT_CHANNELS.MULTI_STATUS, { repos, prioritarios, gen }),
  onStatusParcial: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, p: RepoStatusParcial): void => cb(p)
    ipcRenderer.on(GIT_CHANNELS.STATUS_PARCIAL, h)
    return () => ipcRenderer.removeListener(GIT_CHANNELS.STATUS_PARCIAL, h)
  },
  workingBlob: (path) => ipcRenderer.invoke(GIT_CHANNELS.WORKING_BLOB, { path }),
  discardChanges: (path) => ipcRenderer.invoke(GIT_CHANNELS.DISCARD_CHANGES, { path }),
  stageFile: (path) => ipcRenderer.invoke(GIT_CHANNELS.STAGE_FILE, { path }),
  unstageFile: (path) => ipcRenderer.invoke(GIT_CHANNELS.UNSTAGE_FILE, { path }),
  stageFiles: (paths) => ipcRenderer.invoke(GIT_CHANNELS.STAGE_FILES, { paths }),
  unstageFiles: (paths) => ipcRenderer.invoke(GIT_CHANNELS.UNSTAGE_FILES, { paths }),
  discardChangesMany: (paths) => ipcRenderer.invoke(GIT_CHANNELS.DISCARD_CHANGES_MANY, { paths }),
  ignorarEnGitignore: (paths) => ipcRenderer.invoke(GIT_CHANNELS.IGNORAR_GITIGNORE, { paths }),
  ignorarEnExcludeLocal: (paths) =>
    ipcRenderer.invoke(GIT_CHANNELS.IGNORAR_EXCLUDE_LOCAL, { paths }),
  commit: (message, repo) => ipcRenderer.invoke(GIT_CHANNELS.COMMIT, { message, repo }),
  indexBlob: (path) => ipcRenderer.invoke(GIT_CHANNELS.INDEX_BLOB, { path }),
  commitDetail: (hash, repo) => ipcRenderer.invoke(GIT_CHANNELS.COMMIT_DETAIL, { hash, repo }),
  branchesContaining: (hash, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.BRANCHES_CONTAINING, { hash, repo }),
  commitsRamaActual: (repo, hashes) =>
    ipcRenderer.invoke(GIT_CHANNELS.COMMITS_RAMA_ACTUAL, { repo, hashes })
}
