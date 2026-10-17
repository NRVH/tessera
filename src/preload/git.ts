// =============================================================================
// Preload: git de cada proyecto (estado, historial, diff, preparar y descartar). Cada llamada lleva
// primero la contenedora de su proyecto (`raiz`, ver `PeticionGit`); las rutas, relativas a ella.
// El estado parcial de los repos llega por suscripción. Canales y formas: src/shared/git-ipc.ts.
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
 * API de git expuesta al renderer. `raiz` es la contenedora del proyecto al que pertenece la
 * llamada (nunca la del proyecto activo: la del componente que la hace); las rutas son RELATIVAS a
 * ella (POSIX), igual que en FilesApi.
 */
export interface GitApi {
  /**
   * Historia de commits del proyecto. Sin `branch`: todas las ramas (como
   * siempre); con `branch`: acotada a esa rama. `limit` acota el número de commits
   * (git --max-count); undefined/0 -> historial completo.
   */
  listCommits: (raiz: string, branch?: string, limit?: number, repo?: string) => Promise<Commit[]>
  /** Ramas locales del repo, para el selector del grafo. */
  listBranches: (raiz: string, repo?: string) => Promise<Branch[]>
  /** Archivos tocados por un commit. */
  filesForCommit: (raiz: string, hash: string, repo?: string) => Promise<FileChange[]>
  /** Commits que tocaron un archivo, cruzando renames. */
  fileHistory: (raiz: string, path: string, repo?: string) => Promise<FileHistoryResult>
  /** Contenido de un archivo en un commit dado. */
  blobAtCommit: (raiz: string, hash: string, path: string, repo?: string) => Promise<BlobResult>
  /** Bytes crudos de un lado del diff (commit/índice/disco), para los visores binarios. */
  blobBytes: (raiz: string, req: BlobBytesRequest) => Promise<BlobBytesResult>
  /** Primer padre (DAG real) de un commit; parentHash null si es raíz. */
  parentOf: (raiz: string, hash: string, repo?: string) => Promise<ParentOfResult>
  /** Cambios del working-tree del repo de la contenedora: staged, unstaged, untracked, renames y conflictos, con ambos ejes (index/worktree) por archivo. */
  workingStatus: (raiz: string) => Promise<WorkingChange[]>
  /**
   * Rama + cambios de VARIOS repos de la contenedora, en una sola llamada. `prioritarios` son los
   * que se están VIENDO (se atienden primero) y `gen` marca la petición para poder tirar los
   * goteos de una anterior. Ambos opcionales: sin ellos se comporta como siempre.
   */
  multiStatus: (raiz: string, repos: string[], prioritarios?: string[], gen?: number) => Promise<RepoStatus[]>
  /**
   * Escucha el goteo: un repo que ya tiene su estado mientras los demás siguen en
   * camino. Devuelve la baja, como el resto de `onX` de este puente.
   */
  onStatusParcial: (cb: (p: RepoStatusParcial) => void) => () => void
  /** Contenido ACTUAL en disco de un archivo del working-tree (lado "after" del diff working-vs-HEAD). */
  workingBlob: (raiz: string, path: string) => Promise<BlobResult>
  /** Descarta los cambios locales del working-tree de un archivo (revierte trackeado; borra untracked con confirmación). */
  discardChanges: (raiz: string, path: string) => Promise<DiscardChangesResult>
  /** Añade un archivo al índice (stage). */
  stageFile: (raiz: string, path: string) => Promise<WriteResult>
  /** Quita un archivo del índice (unstage). */
  unstageFile: (raiz: string, path: string) => Promise<WriteResult>
  /** Prepara VARIOS archivos de una vez (un proceso de git por repo). */
  stageFiles: (raiz: string, paths: string[]) => Promise<ResultadoArchivo[]>
  /** Quita VARIOS archivos del índice de una vez. */
  unstageFiles: (raiz: string, paths: string[]) => Promise<ResultadoArchivo[]>
  /** Descarta VARIOS archivos con UNA sola confirmación. */
  discardChangesMany: (raiz: string, paths: string[]) => Promise<ResultadoDescarte[]>
  /**
   * Añade patrones al .gitignore de la raíz del repo (se commitea). Solo las
   * rutas: si una carpeta está entera lo decide el main preguntándoselo a git —
   * el renderer no conoce los archivos que git ya rastrea (ver IgnorarRequest).
   */
  ignorarEnGitignore: (raiz: string, paths: string[]) => Promise<ResultadoIgnorar>
  /** Añade patrones a .git/info/exclude (local: nunca se sube). */
  ignorarEnExcludeLocal: (raiz: string, paths: string[]) => Promise<ResultadoIgnorar>
  /** Crea un commit con lo staged. `repo` = en cuál (omitido: el de la contenedora). */
  commit: (raiz: string, message: string, repo?: string) => Promise<CommitResult>
  /** Contenido de un archivo en el índice (versión staged). */
  indexBlob: (raiz: string, path: string) => Promise<BlobResult>
  /** Detalle completo de un commit (cuerpo del mensaje + committer); null si no existe. */
  commitDetail: (raiz: string, hash: string, repo?: string) => Promise<CommitDetail | null>
  /** Ramas (locales y remotas) que contienen un commit, por nombre corto. */
  branchesContaining: (raiz: string, hash: string, repo?: string) => Promise<string[]>
  /**
   * Hashes alcanzables desde HEAD: los commits que el log tiñe como "de tu rama".
   *
   * `hashes` acota la pregunta a los commits CARGADOS y la respuesta a su
   * subconjunto: sin él viaja la historia entera del repo. Ver el request.
   */
  commitsRamaActual: (raiz: string, repo?: string, hashes?: readonly string[]) => Promise<CommitsRamaActualResult>
}

