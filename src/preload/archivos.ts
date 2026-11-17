// =============================================================================
// Preload: archivos del proyecto activo, portapapeles, búsqueda, Java y comprimidos.
// Rutas relativas a la contenedora, que viaja con ellas solo como identidad del proyecto.
// Canales y formas: archivos-ipc, clipboard-ipc, busqueda-ipc, java-ipc y comprimidos-ipc.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  FILE_CHANNELS,
  type ContenidoArchivoBinario,
  type EntradaCreada,
  type PeticionCrearEntrada,
  type PeticionListarDirectorio,
  type PeticionLeerArchivo,
  type PeticionEscribirArchivo,
  type PeticionGuardarSinTitulo,
  type PeticionBorrar,
  type ResultadoBorrar,
  type ResultadoHtmlDocx,
  type ContenidoArchivo,
  type EntradaArchivo,
  type EventoArchivosCambiados,
  type PeticionImportar,
  type ResultadoImportar,
  type PeticionMover,
  type ResultadoMover,
  type PeticionPegar,
  type ResultadoPegar,
  type RaizProyecto,
  type PeticionRenombrar,
  type RutaEnProyecto,
  type PeticionRutas,
  type ResultadoGuardarSinTitulo,
  type PeticionIniciarArrastre,
  type ResultadoEscribirArchivo,
  type ListadoZip
} from '../shared/archivos-ipc'
import {
  JAVA_CHANNELS,
  type PeticionDescompilar,
  type ResultadoDescompilar,
  type EstadoJava
} from '../shared/java-ipc'
import {
  COMPRIMIDOS_CHANNELS,
  type PeticionComparar,
  type ResultadoComparar,
  type PeticionEntrada,
  type ResultadoEntrada
} from '../shared/comprimidos-ipc'
import {
  SEARCH_CHANNELS,
  type BusquedaAceptada,
  type CancelarBusqueda,
  type PeticionCarpetas,
  type RespuestaCarpetas,
  type FinBusqueda,
  type IniciarBusqueda,
  type LoteResultados
} from '../shared/busqueda-ipc'
import { CLIPBOARD_CHANNELS, type PeticionPegarPortapapeles, type SondaPortapapeles, type MensajeEscribirPortapapeles } from '../shared/portapapeles-ipc'

/**
 * API de archivos expuesta al renderer. Todas las rutas son RELATIVAS al
 * proyecto (POSIX, "" = raíz) y van con la contenedora de su proyecto (`raiz`):
 * el main las resuelve contra ese proyecto (`EnProyecto` de archivos-ipc).
 */
