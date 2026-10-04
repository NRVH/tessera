// =============================================================================
// Preload: archivos del proyecto activo, portapapeles, búsqueda, Java y comprimidos.
// Solo rutas relativas a la contenedora: el renderer nunca ve rutas del host.
// Canales y formas: files-ipc, clipboard-ipc, search-ipc, java-ipc y comprimidos-ipc.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  FILE_CHANNELS,
  type BinaryFileContent,
  type CreatedEntry,
  type DeleteResult,
  type DocxHtmlResult,
  type FileContent,
  type FileEntry,
  type FilesChangedEvent,
  type ImportResult,
  type MoveResult,
  type PasteRequest,
  type PasteResult,
  type ProjectRoot,
  type SaveUntitledResult,
  type WriteFileResult,
  type ZipListing
} from '../shared/files-ipc'
import {
  JAVA_CHANNELS,
  type DescompilarRequest,
  type DescompilarResult,
  type EstadoJava
} from '../shared/java-ipc'
import {
  COMPRIMIDOS_CHANNELS,
  type CompararRequest,
  type CompararResult,
  type EntradaRequest,
  type EntradaResult
} from '../shared/comprimidos-ipc'
import {
  SEARCH_CHANNELS,
  type BusquedaAceptada,
  type CarpetasRequest,
  type CarpetasResult,
  type FinBusqueda,
  type IniciarBusqueda,
  type LoteResultados
} from '../shared/search-ipc'
import { CLIPBOARD_CHANNELS, type ClipboardProbe } from '../shared/clipboard-ipc'

/**
 * API de archivos expuesta al renderer. Todas las rutas son RELATIVAS al
 * proyecto (POSIX, "" = raíz); el main resuelve contra la ruta host real. El
 * renderer nunca ve ni envía rutas de Windows.
 */
