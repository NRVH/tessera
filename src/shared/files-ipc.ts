// =============================================================================
// Contrato IPC de archivos para el explorador y el editor (main <-> preload <-> renderer).
// El renderer NUNCA ve ni envía rutas del host: todas son POSIX relativas a la raíz del
// proyecto activo ("" = raíz), y el main resuelve y valida cada petición contra la ruta
// real (anti path-traversal).
// Casi todo es invoke (renderer -> main, con respuesta); cada canal documenta el suyo.
// =============================================================================

export const FILE_CHANNELS = {
  /** invoke: metadatos del proyecto activo (nombre neutro). Sin argumentos. -> ProjectRoot. */
  GET_ROOT: 'files:getRoot',
  /** invoke: lista una carpeta del proyecto (lazy). ListDirRequest -> FileEntry[]. */
  LIST_DIR: 'files:listDir',
  /** invoke: lee un archivo de texto del proyecto. ReadFileRequest -> FileContent. */
  READ_FILE: 'files:readFile',
  /**
   * invoke: ¿ese archivo SIGUE EXISTIENDO? ReadFileRequest -> boolean.
   *
   * Existe porque el editor necesita esa respuesta SIN leer el archivo: cuando el
   * watcher avisa de un cambio y el buffer tiene ediciones sin guardar, releer
   * destruiría el trabajo (`reload` usa `setValue`), pero hay que saber si lo
   * borraron para tachar la pestaña. Con READ_FILE se pagaba el archivo entero
   * —hasta el tope de MAX_FILE_BYTES— para tirar el contenido y quedarse con un
   * booleano.
   */
  EXISTS: 'files:exists',
  /** invoke: escribe (sobrescribe) un archivo de texto del proyecto. WriteFileRequest -> WriteFileResult. */
  WRITE_FILE: 'files:writeFile',
  /**
   * invoke: guarda un archivo SIN TÍTULO (buffer que solo vive en el editor, Ctrl+N)
   * pidiendo la ruta con el diálogo NATIVO de Windows. SaveUntitledRequest ->
   * SaveUntitledResult.
   */
  SAVE_UNTITLED: 'files:saveUntitled',
  /** invoke: olvida la ruta recordada de un archivo sin título (al cerrar su pestaña). SaveUntitledRequest['id'] -> void. */
  FORGET_UNTITLED: 'files:forgetUntitled',
  /** invoke: lee un archivo como BYTES crudos (para visores binarios: PDF). ReadFileRequest -> BinaryFileContent. */
  READ_BINARY: 'files:readBinary',
  /** invoke: convierte un .docx a HTML con formato (mammoth). ReadFileRequest -> DocxHtmlResult. */
  READ_DOCX: 'files:readDocx',
  /** invoke: lista el contenido de un .zip sin descomprimirlo (fflate). ReadFileRequest -> ZipListing. */
  READ_ZIP: 'files:readZip',
  /** invoke: abre el archivo/carpeta en el explorador del SO (shell.showItemInFolder). ReadFileRequest -> void. */
  REVEAL_IN_FOLDER: 'files:revealInFolder',
  /** invoke: abre el archivo con la app por defecto del SO (shell.openPath). ReadFileRequest -> string (error o ''). */
  OPEN_PATH: 'files:openPath',
  /** invoke: crea un archivo vacío dentro de una carpeta. CreateEntryRequest -> CreatedEntry. */
  CREATE_FILE: 'files:createFile',
  /** invoke: crea una carpeta dentro de otra. CreateEntryRequest -> CreatedEntry. */
  CREATE_DIR: 'files:createDir',
  /** invoke: renombra un archivo/carpeta (mismo padre). RenameRequest -> CreatedEntry. */
  RENAME: 'files:rename',
  /** invoke: mueve VARIOS archivos/carpetas A OTRA carpeta (drag & drop). MoveRequest -> MoveResult. */
  MOVE: 'files:move',
  /** invoke: trae al proyecto archivos/carpetas soltados (copia de fuera, mueve de dentro). ImportRequest -> ImportResult. */
  IMPORT: 'files:import',
  /** invoke: PEGA algo DEL PROPIO PROYECTO en otra carpeta, renombrando si colisiona. PasteRequest -> PasteResult. */
  PASTE: 'files:paste',
  /**
   * invoke: rutas ABSOLUTAS del host de archivos/carpetas del proyecto.
   * RutasRequest -> string[] (cada una '' si la suya no es válida).
   *
   * PLURAL desde que el explorador copia una SELECCIÓN: con una llamada por ruta,
   * un Ctrl+C sobre unos cientos de ficheros lanzaba esos cientos de `invoke` a la
   * vez y el main los atendía uno a uno, dejando sin atender mientras tanto los
   * canales del árbol, de git y de las terminales. Por dentro es traducción de
   * cadena, así que hacerlas todas en un viaje cuesta lo mismo que hacer una.
   *
   * Sirve para UNA cosa: el "Copiar ruta" del menú contextual, que copia al
   * portapapeles la ruta de Windows para pegarla fuera de Tessera. Es una SALIDA de
   * información, no una entrada: el renderer sigue sin poder PEDIR nada por ruta de
   * host (todo canal de lectura/escritura toma rutas relativas), así que el
   * principio de arriba se mantiene. Se compone aquí y no en el renderer para que
   * el separador y el casing salgan de `path.resolve` y no de un `replace` a mano.
   */
  ABS_PATH: 'files:absPath',
  /**
   * invoke: URL `file://` de un ARCHIVO del proyecto. ReadFileRequest -> string
   * ('' si es una carpeta o no existe).
   *
   * Sirve para UNA cosa: rellenar el `DownloadURL` del arrastre, que es como se
   * suelta un archivo en el gestor de archivos del sistema (ver Sidebar). La razón de
   * elegirla frente a `webContents.startDrag` es que
   * `startDrag` SUSTITUYE el arrastre HTML5 —y con él, mover archivos dentro del
   * propio árbol—, mientras que `DownloadURL` convive con él. Un solo gesto sirve
   * para las tres direcciones.
   */
  FILE_URL: 'files:fileUrl',
  /**
   * invoke: arranca un arrastre NATIVO del sistema con VARIOS archivos.
   * StartDragRequest -> void.
   *
   * POR QUÉ HAY DOS MECANISMOS DE ARRASTRE HACIA FUERA, y cuándo se usa cada uno.
   * `DownloadURL` (ver FILE_URL) convive con el arrastre HTML5 y por eso es el
   * camino por defecto, pero Chromium sólo admite UN valor: con varios
   * seleccionados entregaría uno de cinco, que es una promesa rota. La única API
   * capaz de entregar N ficheros al Explorador o al Finder es
   * `webContents.startDrag`, y ésa SUSTITUYE el arrastre HTML5 del gesto.
   *
   * Así que la regla es por número: UNO va por `DownloadURL` (y el arrastre dentro
   * del árbol sigue siendo HTML5, intacto); VARIOS van por aquí. El arrastre
   * interno no se pierde porque el drag nativo, al pasar por encima de nuestra
   * propia ventana, llega al renderer como un arrastre de ficheros normal y el
   * árbol ya sabe qué hacer con él (ver `Sidebar`).
   */
  START_DRAG: 'files:startDrag',
  /** invoke: elimina VARIOS archivos/carpetas (recursivo). DeleteRequest -> DeleteResult. */
  DELETE: 'files:delete',
  /**
   * EVENTO main -> renderer (send, `FilesChangedEvent`): algo cambió en el árbol
   * del proyecto activo (alta/baja/renombre/edición de archivos o carpetas). El
   * explorador lo usa para recargar el árbol al vuelo, sin esperar a cambiar de
   * vista, y el editor para releer las pestañas abiertas que cambiaron por fuera.
   */
  CHANGED: 'files:changed',
  /**
   * EVENTO main -> renderer (send, sin payload): cambió metadata de git en algún
   * `.git` del proyecto (HEAD, refs, packed-refs, logs, index; NO objects, que es
   * ruido). Señala un commit/checkout/merge/stage hecho FUERA de la app (p.ej. el
   * agente en el contenedor). El renderer refresca el grafo y la lista de cambios.
   */
  GIT_CHANGED: 'files:gitChanged'
} as const

