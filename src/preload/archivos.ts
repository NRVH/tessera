// =============================================================================
// Preload: archivos del proyecto activo, portapapeles, búsqueda, Java y comprimidos.
// Rutas relativas a la contenedora, que viaja con ellas solo como identidad del proyecto.
// Canales y formas: files-ipc, clipboard-ipc, search-ipc, java-ipc y comprimidos-ipc.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  FILE_CHANNELS,
  type BinaryFileContent,
  type CreatedEntry,
  type CreateEntryRequest,
  type DeleteRequest,
  type DeleteResult,
  type DocxHtmlResult,
  type FileContent,
  type FileEntry,
  type FilesChangedEvent,
  type ImportRequest,
  type ImportResult,
  type MoveRequest,
  type MoveResult,
  type PasteRequest,
  type PasteResult,
  type ProjectRoot,
  type RenameRequest,
  type RutaEnProyecto,
  type RutasRequest,
  type SaveUntitledResult,
  type StartDragRequest,
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
import { CLIPBOARD_CHANNELS, type ClipboardPasteRequest, type ClipboardProbe } from '../shared/clipboard-ipc'

/**
 * API de archivos expuesta al renderer. Todas las rutas son RELATIVAS al
 * proyecto (POSIX, "" = raíz) y van con la contenedora de su proyecto (`raiz`):
 * el main las resuelve contra ese proyecto (`EnProyecto` de files-ipc).
 */
