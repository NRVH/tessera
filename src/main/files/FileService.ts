// =============================================================================
// Árbol, lectura y escritura de archivos del proyecto activo, leyendo siempre del host (node:fs)
// en el main: el `/workspace` del contenedor es un bind mount de la misma carpeta, así que los
// bytes son idénticos y no hace falta `docker exec`. El renderer solo maneja rutas POSIX relativas
// al proyecto; `resolveSafe` resuelve cada una contra la única raíz real y bloquea salir de ella.
// Los .jar se enrutan a `JarService`; el escritorio (revelar, abrir, icono del arrastre, «Guardar
// como») entra por `adaptadores/escritorioElectron.ts` y los canales se registran en `ipc.ts`.
// =============================================================================

import { promises as fs, watch, type FSWatcher } from 'node:fs'
import * as path from 'node:path'
import { contenedorEnDiscoDe, esNombreContenedor, esRutaVirtual, tocaContenedor } from '../../shared/jarPath'
import { normalizarRelativaProyecto } from '../../shared/rutasHost'
import { JarService } from '../java/JarService'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { BrowserWindow, WebContents } from 'electron'
import type { EscritorioArchivos } from './adaptadores/escritorioElectron'
import {
  comparablePath,
  exists,
  isInside,
  moveAcrossVolumes,
  readPrefix,
  samePath,
  uniqueName,
  validateName
} from './utilidadesDisco'
import {
  FILE_CHANNELS,
  languageForFilename,
  type BinaryFileContent,
  type CreatedEntry,
  type DeleteResult,
  type DocxHtmlResult,
  type FileContent,
  type FileEntry,
  type ImportResult,
  type MoveResult,
  type PasteResult,
  type ProjectRoot,
  type SaveUntitledRequest,
  type SaveUntitledResult,
  type WriteFileResult,
  type FilesChangedEvent,
  type ZipEntry,
  type ZipListing
} from '../../shared/files-ipc'
import {
  detectEncoding,
  decodeText,
  encodeText,
  isBinaryBuffer,
  losesDataOnEncode
} from './textCodec'

/** Tamaño máximo que se envía al editor (2 MiB). Más grande -> se trunca. */
const MAX_FILE_BYTES = 2 * 1024 * 1024
/**
 * Tamaño máximo para lecturas BINARIAS (PDF) y para procesar .docx/.zip (50 MiB).
 * Más alto que el de texto: los documentos de oficina y los PDF pesan más, y aquí
 * NO se vuelca el texto al editor sino que se pinta un visor dedicado.
 */
const MAX_BINARY_BYTES = 50 * 1024 * 1024


/** Milisegundos de espera tras el último evento del watcher antes de avisar al
 *  renderer: fs.watch dispara ráfagas (un guardado emite varios eventos), así que
 *  se colapsan en un solo `files:changed`. */
const WATCH_DEBOUNCE_MS = 200

/**
 * Intervalo MÍNIMO entre dos `files:changed` consecutivos. Acota una escritura
 * sostenida (agente, `npm install`, build), donde el debounce solo no basta porque
 * cada evento lo reinicia sin llegar a colapsarlos. 600 ms es imperceptible para el
 * usuario —las operaciones que él hace ya refrescan el árbol de forma optimista, sin
 * esperar al watcher— y divide por tres el trabajo del renderer en ráfaga.
 */
const MIN_CHANGE_INTERVAL_MS = 600
/** Tope de rutas que viajan en un aviso. Más allá se marca `parcial` (ver el payload). */
const MAX_CHANGED_PATHS = 200

/** Debounce de los cambios de git: una operación (commit/merge) toca varios refs;
 *  algo mayor evita ráfagas de refetch del grafo. */
const GIT_WATCH_DEBOUNCE_MS = 400

/**
 * Parámetro de `FileService.paste`. NO es un contrato IPC y por eso no vive en
 * `shared/`: `hostPaths` (rutas absolutas del host) solo lo compone el propio MAIN
 * desde el portapapeles. Lo que llega del renderer es `PasteRequest`, que es este
 * mismo tipo sin `hostPaths` ni `nombre` — la diferencia es justo la parte capaz de
 * mover o borrar algo fuera del proyecto.
 */
export interface PasteOptions {
  /** Carpeta destino, relativa a la raíz (POSIX, "" = raíz). */
  destDir: string
  /** Orígenes INTERNOS: rutas relativas a la raíz (POSIX). */
  srcs?: string[]
  /** Origen EXTERNO: rutas ABSOLUTAS del host. Solo desde el main. */
  hostPaths?: string[]
  op: 'copiar' | 'cortar'
  /** Fuerza el nombre del destino (pegado de imagen). Solo con UN origen. */
  nombre?: string
}

/** Cómo acabó un elemento del pegado (`pegarUno`). */
type DesenlacePegado = { tipo: 'pegado'; rel: string } | { tipo: 'fallido'; nombre: string } | { tipo: 'noop' }

export interface FileServiceOptions {
  /**
   * Ruta host (Windows) real de la raíz del proyecto activo. Opcional: si se
   * omite, el servicio arranca SIN proyecto activo (arranque limpio) y espera al
   * primer `setProjectRoot()` (vía workspace.setActiveProject).
   */
  projectRoot?: string
  /**
   * Ventana a la que empujar el evento `files:changed` cuando el watcher detecta
   * cambios en el árbol. Se pasa como getter (la ventana puede recrearse). Sin
   * esto, el watcher no arranca (no hay a quién avisar).
   */
  getWindow?: () => BrowserWindow | null
  /** Revelar, abrir, icono del arrastre y «Guardar como»: `adaptadores/escritorioElectron.ts` o un doble. */
  escritorio: EscritorioArchivos
  /** Logger del main (por defecto console.log con prefijo). */
  log?: (msg: string) => void
}

export class FileService {
  /**
   * Raíz real del proyecto ACTIVO, resuelta y absoluta, o `null` si aún no hay
   * proyecto activo (arranque limpio). Nunca se expone al renderer. Mutable de
   * forma controlada vía `setProjectRoot()`: hay una única vista de archivos a la
   * vez (la del proyecto activo), y cambiar de proyecto re-apunta esta raíz en
   * vez de crear una instancia por proyecto.
   */
  private root: string | null
  private readonly log: (msg: string) => void
  private readonly getWindow?: () => BrowserWindow | null
  private readonly escritorio: EscritorioArchivos
  /** Servicio de contenedores (.jar/.war/…). null = la función no está montada. */
  private jar: JarService | null = null
  /** Watcher recursivo de la raíz activa (o null si no hay proyecto/ventana). */
  private watcher: FSWatcher | null = null
  /** Timer del aviso de cambios pendiente (debounce + intervalo mínimo). */
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  /** ¿Hay cambios sin avisar? Garantiza que el último cambio de una ráfaga se entrega. */
  private changePending = false
  /** Rutas POSIX acumuladas durante la ventana de antirrebote (ver scheduleChangeEvent). */
  private readonly changedPaths = new Set<string>()
  /** ¿Se desbordó el tope, o el watcher no dio nombre? Entonces `paths` no es completa. */
  private changedPartial = false
  /** Epoch ms del último `files:changed` emitido (para el intervalo mínimo). */
  private lastChangeEmit = 0
  /** Debounce SEPARADO para los cambios de metadata git (.git refs/HEAD/index). */
  private gitTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Destino RECORDADO de cada archivo sin título ya guardado una vez:
   * id opaco de la pestaña -> ruta host absoluta que el usuario eligió en el
   * diálogo nativo. Es lo que permite que el segundo Ctrl+S no vuelva a
   * preguntar, sin que la ruta de Windows llegue nunca al renderer. Vive solo en
   * memoria (una sesión de app) y se suelta al cerrar la pestaña.
   */
  private readonly untitledTargets = new Map<string, string>()

  constructor(opts: FileServiceOptions) {
    this.root = opts.projectRoot != null ? path.resolve(opts.projectRoot) : null
    this.getWindow = opts.getWindow
    this.escritorio = opts.escritorio
    this.log = opts.log ?? ((m) => console.log(`[files] ${m}`))
    if (this.root) this.startWatching()
  }

  /**
   * Re-apunta el servicio al proyecto ACTIVO indicado (misma resolución que el
   * constructor). A partir de aquí `getRoot`, `resolveSafe`, `listDir` y
   * `readFile` operan contra la nueva raíz; el contrato IPC no cambia (el
   * renderer sigue mandando rutas relativas al proyecto activo).
   */
  setProjectRoot(projectRoot: string): void {
    this.root = path.resolve(projectRoot)
    this.log(`proyecto activo -> "${path.basename(this.root)}"`)
    // Re-apunta el watcher a la nueva raíz (cierra el anterior). Así el árbol del
    // proyecto que se acaba de activar se auto-refresca desde ya.
    this.startWatching()
  }