/**
 * Payload de `files:changed`. Antes el evento no llevaba nada —bastaba para
 * "recarga el árbol"—, pero sin saber QUÉ cambió no se puede releer la pestaña
 * abierta de ese archivo, que es el caso que se sentía roto: pedirle al agente que
 * edite un `.md` que tienes delante y seguir viendo el contenido viejo.
 *
 * El watcher YA tenía el nombre (`fs.watch` lo entrega); simplemente se descartaba.
 */
export interface FilesChangedEvent {
  /**
   * Rutas POSIX relativas a la raíz activa que cambiaron durante la ventana de
   * antirrebote. Acotada: ver `parcial`.
   */
  paths: string[]
  /**
   * `true` si hubo MÁS cambios de los que cabían en `paths` (un `npm install` toca
   * miles de archivos). Quien necesite precisión debe asumir que `paths` no es la
   * lista completa y actuar sobre todo lo que tenga abierto, en vez de creerse una
   * lista truncada — que es como se pierde silenciosamente justo el archivo que
   * importaba.
   */
  parcial: boolean
}

/** Tipo de una entrada del árbol. */
export type FileKind = 'file' | 'dir'

/** Una entrada (archivo o carpeta) dentro del proyecto. */
export interface FileEntry {
  /** Nombre a mostrar (basename). */
  name: string
  /**
   * Ruta RELATIVA a la raíz del proyecto, en POSIX ("src/util/x.ts").
   *
   * Puede ser una ruta VIRTUAL que apunta dentro de un archivo contenedor
   * ("lib/x.jar!/com/A.class"); ver `src/shared/jarPath.ts`. Sigue siendo relativa a
   * la contenedora, así que la invariante de rutas del IPC no cambia.
   */
  path: string
  kind: FileKind
  /**
   * Presente SOLO en archivos CONTENEDORES (.jar/.war/.ear/.aar), estén en disco o
   * dentro de otro contenedor.
   *
   * `kind` sigue siendo 'file' a propósito: el .jar ES un archivo, y así conserva su
   * icono, su letra de git, renombrar, revelar y "copiar ruta". Este campo solo
   * AUTORIZA al árbol a pintarle un chevron y a pedir su contenido con listDir.
   */
  contenedor?: 'jar'
  /** Solo en listados VIRTUALES: tamaño descomprimido de la entrada, en bytes. */
  tamano?: number
}