export interface FilesApi {
  /** Metadatos del proyecto activo (nombre neutro). */
  getRoot: () => Promise<ProjectRoot>
  /** Lista una carpeta del proyecto (lazy). "" = raíz. */
  listDir: (ruta: RutaEnProyecto) => Promise<FileEntry[]>
  /** Lee un archivo de texto para el editor. */
  read: (ruta: RutaEnProyecto, encoding?: string) => Promise<FileContent>
  /**
   * ¿Sigue existiendo? Es la pregunta del editor cuando tiene el buffer SUCIO y no
   * puede releer sin destruir las ediciones, pero necesita saber si tachar la
   * pestaña. Una entrada de .jar responde por su contenedor.
   */
  existe: (ruta: RutaEnProyecto) => Promise<boolean>
  /** Escribe (sobrescribe) un archivo de texto. Devuelve bytes escritos. */
  write: (ruta: RutaEnProyecto, content: string, encoding?: string) => Promise<WriteFileResult>
  /**
   * Guarda un buffer SIN TÍTULO (Ctrl+N): la primera vez abre el diálogo nativo
   * de Windows para elegir destino; después reescribe en el mismo sitio. `id` es
   * el id opaco de la pestaña (el main recuerda la ruta por él).
   */
  saveUntitled: (id: string, content: string, suggestedName: string) => Promise<SaveUntitledResult>
  /** Suelta la ruta recordada de un buffer sin título (al cerrar su pestaña). */
  forgetUntitled: (id: string) => Promise<void>
  /** Lee un archivo como bytes crudos (visor PDF). */
  readBinary: (ruta: RutaEnProyecto) => Promise<BinaryFileContent>
  /** Convierte un .docx a HTML con formato (mammoth, en el main). */
  readDocx: (ruta: RutaEnProyecto) => Promise<DocxHtmlResult>
  /** Lista el contenido de un .zip sin descomprimirlo. */
  readZip: (ruta: RutaEnProyecto) => Promise<ZipListing>
  /** Abre el archivo/carpeta en el explorador del SO, dejándolo seleccionado. */
  reveal: (ruta: RutaEnProyecto) => Promise<void>
  /** Abre el archivo con la app por defecto del SO (Word, etc.). Devuelve error o ''. */
  openPath: (ruta: RutaEnProyecto) => Promise<string>
  /** Crea un archivo vacío `name` dentro de `dir`. Devuelve su ruta relativa. */
  createFile: (req: CreateEntryRequest) => Promise<CreatedEntry>
  /** Crea una carpeta `name` dentro de `dir`. Devuelve su ruta relativa. */
  createDir: (req: CreateEntryRequest) => Promise<CreatedEntry>
  /** Renombra `path` a `newName` (mismo padre). Devuelve la nueva ruta relativa. */
  rename: (req: RenameRequest) => Promise<CreatedEntry>
  /**
   * Mueve `srcs` dentro de la carpeta `destDir` (arrastrar y soltar en el árbol).
   * TODO O NADA: si algún nombre ya existe en el destino no mueve nada y lo devuelve
   * en `conflicts`. A diferencia de `import`, no hay forma de reemplazar: el original
   * de un movimiento interno no queda en ninguna otra parte.
   */
  move: (req: MoveRequest) => Promise<MoveResult>
  /**
   * Trae dentro de `destDir` archivos/carpetas soltados (rutas de `getPathForFile`):
   * COPIA los de fuera del proyecto, MUEVE los de dentro. Sin `overwrite`, si algún
   * nombre ya existe no toca nada y lo devuelve en `conflicts` para confirmar.
   */
  import: (req: ImportRequest) => Promise<ImportResult>
  /**
   * PEGA en `destDir` lo copiado/cortado (menú contextual y Ctrl+V). A diferencia de
   * `import`, nunca pisa ni pregunta: renombra a "x - copia" si el nombre ya existe.
   */
  paste: (req: PasteRequest) => Promise<PasteResult>
  /**
   * URL `file://` de un ARCHIVO del proyecto ('' si es carpeta o no existe). Solo
   * para el `DownloadURL` del arrastre hacia el Explorador de Windows.
   */
  fileUrl: (ruta: RutaEnProyecto) => Promise<string>
  /**
   * Arranca un arrastre NATIVO con VARIOS archivos, que es la única forma de
   * entregar más de uno al gestor de archivos del sistema. `icono` es el fantasma
   * ya rasterizado (`data:image/png;base64,…`); ver `START_DRAG`.
   */
  startDrag: (req: StartDragRequest) => Promise<void>
  /**
   * Rutas ABSOLUTAS del host (cada una '' si no es válida), en el mismo orden. Solo
   * para el "Copiar ruta" del menú contextual y la marca del portapapeles interno:
   * es una salida hacia el portapapeles, no una entrada. Plural para que copiar una
   * selección grande sea UN viaje al main y no uno por fichero.
   */
  absPath: (req: RutasRequest) => Promise<string[]>
  /**
   * Elimina archivos/carpetas (recursivo). Best-effort: lo que no se pudo borrar
   * vuelve en `fallidos` con su nombre, en vez de abortar el resto.
   */
  delete: (req: DeleteRequest) => Promise<DeleteResult>
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
  pasteInto: (req: ClipboardPasteRequest) => Promise<PasteResult>
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

/** Diff de archivos comprimidos (.jar/.war/.ear/.zip) entre dos revisiones; cada petición lleva su `raiz`. */
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
  listDir: ({ raiz, path }) => ipcRenderer.invoke(FILE_CHANNELS.LIST_DIR, { raiz, path }),
  read: ({ raiz, path }, encoding) => ipcRenderer.invoke(FILE_CHANNELS.READ_FILE, { raiz, path, encoding }),
  existe: ({ raiz, path }) => ipcRenderer.invoke(FILE_CHANNELS.EXISTS, { raiz, path }),
  write: ({ raiz, path }, content, encoding) =>
    ipcRenderer.invoke(FILE_CHANNELS.WRITE_FILE, { raiz, path, content, encoding }),
  saveUntitled: (id, content, suggestedName) =>
    ipcRenderer.invoke(FILE_CHANNELS.SAVE_UNTITLED, { id, content, suggestedName }),
  forgetUntitled: (id) => ipcRenderer.invoke(FILE_CHANNELS.FORGET_UNTITLED, id),
  readBinary: ({ raiz, path }) => ipcRenderer.invoke(FILE_CHANNELS.READ_BINARY, { raiz, path }),
  readDocx: ({ raiz, path }) => ipcRenderer.invoke(FILE_CHANNELS.READ_DOCX, { raiz, path }),
  readZip: ({ raiz, path }) => ipcRenderer.invoke(FILE_CHANNELS.READ_ZIP, { raiz, path }),
  reveal: ({ raiz, path }) => ipcRenderer.invoke(FILE_CHANNELS.REVEAL_IN_FOLDER, { raiz, path }),
  openPath: ({ raiz, path }) => ipcRenderer.invoke(FILE_CHANNELS.OPEN_PATH, { raiz, path }),
  createFile: (req) => ipcRenderer.invoke(FILE_CHANNELS.CREATE_FILE, req),
  createDir: (req) => ipcRenderer.invoke(FILE_CHANNELS.CREATE_DIR, req),
  rename: (req) => ipcRenderer.invoke(FILE_CHANNELS.RENAME, req),
  move: (req) => ipcRenderer.invoke(FILE_CHANNELS.MOVE, req),
  import: (req) => ipcRenderer.invoke(FILE_CHANNELS.IMPORT, req),
  paste: (req) => ipcRenderer.invoke(FILE_CHANNELS.PASTE, req),
  fileUrl: ({ raiz, path }) => ipcRenderer.invoke(FILE_CHANNELS.FILE_URL, { raiz, path }),
  startDrag: (req) => ipcRenderer.invoke(FILE_CHANNELS.START_DRAG, req),
  absPath: (req) => ipcRenderer.invoke(FILE_CHANNELS.ABS_PATH, req),
  delete: (req) => ipcRenderer.invoke(FILE_CHANNELS.DELETE, req),
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
  pasteInto: (req) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.PASTE_INTO, req)
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
