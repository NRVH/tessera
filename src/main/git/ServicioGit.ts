// =============================================================================
// ServicioGit: fachada de git de un proyecto. Lee historia, estado y diff y ESCRIBE en el repo del
// usuario (preparar, descartar, commit, ignorar) con el binario `git` en el main; delega en las
// operaciones de `git/` y comparte con ellas un solo núcleo. Cada petición se atiende en la vista de
// su proyecto (`paraRaiz`). Sin `electron`: sus canales los registra `git/ipc.ts`.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md, docs/decisiones/workspace/peticiones-de-archivos-con-su-proyecto.md
// =============================================================================

import type {
  PeticionBytesBlob,
  ResultadoBytesBlob,
  ResultadoBlob,
  Rama,
  Commit,
  DatosDetalleCommit,
  ResultadoCommit,
  ResultadoCommitsRamaActual,
  ResultadoDescarteCambios,
  CambioArchivo,
  ResultadoHistorialArchivo,
  ResultadoPrimerPadre,
  EstadoRepo,
  ResultadoArchivo,
  ResultadoDescarte,
  ResultadoIgnorar,
  CambioWorktree,
  ResultadoEscrituraGit
} from '../../shared/git-ipc'
import * as path from 'node:path'
import { rutaComparable, esMismaRuta } from '../archivos/utilidadesDisco'
import { Blobs } from './blobs'
import { Descartes } from './descartes'
import { Estado } from './estado'
import { Historial } from './historial'
import { Ignorar } from './ignorar'
import { NucleoGit } from './NucleoGit'
import { Preparar } from './preparar'
import { txGit } from './textos.ts'
import type { OpcionesServicioGit } from './tipos'


/** Servicio de git del main: historia, estado, blobs y escrituras del repo del proyecto activo. */
export class ServicioGit {
  async reposDeEscritura(req: { raiz?: string; repo?: string; ruta?: string; rutas?: string[] }): Promise<string[]> {
    const rutas = req.rutas ?? (req.ruta ? [req.ruta] : [])
    const contextos = rutas.length
      ? await Promise.all(rutas.map((ruta) => this.n.obtenerCtxParaRuta(ruta)))
      : [await this.n.obtenerCtxParaRepo(req.repo)]
    return [...new Set(contextos.flatMap((ctx) => ctx ? [ctx.raiz] : []))]
  }
  private readonly n: NucleoGit
  private readonly blobs: Blobs
  private readonly historial: Historial
  private readonly estado: Estado
  private readonly preparar: Preparar
  private readonly descartes: Descartes
  private readonly ignorar: Ignorar

  private readonly opts: OpcionesServicioGit
  /** Contenedoras ancladas alguna vez en la sesión (`rutaComparable`): las únicas a las que se atiende. */
  private readonly conocidas = new Set<string>()
  /** Una vista por cada contenedora conocida que no es la anclada (`paraRaiz`). */
  private readonly vistas = new Map<string, ServicioGit>()

  constructor(opts: OpcionesServicioGit = {}) {
    this.opts = opts
    this.n = new NucleoGit(opts)
    this.blobs = new Blobs(this.n)
    this.historial = new Historial(this.n)
    this.estado = new Estado(this.n)
    this.preparar = new Preparar(this.n)
    this.descartes = new Descartes(this.n)
    this.ignorar = new Ignorar(this.n)
    const contenedora = this.n.contenedora()
    if (contenedora !== null) this.conocidas.add(rutaComparable(contenedora))
  }

  /** Re-apunta el servicio al proyecto activo (y su contenedora) e invalida el repo cacheado. */
  fijarRaizProyecto(raizProyecto: string, rutaContenedora?: string): void {
    this.n.fijarRaizProyecto(raizProyecto, rutaContenedora)
    this.conocerContenedora(rutaContenedora ?? raizProyecto)
  }