/** Metadatos del proyecto activo. Deliberadamente SIN la ruta real de Windows. */
export interface ProjectRoot {
  /** Nombre neutro del proyecto (basename de la carpeta), para el encabezado. */
  name: string
}

export interface ListDirRequest {
  /** Carpeta a listar, relativa a la raíz ("" = raíz del proyecto). POSIX. */
  path: string
}

export interface ReadFileRequest {
  /** Archivo a leer, relativo a la raíz. POSIX. */
  path: string
  /**
   * Solo READ_FILE: fuerza la codificación con la que DECODIFICAR (id del catálogo
   * `shared/encodings`), saltándose la autodetección. Es el "Reabrir con
   * codificación" (recuperar un archivo mal detectado): re-lee y re-decodifica, NO
   * escribe. Ausente = autodetección normal.
   */
  encoding?: string
}

/** Contenido de un archivo listo para abrir en el editor. */
export interface FileContent {
  /** Ruta relativa (POSIX) tal como se pidió. */
  path: string
  /** Id de lenguaje (compatible con Monaco) detectado por extensión; 'plaintext' por defecto. */
  language: string
  /** Contenido de texto ya DECODIFICADO al `encoding` detectado. Vacío si `binary`. */
  content: string
  /**
   * Codificación DETECTADA del archivo (id del catálogo `shared/encodings`, p. ej.
   * 'utf8', 'windows1252'). El editor la muestra y la reusa al guardar para NO
   * cambiarla salvo que el usuario elija otra en el selector. 'utf8' por defecto.
   */
  encoding: string
  /** true si el archivo se truncó por superar el tamaño máximo. */
  truncated: boolean
  /** true si se detectó contenido binario (no se envía el texto; `content` va vacío). */
  binary: boolean
}