export interface ApiArchivos {
  /** Metadatos del proyecto activo (nombre neutro). */
  obtenerRaiz: () => Promise<RaizProyecto>
  /** Lista una carpeta del proyecto (lazy). "" = raíz. */
  listarDirectorio: (ruta: RutaEnProyecto) => Promise<EntradaArchivo[]>
  /** Lee un archivo de texto para el editor. */
  leerArchivo: (ruta: RutaEnProyecto, encoding?: string) => Promise<ContenidoArchivo>
  /**
   * ¿Sigue existiendo? Es la pregunta del editor cuando tiene el buffer SUCIO y no
   * puede releer sin destruir las ediciones, pero necesita saber si tachar la
   * pestaña. Una entrada de .jar responde por su contenedor.
   */
  existe: (ruta: RutaEnProyecto) => Promise<boolean>
  /** Escribe (sobrescribe) un archivo de texto. Devuelve bytes escritos. */
  escribirArchivo: (ruta: RutaEnProyecto, contenido: string, encoding?: string) => Promise<ResultadoEscribirArchivo>
  /**
   * Guarda un buffer SIN TÍTULO (Ctrl+N): la primera vez abre el diálogo nativo
   * de Windows para elegir destino; después reescribe en el mismo sitio. `id` es
   * el id opaco de la pestaña (el main recuerda la ruta por él).
   */
  guardarSinTitulo: (id: string, contenido: string, nombreSugerido: string) => Promise<ResultadoGuardarSinTitulo>
  /** Suelta la ruta recordada de un buffer sin título (al cerrar su pestaña). */
  olvidarSinTitulo: (id: string) => Promise<void>
  /** Lee un archivo como bytes crudos (visor PDF). */
  leerBinario: (ruta: RutaEnProyecto) => Promise<ContenidoArchivoBinario>
  /** Convierte un .docx a HTML con formato (mammoth, en el main). */
  leerDocx: (ruta: RutaEnProyecto) => Promise<ResultadoHtmlDocx>
  /** Lista el contenido de un .zip sin descomprimirlo. */
  leerZip: (ruta: RutaEnProyecto) => Promise<ListadoZip>
  /** Abre el archivo/carpeta en el explorador del SO, dejándolo seleccionado. */
  revelar: (ruta: RutaEnProyecto) => Promise<void>
  /** Abre el archivo con la app por defecto del SO (Word, etc.). Devuelve error o ''. */
  abrirRuta: (ruta: RutaEnProyecto) => Promise<string>
  /** Crea un archivo vacío `nombre` dentro de `dir`. Devuelve su ruta relativa. */
  crearArchivo: (req: PeticionCrearEntrada) => Promise<EntradaCreada>
  /** Crea una carpeta `nombre` dentro de `dir`. Devuelve su ruta relativa. */
  crearCarpeta: (req: PeticionCrearEntrada) => Promise<EntradaCreada>
  /** Renombra `ruta` a `nombreNuevo` (mismo padre). Devuelve la nueva ruta relativa. */
  renombrar: (req: PeticionRenombrar) => Promise<EntradaCreada>
  /**
   * Mueve `srcs` dentro de la carpeta `destDir` (arrastrar y soltar en el árbol).
   * TODO O NADA: si algún nombre ya existe en el destino no mueve nada y lo devuelve
   * en `conflictos`. A diferencia de `importarDesdeHost`, no hay forma de reemplazar: el original
   * de un movimiento interno no queda en ninguna otra parte.
   */
  moverVarios: (req: PeticionMover) => Promise<ResultadoMover>
  /**
   * Trae dentro de `destDir` archivos/carpetas soltados (rutas de `obtenerRutaArchivo`):
   * COPIA los de fuera del proyecto, MUEVE los de dentro. Sin `sobrescribir`, si algún
   * nombre ya existe no toca nada y lo devuelve en `conflictos` para confirmar.
   */
  importarDesdeHost: (req: PeticionImportar) => Promise<ResultadoImportar>
  /**
   * PEGA en `destDir` lo copiado/cortado (menú contextual y Ctrl+V). A diferencia de
   * `importarDesdeHost`, nunca pisa ni pregunta: renombra a "x - copia" si el nombre ya existe.
   */
  pegar: (req: PeticionPegar) => Promise<ResultadoPegar>
  /**
   * URL `file://` de un ARCHIVO del proyecto ('' si es carpeta o no existe). Solo
   * para el `DownloadURL` del arrastre hacia el Explorador de Windows.
   */
  urlArchivo: (ruta: RutaEnProyecto) => Promise<string>
  /**
   * Arranca un arrastre NATIVO con VARIOS archivos, que es la única forma de
   * entregar más de uno al gestor de archivos del sistema. `icono` es el fantasma
   * ya rasterizado (`data:image/png;base64,…`); ver `START_DRAG`.
   */
  iniciarArrastre: (req: PeticionIniciarArrastre) => Promise<void>
  /**
   * Rutas ABSOLUTAS del host (cada una '' si no es válida), en el mismo orden. Solo
   * para el "Copiar ruta" del menú contextual y la marca del portapapeles interno:
   * es una salida hacia el portapapeles, no una entrada. Plural para que copiar una
   * selección grande sea UN viaje al main y no uno por fichero.
   */
  rutaAbs: (req: PeticionRutas) => Promise<string[]>
  /**
   * Elimina archivos/carpetas (recursivo). Best-effort: lo que no se pudo borrar
   * vuelve en `fallidos` con su nombre, en vez de abortar el resto.
   */
  borrarVarios: (req: PeticionBorrar) => Promise<ResultadoBorrar>
  /**
   * Se suscribe al evento de cambios del árbol; devuelve la función para desuscribir.
   * El evento dice QUÉ cambió (`rutas`), o avisa con `parcial` de que la lista no es
   * completa. Un suscriptor al que solo le importe "algo cambió" puede ignorarlo.
   */
  alCambiar: (cb: (ev: EventoArchivosCambiados) => void) => () => void
  /** Se suscribe a cambios de metadata git (.git refs/HEAD/index); devuelve la función para desuscribir. */
  alCambiarGit: (cb: () => void) => () => void
}

/**
 * Portapapeles del sistema, servido por el MAIN (electron.clipboard) vía IPC: el
 * módulo `clipboard` no existe en un renderer sandboxed. Lo usa la terminal
 * (xterm) para copiar la selección y pegar en el pty.
 */