export const git: GitApi = {
  listCommits: (raiz, branch, limit, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.LIST_COMMITS, { raiz, branch, limit, repo }),
  listBranches: (raiz, repo) => ipcRenderer.invoke(GIT_CHANNELS.LIST_BRANCHES, { raiz, repo }),
  filesForCommit: (raiz, hash, repo) => ipcRenderer.invoke(GIT_CHANNELS.FILES_FOR_COMMIT, { raiz, hash, repo }),
  fileHistory: (raiz, path, repo) => ipcRenderer.invoke(GIT_CHANNELS.FILE_HISTORY, { raiz, path, repo }),
  blobAtCommit: (raiz, hash, path, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.BLOB_AT_COMMIT, { raiz, hash, path, repo }),
  blobBytes: (raiz, req) => ipcRenderer.invoke(GIT_CHANNELS.BLOB_BYTES, { ...req, raiz }),
  parentOf: (raiz, hash, repo) => ipcRenderer.invoke(GIT_CHANNELS.PARENT_OF, { raiz, hash, repo }),
  workingStatus: (raiz) => ipcRenderer.invoke(GIT_CHANNELS.WORKING_STATUS, { raiz }),
  multiStatus: (raiz, repos, prioritarios, gen) =>
    ipcRenderer.invoke(GIT_CHANNELS.MULTI_STATUS, { raiz, repos, prioritarios, gen }),
  onStatusParcial: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, p: RepoStatusParcial): void => cb(p)
    ipcRenderer.on(GIT_CHANNELS.STATUS_PARCIAL, h)
    return () => ipcRenderer.removeListener(GIT_CHANNELS.STATUS_PARCIAL, h)
  },
  workingBlob: (raiz, path) => ipcRenderer.invoke(GIT_CHANNELS.WORKING_BLOB, { raiz, path }),
  discardChanges: (raiz, path) => ipcRenderer.invoke(GIT_CHANNELS.DISCARD_CHANGES, { raiz, path }),
  stageFile: (raiz, path) => ipcRenderer.invoke(GIT_CHANNELS.STAGE_FILE, { raiz, path }),
  unstageFile: (raiz, path) => ipcRenderer.invoke(GIT_CHANNELS.UNSTAGE_FILE, { raiz, path }),
  stageFiles: (raiz, paths) => ipcRenderer.invoke(GIT_CHANNELS.STAGE_FILES, { raiz, paths }),
  unstageFiles: (raiz, paths) => ipcRenderer.invoke(GIT_CHANNELS.UNSTAGE_FILES, { raiz, paths }),
  discardChangesMany: (raiz, paths) => ipcRenderer.invoke(GIT_CHANNELS.DISCARD_CHANGES_MANY, { raiz, paths }),
  ignorarEnGitignore: (raiz, paths) => ipcRenderer.invoke(GIT_CHANNELS.IGNORAR_GITIGNORE, { raiz, paths }),
  ignorarEnExcludeLocal: (raiz, paths) =>
    ipcRenderer.invoke(GIT_CHANNELS.IGNORAR_EXCLUDE_LOCAL, { raiz, paths }),
  commit: (raiz, message, repo) => ipcRenderer.invoke(GIT_CHANNELS.COMMIT, { raiz, message, repo }),
  indexBlob: (raiz, path) => ipcRenderer.invoke(GIT_CHANNELS.INDEX_BLOB, { raiz, path }),
  commitDetail: (raiz, hash, repo) => ipcRenderer.invoke(GIT_CHANNELS.COMMIT_DETAIL, { raiz, hash, repo }),
  branchesContaining: (raiz, hash, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.BRANCHES_CONTAINING, { raiz, hash, repo }),
  commitsRamaActual: (raiz, repo, hashes) =>
    ipcRenderer.invoke(GIT_CHANNELS.COMMITS_RAMA_ACTUAL, { raiz, repo, hashes })
}