export interface FilesApi {
  /** Metadatos del proyecto activo (nombre neutro). */
  getRoot: () => Promise<ProjectRoot>
  /** Lista una carpeta del proyecto (lazy). "" = raíz. */
  listDir: (path: string) => Promise<FileEntry[]>
  /** Lee un archivo de texto para el editor. */
  read: (path: string, encoding?: string) => Promise<FileContent>
  /**
   * ¿Sigue existiendo? Es la pregunta del editor cuando tiene el buffer SUCIO y no
   * puede releer sin destruir las ediciones, pero necesita saber si tachar la
   * pestaña. Una entrada de .jar responde por su contenedor.
   */
  existe: (path: string) => Promise<boolean>
  /** Escribe (sobrescribe) un archivo de texto. Devuelve bytes escritos. */
  write: (path: string, content: string, encoding?: string) => Promise<WriteFileResult>
  /**
   * Guarda un buffer SIN TÍTULO (Ctrl+N): la primera vez abre el diálogo nativo
   * de Windows para elegir destino; después reescribe en el mismo sitio. `id` es
   * el id opaco de la pestaña (el main recuerda la ruta por él).
   */
  saveUntitled: (id: string, content: string, suggestedName: string) => Promise<SaveUntitledResult>
  /** Suelta la ruta recordada de un buffer sin título (al cerrar su pestaña). */
  forgetUntitled: (id: string) => Promise<void>
  /** Lee un archivo como bytes crudos (visor PDF). */
  readBinary: (path: string) => Promise<BinaryFileContent>
  /** Convierte un .docx a HTML con formato (mammoth, en el main). */
  readDocx: (path: string) => Promise<DocxHtmlResult>
  /** Lista el contenido de un .zip sin descomprimirlo. */
  readZip: (path: string) => Promise<ZipListing>
  /** Abre el archivo/carpeta en el explorador del SO, dejándolo seleccionado. */
  reveal: (path: string) => Promise<void>
  /** Abre el archivo con la app por defecto del SO (Word, etc.). Devuelve error o ''. */
  openPath: (path: string) => Promise<string>
  /** Crea un archivo vacío `name` dentro de `dir`. Devuelve su ruta relativa. */
  createFile: (dir: string, name: string) => Promise<CreatedEntry>
  /** Crea una carpeta `name` dentro de `dir`. Devuelve su ruta relativa. */
  createDir: (dir: string, name: string) => Promise<CreatedEntry>
  /** Renombra `path` a `newName` (mismo padre). Devuelve la nueva ruta relativa. */
  rename: (path: string, newName: string) => Promise<CreatedEntry>
  /**
   * Mueve `srcs` dentro de la carpeta `destDir` (arrastrar y soltar en el árbol).
   * TODO O NADA: si algún nombre ya existe en el destino no mueve nada y lo devuelve
   * en `conflicts`. A diferencia de `import`, no hay forma de reemplazar: el original
   * de un movimiento interno no queda en ninguna otra parte.
   */
  move: (srcs: string[], destDir: string) => Promise<MoveResult>
  /**
   * Trae dentro de `destDir` archivos/carpetas soltados (rutas de `getPathForFile`):
   * COPIA los de fuera del proyecto, MUEVE los de dentro. Sin `overwrite`, si algún
   * nombre ya existe no toca nada y lo devuelve en `conflicts` para confirmar.
   */
  import: (hostPaths: string[], destDir: string, overwrite: boolean) => Promise<ImportResult>
  /**
   * PEGA en `destDir` lo copiado/cortado (menú contextual y Ctrl+V). A diferencia de
   * `import`, nunca pisa ni pregunta: renombra a "x - copia" si el nombre ya existe.
   */
  paste: (req: PasteRequest) => Promise<PasteResult>
  /**
   * URL `file://` de un ARCHIVO del proyecto ('' si es carpeta o no existe). Solo
   * para el `DownloadURL` del arrastre hacia el Explorador de Windows.
   */
  fileUrl: (path: string) => Promise<string>
  /**
   * Arranca un arrastre NATIVO con VARIOS archivos, que es la única forma de
   * entregar más de uno al gestor de archivos del sistema. `icono` es el fantasma
   * ya rasterizado (`data:image/png;base64,…`); ver `START_DRAG`.
   */
  startDrag: (paths: string[], icono: string) => Promise<void>
  /**
   * Rutas ABSOLUTAS del host (cada una '' si no es válida), en el mismo orden. Solo
   * para el "Copiar ruta" del menú contextual y la marca del portapapeles interno:
   * es una salida hacia el portapapeles, no una entrada. Plural para que copiar una
   * selección grande sea UN viaje al main y no uno por fichero.
   */
  absPath: (paths: string[]) => Promise<string[]>
  /**
   * Elimina archivos/carpetas (recursivo). Best-effort: lo que no se pudo borrar
   * vuelve en `fallidos` con su nombre, en vez de abortar el resto.
   */
  delete: (paths: string[]) => Promise<DeleteResult>
  /**
   * Se suscribe al evento de cambios del árbol; devuelve la función para desuscribir.
   * El evento dice QUÉ cambió (`paths`), o avisa con `parcial` de que la lista no es
   * completa. Un suscriptor al que solo le importe "algo cambió" puede ignorarlo.
   */
  onChanged: (cb: (ev: FilesChangedEvent) => void) => () => void
  /** Se suscribe a cambios de metadata git (.git refs/HEAD/index); devuelve la función para desuscribir. */
  onGitChanged: (cb: () => void) => () => void
}

/**
 * Portapapeles del sistema, servido por el MAIN (electron.clipboard) vía IPC: el
 * módulo `clipboard` no existe en un renderer sandboxed. Lo usa la terminal
 * (xterm) para copiar la selección y pegar en el pty.
 */
export interface ClipboardApi {
  /** Lee el texto del portapapeles del sistema. */
  read: () => Promise<string>
  /** Copia texto plano al portapapeles del sistema. */
  write: (text: string) => Promise<void>
  /**
   * Si el portapapeles del sistema contiene una imagen, la guarda como PNG en un
   * temporal y devuelve su ruta absoluta; null si no hay imagen. Para pegar
   * imágenes en la terminal como archivo adjunto.
   */
  saveImage: () => Promise<string | null>
  /**
   * ¿Hay algo pegable en el portapapeles (ficheros o imagen)? Barato: pensado para
   * llamarlo en cada apertura del menú contextual del explorador.
   */
  probe: () => Promise<ClipboardProbe>
  /**
   * Pega en `destDir` lo que haya en el portapapeles (ficheros del Explorador de
   * Windows, o un bitmap). El renderer solo dice DÓNDE: quién lee las rutas y si el
   * gesto fue copiar o cortar lo decide el main. CARO (~250 ms): solo al hacer clic.
   */
  pasteInto: (destDir: string) => Promise<PasteResult>
}