export interface ApiPortapapeles {
  /** Lee el texto del portapapeles del sistema. */
  leerTexto: () => Promise<string>
  /** Copia texto plano al portapapeles del sistema. */
  escribirTexto: (texto: string) => Promise<void>
  /**
   * Si el portapapeles del sistema contiene una imagen, la guarda como PNG en un
   * temporal y devuelve su ruta absoluta; null si no hay imagen. Para pegar
   * imágenes en la terminal como archivo adjunto.
   */
  guardarImagen: () => Promise<string | null>
  /**
   * ¿Hay algo pegable en el portapapeles (ficheros o imagen)? Barato: pensado para
   * llamarlo en cada apertura del menú contextual del explorador.
   */
  sondear: () => Promise<SondaPortapapeles>
  /**
   * Pega en `destDir` lo que haya en el portapapeles (ficheros del Explorador de
   * Windows, o un bitmap). El renderer solo dice DÓNDE: quién lee las rutas y si el
   * gesto fue copiar o cortar lo decide el main. CARO (~250 ms): solo al hacer clic.
   */
  pegarEn: (req: PeticionPegarPortapapeles) => Promise<ResultadoPegar>
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
export interface ApiBusqueda {
  /** Arranca (y cancela la anterior). Devuelve el id con el que filtrar. */
  iniciar: (req: IniciarBusqueda) => Promise<BusquedaAceptada>
  /** Para la búsqueda `busquedaId` si sigue viva (cerrar el modal). */
  cancelar: (busquedaId: number) => Promise<void>
  /** El árbol de CARPETAS de los proyectos abiertos, para el selector de ámbito. */
  carpetas: (req: PeticionCarpetas) => Promise<RespuestaCarpetas>
  /** Lotes de coincidencias. Devuelve el desuscriptor. */
  alRecibirResultados: (cb: (lote: LoteResultados) => void) => () => void
  /** Fin de la búsqueda. Llega SIEMPRE: también al cancelar y al fallar. */
  alTerminar: (cb: (fin: FinBusqueda) => void) => () => void
}

/** Descompilación de clases Java y estado del runtime instalado. */
export interface ApiJava {
  /** Descompila UNA clase. NUNCA rechaza por un fallo del motor: mira `estado`. */
  descompilar: (req: PeticionDescompilar) => Promise<ResultadoDescompilar>
  /** JVM detectadas y motores disponibles (detección perezosa y cacheada). */
  estado: () => Promise<EstadoJava>
  /** Vuelve a buscar JVM (el usuario acaba de instalar un JDK). */
  redetectar: () => Promise<EstadoJava>
  /** Escotilla "Elegir java.exe…": diálogo NATIVO en el main. */
  elegirJava: () => Promise<EstadoJava>
  /** Olvida el java.exe elegido a mano. */
  olvidarJava: () => Promise<EstadoJava>
}

/** Diff de archivos comprimidos (.jar/.war/.ear/.zip) entre dos revisiones; cada petición lleva su `raiz`. */
export interface ApiComprimidos {
  /** Entradas que CAMBIARON entre los dos lados. Nunca rechaza: mira `error`. */
  comparar: (req: PeticionComparar) => Promise<ResultadoComparar>
  /**
   * Contenido de UNA entrada por los dos lados, ya listo para el diff. Nunca
   * rechaza. Si vuelve con `descartado`, es que otra petición del mismo pane la
   * superó mientras tanto: se ignora, no es un error.
   */
  entrada: (req: PeticionEntrada) => Promise<ResultadoEntrada>
}

export const files: ApiArchivos = {
  obtenerRaiz: () => ipcRenderer.invoke(FILE_CHANNELS.GET_ROOT),
  listarDirectorio: ({ raiz, ruta }) => ipcRenderer.invoke(FILE_CHANNELS.LIST_DIR, { raiz, ruta } satisfies PeticionListarDirectorio),
  leerArchivo: ({ raiz, ruta }, encoding) => ipcRenderer.invoke(FILE_CHANNELS.READ_FILE, { raiz, ruta, encoding } satisfies PeticionLeerArchivo),
  existe: ({ raiz, ruta }) => ipcRenderer.invoke(FILE_CHANNELS.EXISTS, { raiz, ruta } satisfies PeticionLeerArchivo),
  escribirArchivo: ({ raiz, ruta }, contenido, encoding) =>
    ipcRenderer.invoke(FILE_CHANNELS.WRITE_FILE, { raiz, ruta, contenido, encoding } satisfies PeticionEscribirArchivo),
  guardarSinTitulo: (id, contenido, nombreSugerido) =>
    ipcRenderer.invoke(FILE_CHANNELS.SAVE_UNTITLED, { id, contenido, nombreSugerido } satisfies PeticionGuardarSinTitulo),
  olvidarSinTitulo: (id) => ipcRenderer.invoke(FILE_CHANNELS.FORGET_UNTITLED, id),
  leerBinario: ({ raiz, ruta }) => ipcRenderer.invoke(FILE_CHANNELS.READ_BINARY, { raiz, ruta } satisfies PeticionLeerArchivo),
  leerDocx: ({ raiz, ruta }) => ipcRenderer.invoke(FILE_CHANNELS.READ_DOCX, { raiz, ruta } satisfies PeticionLeerArchivo),
  leerZip: ({ raiz, ruta }) => ipcRenderer.invoke(FILE_CHANNELS.READ_ZIP, { raiz, ruta } satisfies PeticionLeerArchivo),
  revelar: ({ raiz, ruta }) => ipcRenderer.invoke(FILE_CHANNELS.REVEAL_IN_FOLDER, { raiz, ruta } satisfies PeticionLeerArchivo),
  abrirRuta: ({ raiz, ruta }) => ipcRenderer.invoke(FILE_CHANNELS.OPEN_PATH, { raiz, ruta } satisfies PeticionLeerArchivo),
  crearArchivo: (req) => ipcRenderer.invoke(FILE_CHANNELS.CREATE_FILE, req),
  crearCarpeta: (req) => ipcRenderer.invoke(FILE_CHANNELS.CREATE_DIR, req),
  renombrar: (req) => ipcRenderer.invoke(FILE_CHANNELS.RENAME, req),
  moverVarios: (req) => ipcRenderer.invoke(FILE_CHANNELS.MOVE, req),
  importarDesdeHost: (req) => ipcRenderer.invoke(FILE_CHANNELS.IMPORT, req),
  pegar: (req) => ipcRenderer.invoke(FILE_CHANNELS.PASTE, req),
  urlArchivo: ({ raiz, ruta }) => ipcRenderer.invoke(FILE_CHANNELS.FILE_URL, { raiz, ruta } satisfies PeticionLeerArchivo),
  iniciarArrastre: (req) => ipcRenderer.invoke(FILE_CHANNELS.START_DRAG, req),
  rutaAbs: (req) => ipcRenderer.invoke(FILE_CHANNELS.ABS_PATH, req),
  borrarVarios: (req) => ipcRenderer.invoke(FILE_CHANNELS.DELETE, req),
  alCambiar: (cb) => {
    // El payload puede faltar (un main anterior a este contrato, o un send suelto):
    // se normaliza aquí a la forma completa para que el renderer no tenga que
    // defenderse en cada consumidor. Sin rutas, `parcial` dice la verdad: no se sabe
    // qué cambió.
    const oyente = (_e: Electron.IpcRendererEvent, ev?: EventoArchivosCambiados): void =>
      cb({ rutas: ev?.rutas ?? [], parcial: ev?.parcial ?? true })
    ipcRenderer.on(FILE_CHANNELS.CHANGED, oyente)
    return () => ipcRenderer.removeListener(FILE_CHANNELS.CHANGED, oyente)
  },
  alCambiarGit: (cb) => {
    const oyente = (): void => cb()
    ipcRenderer.on(FILE_CHANNELS.GIT_CHANGED, oyente)
    return () => ipcRenderer.removeListener(FILE_CHANNELS.GIT_CHANGED, oyente)
  }
}

export const portapapeles: ApiPortapapeles = {
  leerTexto: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.READ),
  escribirTexto: (texto) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.WRITE, { text: texto } satisfies MensajeEscribirPortapapeles),
  guardarImagen: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.SAVE_IMAGE),
  sondear: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.PROBE),
  pegarEn: (req) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.PASTE_INTO, req)
}