/**
 * Bytes crudos de un archivo, para visores que NO son de texto (hoy: PDF, que
 * Chromium pinta nativo desde un Blob). A diferencia de FileContent, NO detecta
 * ni descarta binario: eso es justo lo que se quiere. Límite mayor que el de
 * texto (los PDF/oficina pesan más). `truncated` = superó el máximo binario:
 * el visor debe avisar en vez de renderizar un archivo incompleto.
 */
export interface BinaryFileContent {
  /** Ruta relativa (POSIX) tal como se pidió. */
  path: string
  /** Bytes del archivo (el main devuelve un Buffer; llega como Uint8Array por IPC). */
  bytes: Uint8Array
  /** Tamaño real del archivo en disco (bytes), aunque se haya truncado. */
  size: number
  /** true si el archivo superó el máximo binario y `bytes` está incompleto. */
  truncated: boolean
}

/** HTML con formato de un .docx (convertido por mammoth en el MAIN). */
export interface DocxHtmlResult {
  /** Ruta relativa (POSIX) tal como se pidió. */
  path: string
  /** HTML del documento. SIN sanear: el renderer lo pasa por DOMPurify antes de pintarlo. */
  html: string
  /** Avisos de mammoth (estilos no soportados, etc.); informativos, no errores. */
  messages: string[]
}

/** Una entrada dentro de un archivo .zip (metadatos del índice, sin descomprimir). */
export interface ZipEntry {
  /** Ruta interna del archivo dentro del zip (POSIX, tal como la guardó el zip). */
  name: string
  /** Tamaño descomprimido en bytes. */
  size: number
  /** Tamaño comprimido en bytes. */
  compressedSize: number
  /** true si la entrada es una carpeta (su nombre termina en "/"). */
  isDir: boolean
}

/** Listado del contenido de un .zip (solo índice; no se descomprime nada). */
export interface ZipListing {
  /** Ruta relativa (POSIX) del zip tal como se pidió. */
  path: string
  /** Entradas del archivo, carpetas primero y luego por nombre. */
  entries: ZipEntry[]
}

/** Petición de creación: crea `name` (archivo o carpeta) DENTRO de `dir`. */
export interface CreateEntryRequest {
  /** Carpeta contenedora, relativa a la raíz (POSIX, "" = raíz). */
  dir: string
  /** Nombre del nuevo archivo/carpeta (sin separadores de ruta). */
  name: string
}

/** Petición de renombrado: cambia el nombre de `path` a `newName` (mismo padre). */
export interface RenameRequest {
  /** Ruta actual del archivo/carpeta, relativa a la raíz (POSIX). */
  path: string
  /** Nuevo nombre (sin separadores de ruta). */
  newName: string
}

/**
 * Petición de movimiento: mueve `srcs` DENTRO de la carpeta `destDir`.
 *
 * PLURAL DESDE EL CONTRATO, no singular con un bucle en el renderer, y es una
 * decisión de POLÍTICA y no de comodidad: mover cinco cosas es UNA operación con UN
 * resultado. Con cinco `invoke` el todo-o-nada no puede existir —el tercero
 * descubre la colisión cuando los dos primeros ya se movieron—, ni hay forma de dar
 * un solo aviso, ni de refrescar el árbol una sola vez.
 *
 * El renderer manda la lista ya MINIMIZADA por prefijo (ver `seleccionArbol.ts`):
 * si van una carpeta y algo de dentro, sobra lo de dentro. El main no depende de
 * ello para ser correcto, pero sin la reducción el segundo movimiento fallaría con
 * un ENOENT en vez de con una colisión honesta.
 */
export interface MoveRequest {
  /** Rutas de los archivos/carpetas a mover, relativas a la raíz (POSIX). */
  srcs: string[]
  /** Carpeta destino, relativa a la raíz (POSIX, "" = raíz). */
  destDir: string
}

/**
 * Resultado de un movimiento. MISMA FORMA que `ImportResult` y por el mismo motivo:
 * si `conflicts` no está vacío NO se movió NADA, y el renderer avisa con los nombres.
 *
 * Lo que NO tiene, a diferencia de importar, es `overwrite`, y la asimetría es
 * deliberada: pisar el destino de un arrastre INTERNO borra trabajo sin red, porque
 * el original no sigue en ninguna otra carpeta — que es justo lo que hace inofensivo
 * el "Reemplazar" de la importación desde fuera. Con colisión se avisa y el usuario
 * renombra.
 */
