// =============================================================================
// GitService: fachada de git de un proyecto. Lee historia, estado y diff y ESCRIBE en el repo del
// usuario (preparar, descartar, commit, ignorar) con el binario `git` en el main; delega en las
// operaciones de `git/` y comparte con ellas un solo núcleo. Cada petición se atiende en la vista de
// su proyecto (`paraRaiz`). Sin `electron`: sus canales los registra `git/ipc.ts`.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md, docs/decisiones/workspace/peticiones-de-archivos-con-su-proyecto.md
// =============================================================================

import type {
  BlobBytesRequest,
  BlobBytesResult,
  BlobResult,
  Branch,
  Commit,
  CommitDetail,
  CommitResult,
  CommitsRamaActualResult,
  DiscardChangesResult,
  FileChange,
  FileHistoryResult,
  ParentOfResult,
  RepoStatus,
  ResultadoArchivo,
  ResultadoDescarte,
  ResultadoIgnorar,
  WorkingChange,
  WriteResult
} from '../../shared/git-ipc'
import * as path from 'node:path'
import { comparablePath, samePath } from '../files/utilidadesDisco'
import { Blobs } from './blobs'
import { Descartes } from './descartes'
import { Estado } from './estado'
import { Historial } from './historial'
import { Ignorar } from './ignorar'
import { NucleoGit } from './NucleoGit'
import { Preparar } from './preparar'
import { txGit } from './textos.ts'
import type { GitServiceOptions } from './tipos'

export type { GitServiceOptions }

/** Servicio de git del main: historia, estado, blobs y escrituras del repo del proyecto activo. */
export class GitService {
  private readonly n: NucleoGit
  private readonly blobs: Blobs
  private readonly historial: Historial
  private readonly estado: Estado
  private readonly preparar: Preparar
  private readonly descartes: Descartes
  private readonly ignorar: Ignorar

  private readonly opts: GitServiceOptions
  /** Contenedoras ancladas alguna vez en la sesión (`comparablePath`): las únicas a las que se atiende. */
  private readonly conocidas = new Set<string>()
  /** Una vista por cada contenedora conocida que no es la anclada (`paraRaiz`). */
  private readonly vistas = new Map<string, GitService>()

  constructor(opts: GitServiceOptions = {}) {
    this.opts = opts
    this.n = new NucleoGit(opts)
    this.blobs = new Blobs(this.n)
    this.historial = new Historial(this.n)
    this.estado = new Estado(this.n)
    this.preparar = new Preparar(this.n)
    this.descartes = new Descartes(this.n)
    this.ignorar = new Ignorar(this.n)
    const contenedora = this.n.contenedora()
    if (contenedora !== null) this.conocidas.add(comparablePath(contenedora))
  }

  /** Re-apunta el servicio al proyecto activo (y su contenedora) e invalida el repo cacheado. */
  setProjectRoot(projectRoot: string, containerPath?: string): void {
    this.n.setProjectRoot(projectRoot, containerPath)
    this.conocerContenedora(containerPath ?? projectRoot)
  }

  /** Admite las peticiones de `contenedora` (`paraRaiz`): la del explorador al anclarse. */
  conocerContenedora(contenedora: string): void {
    const clave = comparablePath(path.resolve(contenedora))
    this.conocidas.add(clave)
    // Su vista se rehace la próxima vez: lo que memorizó (un repo que aún no existía) puede ser viejo.
    this.vistas.delete(clave)
  }

  /**
   * El servicio que atiende una petición del proyecto `raiz`: este si es la contenedora anclada; si
   * no, una vista con esa contenedora y el mismo candado de escritura. Solo de contenedoras ya
   * ancladas en la sesión. Así una petición nacida en un proyecto corre siempre en sus repos, aunque
   * el ancla ya esté en otro. Sin el repo elegido en el panel, la vista resuelve el de la contenedora:
   * quien quiera otro lo nombra (`repo`) o da la ruta del archivo.
   */
  paraRaiz(raiz: unknown): GitService {
    if (typeof raiz !== 'string' || raiz === '') throw new Error(txGit().proyectoDesconocido)
    const abs = path.resolve(raiz)
    const anclada = this.n.contenedora()
    if (anclada !== null && samePath(abs, anclada)) return this
    const clave = comparablePath(abs)
    if (!this.conocidas.has(clave)) throw new Error(txGit().proyectoDesconocido)
    let vista = this.vistas.get(clave)
    if (vista === undefined) {
      vista = new GitService({ ...this.opts, projectRoot: abs, containerPath: abs, writeLock: this.n.writeLock, vista: true })
      this.vistas.set(clave, vista)
    }
    return vista
  }

  /** Deja en el log si hay proyecto activo al registrarse los canales. */
  anunciarRegistro(): void {
    this.n.anunciarRegistro()
  }