  /** Admite las peticiones de `contenedora` (`paraRaiz`): la del explorador al anclarse. */
  conocerContenedora(contenedora: string): void {
    const clave = rutaComparable(path.resolve(contenedora))
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
  paraRaiz(raiz: unknown): ServicioGit {
    if (typeof raiz !== 'string' || raiz === '') throw new Error(txGit().proyectoDesconocido)
    const abs = path.resolve(raiz)
    const anclada = this.n.contenedora()
    if (anclada !== null && esMismaRuta(abs, anclada)) return this
    const clave = rutaComparable(abs)
    if (!this.conocidas.has(clave)) throw new Error(txGit().proyectoDesconocido)
    let vista = this.vistas.get(clave)
    if (vista === undefined) {
      vista = new ServicioGit({ ...this.opts, raizProyecto: abs, rutaContenedora: abs, candadoEscritura: this.n.candadoEscritura, vista: true })
      this.vistas.set(clave, vista)
    }
    return vista
  }

  /** Deja en el log si hay proyecto activo al registrarse los canales. */
  anunciarRegistro(): void {
    this.n.anunciarRegistro()
  }

  /** Historia de commits: todas las ramas o una, con tope opcional. */
  listarCommits(rama?: string, limite?: number, repo?: string): Promise<Commit[]> {
    return this.historial.listarCommits(rama, limite, repo)
  }

  /** Detalle completo de un commit; `null` si no existe. */
  leerDetalleCommit(hash: string, repo?: string): Promise<DatosDetalleCommit | null> {
    return this.historial.leerDetalleCommit(hash, repo)
  }

  /** Nombres de las ramas que contienen un commit. */
  obtenerRamasQueContienen(hash: string, repo?: string): Promise<string[]> {
    return this.historial.obtenerRamasQueContienen(hash, repo)
  }

  /** Commits alcanzables desde HEAD, opcionalmente recortados a `filtro`. */
  commitsRamaActual(repo?: string, filtro?: readonly string[]): Promise<ResultadoCommitsRamaActual> {
    return this.historial.commitsRamaActual(repo, filtro)
  }

  /** Ramas locales y remotas del repo. */
  listarRamas(repo?: string): Promise<Rama[]> {
    return this.historial.listarRamas(repo)
  }

  /** Archivos tocados por un commit, con rutas relativas a la contenedora. */
  obtenerArchivosCommit(hash: string, repo?: string): Promise<CambioArchivo[]> {
    return this.historial.obtenerArchivosCommit(hash, repo)
  }

  /** Commits que tocaron un archivo, cruzando renames. */
  leerHistorialArchivo(relPosix: string, repo?: string): Promise<ResultadoHistorialArchivo> {
    return this.historial.leerHistorialArchivo(relPosix, repo)
  }

  /** Contenido de un archivo en un commit. */
  leerBlobEnCommit(hash: string, relPosix: string, repo?: string): Promise<ResultadoBlob> {
    return this.blobs.leerBlobEnCommit(hash, relPosix, repo)
  }

  /** Bytes de un lado del diff (commit, índice o disco). */
  blobBytes(req: PeticionBytesBlob): Promise<ResultadoBytesBlob> {
    return this.blobs.blobBytes(req)
  }

  /** Bytes de varios lados del diff, con un `cat-file --batch` por repo. */
  blobsBytesLote(reqs: readonly PeticionBytesBlob[], maxBytes?: number): Promise<ResultadoBytesBlob[]> {
    return this.blobs.blobsBytesLote(reqs, maxBytes)
  }

  /** Primer padre de un commit. */
  obtenerPrimerPadre(hash: string, repo?: string): Promise<ResultadoPrimerPadre> {
    return this.historial.obtenerPrimerPadre(hash, repo)
  }

  /** Cambios del working-tree de un repo. */
  leerEstadoWorktree(repo?: string): Promise<CambioWorktree[]> {
    return this.estado.leerEstadoWorktree(repo)
  }

  /** Rama y cambios de varios repos, con avisos parciales por `STATUS_PARCIAL`. */
  leerEstadoRepos(repos: string[], prioritarios?: readonly string[], gen?: number): Promise<EstadoRepo[]> {
    return this.estado.leerEstadoRepos(repos, prioritarios, gen)
  }

  /** Contenido actual en disco de un archivo del working-tree. */
  leerBlobWorktree(relPosix: string): Promise<ResultadoBlob> {
    return this.blobs.leerBlobWorktree(relPosix)
  }

  /** Descarta los cambios de un archivo, con confirmación (revertir a HEAD o borrar del disco). */
  descartarCambios(relPosix: string): Promise<ResultadoDescarteCambios> {
    return this.descartes.descartarCambios(relPosix)
  }

  /** Prepara un archivo (stage). */
  prepararArchivo(relPosix: string): Promise<ResultadoEscrituraGit> {
    return this.preparar.prepararArchivo(relPosix)
  }

  /** Quita un archivo del índice, sin tocar el disco. */
  quitarArchivoDelIndice(relPosix: string): Promise<ResultadoEscrituraGit> {
    return this.preparar.quitarArchivoDelIndice(relPosix)
  }

  /** Prepara varios archivos. */
  prepararArchivos(rutas: readonly string[]): Promise<ResultadoArchivo[]> {
    return this.preparar.prepararArchivos(rutas)
  }

  /** Quita varios archivos del índice. */
  quitarArchivosDelIndice(rutas: readonly string[]): Promise<ResultadoArchivo[]> {
    return this.preparar.quitarArchivosDelIndice(rutas)
  }

  /** Descarta varios archivos con UNA confirmación. */
  descartarCambiosVarios(rutas: readonly string[]): Promise<ResultadoDescarte[]> {
    return this.descartes.descartarCambiosVarios(rutas)
  }

  /** Añade patrones al `.gitignore` de la raíz del repo. */
  ignorarEnGitignore(rutas: readonly string[]): Promise<ResultadoIgnorar> {
    return this.ignorar.ignorarEnGitignore(rutas)
  }

  /** Añade patrones a `.git/info/exclude` (solo esta máquina). */
  ignorarEnExclusionLocal(rutas: readonly string[]): Promise<ResultadoIgnorar> {
    return this.ignorar.ignorarEnExclusionLocal(rutas)
  }

  /** Crea un commit con lo preparado. */
  commit(mensaje: string, repo?: string): Promise<ResultadoCommit> {
    return this.preparar.commit(mensaje, repo)
  }

  /** Contenido de un archivo en el índice (versión preparada). */
  leerBlobIndice(relPosix: string): Promise<ResultadoBlob> {
    return this.blobs.leerBlobIndice(relPosix)
  }
}
