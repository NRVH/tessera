// =============================================================================
// ServicioWorkspace: el diálogo de elegir carpeta de proyecto, el cambio de proyecto activo y el
// escaneo de repos de una carpeta. Re-apunta DESACOPLADOS a `ServicioGit` (`setActiveProject`: el
// repo activo) y a `ServicioArchivos` (`fijarRaizArchivos`: la contenedora de la pestaña), para que el
// explorador siga a la pestaña y no se mueva al cambiar de repo. Recuerda la última contenedora
// porque el renderer no la reenvía en `setActiveProject` (su contrato está congelado) y
// `ServicioGit` la necesita para el prefijo del repo. Los canales los traduce `workspace/ipc.ts`.
// =============================================================================

import type { BrowserWindow } from 'electron'
import * as path from 'node:path'
import type {
  ResultadoAbrirProyecto,
  PeticionEscanearRepos,
  ResultadoEscanearRepos,
  PeticionFijarProyectoActivo,
  ResultadoFijarProyectoActivo,
  PeticionFijarRaizArchivos,
  ResultadoFijarRaizArchivos
} from '../../shared/workspace-ipc'
import type { ServicioArchivos } from '../archivos/ServicioArchivos'
import type { ServicioGit } from '../git/ServicioGit'
import { elegirConDialogo } from '../util/adaptadores/dialogosNativos'
import { escanearRepos } from './escanearRepos'
import { txMain } from '../textos.ts'

export interface OpcionesServicioWorkspace {
  /** Ventana a la que anclar el diálogo (modal). */
  ventana: () => BrowserWindow | null
  /** Servicio de archivos del proyecto activo, a re-apuntar al cambiar de proyecto. */
  servicioArchivos: ServicioArchivos
  /** Servicio de git del proyecto activo, a re-apuntar al cambiar de proyecto. */
  servicioGit: ServicioGit
  /** Logger del main (por defecto console.log con prefijo). */
  log?: (msg: string) => void
}

export class ServicioWorkspace {
  private readonly ventana: () => BrowserWindow | null
  private readonly servicioArchivos: ServicioArchivos
  private readonly servicioGit: ServicioGit
  readonly log: (msg: string) => void

  /**
   * Última carpeta CONTENEDORA anclada por `fijarRaizArchivos` (la de la pestaña activa), o null si
   * aún no se ancló ninguna. Al cambiar SOLO de repo dentro de una pestaña, el renderer llama
   * únicamente a `setActiveProject`, sin re-anclar el explorador, y ServicioGit necesita la
   * contenedora para derivar el prefijo del repo dentro de ella.
   */
  private rutaContenedorActiva: string | null = null

  constructor(opts: OpcionesServicioWorkspace) {
    this.ventana = opts.ventana
    this.servicioArchivos = opts.servicioArchivos
    this.servicioGit = opts.servicioGit
    this.log = opts.log ?? ((m) => console.log(`[workspace] ${m}`))
  }

  /**
   * Cambia el REPO ACTIVO de git: re-apunta SOLO ServicioGit a la carpeta host indicada (el
   * `repoHostPath` del repo activo, o el contenedor si aún no hay repo) y devuelve su nombre
   * neutro. ServicioGit invalida además su caché de repo, de modo que el próximo git:* re-resuelve
   * el repo NUEVO. NO toca ServicioArchivos: el explorador se ancla aparte por `fijarRaizArchivos`.
   */
  fijarProyectoActivo(req: PeticionFijarProyectoActivo): ResultadoFijarProyectoActivo {
    const { projectHostPath } = req
    // `projectHostPath` aquí es el repoHostPath del repo activo (nombre de campo conservado por
    // compatibilidad del contrato). Si aún no hay contenedora, o el repo ES la contenedora
    // (proyecto de un solo repo), el prefijo cae a "" y la traducción de rutas es la identidad.
    this.servicioGit.fijarRaizProyecto(projectHostPath, this.rutaContenedorActiva ?? undefined)
    const nombre = path.basename(projectHostPath)
    this.log(`repo activo (git) cambiado -> "${nombre}"`)
    return { name: nombre }
  }

  /**
   * Ancla el EXPLORADOR (ServicioArchivos) a la carpeta CONTENEDORA de la pestaña activa. Se llama al
   * abrir/activar otra pestaña, nunca al cambiar de repo dentro de la misma, de modo que el árbol
   * de archivos muestra siempre la contenedora completa (repos hermanos incluidos).
   */
  fijarRaizArchivos(req: PeticionFijarRaizArchivos): ResultadoFijarRaizArchivos {
    const { projectHostPath } = req
    // Git lo conoce primero: sus paneles piden sin esperar al confirmado, y si re-apuntar el
    // explorador fallara, sus peticiones irían en bucle contra un proyecto desconocido.
    this.servicioGit.conocerContenedora(projectHostPath)
    this.servicioArchivos.fijarRaizProyecto(projectHostPath)
    // NO se re-apunta ServicioGit aquí (movería la vista de git al cambiar de pestaña): el
    // renderer siempre ancla el files-root de una pestaña ANTES de activar un sub-repo suyo, así
    // que la contenedora ya estará recordada cuando llegue ese `setActiveProject`.
    this.rutaContenedorActiva = path.resolve(projectHostPath)
    const nombre = path.basename(projectHostPath)
    this.log(`explorador anclado a contenedora -> "${nombre}"`)
    return { name: nombre }
  }

  /**
   * Escanea `projectHostPath` en busca de repos git (la raíz y los de dentro, ver `escanearRepos`).
   * No activa ninguno; activar un repo detectado es un `setActiveProject` posterior.
   */
  async escanearRepos(req: PeticionEscanearRepos): Promise<ResultadoEscanearRepos> {
    const repos = await escanearRepos(req.projectHostPath)
    this.log(`escaneo de "${path.basename(req.projectHostPath)}" -> ${repos.length} repo(s)`)
    return { repos }
  }

  /** Abre el diálogo nativo "elegir carpeta", anclado a la ventana si existe. */
  async abrirDialogoProyecto(): Promise<ResultadoAbrirProyecto> {
    // Dónde abre (ver `util/adaptadores/dialogosNativos.ts`): lo recordado y, si no hay, la carpeta
    // que contiene el proyecto activo, que es donde suelen vivir sus hermanos.
    const resultado = await elegirConDialogo(
      'abrir-proyecto',
      { properties: ['openDirectory'], title: txMain().abrirProyecto },
      {
        ventana: this.ventana(),
        despues: [this.rutaContenedorActiva ? path.dirname(this.rutaContenedorActiva) : null]
      }
    )

    const chosen = resultado.filePaths[0]
    if (resultado.canceled || !chosen) {
      return { canceled: true }
    }

    return { canceled: false, projectHostPath: chosen, name: path.basename(chosen) }
  }
}
