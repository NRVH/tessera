// =============================================================================
// Preload: git de cada proyecto (estado, historial, diff, preparar y descartar). Cada llamada lleva
// primero la contenedora de su proyecto (`raiz`, ver `PeticionGit`); las rutas, relativas a ella.
// El estado parcial de los repos llega por suscripción. Canales y formas: src/shared/git-ipc.ts.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  GIT_CHANNELS,
  type PeticionGit,
  type PeticionListaCommits,
  type PeticionListaRamas,
  type PeticionArchivosCommit,
  type PeticionHistorialArchivo,
  type PeticionBlobEnCommit,
  type PeticionPrimerPadre,
  type PeticionEstadoRepos,
  type PeticionBlobWorktree,
  type PeticionDescarteCambios,
  type PeticionPrepararArchivo,
  type PeticionQuitarArchivoDelIndice,
  type PeticionRutasGit,
  type PeticionIgnorar,
  type PeticionCommit,
  type PeticionBlobIndice,
  type PeticionDetalleCommit,
  type PeticionRamasQueContienen,
  type PeticionCommitsRamaActual,
  type ResultadoBlob,
  type PeticionBytesBlob,
  type ResultadoBytesBlob,
  type Rama,
  type Commit,
  type ResultadoDescarteCambios,
  type ResultadoArchivo,
  type ResultadoDescarte,
  type ResultadoIgnorar,
  type CambioArchivo,
  type ResultadoHistorialArchivo,
  type ResultadoPrimerPadre,
  type EstadoRepo,
  type EstadoRepoParcial,
  type CambioWorktree,
  type ResultadoEscrituraGit,
  type ResultadoCommit,
  type ResolucionHooks,
  type HooksPendientes,
  type DatosDetalleCommit,
  type ResultadoCommitsRamaActual
} from '../shared/git-ipc'

/**
 * API de git expuesta al renderer. `raiz` es la contenedora del proyecto al que pertenece la
 * llamada (nunca la del proyecto activo: la del componente que la hace); las rutas son RELATIVAS a
 * ella (POSIX), igual que en ApiArchivos.
 */
export interface ApiGit {
  alPedirPermisoHooks: (cb: (pendiente: HooksPendientes) => void) => () => void
  resolverPermisoHooks: (ficha: string, decision?: ResolucionHooks['decision']) => void
  /**
   * Historia de commits del proyecto. Sin `branch`: todas las ramas (como
   * siempre); con `branch`: acotada a esa rama. `limit` acota el número de commits
   * (git --max-count); undefined/0 -> historial completo.
   */
  listarCommits: (raiz: string, rama?: string, limite?: number, repo?: string) => Promise<Commit[]>
  /** Ramas locales del repo, para el selector del grafo. */
  listarRamas: (raiz: string, repo?: string) => Promise<Rama[]>
  /** Archivos tocados por un commit. */
  obtenerArchivosCommit: (raiz: string, hash: string, repo?: string) => Promise<CambioArchivo[]>
  /** Commits que tocaron un archivo, cruzando renames. */
  leerHistorialArchivo: (raiz: string, ruta: string, repo?: string) => Promise<ResultadoHistorialArchivo>
  /** Contenido de un archivo en un commit dado. */
  leerBlobEnCommit: (raiz: string, hash: string, ruta: string, repo?: string) => Promise<ResultadoBlob>
  /** Bytes crudos de un lado del diff (commit/índice/disco), para los visores binarios. */
  blobBytes: (raiz: string, req: PeticionBytesBlob) => Promise<ResultadoBytesBlob>
  /** Primer padre (DAG real) de un commit; hashPadre null si es raíz. */
  obtenerPrimerPadre: (raiz: string, hash: string, repo?: string) => Promise<ResultadoPrimerPadre>
  /** Cambios del working-tree del repo de la contenedora: staged, unstaged, untracked, renames y conflictos, con ambos ejes (index/worktree) por archivo. */
  leerEstadoWorktree: (raiz: string) => Promise<CambioWorktree[]>
  /**
   * Rama + cambios de VARIOS repos de la contenedora, en una sola llamada. `prioritarios` son los
   * que se están VIENDO (se atienden primero) y `gen` marca la petición para poder tirar los
   * goteos de una anterior. Ambos opcionales: sin ellos se comporta como siempre.
   */
  leerEstadoRepos: (raiz: string, repos: string[], prioritarios?: string[], gen?: number) => Promise<EstadoRepo[]>
  /**
   * Escucha el goteo: un repo que ya tiene su estado mientras los demás siguen en
   * camino. Devuelve la baja, como el resto de `onX` de este puente.
   */
  alRecibirEstadoParcial: (cb: (p: EstadoRepoParcial) => void) => () => void
  /** Contenido ACTUAL en disco de un archivo del working-tree (lado "after" del diff working-vs-HEAD). */
  leerBlobWorktree: (raiz: string, ruta: string) => Promise<ResultadoBlob>
  /** Descarta los cambios locales del working-tree de un archivo (revierte trackeado; borra untracked con confirmación). */
  descartarCambios: (raiz: string, ruta: string) => Promise<ResultadoDescarteCambios>
  /** Añade un archivo al índice (stage). */
  prepararArchivo: (raiz: string, ruta: string) => Promise<ResultadoEscrituraGit>
  /** Quita un archivo del índice (unstage). */
  quitarArchivoDelIndice: (raiz: string, ruta: string) => Promise<ResultadoEscrituraGit>
  /** Prepara VARIOS archivos de una vez (un proceso de git por repo). */
  prepararArchivos: (raiz: string, rutas: string[]) => Promise<ResultadoArchivo[]>
  /** Quita VARIOS archivos del índice de una vez. */
  quitarArchivosDelIndice: (raiz: string, rutas: string[]) => Promise<ResultadoArchivo[]>
  /** Descarta VARIOS archivos con UNA sola confirmación. */
  descartarCambiosVarios: (raiz: string, rutas: string[]) => Promise<ResultadoDescarte[]>
  /**
   * Añade patrones al .gitignore de la raíz del repo (se commitea). Solo las
   * rutas: si una carpeta está entera lo decide el main preguntándoselo a git —
   * el renderer no conoce los archivos que git ya rastrea (ver PeticionIgnorar).
   */
  ignorarEnGitignore: (raiz: string, rutas: string[]) => Promise<ResultadoIgnorar>
  /** Añade patrones a .git/info/exclude (local: nunca se sube). */
  ignorarEnExclusionLocal: (raiz: string, rutas: string[]) => Promise<ResultadoIgnorar>
  /** Crea un commit con lo staged. `repo` = en cuál (omitido: el de la contenedora). */
  commit: (raiz: string, mensaje: string, repo?: string, resolucionHooks?: ResolucionHooks) => Promise<ResultadoCommit>
  /** Contenido de un archivo en el índice (versión staged). */
  leerBlobIndice: (raiz: string, ruta: string) => Promise<ResultadoBlob>
  /** Detalle completo de un commit (cuerpo del mensaje + committer); null si no existe. */
  leerDetalleCommit: (raiz: string, hash: string, repo?: string) => Promise<DatosDetalleCommit | null>
  /** Ramas (locales y remotas) que contienen un commit, por nombre corto. */
  obtenerRamasQueContienen: (raiz: string, hash: string, repo?: string) => Promise<string[]>
  /**
   * Hashes alcanzables desde HEAD: los commits que el log tiñe como "de tu rama".
   *
   * `hashes` acota la pregunta a los commits CARGADOS y la respuesta a su
   * subconjunto: sin él viaja la historia entera del repo. Ver el request.
   */
  commitsRamaActual: (raiz: string, repo?: string, hashes?: readonly string[]) => Promise<ResultadoCommitsRamaActual>
}