export interface MoveResult {
  /** Rutas relativas (POSIX) resultantes. Vacío si hubo conflictos. */
  moved: string[]
  /** Nombres que ya existían en el destino. Vacío si fue todo bien. */
  conflicts: string[]
}

/**
 * Petición de importación: trae dentro de `destDir` los archivos/carpetas que el
 * usuario soltó sobre el árbol.
 *
 * COPIA o MUEVE según de dónde vengan, que es la regla del propio Explorador de
 * Windows (dentro del mismo volumen se mueve; entre volúmenes se copia):
 *   - origen FUERA del proyecto  -> se COPIA (el original del usuario no se toca).
 *   - origen DENTRO del proyecto -> se MUEVE (es reordenar el árbol, no duplicar).
 * Lo decide el MAIN comparando la ruta de origen con la raíz del proyecto; el
 * renderer no elige. El caso "dentro" no es teórico: ocurre al arrastrar sobre el
 * árbol un archivo del propio proyecto desde una ventana del Explorador de Windows.
 *
 * (Mover una fila del árbol SOBRE otra carpeta del árbol NO pasa por aquí: eso es un
 * arrastre HTML5 interno y usa MOVE. Ver Sidebar.)
 *
 * ÚNICA excepción al principio "el renderer nunca envía rutas del host": la ruta
 * de origen la produce Electron (`webUtils.getPathForFile`) a partir de un `File`
 * que el propio usuario soltó, no la teclea el renderer. El origen puede estar en
 * cualquier parte del disco (es el punto: traer archivos de fuera); el DESTINO
 * sigue siendo relativo y validado contra la raíz del proyecto.
 */
export interface ImportRequest {
  /** Rutas ABSOLUTAS del host de los archivos/carpetas soltados. */
  hostPaths: string[]
  /** Carpeta destino, relativa a la raíz (POSIX, "" = raíz). */
  destDir: string
  /** true = sobrescribe los destinos que ya existan. false = no trae nada y los reporta. */
  overwrite: boolean
}

/**
 * Resultado de una importación. Si `conflicts` no está vacío con `overwrite:false`,
 * NO se copió NADA (todo o nada): el renderer pide confirmación y reintenta con
 * `overwrite:true`.
 */
export interface ImportResult {
  /** Rutas relativas (POSIX) de lo copiado. Vacío si hubo conflictos sin resolver. */
  imported: string[]
  /** Nombres que ya existían en el destino (solo cuando `overwrite` era false). */
  conflicts: string[]
}

/**
 * Petición de PEGADO: mete en `destDir` lo que el usuario copió o cortó.
 *
 * Es hermano de MOVE/IMPORT pero NO el mismo canal, y la diferencia es de POLÍTICA,
 * no de mecánica: arrastrar (MOVE/IMPORT) es todo-o-nada y PREGUNTA antes de pisar
 * un nombre existente; pegar RENOMBRA solo ("informe - copia.md"), como los
 * gestores de archivos, y nunca interrumpe con un diálogo. Meter ambas
 * políticas en `importFromHost` lo habría convertido en un interruptor de cuatro
 * vías; separarlas deja el drag & drop intacto.
 *
 * Este canal SOLO acepta orígenes INTERNOS: una ruta relativa del propio proyecto,
 * que `resolveSafe` valida. Pegar lo que hay en el PORTAPAPELES DEL SISTEMA va por
 * `clipboard:pasteInto`, donde es el MAIN quien lee las rutas y decide copiar o
 * mover.
 *
 * Esa separación es deliberada y de seguridad, no de estilo: si el renderer pudiera
 * mandar rutas absolutas del host junto a `op: 'cortar'`, un fallo suyo bastaría para
 * que el main moviera —o borrara recursivamente— cualquier carpeta del disco. El
 * mismo motivo por el que `ImportRequest` acepta rutas de host pero NO deja elegir
 * entre mover y copiar: esa decisión se toma siempre en el main.
 */