  /** Historia de commits: todas las ramas o una, con tope opcional. */
  listCommits(branch?: string, limit?: number, repo?: string): Promise<Commit[]> {
    return this.historial.listCommits(branch, limit, repo)
  }

  /** Detalle completo de un commit; `null` si no existe. */
  commitDetail(hash: string, repo?: string): Promise<CommitDetail | null> {
    return this.historial.commitDetail(hash, repo)
  }

  /** Nombres de las ramas que contienen un commit. */
  branchesContaining(hash: string, repo?: string): Promise<string[]> {
    return this.historial.branchesContaining(hash, repo)
  }

  /** Commits alcanzables desde HEAD, opcionalmente recortados a `filtro`. */
  commitsRamaActual(repo?: string, filtro?: readonly string[]): Promise<CommitsRamaActualResult> {
    return this.historial.commitsRamaActual(repo, filtro)
  }

  /** Ramas locales y remotas del repo. */
  listBranches(repo?: string): Promise<Branch[]> {
    return this.historial.listBranches(repo)
  }

  /** Archivos tocados por un commit, con rutas relativas a la contenedora. */
  filesForCommit(hash: string, repo?: string): Promise<FileChange[]> {
    return this.historial.filesForCommit(hash, repo)
  }

  /** Commits que tocaron un archivo, cruzando renames. */
  fileHistory(relPosix: string, repo?: string): Promise<FileHistoryResult> {
    return this.historial.fileHistory(relPosix, repo)
  }

  /** Contenido de un archivo en un commit. */
  blobAtCommit(hash: string, relPosix: string, repo?: string): Promise<BlobResult> {
    return this.blobs.blobAtCommit(hash, relPosix, repo)
  }

  /** Bytes de un lado del diff (commit, índice o disco). */
  blobBytes(req: BlobBytesRequest): Promise<BlobBytesResult> {
    return this.blobs.blobBytes(req)
  }

  /** Bytes de varios lados del diff, con un `cat-file --batch` por repo. */
  blobsBytesLote(reqs: readonly BlobBytesRequest[], maxBytes?: number): Promise<BlobBytesResult[]> {
    return this.blobs.blobsBytesLote(reqs, maxBytes)
  }

  /** Primer padre de un commit. */
  parentOf(hash: string, repo?: string): Promise<ParentOfResult> {
    return this.historial.parentOf(hash, repo)
  }

  /** Cambios del working-tree de un repo. */
  workingStatus(repo?: string): Promise<WorkingChange[]> {
    return this.estado.workingStatus(repo)
  }

  /** Rama y cambios de varios repos, con avisos parciales por `STATUS_PARCIAL`. */
  multiStatus(repos: string[], prioritarios?: readonly string[], gen?: number): Promise<RepoStatus[]> {
    return this.estado.multiStatus(repos, prioritarios, gen)
  }

  /** Contenido actual en disco de un archivo del working-tree. */
  workingBlob(relPosix: string): Promise<BlobResult> {
    return this.blobs.workingBlob(relPosix)
  }

  /** Descarta los cambios de un archivo; lo irrecuperable pide confirmación. */
  discardChanges(relPosix: string): Promise<DiscardChangesResult> {
    return this.descartes.discardChanges(relPosix)
  }

  /** Prepara un archivo (stage). */
  stageFile(relPosix: string): Promise<WriteResult> {
    return this.preparar.stageFile(relPosix)
  }

  /** Quita un archivo del índice, sin tocar el disco. */
  unstageFile(relPosix: string): Promise<WriteResult> {
    return this.preparar.unstageFile(relPosix)
  }

  /** Prepara varios archivos. */
  stageFiles(paths: readonly string[]): Promise<ResultadoArchivo[]> {
    return this.preparar.stageFiles(paths)
  }

  /** Quita varios archivos del índice. */
  unstageFiles(paths: readonly string[]): Promise<ResultadoArchivo[]> {
    return this.preparar.unstageFiles(paths)
  }

  /** Descarta varios archivos con UNA confirmación. */
  discardChangesMany(paths: readonly string[]): Promise<ResultadoDescarte[]> {
    return this.descartes.discardChangesMany(paths)
  }

  /** Añade patrones al `.gitignore` de la raíz del repo. */
  ignorarEnGitignore(paths: readonly string[]): Promise<ResultadoIgnorar> {
    return this.ignorar.ignorarEnGitignore(paths)
  }

  /** Añade patrones a `.git/info/exclude` (solo esta máquina). */
  ignorarEnExcludeLocal(paths: readonly string[]): Promise<ResultadoIgnorar> {
    return this.ignorar.ignorarEnExcludeLocal(paths)
  }

  /** Crea un commit con lo preparado. */
  commit(message: string, repo?: string): Promise<CommitResult> {
    return this.preparar.commit(message, repo)
  }

  /** Contenido de un archivo en el índice (versión preparada). */
  indexBlob(relPosix: string): Promise<BlobResult> {
    return this.blobs.indexBlob(relPosix)
  }
}