const oyentesHooks = new Set<(pendiente: HooksPendientes) => void>()
const permisosHooks = new Map<string, (decision?: ResolucionHooks['decision']) => void>()

async function invocarEscritura<R extends PeticionGit>(canal: string, peticion: R, cancelado: unknown): Promise<unknown> {
  let resolucionHooks: ResolucionHooks | undefined
  for (;;) {
    const resultado = await ipcRenderer.invoke(canal, { ...peticion, resolucionHooks } satisfies PeticionGit)
    const pendiente: HooksPendientes | undefined = resultado?.pendienteHooks
    if (!pendiente) return resultado
    if (!oyentesHooks.size) return cancelado
    const decision = await new Promise<ResolucionHooks['decision'] | undefined>((resolver) => {
      permisosHooks.set(pendiente.ficha, resolver)
      for (const oyente of oyentesHooks) oyente(pendiente)
    })
    permisosHooks.delete(pendiente.ficha)
    if (!decision) return cancelado
    resolucionHooks = { ficha: pendiente.ficha, decision }
  }
}

export const git: ApiGit = {
  alPedirPermisoHooks: (cb) => {
    oyentesHooks.add(cb)
    return () => { oyentesHooks.delete(cb); if (!oyentesHooks.size) for (const resolver of permisosHooks.values()) resolver() }
  },
  resolverPermisoHooks: (ficha, decision) => permisosHooks.get(ficha)?.(decision),
  listarCommits: (raiz, rama, limite, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.LIST_COMMITS, { raiz, rama, limite, repo } satisfies PeticionGit<PeticionListaCommits>),
  listarRamas: (raiz, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.LIST_BRANCHES, { raiz, repo } satisfies PeticionGit<PeticionListaRamas>),
  obtenerArchivosCommit: (raiz, hash, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.FILES_FOR_COMMIT, { raiz, hash, repo } satisfies PeticionGit<PeticionArchivosCommit>),
  leerHistorialArchivo: (raiz, ruta, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.FILE_HISTORY, { raiz, ruta, repo } satisfies PeticionGit<PeticionHistorialArchivo>),
  leerBlobEnCommit: (raiz, hash, ruta, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.BLOB_AT_COMMIT, { raiz, hash, ruta, repo } satisfies PeticionGit<PeticionBlobEnCommit>),
  blobBytes: (raiz, req) =>
    ipcRenderer.invoke(GIT_CHANNELS.BLOB_BYTES, { ...req, raiz } satisfies PeticionGit<PeticionBytesBlob>),
  obtenerPrimerPadre: (raiz, hash, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.PARENT_OF, { raiz, hash, repo } satisfies PeticionGit<PeticionPrimerPadre>),
  leerEstadoWorktree: (raiz) => ipcRenderer.invoke(GIT_CHANNELS.WORKING_STATUS, { raiz } satisfies PeticionGit),
  leerEstadoRepos: (raiz, repos, prioritarios, gen) =>
    ipcRenderer.invoke(GIT_CHANNELS.MULTI_STATUS, { raiz, repos, prioritarios, gen } satisfies PeticionGit<PeticionEstadoRepos>),
  alRecibirEstadoParcial: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, p: EstadoRepoParcial): void => cb(p)
    ipcRenderer.on(GIT_CHANNELS.STATUS_PARCIAL, h)
    return () => ipcRenderer.removeListener(GIT_CHANNELS.STATUS_PARCIAL, h)
  },
  leerBlobWorktree: (raiz, ruta) =>
    ipcRenderer.invoke(GIT_CHANNELS.WORKING_BLOB, { raiz, ruta } satisfies PeticionGit<PeticionBlobWorktree>),
  descartarCambios: (raiz, ruta) => invocarEscritura(GIT_CHANNELS.DISCARD_CHANGES, { raiz, ruta } satisfies PeticionGit<PeticionDescarteCambios>, { ok: false }) as Promise<ResultadoDescarteCambios>,
  prepararArchivo: (raiz, ruta) => invocarEscritura(GIT_CHANNELS.STAGE_FILE, { raiz, ruta } satisfies PeticionGit<PeticionPrepararArchivo>, { ok: false }) as Promise<ResultadoEscrituraGit>,
  quitarArchivoDelIndice: (raiz, ruta) => invocarEscritura(GIT_CHANNELS.UNSTAGE_FILE, { raiz, ruta } satisfies PeticionGit<PeticionQuitarArchivoDelIndice>, { ok: false }) as Promise<ResultadoEscrituraGit>,
  prepararArchivos: (raiz, rutas) => invocarEscritura(GIT_CHANNELS.STAGE_FILES, { raiz, rutas } satisfies PeticionGit<PeticionRutasGit>, []) as Promise<ResultadoArchivo[]>,
  quitarArchivosDelIndice: (raiz, rutas) => invocarEscritura(GIT_CHANNELS.UNSTAGE_FILES, { raiz, rutas } satisfies PeticionGit<PeticionRutasGit>, []) as Promise<ResultadoArchivo[]>,
  descartarCambiosVarios: (raiz, rutas) => invocarEscritura(GIT_CHANNELS.DISCARD_CHANGES_MANY, { raiz, rutas } satisfies PeticionGit<PeticionRutasGit>, []) as Promise<ResultadoDescarte[]>,
  ignorarEnGitignore: (raiz, rutas) => invocarEscritura(GIT_CHANNELS.IGNORAR_GITIGNORE, { raiz, rutas } satisfies PeticionGit<PeticionIgnorar>, { patrones: [], ignorados: [], omitidos: [] }) as Promise<ResultadoIgnorar>,
  ignorarEnExclusionLocal: (raiz, rutas) =>
    invocarEscritura(GIT_CHANNELS.IGNORAR_EXCLUDE_LOCAL, { raiz, rutas } satisfies PeticionGit<PeticionIgnorar>, { patrones: [], ignorados: [], omitidos: [] }) as Promise<ResultadoIgnorar>,
  commit: (raiz, mensaje, repo, resolucionHooks) => ipcRenderer.invoke(GIT_CHANNELS.COMMIT, { raiz, mensaje, repo, resolucionHooks } satisfies PeticionGit<PeticionCommit>),
  leerBlobIndice: (raiz, ruta) =>
    ipcRenderer.invoke(GIT_CHANNELS.INDEX_BLOB, { raiz, ruta } satisfies PeticionGit<PeticionBlobIndice>),
  leerDetalleCommit: (raiz, hash, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.COMMIT_DETAIL, { raiz, hash, repo } satisfies PeticionGit<PeticionDetalleCommit>),
  obtenerRamasQueContienen: (raiz, hash, repo) =>
    ipcRenderer.invoke(GIT_CHANNELS.BRANCHES_CONTAINING, { raiz, hash, repo } satisfies PeticionGit<PeticionRamasQueContienen>),
  commitsRamaActual: (raiz, repo, hashes) =>
    ipcRenderer.invoke(GIT_CHANNELS.COMMITS_RAMA_ACTUAL, { raiz, repo, hashes } satisfies PeticionGit<PeticionCommitsRamaActual>)
}
