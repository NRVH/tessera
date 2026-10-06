// =============================================================================
// WorkspaceService: el diálogo de elegir carpeta de proyecto, el cambio de proyecto activo y el
// escaneo de repos de una carpeta. Re-apunta DESACOPLADOS a `GitService` (`setActiveProject`: el
// repo activo) y a `FileService` (`setFilesRoot`: la contenedora de la pestaña), para que el
// explorador siga a la pestaña y no se mueva al cambiar de repo. Recuerda la última contenedora
// porque el renderer no la reenvía en `setActiveProject` (su contrato está congelado) y
// `GitService` la necesita para el prefijo del repo. Los canales los traduce `workspace/ipc.ts`.
// =============================================================================

import type { BrowserWindow } from 'electron'
import * as path from 'node:path'
import type {
  OpenProjectResult,
  ScanReposRequest,
  ScanReposResult,
  SetActiveProjectRequest,
  SetActiveProjectResult,
  SetFilesRootRequest,
  SetFilesRootResult
} from '../../shared/workspace-ipc'
import type { FileService } from '../files/FileService'
import type { GitService } from '../git/GitService'
import { elegirConDialogo } from '../util/adaptadores/dialogosNativos'
import { scanRepos } from './scanRepos'

export interface WorkspaceServiceOptions {
  /** Ventana a la que anclar el diálogo (modal). */
  getWindow: () => BrowserWindow | null
  /** Servicio de archivos del proyecto activo, a re-apuntar al cambiar de proyecto. */
  fileService: FileService
  /** Servicio de git del proyecto activo, a re-apuntar al cambiar de proyecto. */
  gitService: GitService
  /** Logger del main (por defecto console.log con prefijo). */
  log?: (msg: string) => void
}

export class WorkspaceService {
  private readonly getWindow: () => BrowserWindow | null
  private readonly fileService: FileService
  private readonly gitService: GitService
  readonly log: (msg: string) => void

  /**
   * Última carpeta CONTENEDORA anclada por `setFilesRoot` (la de la pestaña activa), o null si
   * aún no se ancló ninguna. Al cambiar SOLO de repo dentro de una pestaña, el renderer llama
   * únicamente a `setActiveProject`, sin re-anclar el explorador, y GitService necesita la
   * contenedora para derivar el prefijo del repo dentro de ella.
   */
  private activeContainerPath: string | null = null

  constructor(opts: WorkspaceServiceOptions) {
    this.getWindow = opts.getWindow
    this.fileService = opts.fileService
    this.gitService = opts.gitService
    this.log = opts.log ?? ((m) => console.log(`[workspace] ${m}`))
  }

  /**
   * Cambia el REPO ACTIVO de git: re-apunta SOLO GitService a la carpeta host indicada (el
   * `repoHostPath` del repo activo, o el contenedor si aún no hay repo) y devuelve su nombre
   * neutro. GitService invalida además su caché de repo, de modo que el próximo git:* re-resuelve
   * el repo NUEVO. NO toca FileService: el explorador se ancla aparte por `setFilesRoot`.
   */
  setActiveProject(req: SetActiveProjectRequest): SetActiveProjectResult {
    const { projectHostPath } = req
    // `projectHostPath` aquí es el repoHostPath del repo activo (nombre de campo conservado por
    // compatibilidad del contrato). Si aún no hay contenedora, o el repo ES la contenedora
    // (proyecto de un solo repo), el prefijo cae a "" y la traducción de rutas es la identidad.
    this.gitService.setProjectRoot(projectHostPath, this.activeContainerPath ?? undefined)
    const name = path.basename(projectHostPath)
    this.log(`repo activo (git) cambiado -> "${name}"`)
    return { name }
  }

  /**
   * Ancla el EXPLORADOR (FileService) a la carpeta CONTENEDORA de la pestaña activa. Se llama al
   * abrir/activar otra pestaña, nunca al cambiar de repo dentro de la misma, de modo que el árbol
   * de archivos muestra siempre la contenedora completa (repos hermanos incluidos).
   */
  setFilesRoot(req: SetFilesRootRequest): SetFilesRootResult {
    const { projectHostPath } = req
    this.fileService.setProjectRoot(projectHostPath)
    // NO se re-apunta GitService aquí (movería la vista de git al cambiar de pestaña): el
    // renderer siempre ancla el files-root de una pestaña ANTES de activar un sub-repo suyo, así
    // que la contenedora ya estará recordada cuando llegue ese `setActiveProject`.
    this.activeContainerPath = path.resolve(projectHostPath)
    const name = path.basename(projectHostPath)
    this.log(`explorador anclado a contenedora -> "${name}"`)
    return { name }
  }

  /**
   * Escanea `projectHostPath` en busca de repos git (la raíz y los de dentro, ver `scanRepos`).
   * No activa ninguno; activar un repo detectado es un `setActiveProject` posterior.
   */
  async scanRepos(req: ScanReposRequest): Promise<ScanReposResult> {
    const repos = await scanRepos(req.projectHostPath)
    this.log(`escaneo de "${path.basename(req.projectHostPath)}" -> ${repos.length} repo(s)`)
    return { repos }
  }

  /** Abre el diálogo nativo "elegir carpeta", anclado a la ventana si existe. */
  async openProjectDialog(): Promise<OpenProjectResult> {
    // Dónde abre (ver `util/adaptadores/dialogosNativos.ts`): lo recordado y, si no hay, la carpeta
    // que contiene el proyecto activo, que es donde suelen vivir sus hermanos.
    const result = await elegirConDialogo(
      'abrir-proyecto',
      { properties: ['openDirectory'], title: 'Abrir proyecto' },
      {
        ventana: this.getWindow(),
        despues: [this.activeContainerPath ? path.dirname(this.activeContainerPath) : null]
      }
    )

    const chosen = result.filePaths[0]
    if (result.canceled || !chosen) {
      return { canceled: true }
    }

    return { canceled: false, projectHostPath: chosen, name: path.basename(chosen) }
  }
}