export interface PasteRequest {
  /** Carpeta destino, relativa a la raíz (POSIX, "" = raíz). */
  destDir: string
  /** Orígenes: rutas relativas a la raíz (POSIX). Ya minimizadas por el renderer. */
  srcs: string[]
  /** 'copiar' duplica; 'cortar' mueve DENTRO del proyecto. */
  op: 'copiar' | 'cortar'
}

/**
 * Resultado de un pegado. Es BEST-EFFORT y por eso lleva las dos listas: pegar cinco
 * archivos y que uno falle no debe abortar los otros cuatro ni perder lo que sí
 * entró. Solo se lanza cuando NO entró nada.
 */
export interface PasteResult {
  /** Rutas relativas (POSIX) de lo que quedó en el destino. */
  paths: string[]
  /** Nombres que no se pudieron pegar. Vacío si fue todo bien. */
  fallidos: string[]
}

/** Petición de arrastre NATIVO con varios archivos (ver `START_DRAG`). */
export interface StartDragRequest {
  /** Rutas a arrastrar, relativas a la raíz (POSIX). */
  paths: string[]
  /**
   * Imagen que acompaña al cursor, como `data:image/png;base64,…`.
   *
   * La compone el RENDERER y no el main a propósito: es el mismo fantasma que se
   * ve al arrastrar dentro del árbol, y dibujarlo donde viven la tipografía y los
   * colores es lo que hace que las dos direcciones se parezcan. Además `startDrag`
   * EXIGE un icono no vacío —no acepta `nativeImage.createEmpty()`—, así que el
   * main necesita recibir uno válido siempre.
   */
  icono: string
}

/** Petición sobre VARIAS rutas del proyecto (relativas, POSIX). */
export interface RutasRequest {
  paths: string[]
}

/** Petición de borrado: elimina `paths` (archivos o carpetas, recursivo). */
export interface DeleteRequest {
  /** Rutas de los archivos/carpetas a eliminar, relativas a la raíz (POSIX). */
  paths: string[]
}

/**
 * Resultado de un borrado. BEST-EFFORT, al revés que mover, y la asimetría tiene
 * motivo: un borrado a medias es irrecuperable de todas formas, así que negarse a
 * borrar nueve archivos porque el décimo lo tiene abierto otro proceso no protege
 * nada — sólo obliga a repetir el gesto sin decir cuál era el que estorbaba.
 *
 * La VALIDACIÓN, en cambio, sí es todo-o-nada: una ruta inválida (fuera del
 * proyecto, dentro de un .jar, la propia raíz) lanza antes de borrar nada.
 */
export interface DeleteResult {
  /** Rutas relativas (POSIX) de lo que se eliminó. */
  deleted: string[]
  /** Nombres de lo que no se pudo eliminar. Vacío si fue todo bien. */
  fallidos: string[]
}

/** Resultado de crear/renombrar: la ruta relativa (POSIX) resultante. */
export interface CreatedEntry {
  /** Ruta relativa (POSIX) del archivo/carpeta creado o renombrado. */
  path: string
}

/** Petición de escritura: sobrescribe el archivo en `path` con `content`. */
export interface WriteFileRequest {
  /** Archivo a escribir, relativo a la raíz. POSIX. */
  path: string
  /** Contenido completo a persistir (texto Unicode del editor). */
  content: string
  /**
   * Id de codificación con la que ESCRIBIR (catálogo `shared/encodings`). Ausente =
   * 'utf8'. El editor manda AQUÍ la codificación actual del archivo para preservarla
   * en cada guardado; solo cambia si el usuario elige otra en el selector.
   */
  encoding?: string
}

/** Resultado de una escritura exitosa. */
export interface WriteFileResult {
  /** Ruta relativa (POSIX) tal como se pidió. */
  path: string
  /** Bytes escritos (longitud UTF-8 del contenido). Para feedback/verificación. */
  bytesWritten: number
}

