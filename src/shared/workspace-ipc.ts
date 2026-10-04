// =============================================================================
// Contrato IPC de workspace: diálogo de carpeta, repo activo de git, raíz del explorador y
// escaneo de repos (todo invoke, renderer -> main).
// La ruta host que devuelve el diálogo es un identificador OPACO: el renderer la reenvía
// y enseña `name`, nunca la ruta.
// Archivos y repo activo van desacoplados: SET_FILES_ROOT ancla el explorador a la
// contenedora y SET_ACTIVE_PROJECT re-apunta solo GitService; por eso son dos canales.
// =============================================================================

export const WORKSPACE_CHANNELS = {
  /** invoke: abre el diálogo nativo "elegir carpeta". Sin argumentos. -> OpenProjectResult. */
  OPEN_PROJECT_DIALOG: 'workspace:openProjectDialog',
  /**
   * invoke: cambia el REPO ACTIVO de la vista de GIT. Re-apunta SOLO GitService a
   * la carpeta host indicada (el `repoHostPath` del repo activo, o el contenedor
   * cuando aún no hay repo). NO toca FileService: el explorador se ancla aparte por
   * SET_FILES_ROOT. Toma SetActiveProjectRequest -> SetActiveProjectResult.
   */
  SET_ACTIVE_PROJECT: 'workspace:setActiveProject',
  /**
   * invoke: ancla el EXPLORADOR (FileService) a la carpeta CONTENEDORA de la
   * pestaña activa. Independiente del repo activo: solo cambia al abrir/activar otra
   * pestaña, nunca al cambiar de repo dentro de la misma. Toma SetFilesRootRequest
   * -> SetFilesRootResult.
   */
  SET_FILES_ROOT: 'workspace:setFilesRoot',
  /**
   * invoke: escanea una carpeta host abierta en busca de repos git de primer
   * nivel (la raíz + subcarpetas directas). NO activa nada; activar un repo
   * detectado es un SET_ACTIVE_PROJECT posterior con su `repoHostPath`. Toma
   * ScanReposRequest -> ScanReposResult.
   */
  SCAN_REPOS: 'workspace:scanRepos'
} as const

/** Resultado de invocar el diálogo nativo de "abrir proyecto". */
export interface OpenProjectResult {
  /** true si el usuario cerró el diálogo sin elegir carpeta. */
  canceled: boolean
  /**
   * Ruta HOST (Windows) absoluta de la carpeta elegida. Vive solo en el main:
   * el renderer la trata como un identificador opaco para pedir abrir ese
   * proyecto más adelante, pero nunca la muestra ni la interpreta. Ausente
   * si `canceled` es true.
   */
  projectHostPath?: string
  /** Basename de la carpeta elegida; nombre neutro para el tab. Ausente si `canceled`. */
  name?: string
}

/**
 * Petición para cambiar el REPO ACTIVO de git. Hay UNA sola vista de git a la vez;
 * esto re-apunta GitService a otra carpeta host (el `repoHostPath` del repo activo)
 * sin tocar su contrato (git-ipc) ni el explorador (que se ancla por SET_FILES_ROOT).
 */
export interface SetActiveProjectRequest {
  /**
   * Ruta HOST (Windows) absoluta del repo que pasa a ser el activo de git. Es la
   * misma ruta opaca que el renderer ya posee: el `repoHostPath` de un repo
   * detectado por `SCAN_REPOS`, o el `projectHostPath` del contenedor cuando aún
   * no hay repo. El renderer no la interpreta ni la muestra; solo la reenvía tal
   * cual. (El nombre del campo se conserva por compatibilidad del contrato.)
   */
  projectHostPath: string
}

/** Resultado de cambiar el repo activo de git. */
export interface SetActiveProjectResult {
  /**
   * Basename neutro del repo ahora activo. Sirve al renderer para confirmar el
   * cambio; nunca se expone la ruta host completa.
   */
  name: string
}

/**
 * Petición para anclar el EXPLORADOR a la carpeta contenedora de la pestaña. Es la
 * ruta opaca del contenedor (la que devolvió `OPEN_PROJECT_DIALOG` o el bootstrap),
 * nunca un `repoHostPath` de un repo interno: el explorador muestra la contenedora
 * completa (repos hermanos navegables), independiente del repo activo de git.
 */
export interface SetFilesRootRequest {
  /** Ruta HOST absoluta de la carpeta CONTENEDORA a la que anclar el explorador. */
  projectHostPath: string
}

/** Resultado de anclar el explorador a una contenedora. */
export interface SetFilesRootResult {
  /** Basename neutro de la contenedora ahora anclada. El renderer no ve la ruta. */
  name: string
}

/** Petición para escanear una carpeta host abierta en busca de repos git. */
export interface ScanReposRequest {
  /**
   * Ruta HOST absoluta de la carpeta a escanear. La misma ruta opaca que el
   * renderer ya posee (de `OPEN_PROJECT_DIALOG` o del bootstrap); no se
   * interpreta ni se muestra, solo se reenvía.
   */
  projectHostPath: string
}

/**
 * Un repo git detectado dentro de una carpeta host escaneada. Es el shape
 * canónico compartido por el contrato IPC y el detector (`scanRepos` en el
 * main); no lo redefinas en otro lugar.
 */
export interface DetectedRepo {
  /** Basename neutro del repo, para mostrar. NO garantizado único: usar `repoHostPath` como key. */
  name: string
  /**
   * Ruta host absoluta de la raíz del repo. OPACA: identificador para activar
   * este repo vía `SET_ACTIVE_PROJECT` (`setActiveProject(repoHostPath)`);
   * el renderer nunca la interpreta ni la muestra.
   */
  repoHostPath: string
  /**
   * `true` si este repo ES la propia carpeta abierta (`projectHostPath` de la
   * petición); `false` si es una subcarpeta directa. Distingue el repo
   * "contenedor" de sus hijos sin re-derivarlo de las rutas.
   */
  isRoot: boolean
}

/**
 * Resultado de escanear una carpeta host. `repos` puede ser una lista VACÍA:
 * es un estado válido (la carpeta abierta no contiene ningún repo git).
 */
export interface ScanReposResult {
  repos: DetectedRepo[]
}