  /**
   * La contenedora ANCLADA (la raíz real del explorador), o null. SOLO para el main, nunca
   * por IPC: con ella `DbController` comprueba que «Montar como base de datos» pide un
   * archivo del proyecto que el explorador enseña, y no de otra carpeta cualquiera.
   */
  raizAnclada(): string | null {
    return this.root
  }

  /** Suelta el destino recordado de una pestaña sin título que se cierra. */
  olvidarSinTitulo(id: string): void {
    this.untitledTargets.delete(id)
  }

  /** Metadatos neutros del proyecto: solo el nombre, nunca la ruta de Windows. */
  getRoot(): ProjectRoot {
    return { name: this.root ? path.basename(this.root) : '' }
  }

  /**
   * Resuelve una ruta relativa (POSIX) del renderer a una ruta host absoluta,
   * garantizando que queda DENTRO de la raíz del proyecto. Lanza si no hay
   * proyecto activo, o si detecta un intento de salir (../, ruta absoluta, etc.).
   */
  private resolveSafe(relPosix: string): string {
    if (this.root === null) throw new Error('No hay proyecto activo.')
    // GUARDA DE RUTAS VIRTUALES. Una ruta de dentro de un .jar no existe en el disco:
    // resolverla daría una carpeta creíble pero falsa ("x.jar!") y crear, renombrar o
    // borrar ahí ensuciaría el proyecto. Los pocos caminos que SÍ leen dentro de un
    // contenedor (listDir, readFile, readBinary) bifurcan ANTES de llamar aquí; cualquier
    // otro, también uno que se añada mañana, falla en la puerta.
    // Anclado a la extensión y no un `includes('!/')`: `!` es legal en un nombre y una
    // carpeta real "scripts!" tiene que seguir funcionando. `tocaContenedor` y no
    // `esRutaVirtual`: atrapa también la forma degenerada `x.jar!` (sin su barra), que
    // sale de hacer `parentDir` sobre una entrada de la raíz del jar.
    if (tocaContenedor(relPosix)) {
      throw new Error(
        'Esa ruta está dentro de un archivo comprimido y no se puede modificar desde aquí.'
      )
    }
    return this.resolveProyecto(relPosix)
  }