/**
 * Petición de guardado de un archivo SIN TÍTULO (Ctrl+N): un buffer que solo
 * existe en el editor y todavía no tiene sitio en el disco.
 *
 * El renderer NO manda ninguna ruta: manda el `id` opaco de su pestaña sin
 * título. Es el MAIN quien abre el diálogo nativo, conoce la ruta elegida y la
 * RECUERDA asociada a ese `id` —así los guardados siguientes (Ctrl+S) van al
 * mismo archivo sin volver a preguntar, y la ruta de Windows nunca cruza el IPC
 * (mismo principio de seguridad que el resto del contrato).
 *
 * El destino puede caer FUERA del proyecto (el usuario elige dónde en el
 * diálogo): por eso este canal NO pasa por resolveSafe. La ruta no la teclea el
 * renderer, la produce el usuario en un diálogo del SO (misma excepción, y por
 * el mismo motivo, que `ImportRequest.hostPaths`).
 */
export interface SaveUntitledRequest {
  /** Id opaco de la pestaña sin título (lo genera el renderer; identifica el buffer). */
  id: string
  /** Contenido completo a persistir (UTF-8). */
  content: string
  /** Nombre propuesto en el diálogo. Se ignora si el `id` ya tiene ruta recordada. */
  suggestedName: string
}

/** Resultado de guardar un archivo sin título. */
export interface SaveUntitledResult {
  /** true si el usuario cerró el diálogo sin elegir destino: no se escribió nada. */
  canceled: boolean
  /** Nombre (basename) del archivo guardado. Ausente si `canceled`. */
  name?: string
  /**
   * Ruta relativa (POSIX) al proyecto activo si el archivo cayó DENTRO de él, o
   * `null` si el usuario lo guardó fuera. Dentro, el renderer convierte la
   * pestaña sin título en una pestaña de archivo normal (con git, explorador y
   * recarga); fuera, la pestaña sigue siendo "sin título" pero ya con nombre y
   * con destino recordado.
   */
  path?: string | null
  /** Bytes escritos (longitud UTF-8 del contenido). Ausente si `canceled`. */
  bytesWritten?: number
}

// -----------------------------------------------------------------------------
// Detección de lenguaje por extensión (pura, sin dependencias).
// Vive en `shared` para ser la ÚNICA fuente de verdad: el main la usa al leer y
// el renderer la reusa al crear el modelo de Monaco. Ids alineados con Monaco.
// -----------------------------------------------------------------------------

/** Extensión (sin punto, minúsculas) -> id de lenguaje de Monaco. */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  svg: 'xml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  dart: 'dart',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  toml: 'ini',
  ini: 'ini',
  // Java .properties: lenguaje PROPIO 'properties' (registrado en monacoLenguajes). El
  // 'ini' de Monaco no sirve (no cubre claves con puntos ni colorea el valor). Sin
  // esto caían a 'plaintext' -> todo blanco. .cfg/.editorconfig sí van a 'ini' (llevan
  // secciones [seccion], que 'properties' no contempla).
  properties: 'properties',
  // Diagramas de Mermaid: lenguaje PROPIO 'mermaid' (registrado en monacoLenguajes).
  // Sin esto caían a 'plaintext' y un diagrama se veía todo blanco, comentarios
  // incluidos. Monaco no trae mermaid y no hay a qué mapearlo: ni ini ni yaml
  // reconocen un `-->`.
  mmd: 'mermaid',
  mermaid: 'mermaid',
  cfg: 'ini',
  editorconfig: 'ini',
  dockerfile: 'dockerfile',

  // --- Cobertura AMPLIA (multi-framework). Solo se mapea a lenguajes que Monaco
  // 0.52 trae de verdad; lo que no exista queda en 'plaintext'. ---

  // Shell / Windows / scripting
  bat: 'bat',
  cmd: 'bat',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  fish: 'shell',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  r: 'r',
  tcl: 'tcl',
  coffee: 'coffeescript',

  // Web / plantillas de framework. Monaco no trae Vue/Svelte/Astro propios; 'html'
  // resalta el template y el <script>/<style> embebidos (mejor que texto plano).
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  ejs: 'html',
  pug: 'pug',
  jade: 'pug',
  hbs: 'handlebars',
  handlebars: 'handlebars',
  mustache: 'handlebars',
  twig: 'twig',
  liquid: 'liquid',
  njk: 'twig',
  graphql: 'graphql',
  gql: 'graphql',
  mdx: 'mdx',
  rst: 'restructuredtext',

  // JVM / .NET / funcionales / otros
  scala: 'scala',
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  edn: 'clojure',
  ex: 'elixir',
  exs: 'elixir',
  jl: 'julia',
  fs: 'fsharp',
  fsx: 'fsharp',
  fsi: 'fsharp',
  vb: 'vb',
  pas: 'pascal',
  // Groovy: lenguaje PROPIO 'groovy' (registrado en monacoLenguajes). Antes iba a 'java',
  // cuyo tokenizer rompe las comillas simples de Groovy ('literal de un char'), así que
  // un `implementation 'com.example:Lib:1.0'` salía en trozos de colores.
  groovy: 'groovy',
  gradle: 'groovy',

  // C-family extra + Objective-C
  hh: 'cpp',
  hxx: 'cpp',
  cxx: 'cpp',
  'c++': 'cpp',
  ino: 'cpp',
  // `.m` NO se mapea a propósito: es Objective-C solo en proyectos Apple; en repos de
  // ingeniería es MATLAB/Octave, y el tokenizer de Objective-C toma el apóstrofo de
  // transpuesta (`A' * x`) como apertura de string y se traga media pantalla. Texto
  // plano (neutro) es mejor que color equivocado. `.mm` sí es Objective-C++ inequívoco.
  mm: 'objective-c',

  // Infra / IaC / config / blockchain / hardware
  tf: 'hcl',
  tfvars: 'hcl',
  hcl: 'hcl',
  proto: 'proto',
  env: 'properties',
  bicep: 'bicep',
  sol: 'sol',
  wgsl: 'wgsl',
  sv: 'systemverilog',
  svh: 'systemverilog'
}