export const java: ApiJava = {
  descompilar: (req) => ipcRenderer.invoke(JAVA_CHANNELS.DECOMPILE, req),
  estado: () => ipcRenderer.invoke(JAVA_CHANNELS.RUNTIMES),
  redetectar: () => ipcRenderer.invoke(JAVA_CHANNELS.REDETECT),
  elegirJava: () => ipcRenderer.invoke(JAVA_CHANNELS.PICK_JAVA),
  olvidarJava: () => ipcRenderer.invoke(JAVA_CHANNELS.FORGET_JAVA)
}

export const comprimidos: ApiComprimidos = {
  comparar: (req) => ipcRenderer.invoke(COMPRIMIDOS_CHANNELS.COMPARAR, req),
  entrada: (req) => ipcRenderer.invoke(COMPRIMIDOS_CHANNELS.ENTRADA, req)
}

export const busqueda: ApiBusqueda = {
  iniciar: (req) => ipcRenderer.invoke(SEARCH_CHANNELS.START, req),
  cancelar: (busquedaId) => ipcRenderer.invoke(SEARCH_CHANNELS.CANCEL, { busquedaId } satisfies CancelarBusqueda),
  carpetas: (req) => ipcRenderer.invoke(SEARCH_CHANNELS.CARPETAS, req),
  alRecibirResultados: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, lote: LoteResultados): void => cb(lote)
    ipcRenderer.on(SEARCH_CHANNELS.RESULTS, oyente)
    return () => ipcRenderer.removeListener(SEARCH_CHANNELS.RESULTS, oyente)
  },
  alTerminar: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, fin: FinBusqueda): void => cb(fin)
    ipcRenderer.on(SEARCH_CHANNELS.DONE, oyente)
    return () => ipcRenderer.removeListener(SEARCH_CHANNELS.DONE, oyente)
  }
}