/**
 * Búsqueda en archivos (Ctrl+Shift+F). El ámbito es siempre el proyecto activo: no
 * se manda carpeta, igual que en el resto de `files:*`.
 *
 * El ciclo es arrancar -> N lotes -> un fin. `iniciar` cancela la búsqueda anterior
 * por sí solo, así que teclear no exige llamar a `cancelar` entre pulsación y
 * pulsación. Todo mensaje trae el `busquedaId` y el consumidor DEBE descartar los
 * que no sean del suyo: al cancelar, lo que ya estaba en la cola del IPC sigue
 * llegando, y sin ese filtro pintaría resultados de la consulta anterior.
 */
export interface SearchApi {
  /** Arranca (y cancela la anterior). Devuelve el id con el que filtrar. */
  iniciar: (req: IniciarBusqueda) => Promise<BusquedaAceptada>
  /** Para la búsqueda `busquedaId` si sigue viva (cerrar el modal). */
  cancelar: (busquedaId: number) => Promise<void>
  /** El árbol de CARPETAS de los proyectos abiertos, para el selector de ámbito. */
  carpetas: (req: CarpetasRequest) => Promise<CarpetasResult>
  /** Lotes de coincidencias. Devuelve el desuscriptor. */
  onResultados: (cb: (lote: LoteResultados) => void) => () => void
  /** Fin de la búsqueda. Llega SIEMPRE: también al cancelar y al fallar. */
  onFin: (cb: (fin: FinBusqueda) => void) => () => void
}

/** Descompilación de clases Java y estado del runtime instalado. */
export interface JavaApi {
  /** Descompila UNA clase. NUNCA rechaza por un fallo del motor: mira `estado`. */
  decompile: (req: DescompilarRequest) => Promise<DescompilarResult>
  /** JVM detectadas y motores disponibles (detección perezosa y cacheada). */
  runtimes: () => Promise<EstadoJava>
  /** Vuelve a buscar JVM (el usuario acaba de instalar un JDK). */
  redetect: () => Promise<EstadoJava>
  /** Escotilla "Elegir java.exe…": diálogo NATIVO en el main. */
  pickJava: () => Promise<EstadoJava>
  /** Olvida el java.exe elegido a mano. */
  forgetJava: () => Promise<EstadoJava>
}

/** Diff de archivos comprimidos (.jar/.war/.ear/.zip) entre dos revisiones. */
export interface ComprimidosApi {
  /** Entradas que CAMBIARON entre los dos lados. Nunca rechaza: mira `error`. */
  comparar: (req: CompararRequest) => Promise<CompararResult>
  /**
   * Contenido de UNA entrada por los dos lados, ya listo para el diff. Nunca
   * rechaza. Si vuelve con `descartado`, es que otra petición del mismo pane la
   * superó mientras tanto: se ignora, no es un error.
   */
  entrada: (req: EntradaRequest) => Promise<EntradaResult>
}