/** Nombres de archivo completos (minúsculas) -> id de lenguaje. */
const NAME_TO_LANGUAGE: Record<string, string> = {
  dockerfile: 'dockerfile',
  '.gitignore': 'plaintext',
  '.dockerignore': 'plaintext',
  '.gitattributes': 'plaintext',
  'tsconfig.json': 'json',
  'jsconfig.json': 'json',
  // Configs de herramientas SIN extensión. Van a YAML, NO a json: estos rc admiten
  // JSON **y** YAML (y JSON con comentarios), y el lenguaje `json` de Monaco arrastra
  // su worker de validación (`validate:true, allowComments:false`), que llenaba de
  // errores rojos FALSOS un `.prettierrc` en YAML o un `.eslintrc` con `//`. El
  // tokenizer de YAML no valida nada y colorea bien ambas formas (JSON es casi YAML).
  '.babelrc': 'yaml',
  '.prettierrc': 'yaml',
  '.eslintrc': 'yaml',
  '.stylelintrc': 'yaml',
  // Configs estilo INI / rc
  '.npmrc': 'ini',
  '.yarnrc': 'ini',
  '.gitconfig': 'ini',
  // Perfiles / rc de shell
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.bash_profile': 'shell',
  '.zprofile': 'shell',
  '.profile': 'shell',
  '.bash_aliases': 'shell',
  // Pipelines de Jenkins: Groovy.
  jenkinsfile: 'groovy'
}

/**
 * Id de lenguaje de Monaco para un nombre de archivo, detectado por extensión
 * (o por nombre completo para casos sin extensión). 'plaintext' por defecto.
 *
 * Acepta un nombre suelto O una RUTA (POSIX o Windows): se queda con el último
 * segmento. Sin esto, un llamador que pasa la ruta —la vista de diff pasa la ruta
 * relativa al repo— no casaba NINGUNA regla por nombre (`docker/Dockerfile`,
 * `web/.prettierrc`, `config/.env.local`…) y esos archivos salían sin colorear.
 */
export function languageForFilename(filename: string): string {
  const lower = filename.toLowerCase().split(/[\\/]/).pop() ?? ''
  if (NAME_TO_LANGUAGE[lower]) return NAME_TO_LANGUAGE[lower]
  // Familia .env (.env, .env.local, .env.production…): clave=valor, mismo tratamiento
  // que .properties. El prefijo cubre todas las variantes sin listarlas una a una.
  if (lower === '.env' || lower.startsWith('.env.')) return 'properties'
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  const ext = lower.slice(dot + 1)
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext'
}