  /**
   * Traducción cruda de ruta relativa del proyecto a ruta de Windows, con la guarda
   * anti-traversal. Es lo que usa `resolveSafe`, y se expone para que el servicio de
   * jars pueda resolver el CONTENEDOR (que sí es un fichero real) sin duplicar la
   * validación ni saltarse la raíz del proyecto activo.
   */
  resolveProyecto(relPosix: string): string {
    if (this.root === null) throw new Error('No hay proyecto activo.')
    // Normaliza separadores y descarta prefijos que intenten "anclar" fuera. La
    // traducción de `\` a `/` la decide la PLATAFORMA (`normalizarRelativaProyecto`):
    // hacerla siempre rompía en Mac los nombres con barra invertida, que ahí es un
    // carácter legal — y `relativaPosixHost` los entrega correctos por la ida.
    const rel = normalizarRelativaProyecto(relPosix)
    const abs = path.resolve(this.root, rel)
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new Error('Ruta fuera del proyecto (path traversal bloqueado).')
    }
    return abs
  }

  /**
   * ¿Esta ruta hay que servirla desde dentro de un contenedor? Cubre los dos casos:
   * una ruta virtual ("lib/x.jar!/com"), y un contenedor PELADO ("lib/x.jar"), que
   * es con el que el árbol pide la PRIMERA expansión y que `parseRutaArchivo`
   * devuelve como null por contrato. Sin la segunda mitad, expandir un .jar no
   * funcionaría nunca: `fs.readdir` sobre un fichero da ENOTDIR.
   */
  private async esDeContenedor(relPosix: string): Promise<boolean> {
    if (this.jar === null) return false
    if (esRutaVirtual(relPosix)) return true
    const rel = normalizarRelativaProyecto(relPosix)
    if (rel === '' || !esNombreContenedor(rel.slice(rel.lastIndexOf('/') + 1))) return false
    try {
      // El desempate de una CARPETA real llamada "algo.jar": solo el disco lo sabe.
      return (await fs.stat(this.resolveProyecto(rel))).isFile()
    } catch {
      return false
    }
  }

  /** Ruta de Windows del contenedor de disco de una ruta (virtual o pelada). */
  private absDelContenedor(relPosix: string): string {
    const enDisco = contenedorEnDiscoDe(relPosix)
    return this.resolveProyecto(enDisco !== '' ? enDisco : relPosix)
  }

  /** Inyecta el servicio de jars (lo construye `index.ts`, que es quien lo posee). */
  setJarService(jar: JarService | null): void {
    this.jar = jar
  }

  /** Lista una carpeta del proyecto (lazy). Carpetas primero, luego alfabético. */
  async listDir(relPosix: string): Promise<FileEntry[]> {
    // Sin proyecto activo: árbol vacío, estado seguro (el renderer no debería
    // llamar aquí, pero no revienta si lo hace).
    if (this.root === null) return []

    // Un .jar se navega como si fuera una carpeta. El explorador NO se entera: pide
    // por el canal de siempre y recibe FileEntry[] con la misma forma y el mismo
    // orden. Se enruta aquí, y no en un canal propio, porque el bucle de
    // compactación de `loadChain` y el re-listado del watcher llaman a listDir una
    // vez por nivel: un canal paralelo dejaría esos dos caminos viejos abiertos.
    if (await this.esDeContenedor(relPosix)) {
      // NORMALIZADA aquí, en la frontera, que es donde el repo decide traducir
      // separadores (`normalizarRelativaProyecto`, sensible a la plataforma). Antes
      // entraba cruda y quien traducía era `JarService.partirOEnRaiz`, con un
      // `\`→`/` incondicional: correcto en Windows y falso en macOS, donde una
      // carpeta `a\b` es un nombre legal y sus jars quedaban inalcanzables.
      const relJar = normalizarRelativaProyecto(relPosix)
      return this.jar!.listarDirectorio(this.absDelContenedor(relJar), relJar)
    }

    const abs = this.resolveSafe(relPosix)
    const dirents = await fs.readdir(abs, { withFileTypes: true })
    const base = normalizarRelativaProyecto(relPosix).replace(/\/+$/, '')

    const entries: FileEntry[] = []
    for (const d of dirents) {
      // Solo archivos y carpetas reales: los symlinks (isFile/isDirectory dan
      // false sobre un dirent de symlink) quedan fuera del árbol por seguridad.
      if (!d.isFile() && !d.isDirectory()) continue
      const entry: FileEntry = {
        name: d.name,
        path: base ? `${base}/${d.name}` : d.name,
        kind: d.isDirectory() ? 'dir' : 'file'
      }
      // Un .jar/.war/.ear/.aar del disco se marca como CONTENEDOR: es lo único que
      // autoriza al árbol a pintarle chevron y a pedir su contenido. Sin esta marca
      // el enrutado de abajo funciona pero nadie lo llama nunca, porque la fila sigue
      // siendo una hoja. La comprobación de `isFile` es la que descarta una CARPETA
      // real llamada "algo.jar".
      if (d.isFile() && esNombreContenedor(d.name)) entry.contenedor = 'jar'
      entries.push(entry)
    }

    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    })
    return entries
  }

  /**
   * ¿Sigue estando ahí? Sin leerlo, y sin distinguir archivo de carpeta: quien
   * pregunta es el editor con un buffer SUCIO delante, y para él «lo borraron»
   * incluye que se llevaran la carpeta que lo contenía.
   *
   * Una entrada DENTRO de un contenedor (`x.jar!/a/B.class`) responde por su .jar:
   * no se puede borrar por separado, así que la pregunta honesta es si el
   * contenedor sigue en disco.
   *
   * NO se traga los errores de ruta: si `resolveSafe` rechaza la ruta, eso no es
   * «no existe» sino «esa pregunta no es válida», y quien llama tiene que poder
   * distinguirlo para NO tachar una pestaña por un fallo de programación.
   */
  async existeRuta(relPosix: string): Promise<boolean> {
    const rel0 = normalizarRelativaProyecto(relPosix)
    if (esRutaVirtual(rel0)) {
      const contenedor = contenedorEnDiscoDe(rel0)
      if (contenedor === '') return false
      return exists(this.resolveSafe(contenedor))
    }
    return exists(this.resolveSafe(relPosix))
  }

  /**
   * Lee un archivo de texto para el editor. Trunca a MAX_FILE_BYTES y detecta
   * binario (byte NUL en el primer tramo) para no volcar bytes crudos al editor.
   */
  async readFile(relPosix: string, forcedEncoding?: string): Promise<FileContent> {
    const rel0 = normalizarRelativaProyecto(relPosix)
    // Una entrada de TEXTO dentro de un .jar (el MANIFEST, un .properties, un .xml)
    // se lee igual que un fichero: mismos topes, misma detección de codificación y
    // de binario. El lenguaje se calcula del basename ANTES de bifurcar, porque
    // `path.basename` de una ruta virtual no daría el nombre correcto.
    if (esRutaVirtual(rel0) && this.jar !== null) {
      return this.leerEntradaDeContenedor(rel0, forcedEncoding)
    }

    const abs = this.resolveSafe(relPosix)
    const rel = rel0
    const language = languageForFilename(path.basename(abs))

    const stat = await fs.stat(abs)
    if (!stat.isFile()) throw new Error(`No es un archivo: "${rel}".`)

    const truncated = stat.size > MAX_FILE_BYTES
    const buffer = truncated ? await readPrefix(abs, MAX_FILE_BYTES) : await fs.readFile(abs)

    if (isBinary(buffer)) {
      return { path: rel, language: 'plaintext', content: '', encoding: 'utf8', truncated, binary: true }
    }

    // Codificación: la FORZADA ("Reabrir con codificación": el usuario reinterpreta
    // los bytes con ese charset) o la autodetectada. Le pasamos `truncated` a la
    // detección para que solo entonces tolere un multibyte cortado al final.
    const encoding = forcedEncoding ?? detectEncoding(buffer, truncated)
    return {
      path: rel,
      language,
      content: decodeText(buffer, encoding),
      encoding,
      truncated,
      binary: false
    }
  }

  /**
   * Lee una entrada de TEXTO de dentro de un contenedor con el mismo contrato que
   * `readFile`: mismos topes, misma detección de binario y de codificación. Reusa
   * `detectEncoding`/`decodeText` a propósito — un `.properties` dentro de un jar de
   * 2003 es ISO-8859-1 por especificación, y decodificarlo como UTF-8 destroza los
   * acentos igual que lo haría con un fichero suelto.
   */
  private async leerEntradaDeContenedor(rel: string, forcedEncoding?: string): Promise<FileContent> {
    const nombre = rel.slice(Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('!')) + 1)
    const language = languageForFilename(nombre)
    const completo = await this.jar!.leerBytes(this.absDelContenedor(rel), rel)

    const truncated = completo.length > MAX_FILE_BYTES
    const buffer = truncated ? completo.subarray(0, MAX_FILE_BYTES) : completo

    if (isBinary(buffer)) {
      return { path: rel, language: 'plaintext', content: '', encoding: 'utf8', truncated, binary: true }
    }
    const encoding = forcedEncoding ?? detectEncoding(buffer, truncated)
    return { path: rel, language, content: decodeText(buffer, encoding), encoding, truncated, binary: false }
  }

  /**
   * Sobrescribe un archivo de texto del proyecto con `content` (UTF-8), leyendo
   * y validando la ruta igual que readFile (resolveSafe: anti-traversal + guarda
   * de proyecto activo). No crea estructura de carpetas nueva ni valida
   * existencia previa: en este bloque el archivo siempre viene de un read previo
   * exitoso (existe en disco). El bloqueo del caso "abierto truncado" vive en el
   * RENDERER (que es quien sabe si truncó al abrir); aquí se persiste lo que llega.
   */
  async writeFile(relPosix: string, content: string, encoding = 'utf8'): Promise<WriteFileResult> {
    const abs = this.resolveSafe(relPosix)
    const rel = normalizarRelativaProyecto(relPosix)
    // GUARDA ANTI-PÉRDIDA: escribir con un charset legacy que no representa algún
    // carácter lo sustituiría por '?' (corrupción silenciosa). Antes de escribir se
    // aborta con un error claro (el editor lo muestra) en vez de corromper el archivo.
    if (losesDataOnEncode(content, encoding)) {
      throw new Error(
        `El texto tiene caracteres que la codificación seleccionada no admite; ` +
          `guardar los perdería. Cambia a UTF-8 para conservarlos.`
      )
    }
    // Codifica con el encoding del archivo (el editor lo reenvía en cada guardado
    // para preservarlo; solo cambia si el usuario elige otro en el selector).
    const bytes = encodeText(content, encoding)
    // RECREA LA CARPETA SI HACE FALTA. El caso no es teórico: con una pestaña abierta
    // cuyo archivo borraron por fuera —a menudo borrando la CARPETA entera—, el
    // Ctrl+S que debe recrearlo moría con un ENOENT del directorio padre, y el
    // usuario veía «no se pudo guardar» con su contenido delante y sin salida. Es
    // recursivo y va dentro de la raíz ya validada por `resolveSafe`, así que no
    // puede crear nada fuera del proyecto.
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, bytes)
    return { path: rel, bytesWritten: bytes.length }
  }

  /**
   * Guarda un archivo SIN TÍTULO (Ctrl+N). La primera vez abre el diálogo NATIVO
   * de Windows para que el usuario elija dónde; a partir de ahí escribe en esa
   * misma ruta sin volver a preguntar, como hacen los editores: «Guardar como…» solo la
   * primera vez.
   *
   * NO usa resolveSafe a propósito: el destino lo elige el usuario en un diálogo
   * del SO y puede estar fuera del proyecto. Lo que se devuelve al renderer sigue
   * siendo neutro (nombre + ruta relativa si cayó dentro del proyecto, nunca la
   * ruta de Windows).
   */
  async saveUntitled(req: SaveUntitledRequest): Promise<SaveUntitledResult> {
    let abs = this.untitledTargets.get(req.id)
    if (!abs) {
      // Dónde abre, y que lo recuerde: `util/adaptadores/dialogosNativos.ts`. Con proyecto activo
      // arranca en él (lo esperable); sin proyecto, donde se guardó la última vez, y si
      // no, el home. Ya no «donde el SO decida»: desde Electron 43, sin carpeta, el SO
      // abre en Descargas.
      const res = await this.escritorio.guardarConDialogo(
        'guardar-como',
        req.suggestedName,
        {
          title: 'Guardar como',
          buttonLabel: 'Guardar',
          properties: ['createDirectory', 'showOverwriteConfirmation']
        },
        { ventana: this.getWindow?.() ?? null, antes: [this.root] }
      )
      if (res.canceled || !res.filePath) return { canceled: true }
      abs = path.resolve(res.filePath)
      this.untitledTargets.set(req.id, abs)
    }

    await fs.writeFile(abs, req.content, 'utf8')
    const rel = this.relFromHost(abs)
    // Guardado DENTRO del proyecto: la pestaña deja de ser "sin título" y pasa a
    // ser un archivo normal, así que su destino recordado ya no hace falta.
    if (rel !== null) this.untitledTargets.delete(req.id)
    return {
      canceled: false,
      name: path.basename(abs),
      path: rel,
      bytesWritten: Buffer.byteLength(req.content, 'utf8')
    }
  }

  /**
   * Ruta relativa (POSIX) al proyecto activo de una ruta host absoluta, o `null`
   * si cae FUERA del proyecto (o no hay proyecto activo). Inversa de resolveSafe:
   * traduce hacia el renderer sin filtrarle nunca la ruta del host.
   *
   * USA LAS MISMAS PRIMITIVAS QUE `isInside`/`samePath` (insensibles a la caja, como
   * NTFS y APFS), y eso no es cosmética. Con dos criterios distintos sobre "¿esto está
   * dentro del proyecto?" en el mismo módulo, cortar y pegar en la misma carpeta con
   * rutas de caja distinta acababa en «No había nada que pegar.», y guardar un archivo
   * sin título dentro del proyecto lo dejaba «sin título» para siempre.
   */
  private relFromHost(abs: string): string | null {
    if (this.root === null) return null
    // La raíz no es "un archivo dentro" (antes lo decía el `rel === ''`).
    if (samePath(abs, this.root)) return null
    if (!isInside(abs, this.root)) return null
    const raiz = this.root.endsWith(path.sep) ? this.root : this.root + path.sep
    // Se corta por LONGITUD sobre `abs` tal cual, y NO se usa la versión en
    // minúsculas: la insensibilidad vive en la COMPARACIÓN, nunca en la ruta que se
    // devuelve al renderer — la pestaña tiene que enseñar el nombre que el usuario
    // reconoce.
    return abs.slice(raiz.length).split(path.sep).join('/')
  }

  /**
   * Lee un archivo como BYTES crudos para un visor no-textual (hoy: PDF). No
   * detecta ni descarta binario (justo lo contrario que readFile). Trunca a
   * MAX_BINARY_BYTES: un PDF incompleto no se puede pintar, así que el renderer
   * usa `truncated` para avisar en vez de renderizar basura.
   */
  async readBinary(relPosix: string): Promise<BinaryFileContent> {
    const rel0 = normalizarRelativaProyecto(relPosix)
    if (esRutaVirtual(rel0) && this.jar !== null) {
      const bytes = await this.jar.leerBytes(this.absDelContenedor(rel0), rel0)
      // MISMO techo que un fichero de disco. El tope de zipRandom (64 MiB por entrada)
      // es más alto que MAX_BINARY_BYTES, así que sin esto un PDF de 60 MiB dentro de
      // un .war cruzaría el IPC entero —por encima del límite que respeta el resto de
      // la app— y encima diría `truncated:false`, que es mentir.
      const truncated = bytes.length > MAX_BINARY_BYTES
      const recorte = truncated ? bytes.subarray(0, MAX_BINARY_BYTES) : bytes
      return { path: rel0, bytes: new Uint8Array(recorte), size: bytes.length, truncated }
    }

    const abs = this.resolveSafe(relPosix)
    const rel = rel0
    const stat = await fs.stat(abs)
    if (!stat.isFile()) throw new Error(`No es un archivo: "${rel}".`)

    const truncated = stat.size > MAX_BINARY_BYTES
    const buffer = truncated ? await readPrefix(abs, MAX_BINARY_BYTES) : await fs.readFile(abs)
    // Uint8Array explícito: es lo que llega al renderer tras el structured-clone
    // del IPC y evita depender de que Electron convierta Buffer -> Uint8Array.
    return { path: rel, bytes: new Uint8Array(buffer), size: stat.size, truncated }
  }

  /**
   * Convierte un .docx a HTML con formato usando mammoth (MIT). Corre en el MAIN
   * (Node) para no arrastrar mammoth ni sus polyfills al bundle del renderer; el
   * renderer solo recibe HTML y lo sanea con DOMPurify antes de pintarlo. Solo
   * .docx moderno (OOXML); el .doc binario legado no está soportado.
   */
  async readDocx(relPosix: string): Promise<DocxHtmlResult> {
    const rel = normalizarRelativaProyecto(relPosix)
    // Un .docx DENTRO de un .jar/.war se lee igual que uno de disco: es una lectura,
    // y las lecturas bifurcan ANTES de `resolveSafe`. Sin esta rama caía en la guarda
    // de ESCRITURA y el usuario recibía "no se puede modificar desde aquí" por haber
    // hecho doble clic para MIRAR: un mensaje que describe algo que nadie intentó.
    const buffer = await this.bytesParaVisor(rel, relPosix, 'Documento demasiado grande para previsualizar (>50 MiB).')
    // La conversión OOXML->HTML de mammoth es CPU-pesada y SÍNCRONA: corre en un
    // worker_threads para no congelar el hilo main con un .docx grande/complejo.
    const { html, messages } = await runFileWorker<{ html: string; messages: string[] }>('docx-html', buffer)
    return { path: rel, html, messages }
  }

  /**
   * Lista el contenido de un .zip SIN descomprimirlo. fflate (MIT) recorre el
   * índice y, con un `filter` que siempre devuelve false, obtiene los metadatos
   * (nombre, tamaños) de cada entrada sin inflar sus datos: barato incluso para
   * zips grandes. Carpetas primero, luego por nombre.
   */
  async readZip(relPosix: string): Promise<ZipListing> {
    const rel = normalizarRelativaProyecto(relPosix)
    // Igual que readDocx: un .zip dentro de un contenedor se LISTA, no se modifica.
    const buffer = await this.bytesParaVisor(rel, relPosix, 'Archivo comprimido demasiado grande para listar (>50 MiB).')
    // El recorrido del índice del zip (unzipSync) es síncrono: en un zip con decenas
    // de miles de entradas bloqueaba el main. Corre en un worker; el orden se aplica
    // aquí (barato) para mantener la lógica de presentación en el servicio.
    const { entries } = await runFileWorker<{ entries: ZipEntry[] }>('zip-list', buffer)
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    })
    return { path: rel, entries }
  }

  /**
   * Abre el archivo o carpeta en el explorador del SO y lo deja seleccionado
   * (shell.showItemInFolder). Resuelve+valida la ruta igual que el resto
   * (anti-traversal): el renderer solo manda la ruta relativa.
   */
  async reveal(relPosix: string): Promise<void> {
    // Dentro de un .jar no hay nada que revelar en el Explorador de Windows, pero
    // "no hacer nada" sería peor: se COLAPSA al .jar que la contiene, que es la
    // respuesta útil a "enséñame dónde está esto".
    const abs = this.resolveSafe(this.colapsarAContenedor(relPosix))
    // showItemInFolder es síncrono; el await de la firma mantiene el contrato IPC.
    this.escritorio.revelarEnCarpeta(abs)
  }

  /**
   * Bytes completos de un archivo para un VISOR que necesita el fichero entero
   * (mammoth con un .docx, fflate con un .zip), venga de disco o de dentro de un
   * contenedor. Aplica el mismo techo en los dos casos.
   *
   * Existe para que los visores no tengan que repetir —y olvidarse de— la
   * bifurcación de rutas virtuales. Truncar aquí NO vale: a diferencia de un PDF,
   * un .docx o un .zip a medias no se pueden abrir, así que se rechaza con un
   * mensaje que dice el motivo real.
   */
  private async bytesParaVisor(rel: string, relPosix: string, siEsGrande: string): Promise<Buffer> {
    if (esRutaVirtual(rel) && this.jar !== null) {
      const bytes = await this.jar.leerBytes(this.absDelContenedor(rel), rel)
      if (bytes.length > MAX_BINARY_BYTES) throw new Error(siEsGrande)
      return bytes
    }
    const abs = this.resolveSafe(relPosix)
    const stat = await fs.stat(abs)
    if (!stat.isFile()) throw new Error(`No es un archivo: "${rel}".`)
    if (stat.size > MAX_BINARY_BYTES) throw new Error(siEsGrande)
    return fs.readFile(abs)
  }

  /** Si la ruta es virtual, la del contenedor de disco; si no, ella misma. */
  private colapsarAContenedor(relPosix: string): string {
    const enDisco = contenedorEnDiscoDe(relPosix)
    return enDisco !== '' ? enDisco : relPosix
  }

  /**
   * Abre el archivo con la app por defecto del SO (Word para .docx, etc.). Devuelve
   * el mensaje de error de `shell.openPath` (o '' si abrió bien) para que el renderer
   * avise si no hay app asociada. resolveSafe cubre el anti-traversal.
   */
  async openPath(relPosix: string): Promise<string> {
    // Igual que reveal: se abre el .jar con la app del sistema, no una ruta que no
    // existe.
    const abs = this.resolveSafe(this.colapsarAContenedor(relPosix))
    return this.escritorio.abrirRuta(abs)
  }

  /**
   * Crea un archivo vacío o una carpeta llamado `name` DENTRO de `dirRelPosix`.
   * Valida el nombre (sin separadores ni '.'/'..') y que no exista ya. Devuelve la
   * ruta relativa del nuevo nodo. resolveSafe cubre el anti-traversal.
   */
  async createEntry(dirRelPosix: string, name: string, kind: 'file' | 'dir'): Promise<CreatedEntry> {
    const clean = validateName(name)
    const dirRel = normalizarRelativaProyecto(dirRelPosix).replace(/\/+$/, '')
    const relPosix = dirRel ? `${dirRel}/${clean}` : clean
    const abs = this.resolveSafe(relPosix)
    // No pisar algo existente (archivo o carpeta con ese nombre).
    if (await exists(abs)) throw new Error(`Ya existe "${clean}" en esa carpeta.`)
    if (kind === 'dir') {
      await fs.mkdir(abs)
    } else {
      // 'wx' = crear en exclusiva: falla si aparece entre el check y aquí (carrera).
      const handle = await fs.open(abs, 'wx')
      await handle.close()
    }
    return { path: relPosix }
  }

  /**
   * Renombra un archivo/carpeta a `newName` DENTRO de su misma carpeta padre.
   * Valida el nombre y que el destino no exista. Devuelve la nueva ruta relativa.
   *
   * CAMBIAR SÓLO LAS MAYÚSCULAS (`Foo.txt` → `foo.txt`) TIENE QUE FUNCIONAR, y no lo
   * hacía. En APFS y en NTFS —los dos sistemas donde Tessera corre— el nombre no
   * distingue mayúsculas pero sí las conserva, así que el destino "ya existe": es el
   * propio archivo. Comparando con `===` no era ni el no-op (las cadenas difieren) ni
   * un destino libre, y el usuario recibía «Ya existe "foo.txt" en esa carpeta.» sin
   * manera de corregir la capitalización. Se distingue con `samePath`, que es el
   * comparador que este módulo ya usa en todas partes: mismo archivo con otra caja se
   * renombra sin más comprobación (`fs.rename` sí aplica el cambio de caja en los dos
   * sistemas); mismo archivo y misma caja sigue siendo el no-op de siempre.
   */
  async rename(relPosix: string, newName: string): Promise<CreatedEntry> {
    const clean = validateName(newName)
    const abs = this.resolveSafe(relPosix)
    const rel = normalizarRelativaProyecto(relPosix).replace(/\/+$/, '')
    const slash = rel.lastIndexOf('/')
    const parentRel = slash < 0 ? '' : rel.slice(0, slash)
    const destRel = parentRel ? `${parentRel}/${clean}` : clean
    const destAbs = this.resolveSafe(destRel)
    if (destAbs === abs) return { path: rel } // mismo nombre EXACTO: no-op
    const soloOtraCaja = samePath(destAbs, abs)
    if (!soloOtraCaja && (await exists(destAbs))) throw new Error(`Ya existe "${clean}" en esa carpeta.`)
    await fs.rename(abs, destAbs)
    return { path: destRel }
  }

  /**
   * Mueve VARIOS archivos/carpetas DENTRO de `destDirRelPosix` (drag & drop),
   * conservando sus nombres.
   *
   * TODO O NADA CONTRA LAS COLISIONES: se valida la lista entera antes de tocar el
   * disco y, si algún nombre ya existe en el destino, no se mueve nada y se
   * devuelven los nombres en `conflicts`. Misma política que `importFromHost`, y por
   * el mismo motivo: un movimiento a medias deja el árbol en un estado que el
   * usuario no pidió y no sabe deshacer.
   *
   * LO QUE ESA GARANTÍA *NO* CUBRE, y conviene tenerlo escrito: un `fs.rename` que
   * falle a mitad del bucle (permiso, archivo abierto por otro proceso en Windows)
   * propaga con parte ya movida. No hay rollback y no se finge que lo haya —
   * revertir renames a medias es otro camino que también puede fallar—. La
   * comprobación previa cubre el caso REAL, que es la colisión de nombre.
   *
   * Rechaza mover algo sobre sí mismo o dentro de un descendiente suyo (ciclo), y
   * DESCARTA en silencio lo que ya vive en el destino: arrastrar A+B sobre la
   * carpeta donde A ya está tiene que mover B, no fallar. `resolveSafe` cubre el
   * anti-traversal y las rutas virtuales en los dos extremos.
   */
  async moveMany(srcsRelPosix: readonly string[], destDirRelPosix: string): Promise<MoveResult> {
    const destDir = normalizarRelativaProyecto(destDirRelPosix).replace(/\/+$/, '')
    const destDirAbs = this.resolveSafe(destDir)
    const destStat = await fs.stat(destDirAbs).catch(() => null)
    if (!destStat?.isDirectory()) throw new Error('El destino no es una carpeta.')

    interface Job {
      srcAbs: string
      destAbs: string
      rel: string
      name: string
    }
    const jobs: Job[] = []
    const nombres = new Set<string>()
    for (const src of srcsRelPosix) {
      const srcRel = normalizarRelativaProyecto(src).replace(/\/+$/, '')
      if (!srcRel) throw new Error('Origen inválido.')
      const slash = srcRel.lastIndexOf('/')
      const srcParent = slash < 0 ? '' : srcRel.slice(0, slash)
      if (destDir === srcParent) continue // ya está ahí: no-op silencioso
      if (destDir === srcRel || destDir.startsWith(`${srcRel}/`)) {
        throw new Error('No se puede mover una carpeta dentro de sí misma.')
      }
      const name = srcRel.slice(slash + 1)
      // Dos orígenes con el MISMO nombre (de carpetas distintas) colisionan ENTRE
      // ELLOS, y `exists` no puede verlo: cuando se comprueba el segundo, el primero
      // todavía no se ha movido. Sin esta guarda, el segundo `rename` pisaría al
      // primero y el archivo se perdería en silencio.
      //
      // Se compara con `comparablePath`, NO con el nombre crudo: Windows y APFS
      // conservan la caja pero no la distinguen, así que `A.txt` y `a.txt` son el
      // mismo destino y con un Set sensible a mayúsculas se colaban los dos — el
      // mismo motivo por el que `rename` usa `samePath`.
      const clave = comparablePath(name)
      if (nombres.has(clave)) {
        throw new Error(
          `Hay dos elementos llamados "${name}" en la selección: no caben los dos en la misma carpeta.`
        )
      }
      nombres.add(clave)
      const srcAbs = this.resolveSafe(srcRel)
      // El origen tiene que EXISTIR, y se comprueba en la validación por lo mismo que
      // las colisiones: sin esto, una selección de hace unos segundos cuyo segundo
      // elemento acaba de borrar un build reventaba con un ENOENT crudo A MITAD del
      // bucle, dejando el lote movido a medias — justo el estado que el todo-o-nada
      // existe para impedir. El `stat` cuesta lo mismo que el `exists` del destino.
      if (!(await exists(srcAbs))) throw new Error(`Ya no existe "${name}".`)
      const rel = destDir ? `${destDir}/${name}` : name
      jobs.push({ srcAbs, destAbs: this.resolveSafe(rel), rel, name })
    }
    if (jobs.length === 0) return { moved: [], conflicts: [] }

    const conflicts: string[] = []
    for (const job of jobs) if (await exists(job.destAbs)) conflicts.push(job.name)
    if (conflicts.length > 0) return { moved: [], conflicts }

    for (const job of jobs) await fs.rename(job.srcAbs, job.destAbs)
    this.log(`movidos ${jobs.length} elemento(s) a "${destDir || '.'}"`)
    return { moved: jobs.map((j) => j.rel), conflicts: [] }
  }

  /**
   * PEGA en `destDir` lo que el usuario copió o cortó (menú contextual del
   * explorador y Ctrl+V). Ver PasteRequest para por qué no reutiliza MOVE/IMPORT.
   *
   * OJO con `hostPaths` + `op:'cortar'`: esa combinación MUEVE (y por tanto puede
   * borrar) rutas de cualquier parte del disco, así que NO se expone por IPC. El
   * handler de `files:paste` solo construye la forma interna (`src` relativo); el
   * origen externo lo compone `pasteFromClipboard`, en el main, a partir de lo que
   * de verdad hay en el portapapeles.
   *
   * Política, deliberadamente distinta a la del arrastre:
   *   - NUNCA pisa un archivo existente: renombra ("informe - copia.md",
   *     "informe - copia (2).md"), como el Explorador de Windows. Así "pegar en la
   *     misma carpeta" duplica —que es justo lo que el usuario espera— en vez de
   *     fallar con "ya existe".
   *   - NUNCA pregunta: pegar es un gesto rápido, un diálogo lo rompe.
   *   - Best-effort por elemento: pegar 5 archivos y que uno falle no debe abortar
   *     los otros 4. Lo que falla se reporta con su nombre y el resto sigue.
   *
   * CORTAR de fuera del proyecto (Ctrl+X en el Explorador de Windows) sí MUEVE: es
   * lo que el usuario pidió allí. Pero `fs.rename` falla con EXDEV entre volúmenes
   * (D:\Descargas -> proyecto en C:\), así que hay copia+borrado de respaldo; si el
   * borrado del original falla, se deja el duplicado y NO se insiste: perder el
   * original del usuario es peor que dejarle dos copias.
   */
  async paste(req: PasteOptions): Promise<PasteResult> {
    if (this.root === null) throw new Error('No hay proyecto activo.')
    const projectRoot = this.root
    const destDir = normalizarRelativaProyecto(req.destDir).replace(/\/+$/, '')
    const destDirAbs = this.resolveSafe(destDir)
    const destStat = await fs.stat(destDirAbs).catch(() => null)
    if (!destStat?.isDirectory()) throw new Error('El destino no es una carpeta.')

    // Origen unificado: interno (relativo) y externo (absoluto) acaban ambos en una
    // lista de rutas ABSOLUTAS ya validadas. `resolveSafe` cubre el interno; el
    // externo es legítimamente de fuera y solo se comprueba que exista.
    const sources: string[] = []
    for (const src of req.srcs ?? []) {
      const srcRel = normalizarRelativaProyecto(src).replace(/\/+$/, '')
      if (!srcRel) throw new Error('Origen inválido.')
      sources.push(this.resolveSafe(srcRel))
    }
    for (const hostPath of req.hostPaths ?? []) sources.push(path.resolve(hostPath))
    if (sources.length === 0) throw new Error('No hay nada que pegar.')
    if (req.nombre !== undefined && sources.length > 1) {
      throw new Error('No se puede renombrar al pegar varios elementos.')
    }

    const pasted: string[] = []
    const failed: string[] = []
    for (const srcAbs of sources) {
      const r = await this.pegarUno(srcAbs, req, { rel: destDir, abs: destDirAbs, projectRoot })
      switch (r.tipo) {
        case 'pegado':
          pasted.push(r.rel)
          break
        case 'fallido':
          failed.push(r.nombre)
          break
        case 'noop':
          break
        default: {
          const imposible: never = r
          throw new Error(`desenlace de pegado desconocido: ${JSON.stringify(imposible)}`)
        }
      }
    }

    this.log(`pegados ${pasted.length} elemento(s) en "${destDir || '.'}" (${failed.length} fallidos)`)
    // Solo se LANZA si no entró nada. Un fallo parcial se DEVUELVE: lanzarlo perdía
    // la lista de lo que sí se pegó y, en un CORTE, se saltaba el vaciado posterior
    // del portapapeles, que es justo lo que evita que el siguiente pegado falle sobre
    // rutas ya inexistentes.
    if (pasted.length === 0) {
      if (failed.length === 0) throw new Error('No había nada que pegar.')
      const que = failed.length > 1 ? 'ninguno de los elementos' : `"${failed[0]}"`
      throw new Error(`No se pudo pegar ${que}.`)
    }
    return { paths: pasted, fallidos: failed }
  }

  /**
   * Un elemento del pegado: `pegado` con la ruta relativa resultante, `fallido` con el nombre
   * del origen que no entró, o `noop`: un corte pegado donde ya estaba sin ruta que devolver.
   */
  private async pegarUno(
    srcAbs: string,
    req: PasteOptions,
    destino: { rel: string; abs: string; projectRoot: string }
  ): Promise<DesenlacePegado> {
    const srcStat = await fs.stat(srcAbs).catch(() => null)
    const originalName = path.basename(srcAbs)
    if (!srcStat || (!srcStat.isFile() && !srcStat.isDirectory())) {
      return { tipo: 'fallido', nombre: originalName || '(sin nombre)' }
    }
    // Meter una carpeta dentro de sí misma (o de un descendiente) recursaría sin fin.
    if (srcStat.isDirectory() && isInside(destino.abs, srcAbs)) return { tipo: 'fallido', nombre: originalName }
    // Mover algo justo donde ya está es un no-op, no un error: pegar un CORTE en la
    // carpeta de origen debe dejarlo como estaba. Un COPIAR, en cambio, duplica.
    const mueve = req.op === 'cortar' && isInside(srcAbs, destino.projectRoot)
    if (mueve && samePath(path.dirname(srcAbs), destino.abs)) {
      const yaEstaba = this.relFromHost(srcAbs)
      return yaEstaba !== null ? { tipo: 'pegado', rel: yaEstaba } : { tipo: 'noop' }
    }
    try {
      // El nombre de ORIGEN viene del sistema de archivos y por construcción ya es
      // legal: pasarlo por validateName —pensado para lo que se teclea en un
      // diálogo— lo recortaría, y copiar " nota.txt" acabaría creando "nota.txt",
      // un renombrado silencioso en mitad de lo que el usuario pidió como copia.
      // Solo se valida el nombre IMPUESTO por el llamador.
      const base = req.nombre !== undefined ? validateName(req.nombre) : originalName
      const name = await uniqueName(destino.abs, base)
      const destAbs = path.join(destino.abs, name)
      if (req.op === 'cortar') {
        await moveAcrossVolumes(srcAbs, destAbs)
      } else {
        await fs.cp(srcAbs, destAbs, { recursive: true, errorOnExist: true, force: false })
      }
      return { tipo: 'pegado', rel: destino.rel ? `${destino.rel}/${name}` : name }
    } catch {
      return { tipo: 'fallido', nombre: originalName }
    }
  }

  /**
   * Ruta ABSOLUTA del host de algo del proyecto, para el "Copiar ruta" del menú
   * contextual. Devuelve '' si la ruta no es válida, con el mismo criterio que
   * `fileUrl`: un ítem de menú que falla en silencio es mejor que una excepción
   * cruzando el IPC por algo tan inocuo como copiar texto.
   *
   * NO comprueba que exista: copiar la ruta de algo recién borrado sigue siendo una
   * respuesta útil, y así no se paga un stat por cada clic.
   */
  async absPath(relPosix: string): Promise<string> {
    try {
      // Para algo de dentro de un .jar no existe una ruta de Windows: devolver la
      // del contenedor a secas sería una ruta CREÍBLE PERO FALSA en el portapapeles.
      // Se devuelve el localizador completo `C:\…\x.jar!/com/A.class`, la forma `jar!/`
      // con que las trazas de la JVM nombran una clase, que sí identifica lo copiado.
      const enDisco = contenedorEnDiscoDe(relPosix)
      if (enDisco !== '') {
        const rel = normalizarRelativaProyecto(relPosix)
        return this.resolveProyecto(enDisco) + rel.slice(enDisco.length)
      }
      return this.resolveSafe(relPosix)
    } catch {
      return ''
    }
  }

  /**
   * Trae al proyecto los archivos/carpetas que el usuario soltó sobre el árbol.
   * `hostPaths` son rutas absolutas del host que produjo Electron a partir de los
   * `File` soltados (ver ImportRequest); el DESTINO sí pasa por resolveSafe
   * (anti-traversal).
   *
   * MOVER o COPIAR se decide AQUÍ, por el origen, imitando al Explorador de
   * Windows: lo que viene de FUERA del proyecto se copia (el original en Descargas
   * queda intacto); lo que ya vive DENTRO se mueve (arrastrar una fila del árbol a
   * otra carpeta es reordenar, no duplicar). El renderer no elige: manda las rutas
   * y el main aplica la regla.
   *
   * Todo-o-nada ante colisiones: con `overwrite:false` NO toca nada si algún
   * nombre ya existe en el destino y devuelve la lista para que el renderer
   * confirme; con `overwrite:true` sobrescribe (al copiar, las carpetas se fusionan).
   */
  async importFromHost(
    hostPaths: string[],
    destDirRelPosix: string,
    overwrite: boolean
  ): Promise<ImportResult> {
    if (this.root === null) throw new Error('No hay proyecto activo.')
    const projectRoot = this.root
    const destDir = normalizarRelativaProyecto(destDirRelPosix).replace(/\/+$/, '')
    const destDirAbs = this.resolveSafe(destDir)
    const destStat = await fs.stat(destDirAbs)
    if (!destStat.isDirectory()) throw new Error('El destino no es una carpeta.')

    // Valida TODO antes de tocar NADA: el resultado es todo-o-nada.
    interface Job {
      srcAbs: string
      destAbs: string
      rel: string
      name: string
      /** 'move' si el origen ya vive dentro del proyecto; 'copy' si viene de fuera. */
      mode: 'move' | 'copy'
    }
    const jobs: Job[] = []
    for (const hostPath of hostPaths) {
      const srcAbs = path.resolve(hostPath)
      const name = path.basename(srcAbs)
      if (!name) throw new Error('Origen inválido.')
      const srcStat = await fs.stat(srcAbs).catch(() => null)
      if (!srcStat) throw new Error(`No se pudo leer "${name}".`)
      if (!srcStat.isFile() && !srcStat.isDirectory()) throw new Error(`"${name}" no es un archivo.`)
      const rel = destDir ? `${destDir}/${name}` : name
      const destAbs = this.resolveSafe(rel)
      // Meter una carpeta dentro de sí misma (o de un descendiente) recursaría sin fin.
      if (srcStat.isDirectory() && isInside(destDirAbs, srcAbs)) {
        throw new Error(`No se puede mover "${name}" dentro de sí misma.`)
      }
      // Soltar algo justo donde ya está: no-op silencioso (cp/rename fallarían con src===dest).
      if (samePath(srcAbs, destAbs)) continue
      // (La raíz del proyecto la cubre ya la guarda de ciclo de arriba: todo destino
      // vive DENTRO de ella, así que soltarla en cualquier sitio es meterla en sí misma.)
      jobs.push({ srcAbs, destAbs, rel, name, mode: isInside(srcAbs, projectRoot) ? 'move' : 'copy' })
    }

    if (!overwrite) {
      const conflicts: string[] = []
      for (const job of jobs) {
        if (await exists(job.destAbs)) conflicts.push(job.name)
      }
      if (conflicts.length > 0) return { imported: [], conflicts }
    }

    for (const job of jobs) {
      if (job.mode === 'move') {
        // `rename` no pisa un destino existente en Windows: con overwrite hay que
        // quitarlo antes (con `overwrite:false` este caso ya salió por `conflicts`).
        if (overwrite) await fs.rm(job.destAbs, { recursive: true, force: true })
        await fs.rename(job.srcAbs, job.destAbs)
      } else {
        await fs.cp(job.srcAbs, job.destAbs, {
          recursive: true,
          force: overwrite,
          errorOnExist: !overwrite
        })
      }
    }
    const moved = jobs.filter((j) => j.mode === 'move').length
    this.log(
      `${jobs.length} elemento(s) en "${destDir || '.'}" (${moved} movido(s), ${jobs.length - moved} copiado(s))`
    )
    return { imported: jobs.map((j) => j.rel), conflicts: [] }
  }

  /**
   * URL `file://` de un ARCHIVO del proyecto, para el `DownloadURL` del arrastre
   * (ver FILE_URL y Sidebar). Devuelve '' si no existe o es una carpeta: Chromium no
   * sabe "descargar" un directorio, así que arrastrar carpetas fuera de la app no se
   * ofrece.
   *
   * resolveSafe cubre el anti-traversal: solo se puede pedir la URL de algo que viva
   * dentro del proyecto activo.
   */
  async fileUrl(relPosix: string): Promise<string> {
    let abs: string
    try {
      abs = this.resolveSafe(relPosix)
    } catch {
      return ''
    }
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat || !stat.isFile()) return ''
    return pathToFileURL(abs).toString()
  }

  /**
   * Arranca un arrastre NATIVO del sistema con VARIOS archivos del proyecto, que es
   * la única forma de entregar más de uno al Explorador o al Finder (ver
   * `FILE_CHANNELS.START_DRAG` para por qué no vale `DownloadURL`).
   *
   * RECIBE EL `webContents` DEL EVENTO (lo pasa `ipc.ts`) y no la ventana guardada:
   * `startDrag` tiene que arrancar en el mismo `webContents` que está viviendo el gesto
   * del ratón, y con la ventana de `getWindow()` bastaría hoy pero no lo diría el código.
   *
   * Las rutas pasan por `resolveSafe` como cualquier otra: una dentro de un `.jar`
   * o fuera del proyecto no llega a la API del sistema. Y se descarta lo que ya no
   * exista, porque `startDrag` aborta ENTERO si una sola ruta falta — con una
   * selección hecha hace unos segundos eso sería un gesto muerto sin explicación.
   */
  async startDrag(
    sender: Pick<WebContents, 'startDrag'>,
    relPosixList: readonly string[],
    icono: string
  ): Promise<void> {
    const abs: string[] = []
    for (const rel of relPosixList) {
      try {
        const p = this.resolveSafe(rel)
        if (await exists(p)) abs.push(p)
      } catch {
        // Ruta inválida (virtual, fuera del proyecto): se omite. El resto del
        // arrastre sigue siendo legítimo y negarlo entero no ayudaría a nadie.
      }
    }
    // NO QUEDA NADA QUE ARRASTRAR, y esto se DICE en vez de volver callando. Se llega
    // aquí cuando otro proceso se llevó la selección entre el clic y el arrastre. El
    // gesto ya no tiene vuelta atrás —el arrastre HTML5 se canceló para dar paso a
    // este—, así que sin aviso el usuario ve un arrastre muerto, sin cursor de
    // "prohibido" ni nada: el renderer pinta este mensaje en su banner.
    if (abs.length === 0) {
      throw new Error(
        relPosixList.length === 1
          ? 'Eso ya no está en el proyecto: no hay nada que arrastrar.'
          : 'Ninguno de esos elementos sigue en el proyecto: no hay nada que arrastrar.'
      )
    }
    const imagen = this.escritorio.imagenDesdeDataUrl(icono)
    // `startDrag` LANZA con un icono vacío, así que un data-URL corrupto tumbaría el
    // arrastre entero. Con el respaldo, el gesto funciona aunque la imagen sea fea:
    // el usuario pidió sacar los archivos, no una estampita.
    const icon = imagen.isEmpty() ? this.escritorio.imagenDesdeDataUrl(ICONO_ARRASTRE_MINIMO) : imagen
    if (icon.isEmpty()) return
    // `file` es obligatorio en el tipo aunque `files` lo sustituya: la doc de Electron
    // dice que cuando van los dos manda `files`, y el primero se repite ahí sólo para
    // satisfacer la firma. Sin él no compila; con él, el comportamiento es el de la
    // lista.
    sender.startDrag({ file: abs[0], files: [...abs], icon })
  }

  /**
   * Elimina VARIOS archivos/carpetas (recursivo). resolveSafe impide salir del
   * proyecto y bloquea las rutas dentro de un contenedor.
   *
   * DOS POLÍTICAS EN LA MISMA FUNCIÓN, y las dos a propósito:
   *   - la VALIDACIÓN es todo-o-nada y LANZA (ruta fuera del proyecto, dentro de un
   *     .jar, o la propia raíz): una petición malformada no debe borrar "casi todo"
   *     y luego quejarse;
   *   - el BORRADO es best-effort: un `rm` que falle porque otro proceso tiene el
   *     archivo abierto no puede impedir que se borren los otros nueve. Lo que falla
   *     vuelve en `fallidos` con su nombre.
   */
  async deleteMany(relPosixList: readonly string[]): Promise<DeleteResult> {
    const objetivos = relPosixList.map((rel) => {
      const abs = this.resolveSafe(rel)
      // Guarda extra: nunca borrar la raíz del proyecto en sí.
      if (abs === this.root) throw new Error('No se puede eliminar la raíz del proyecto.')
      return { rel, abs }
    })
    const deleted: string[] = []
    const fallidos: string[] = []
    for (const { rel, abs } of objetivos) {
      try {
        await fs.rm(abs, { recursive: true, force: true })
        deleted.push(rel)
      } catch {
        fallidos.push(rel.slice(rel.lastIndexOf('/') + 1) || rel)
      }
    }
    if (objetivos.length > 0) {
      this.log(`eliminados ${deleted.length} elemento(s) (${fallidos.length} fallidos)`)
    }
    return { deleted, fallidos }
  }

  /**
   * (Re)arranca el watcher recursivo de la raíz activa. Cierra el anterior si lo
   * había. Sin ventana (getWindow) o sin raíz, no hace nada. fs.watch recursivo
   * está soportado en Windows y macOS; ante cualquier fallo (p. ej. la carpeta
   * desapareció) NO propaga: el árbol simplemente deja de auto-refrescarse.
   */
  private startWatching(): void {
    this.stopWatching()
    if (!this.getWindow || this.root === null) return
    try {
      this.watcher = watch(this.root, { recursive: true }, (_evt, filename) => {
        // Clasifica el cambio: 'noise' (node_modules / .git/objects) se ignora;
        // 'git' (HEAD/refs/packed-refs/logs/index — cambio de git relevante hecho
        // fuera de la app) emite files:gitChanged; el resto recarga el árbol.
        const kind = filename ? classifyPath(filename) : 'file'
        if (kind === 'noise') return
        if (kind === 'git') {
          this.scheduleGitEvent()
          return
        }
        // Si el que cambió es un .jar/.war, se suelta su índice cacheado. La clave de
        // la caché ya lleva mtime y tamaño, así que la CORRECCIÓN no depende de esto
        // —un jar reconstruido nunca se sirve viejo—, pero sin soltarlo el índice
        // muerto se queda ocupando el presupuesto de memoria y desaloja a otros que
        // sí sirven. Pasa de verdad: un `mvn package` reescribe media carpeta lib/.
        if (filename != null && this.jar !== null && esNombreContenedor(filename)) {
          try {
            // El watcher entrega la ruta con el separador del HOST: la misma regla
            // por plataforma que el resto del servicio (en Mac un `\` del nombre no
            // se toca; en Windows es el separador y pasa a `/`).
            this.jar.invalidar(this.resolveProyecto(normalizarRelativaProyecto(filename)))
          } catch {
            // Ruta rara del watcher: no es motivo para dejar de refrescar el árbol.
          }
        }
        this.scheduleChangeEvent(filename)
      })
    } catch (err) {
      this.log(`watcher no disponible: ${err instanceof Error ? err.message : String(err)}`)
      this.watcher = null
    }
  }

  /**
   * Teardown público (cierre de la app): cierra el FSWatcher recursivo y cancela sus
   * temporizadores pendientes, en vez de dejarlos vivos hasta que muera el proceso.
   */
  dispose(): void {
    this.stopWatching()
  }

  /** Cierra el watcher y cancela los avisos pendientes. */
  private stopWatching(): void {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer)
      this.watchTimer = null
    }
    // Un cambio pendiente del proyecto ANTERIOR no debe entregarse tras re-apuntar.
    // Sus RUTAS tampoco: son relativas a la raíz vieja, y entregarlas contra la nueva
    // haría releer archivos que no tienen nada que ver.
    this.changePending = false
    this.changedPaths.clear()
    this.changedPartial = false
    if (this.gitTimer) {
      clearTimeout(this.gitTimer)
      this.gitTimer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  /**
   * Colapsa la ráfaga de eventos del watcher en avisos al renderer, con DOS frenos:
   *
   *   - debounce (WATCH_DEBOUNCE_MS): un cambio aislado espera a que amaine la ráfaga
   *     de eventos que fs.watch emite por un solo guardado.
   *   - intervalo mínimo (MIN_CHANGE_INTERVAL_MS): entre dos avisos consecutivos.
   *
   * El segundo freno es el que faltaba, y es el importante. Un debounce por sí solo
   * NO acota una escritura SOSTENIDA: si el agente (o `npm install`) escribe cada
   * 250 ms, cada escritura supera el debounce de 200 ms y emite su propio evento.
   * Medido: 20 escrituras en 5 s producían 21 avisos, y cada aviso costaba re-listar
   * el árbol en el renderer MÁS un `git status` por repo. Con el intervalo mínimo la
   * misma ráfaga emite unos pocos avisos, sin perder ninguno: el último cambio
   * SIEMPRE se entrega (flanco de salida).
   */
  private scheduleChangeEvent(filename?: string | null): void {
    this.changePending = true
    // Acumula QUÉ cambió durante la ventana de antirrebote. Con tope: un `npm
    // install` toca miles de archivos y mandarlos todos por IPC no le sirve a nadie.
    // Al desbordar se marca `parcial` en vez de entregar una lista truncada que
    // parezca completa: el renderer prefiere releer todo lo que tiene abierto (son
    // unas pocas pestañas) antes que perderse justo el archivo que importaba.
    if (filename != null && filename !== '') {
      if (this.changedPaths.size < MAX_CHANGED_PATHS) {
        this.changedPaths.add(normalizarRelativaProyecto(filename))
      } else {
        this.changedPartial = true
      }
    } else {
      this.changedPartial = true // el watcher no dio nombre: no se puede acotar
    }
    if (this.watchTimer) return // ya hay un aviso programado; este cambio va en él
    const sinceLast = Date.now() - this.lastChangeEmit
    const wait = Math.max(WATCH_DEBOUNCE_MS, MIN_CHANGE_INTERVAL_MS - sinceLast)
    this.watchTimer = setTimeout(() => this.emitChangeEvent(), wait)
  }

  /** Entrega el aviso pendiente (flanco de salida del throttle de arriba). */
  private emitChangeEvent(): void {
    this.watchTimer = null
    if (!this.changePending) return
    this.changePending = false
    this.lastChangeEmit = Date.now()
    const payload: FilesChangedEvent = {
      paths: [...this.changedPaths],
      parcial: this.changedPartial
    }
    this.changedPaths.clear()
    this.changedPartial = false
    const win = this.getWindow?.()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(FILE_CHANNELS.CHANGED, payload)
    }
  }

  /** Colapsa la ráfaga de cambios de metadata git en un único aviso al renderer.
   *  Debounce mayor: una operación git (commit/merge) toca varios refs a la vez. */
  private scheduleGitEvent(): void {
    if (this.gitTimer) clearTimeout(this.gitTimer)
    this.gitTimer = setTimeout(() => {
      this.gitTimer = null
      const win = this.getWindow?.()
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(FILE_CHANNELS.GIT_CHANGED)
      }
    }, GIT_WATCH_DEBOUNCE_MS)
  }
}