export const files: FilesApi = {
  getRoot: () => ipcRenderer.invoke(FILE_CHANNELS.GET_ROOT),
  listDir: (path) => ipcRenderer.invoke(FILE_CHANNELS.LIST_DIR, { path }),
  read: (path, encoding) => ipcRenderer.invoke(FILE_CHANNELS.READ_FILE, { path, encoding }),
  existe: (path) => ipcRenderer.invoke(FILE_CHANNELS.EXISTS, { path }),
  write: (path, content, encoding) =>
    ipcRenderer.invoke(FILE_CHANNELS.WRITE_FILE, { path, content, encoding }),
  saveUntitled: (id, content, suggestedName) =>
    ipcRenderer.invoke(FILE_CHANNELS.SAVE_UNTITLED, { id, content, suggestedName }),
  forgetUntitled: (id) => ipcRenderer.invoke(FILE_CHANNELS.FORGET_UNTITLED, id),
  readBinary: (path) => ipcRenderer.invoke(FILE_CHANNELS.READ_BINARY, { path }),
  readDocx: (path) => ipcRenderer.invoke(FILE_CHANNELS.READ_DOCX, { path }),
  readZip: (path) => ipcRenderer.invoke(FILE_CHANNELS.READ_ZIP, { path }),
  reveal: (path) => ipcRenderer.invoke(FILE_CHANNELS.REVEAL_IN_FOLDER, { path }),
  openPath: (path) => ipcRenderer.invoke(FILE_CHANNELS.OPEN_PATH, { path }),
  createFile: (dir, name) => ipcRenderer.invoke(FILE_CHANNELS.CREATE_FILE, { dir, name }),
  createDir: (dir, name) => ipcRenderer.invoke(FILE_CHANNELS.CREATE_DIR, { dir, name }),
  rename: (path, newName) => ipcRenderer.invoke(FILE_CHANNELS.RENAME, { path, newName }),
  move: (srcs, destDir) => ipcRenderer.invoke(FILE_CHANNELS.MOVE, { srcs, destDir }),
  import: (hostPaths, destDir, overwrite) =>
    ipcRenderer.invoke(FILE_CHANNELS.IMPORT, { hostPaths, destDir, overwrite }),
  paste: (req) => ipcRenderer.invoke(FILE_CHANNELS.PASTE, req),
  fileUrl: (path) => ipcRenderer.invoke(FILE_CHANNELS.FILE_URL, { path }),
  startDrag: (paths, icono) => ipcRenderer.invoke(FILE_CHANNELS.START_DRAG, { paths, icono }),
  absPath: (paths) => ipcRenderer.invoke(FILE_CHANNELS.ABS_PATH, { paths }),
  delete: (paths) => ipcRenderer.invoke(FILE_CHANNELS.DELETE, { paths }),
  onChanged: (cb) => {
    // El payload puede faltar (un main anterior a este contrato, o un send suelto):
    // se normaliza aquí a la forma completa para que el renderer no tenga que
    // defenderse en cada consumidor. Sin rutas, `parcial` dice la verdad: no se sabe
    // qué cambió.
    const listener = (_e: Electron.IpcRendererEvent, ev?: FilesChangedEvent): void =>
      cb({ paths: ev?.paths ?? [], parcial: ev?.parcial ?? true })
    ipcRenderer.on(FILE_CHANNELS.CHANGED, listener)
    return () => ipcRenderer.removeListener(FILE_CHANNELS.CHANGED, listener)
  },
  onGitChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(FILE_CHANNELS.GIT_CHANGED, listener)
    return () => ipcRenderer.removeListener(FILE_CHANNELS.GIT_CHANGED, listener)
  }
}

export const clipboard: ClipboardApi = {
  read: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.READ),
  write: (text) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.WRITE, { text }),
  saveImage: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.SAVE_IMAGE),
  probe: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.PROBE),
  pasteInto: (destDir) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.PASTE_INTO, { destDir })
}

export const java: JavaApi = {
  decompile: (req) => ipcRenderer.invoke(JAVA_CHANNELS.DECOMPILE, req),
  runtimes: () => ipcRenderer.invoke(JAVA_CHANNELS.RUNTIMES),
  redetect: () => ipcRenderer.invoke(JAVA_CHANNELS.REDETECT),
  pickJava: () => ipcRenderer.invoke(JAVA_CHANNELS.PICK_JAVA),
  forgetJava: () => ipcRenderer.invoke(JAVA_CHANNELS.FORGET_JAVA)
}

export const comprimidos: ComprimidosApi = {
  comparar: (req) => ipcRenderer.invoke(COMPRIMIDOS_CHANNELS.COMPARAR, req),
  entrada: (req) => ipcRenderer.invoke(COMPRIMIDOS_CHANNELS.ENTRADA, req)
}

export const search: SearchApi = {
  iniciar: (req) => ipcRenderer.invoke(SEARCH_CHANNELS.START, req),
  cancelar: (busquedaId) => ipcRenderer.invoke(SEARCH_CHANNELS.CANCEL, { busquedaId }),
  carpetas: (req) => ipcRenderer.invoke(SEARCH_CHANNELS.CARPETAS, req),
  onResultados: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, lote: LoteResultados): void => cb(lote)
    ipcRenderer.on(SEARCH_CHANNELS.RESULTS, listener)
    return () => ipcRenderer.removeListener(SEARCH_CHANNELS.RESULTS, listener)
  },
  onFin: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, fin: FinBusqueda): void => cb(fin)
    ipcRenderer.on(SEARCH_CHANNELS.DONE, listener)
    return () => ipcRenderer.removeListener(SEARCH_CHANNELS.DONE, listener)
  }
}