/**
 * Corre una tarea CPU-pesada de visor (listar zip / convertir docx) en un
 * worker_threads EFÍMERO y devuelve su resultado, para no bloquear el hilo main.
 * Spawn-por-tarea (sin pool): son operaciones infrecuentes, así el worker no queda
 * residente. El buffer viaja por `workerData` (structured clone). El bundle del
 * worker se emite junto al main (ver electron.vite.config) como `fileWorker.js`.
 */
function runFileWorker<T>(kind: 'zip-list' | 'docx-html', bytes: Buffer): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'fileWorker.js'), { workerData: { kind, bytes } })
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      void worker.terminate()
      fn()
    }
    worker.once('message', (msg: { ok: boolean; result?: T; error?: string }) => {
      finish(() =>
        msg && msg.ok
          ? resolve(msg.result as T)
          : reject(new Error(msg?.error ?? 'Error en el worker de archivos.'))
      )
    })
    worker.once('error', (err) => finish(() => reject(err)))
    worker.once('exit', (code) => {
      if (!settled) {
        settled = true
        reject(new Error(`El worker de archivos salió inesperadamente (código ${code}).`))
      }
    })
  })
}

/**
 * Respaldo del icono del arrastre nativo: un cuadrado gris de 16x16.
 *
 * `startDrag` LANZA si el icono está vacío, así que sin este respaldo un data-URL
 * corrupto tumbaría el gesto entero en vez de sacarle una imagen fea. Va embebido y
 * no como fichero para no depender de que el empaquetado copie un recurso: es lo
 * único que separa «se arrastra con mal aspecto» de «no se arrastra».
 */
const ICONO_ARRASTRE_MINIMO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNo6JjynxLMMGrAqAGjBgwXAwBm5psfZdnX/QAAAABJRU5ErkJggg=='

/**
 * Elementos DENTRO de `.git` que señalan un cambio de HISTORIA/refs relevante
 * (commit, checkout, merge, fetch, reset). Deliberadamente NO incluye `index`:
 * `git status` (que la propia app corre al refrescar "Cambios") reescribe el index
 * para actualizar su caché de stats, así que reaccionar a él crearía un BUCLE
 * infinito (status -> index -> watcher -> refresca -> status -> …) que ralentiza
 * todo. Tampoco `objects/` (blobs, altísimo volumen).
 */
const GIT_REF_ENTRIES = new Set([
  'HEAD',
  'ORIG_HEAD',
  'MERGE_HEAD',
  'FETCH_HEAD',
  'packed-refs',
  'refs',
  'logs'
])

/**
 * Clasifica un cambio del watcher por su ruta relativa:
 *   - 'git':   cambio de refs/HEAD/logs dentro de un `.git` (commit/checkout/merge
 *              hecho FUERA de la app) -> refresca grafo + lista de cambios.
 *   - 'noise': node_modules, o cualquier otro `.git/*` (index, objects, config…):
 *              ruido o —en el caso de index— fuente de bucle. Se ignora.
 *   - 'file':  cambio normal de archivo -> recarga el árbol del explorador.
 */
function classifyPath(filename: string | Buffer): 'noise' | 'git' | 'file' {
  const segs = filename.toString().split(/[/\\]/)
  if (segs.includes('node_modules')) return 'noise'
  const gi = segs.indexOf('.git')
  if (gi === -1) return 'file'
  const sub = segs[gi + 1]
  // Dentro de .git: solo refs/HEAD/logs cuentan; el resto (index, objects…) es ruido.
  return sub !== undefined && GIT_REF_ENTRIES.has(sub) ? 'git' : 'noise'
}

/** Heurística de binario (byte NUL en el primer tramo); vive en `textCodec` porque git también la usa. */
const isBinary = isBinaryBuffer
