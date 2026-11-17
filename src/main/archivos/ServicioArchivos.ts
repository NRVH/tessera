// =============================================================================
// Árbol, lectura y escritura de archivos de un proyecto, leyendo siempre del host (node:fs) en el
// main: el `/workspace` del contenedor es un bind mount de la misma carpeta, así que los bytes son
// idénticos y no hace falta `docker exec`. El renderer manda rutas POSIX relativas con su proyecto;
// `paraRaiz` elige la vista de ese proyecto y `resolverSeguro` resuelve contra su raíz sin salir de ella.
// Los .jar se enrutan a `ServicioJar`; el escritorio (revelar, abrir, icono del arrastre, «Guardar
// como») entra por `adaptadores/escritorioElectron.ts` y los canales se registran en `ipc.ts`.
// =============================================================================

import { promises as fs, watch, type FSWatcher } from 'node:fs'
import * as path from 'node:path'
import { contenedorEnDiscoDe, esNombreContenedor, esRutaVirtual, tocaContenedor } from '../../shared/jarPath'
import { normalizarRelativaProyecto } from '../../shared/rutasHost'
import { ServicioJar } from '../java/ServicioJar'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { BrowserWindow, WebContents } from 'electron'
import type { EscritorioArchivos } from './adaptadores/escritorioElectron'
import {
  rutaComparable,
  existe,
  estaDentroDe,
  moverEntreVolumenes,
  leerPrefijo,
  esMismaRuta,
  nombreDisponible,
  validarNombreArchivo
} from './utilidadesDisco'
import {
  FILE_CHANNELS,
  lenguajeDeNombreArchivo,
  type ContenidoArchivoBinario,
  type EntradaCreada,
  type ResultadoBorrar,
  type ResultadoHtmlDocx,
  type ContenidoArchivo,
  type EntradaArchivo,
  type ResultadoImportar,
  type ResultadoMover,
  type ResultadoPegar,
  type RaizProyecto,
  type PeticionGuardarSinTitulo,
  type ResultadoGuardarSinTitulo,
  type ResultadoEscribirArchivo,
  type EventoArchivosCambiados,
  type EntradaListadoZip,
  type ListadoZip
} from '../../shared/archivos-ipc'
import {
  detectarEncoding,
  decodificarTexto,
  codificarTexto,
  esBufferBinario,
  pierdeDatosAlCodificar
} from './codificacionTexto'
import { txArchivos } from './textos.ts'
import { sigueDentroDeLaRaiz } from './rutaReal.ts'

/** Tamaño máximo que se envía al editor (2 MiB). Más grande -> se trunca. */
const MAX_ARCHIVO_EDITOR_BYTES = 2 * 1024 * 1024
/**
 * Tamaño máximo para lecturas BINARIAS (PDF) y para procesar .docx/.zip (50 MiB).
 * Más alto que el de texto: los documentos de oficina y los PDF pesan más, y aquí
 * NO se vuelca el texto al editor sino que se pinta un visor dedicado.
 */
const MAX_BINARIO_BYTES = 50 * 1024 * 1024


/** Milisegundos de espera tras el último evento del watcher antes de avisar al
 *  renderer: fs.watch dispara ráfagas (un guardado emite varios eventos), así que
 *  se colapsan en un solo `files:changed`. */
const DEBOUNCE_VIGILANTE_MS = 200

/**
 * Intervalo MÍNIMO entre dos `files:changed` consecutivos. Acota una escritura
 * sostenida (agente, `npm install`, build), donde el debounce solo no basta porque
 * cada evento lo reinicia sin llegar a colapsarlos. 600 ms es imperceptible para el
 * usuario —las operaciones que él hace ya refrescan el árbol de forma optimista, sin
 * esperar al watcher— y divide por tres el trabajo del renderer en ráfaga.
 */
const INTERVALO_MIN_CAMBIOS_MS = 600
/** Tope de rutas que viajan en un aviso. Más allá se marca `parcial` (ver el payload). */
const MAX_RUTAS_CAMBIADAS = 200

/** Debounce de los cambios de git: una operación (commit/merge) toca varios refs;
 *  algo mayor evita ráfagas de refetch del grafo. */
const DEBOUNCE_VIGILANTE_GIT_MS = 400

/**
 * Parámetro de `ServicioArchivos.pegar`. NO es un contrato IPC y por eso no vive en
 * `shared/`: `rutasHost` (rutas absolutas del host) solo lo compone el propio MAIN
 * desde el portapapeles. Lo que llega del renderer es `PeticionPegar`, que es este
 * mismo tipo sin `rutasHost` ni `nombre` — la diferencia es justo la parte capaz de
 * mover o borrar algo fuera del proyecto.
 */
export interface OpcionesPegar {
  /** Carpeta destino, relativa a la raíz (POSIX, "" = raíz). */
  destDir: string
  /** Orígenes INTERNOS: rutas relativas a la raíz (POSIX). */
  srcs?: string[]
  /** Origen EXTERNO: rutas ABSOLUTAS del host. Solo desde el main. */
  rutasHost?: string[]
  op: 'copiar' | 'cortar'
  /** Fuerza el nombre del destino (pegado de imagen). Solo con UN origen. */
  nombre?: string
}

/** Cómo acabó un elemento del pegado (`pegarUno`). */
type DesenlacePegado = { tipo: 'pegado'; rel: string } | { tipo: 'fallido'; nombre: string } | { tipo: 'noop' }

export interface OpcionesServicioArchivos {
  /**
   * Ruta host (Windows) real de la raíz del proyecto activo. Opcional: si se
   * omite, el servicio arranca SIN proyecto activo (arranque limpio) y espera al
   * primer `fijarRaizProyecto()` (vía workspace.setActiveProject).
   */
  raizProyecto?: string
  /**
   * Ventana a la que empujar el evento `files:changed` cuando el watcher detecta
   * cambios en el árbol. Se pasa como getter (la ventana puede recrearse). Sin
   * esto, el watcher no arranca (no hay a quién avisar).
   */
  ventana?: () => BrowserWindow | null
  /** Revelar, abrir, icono del arrastre y «Guardar como»: `adaptadores/escritorioElectron.ts` o un doble. */
  escritorio: EscritorioArchivos
  /** Logger del main (por defecto console.log con prefijo). */
  log?: (msg: string) => void
}

export class ServicioArchivos {
  /**
   * Raíz real del proyecto ACTIVO, resuelta y absoluta, o `null` si aún no hay
   * proyecto activo (arranque limpio). Nunca se expone al renderer. Mutable de
   * forma controlada vía `fijarRaizProyecto()`: es la que vigila el watcher; las
   * peticiones de otro proyecto ya anclado se atienden en su vista (`paraRaiz`).
   */
  private raiz: string | null
  private readonly log: (msg: string) => void
  private readonly ventana?: () => BrowserWindow | null
  private readonly escritorio: EscritorioArchivos
  /** Servicio de contenedores (.jar/.war/…). null = la función no está montada. */
  private jar: ServicioJar | null = null
  /** Watcher recursivo de la raíz activa (o null si no hay proyecto/ventana). */
  private vigilante: FSWatcher | null = null
  /** Timer del aviso de cambios pendiente (debounce + intervalo mínimo). */
  private temporizadorVigilante: ReturnType<typeof setTimeout> | null = null
  /** ¿Hay cambios sin avisar? Garantiza que el último cambio de una ráfaga se entrega. */
  private cambioPendiente = false
  /** Rutas POSIX acumuladas durante la ventana de antirrebote (ver programarEventoCambio). */
  private readonly rutasCambiadas = new Set<string>()
  /** ¿Se desbordó el tope, o el watcher no dio nombre? Entonces `rutas` no es completa. */
  private cambioParcial = false
  /** Epoch ms del último `files:changed` emitido (para el intervalo mínimo). */
  private ultimaEmisionCambio = 0
  /** Debounce SEPARADO para los cambios de metadata git (.git refs/HEAD/index). */
  private temporizadorGit: ReturnType<typeof setTimeout> | null = null
  /**
   * Destino RECORDADO de cada archivo sin título ya guardado una vez:
   * id opaco de la pestaña -> ruta host absoluta que el usuario eligió en el
   * diálogo nativo. Es lo que permite que el segundo Ctrl+S no vuelva a
   * preguntar, sin que la ruta de Windows llegue nunca al renderer. Vive solo en
   * memoria (una sesión de app) y se suelta al cerrar la pestaña.
   */
  private readonly destinosSinTitulo = new Map<string, string>()
  /** Contenedoras ancladas alguna vez en la sesión (`rutaComparable`): las únicas a las que se atiende. */
  private readonly conocidas = new Set<string>()
  /** Una vista sin vigilante por cada contenedora conocida que no es la anclada (`paraRaiz`). */
  private readonly vistas = new Map<string, ServicioArchivos>()

  constructor(opts: OpcionesServicioArchivos) {
    this.raiz = opts.raizProyecto != null ? path.resolve(opts.raizProyecto) : null
    if (this.raiz !== null) this.conocidas.add(rutaComparable(this.raiz))
    this.ventana = opts.ventana
    this.escritorio = opts.escritorio
    this.log = opts.log ?? ((m) => console.log(`[files] ${m}`))
    if (this.raiz) this.iniciarVigilancia()
  }

  /**
   * Re-apunta el servicio al proyecto ACTIVO indicado (misma resolución que el
   * constructor). A partir de aquí `obtenerRaiz`, `resolverSeguro`, `listarDirectorio` y
   * `leerArchivo` operan contra la nueva raíz; el contrato IPC no cambia (el
   * renderer sigue mandando rutas relativas al proyecto activo).
   */
  fijarRaizProyecto(raizProyecto: string): void {
    this.raiz = path.resolve(raizProyecto)
    this.conocidas.add(rutaComparable(this.raiz))
    this.log(`proyecto activo -> "${path.basename(this.raiz)}"`)
    // Re-apunta el watcher a la nueva raíz (cierra el anterior). Así el árbol del
    // proyecto que se acaba de activar se auto-refresca desde ya.
    this.iniciarVigilancia()
  }

  /**
   * La contenedora ANCLADA (la raíz real del explorador), o null. SOLO para el main, nunca
   * por IPC: con ella `ControladorBd` comprueba que «Montar como base de datos» pide un
   * archivo del proyecto que el explorador enseña, y no de otra carpeta cualquiera.
   */
  raizAnclada(): string | null {
    return this.raiz
  }

  /**
   * El servicio que atiende una petición del proyecto `raiz` (`EnProyecto` de archivos-ipc): este si es
   * el anclado; si no, una vista sin vigilante con esa raíz. Solo de proyectos que ya se anclaron en
   * la sesión, como los que `fijarRaizArchivos` acepta. Así una petición nacida en un proyecto se resuelve
   * siempre contra el suyo, aunque el ancla ya se haya movido a otro.
   */
  paraRaiz(raiz: unknown): ServicioArchivos {
    if (typeof raiz !== 'string' || raiz === '') throw new Error(txArchivos().proyectoDesconocido)
    const abs = path.resolve(raiz)
    if (this.raiz !== null && esMismaRuta(abs, this.raiz)) return this
    const clave = rutaComparable(abs)
    if (!this.conocidas.has(clave)) throw new Error(txArchivos().proyectoDesconocido)
    let vista = this.vistas.get(clave)
    if (vista === undefined) {
      // Sin `ventana`: la vista no vigila; los avisos de cambios son del proyecto anclado.
      vista = new ServicioArchivos({ raizProyecto: abs, escritorio: this.escritorio, log: this.log })
      vista.fijarServicioJar(this.jar)
      this.vistas.set(clave, vista)
    }
    return vista
  }

  /** Suelta el destino recordado de una pestaña sin título que se cierra. */
  olvidarSinTitulo(id: string): void {
    this.destinosSinTitulo.delete(id)
  }

  /** Metadatos neutros del proyecto: solo el nombre, nunca la ruta de Windows. */
  obtenerRaiz(): RaizProyecto {
    return { nombre: this.raiz ? path.basename(this.raiz) : '' }
  }

  /**
   * Resuelve una ruta relativa (POSIX) del renderer a una ruta host absoluta,
   * garantizando que queda DENTRO de la raíz del proyecto. Lanza si no hay
   * proyecto activo, o si detecta un intento de salir (../, ruta absoluta, etc.).
   */
  private resolverSeguro(relPosix: string): string {
    if (this.raiz === null) throw new Error(txArchivos().sinProyecto)
    // GUARDA DE RUTAS VIRTUALES. Una ruta de dentro de un .jar no existe en el disco:
    // resolverla daría una carpeta creíble pero falsa ("x.jar!") y crear, renombrar o
    // borrar ahí ensuciaría el proyecto. Los pocos caminos que SÍ leen dentro de un
    // contenedor (listarDirectorio, leerArchivo, leerBinario) bifurcan ANTES de llamar aquí; cualquier
    // otro, también uno que se añada mañana, falla en la puerta.
    // Anclado a la extensión y no un `includes('!/')`: `!` es legal en un nombre y una
    // carpeta real "scripts!" tiene que seguir funcionando. `tocaContenedor` y no
    // `esRutaVirtual`: atrapa también la forma degenerada `x.jar!` (sin su barra), que
    // sale de hacer `dirPadre` sobre una entrada de la raíz del jar.
    if (tocaContenedor(relPosix)) {
      throw new Error(txArchivos().dentroComprimido)
    }
    return this.resolverProyecto(relPosix)
  }

  /**
   * `resolverSeguro` más la guarda de enlaces (`rutaReal.ts`): la misma ruta, solo si al seguir enlaces o junctions
   * sigue dentro del proyecto, que el contenedor del agente puede llenar de ellos. La llevan las operaciones que
   * escriben, copian, abren con el sistema o arrastran; leer no, porque solo lo enseña la ventana. `seguirUltimo:
   * false` para lo que actúa sobre la entrada misma (borrar, renombrar o mover el origen): un enlace plantado tiene
   * que poder quitarse.
   */
  private async resolverSeguroReal(relPosix: string, seguirUltimo = true): Promise<string> {
    const abs: string = this.resolverSeguro(relPosix)
    if (!(await sigueDentroDeLaRaiz(this.raiz as string, abs, { seguirUltimo }))) {
      throw new Error(txArchivos().fueraDelProyecto)
    }
    return abs
  }

  /**
   * Traducción cruda de ruta relativa del proyecto a ruta de Windows, con la guarda
   * anti-traversal. Es lo que usa `resolverSeguro`, y se expone para que el servicio de
   * jars pueda resolver el CONTENEDOR (que sí es un fichero real) sin duplicar la
   * validación ni saltarse la raíz del proyecto activo.
   */
  resolverProyecto(relPosix: string): string {
    if (this.raiz === null) throw new Error(txArchivos().sinProyecto)
    // Normaliza separadores y descarta prefijos que intenten "anclar" fuera. La
    // traducción de `\` a `/` la decide la PLATAFORMA (`normalizarRelativaProyecto`):
    // hacerla siempre rompía en Mac los nombres con barra invertida, que ahí es un
    // carácter legal — y `relativaPosixHost` los entrega correctos por la ida.
    const rel = normalizarRelativaProyecto(relPosix)
    const abs = path.resolve(this.raiz, rel)
    const raizConSep = this.raiz.endsWith(path.sep) ? this.raiz : this.raiz + path.sep
    if (abs !== this.raiz && !abs.startsWith(raizConSep)) {
      throw new Error(txArchivos().fueraDelProyecto)
    }
    return abs
  }

  /**
   * ¿Esta ruta hay que servirla desde dentro de un contenedor? Cubre los dos casos:
   * una ruta virtual ("lib/x.jar!/com"), y un contenedor PELADO ("lib/x.jar"), que
   * es con el que el árbol pide la PRIMERA expansión y que `analizarRutaArchivo`
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
      return (await fs.stat(this.resolverProyecto(rel))).isFile()
    } catch {
      return false
    }
  }

  /** Ruta de Windows del contenedor de disco de una ruta (virtual o pelada). */
  private absDelContenedor(relPosix: string): string {
    const enDisco = contenedorEnDiscoDe(relPosix)
    return this.resolverProyecto(enDisco !== '' ? enDisco : relPosix)
  }

  /** Inyecta el servicio de jars (lo construye `index.ts`, que es quien lo posee). */
  fijarServicioJar(jar: ServicioJar | null): void {
    this.jar = jar
    for (const vista of this.vistas.values()) vista.fijarServicioJar(jar)
  }

  /** Lista una carpeta del proyecto (lazy). Carpetas primero, luego alfabético. */
  async listarDirectorio(relPosix: string): Promise<EntradaArchivo[]> {
    // Sin proyecto activo: árbol vacío, estado seguro (el renderer no debería
    // llamar aquí, pero no revienta si lo hace).
    if (this.raiz === null) return []

    // Un .jar se navega como si fuera una carpeta. El explorador NO se entera: pide
    // por el canal de siempre y recibe EntradaArchivo[] con la misma forma y el mismo
    // orden. Se enruta aquí, y no en un canal propio, porque el bucle de
    // compactación de `cargarCadena` y el re-listado del watcher llaman a listarDirectorio una
    // vez por nivel: un canal paralelo dejaría esos dos caminos viejos abiertos.
    if (await this.esDeContenedor(relPosix)) {
      // NORMALIZADA aquí, en la frontera, que es donde el repo decide traducir
      // separadores (`normalizarRelativaProyecto`, sensible a la plataforma). Antes
      // entraba cruda y quien traducía era `ServicioJar.partirOEnRaiz`, con un
      // `\`→`/` incondicional: correcto en Windows y falso en macOS, donde una
      // carpeta `a\b` es un nombre legal y sus jars quedaban inalcanzables.
      const relJar = normalizarRelativaProyecto(relPosix)
      return this.jar!.listarDirectorio(this.absDelContenedor(relJar), relJar)
    }

    // Leer sigue enlaces (un `npm link` se puede mirar): solo lo enseña la ventana. La guarda va en lo que escribe.
    const abs = this.resolverSeguro(relPosix)
    const entradasDirectorio = await fs.readdir(abs, { withFileTypes: true })
    const base = normalizarRelativaProyecto(relPosix).replace(/\/+$/, '')

    const entradas: EntradaArchivo[] = []
    for (const d of entradasDirectorio) {
      // Solo archivos y carpetas reales: los symlinks (isFile/isDirectory dan
      // false sobre un dirent de symlink) quedan fuera del árbol por seguridad.
      if (!d.isFile() && !d.isDirectory()) continue
      const entrada: EntradaArchivo = {
        nombre: d.name,
        ruta: base ? `${base}/${d.name}` : d.name,
        tipo: d.isDirectory() ? 'dir' : 'file'
      }
      // Un .jar/.war/.ear/.aar del disco se marca como CONTENEDOR: es lo único que
      // autoriza al árbol a pintarle chevron y a pedir su contenido. Sin esta marca
      // el enrutado de abajo funciona pero nadie lo llama nunca, porque la fila sigue
      // siendo una hoja. La comprobación de `isFile` es la que descarta una CARPETA
      // real llamada "algo.jar".
      if (d.isFile() && esNombreContenedor(d.name)) entrada.contenedor = 'jar'
      entradas.push(entrada)
    }

    entradas.sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'dir' ? -1 : 1
      return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
    })
    return entradas
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
   * NO se traga los errores de ruta: si `resolverSeguro` rechaza la ruta, eso no es
   * «no existe» sino «esa pregunta no es válida», y quien llama tiene que poder
   * distinguirlo para NO tachar una pestaña por un fallo de programación.
   */
  async existeRuta(relPosix: string): Promise<boolean> {
    const rel0 = normalizarRelativaProyecto(relPosix)
    if (esRutaVirtual(rel0)) {
      const contenedor = contenedorEnDiscoDe(rel0)
      if (contenedor === '') return false
      return existe(this.resolverSeguro(contenedor))
    }
    return existe(this.resolverSeguro(relPosix))
  }

  /**
   * Lee un archivo de texto para el editor. Trunca a MAX_ARCHIVO_EDITOR_BYTES y detecta
   * binario (byte NUL en el primer tramo) para no volcar bytes crudos al editor.
   */
  async leerArchivo(relPosix: string, encodingForzado?: string): Promise<ContenidoArchivo> {
    const rel0 = normalizarRelativaProyecto(relPosix)
    // Una entrada de TEXTO dentro de un .jar (el MANIFEST, un .properties, un .xml)
    // se lee igual que un fichero: mismos topes, misma detección de codificación y
    // de binario. El lenguaje se calcula del basename ANTES de bifurcar, porque
    // `path.basename` de una ruta virtual no daría el nombre correcto.
    if (esRutaVirtual(rel0) && this.jar !== null) {
      return this.leerEntradaDeContenedor(rel0, encodingForzado)
    }

    const abs = this.resolverSeguro(relPosix)
    const rel = rel0
    const lenguaje = lenguajeDeNombreArchivo(path.basename(abs))

    const stat = await fs.stat(abs)
    if (!stat.isFile()) throw new Error(`No es un archivo: «${rel}».`)

    const truncado = stat.size > MAX_ARCHIVO_EDITOR_BYTES
    const buffer = truncado ? await leerPrefijo(abs, MAX_ARCHIVO_EDITOR_BYTES) : await fs.readFile(abs)

    if (esBinarioArchivo(buffer)) {
      return { ruta: rel, lenguaje: 'plaintext', contenido: '', encoding: 'utf8', truncado, binario: true }
    }

    // Codificación: la FORZADA ("Reabrir con codificación": el usuario reinterpreta
    // los bytes con ese charset) o la autodetectada. Le pasamos `truncado` a la
    // detección para que solo entonces tolere un multibyte cortado al final.
    const encoding = encodingForzado ?? detectarEncoding(buffer, truncado)
    return {
      ruta: rel,
      lenguaje,
      contenido: decodificarTexto(buffer, encoding),
      encoding,
      truncado,
      binario: false
    }
  }

  /**
   * Lee una entrada de TEXTO de dentro de un contenedor con el mismo contrato que
   * `leerArchivo`: mismos topes, misma detección de binario y de codificación. Reusa
   * `detectarEncoding`/`decodificarTexto` a propósito — un `.properties` dentro de un jar de
   * 2003 es ISO-8859-1 por especificación, y decodificarlo como UTF-8 destroza los
   * acentos igual que lo haría con un fichero suelto.
   */
  private async leerEntradaDeContenedor(rel: string, encodingForzado?: string): Promise<ContenidoArchivo> {
    const nombre = rel.slice(Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('!')) + 1)
    const lenguaje = lenguajeDeNombreArchivo(nombre)
    const completo = await this.jar!.leerBytes(this.absDelContenedor(rel), rel)

    const truncado = completo.length > MAX_ARCHIVO_EDITOR_BYTES
    const buffer = truncado ? completo.subarray(0, MAX_ARCHIVO_EDITOR_BYTES) : completo

    if (esBinarioArchivo(buffer)) {
      return { ruta: rel, lenguaje: 'plaintext', contenido: '', encoding: 'utf8', truncado, binario: true }
    }
    const encoding = encodingForzado ?? detectarEncoding(buffer, truncado)
    return { ruta: rel, lenguaje, contenido: decodificarTexto(buffer, encoding), encoding, truncado, binario: false }
  }

  /**
   * Sobrescribe un archivo de texto del proyecto con `contenido` (UTF-8), leyendo
   * y validando la ruta igual que leerArchivo (resolverSeguro: anti-traversal + guarda
   * de proyecto activo). No crea estructura de carpetas nueva ni valida
   * existencia previa: en este bloque el archivo siempre viene de un read previo
   * exitoso (existe en disco). El bloqueo del caso "abierto truncado" vive en el
   * RENDERER (que es quien sabe si truncó al abrir); aquí se persiste lo que llega.
   */
  async escribirArchivo(relPosix: string, contenido: string, encoding = 'utf8'): Promise<ResultadoEscribirArchivo> {
    const abs = await this.resolverSeguroReal(relPosix)
    const rel = normalizarRelativaProyecto(relPosix)
    // GUARDA ANTI-PÉRDIDA: escribir con un charset legacy que no representa algún
    // carácter lo sustituiría por '?' (corrupción silenciosa). Antes de escribir se
    // aborta con un error claro (el editor lo muestra) en vez de corromper el archivo.
    if (pierdeDatosAlCodificar(contenido, encoding)) {
      throw new Error(txArchivos().codificacionPierde)
    }
    // Codifica con el encoding del archivo (el editor lo reenvía en cada guardado
    // para preservarlo; solo cambia si el usuario elige otro en el selector).
    const bytes = codificarTexto(contenido, encoding)
    // RECREA LA CARPETA SI HACE FALTA. El caso no es teórico: con una pestaña abierta
    // cuyo archivo borraron por fuera —a menudo borrando la CARPETA entera—, el
    // Ctrl+S que debe recrearlo moría con un ENOENT del directorio padre, y el
    // usuario veía «no se pudo guardar» con su contenido delante y sin salida. Es
    // recursivo y va dentro de la raíz ya validada por `resolverSeguro`, así que no
    // puede crear nada fuera del proyecto.
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, bytes)
    return { ruta: rel, bytesEscritos: bytes.length }
  }

  /**
   * Guarda un archivo SIN TÍTULO (Ctrl+N). La primera vez abre el diálogo NATIVO
   * de Windows para que el usuario elija dónde; a partir de ahí escribe en esa
   * misma ruta sin volver a preguntar, como hacen los editores: «Guardar como…» solo la
   * primera vez.
   *
   * NO usa resolverSeguro a propósito: el destino lo elige el usuario en un diálogo
   * del SO y puede estar fuera del proyecto. Lo que se devuelve al renderer sigue
   * siendo neutro (nombre + ruta relativa si cayó dentro del proyecto, nunca la
   * ruta de Windows).
   */
  async guardarSinTitulo(req: PeticionGuardarSinTitulo): Promise<ResultadoGuardarSinTitulo> {
    let abs = this.destinosSinTitulo.get(req.id)
    if (!abs) {
      // Dónde abre, y que lo recuerde: `util/adaptadores/dialogosNativos.ts`. Con proyecto activo
      // arranca en él (lo esperable); sin proyecto, donde se guardó la última vez, y si
      // no, el home. Ya no «donde el SO decida»: desde Electron 43, sin carpeta, el SO
      // abre en Descargas.
      const res = await this.escritorio.guardarConDialogo(
        'guardar-como',
        req.nombreSugerido,
        {
          title: txArchivos().guardarComo,
          buttonLabel: txArchivos().guardar,
          properties: ['createDirectory', 'showOverwriteConfirmation']
        },
        { ventana: this.ventana?.() ?? null, antes: [this.raiz] }
      )
      if (res.canceled || !res.filePath) return { canceled: true }
      abs = path.resolve(res.filePath)
      this.destinosSinTitulo.set(req.id, abs)
    }

    await fs.writeFile(abs, req.contenido, 'utf8')
    const rel = this.relDesdeHost(abs)
    // Guardado DENTRO del proyecto: la pestaña deja de ser "sin título" y pasa a
    // ser un archivo normal, así que su destino recordado ya no hace falta.
    if (rel !== null) this.destinosSinTitulo.delete(req.id)
    return {
      canceled: false,
      nombre: path.basename(abs),
      ruta: rel,
      bytesEscritos: Buffer.byteLength(req.contenido, 'utf8')
    }
  }

  /**
   * Ruta relativa (POSIX) al proyecto activo de una ruta host absoluta, o `null`
   * si cae FUERA del proyecto (o no hay proyecto activo). Inversa de resolverSeguro:
   * traduce hacia el renderer sin filtrarle nunca la ruta del host.
   *
   * USA LAS MISMAS PRIMITIVAS QUE `estaDentroDe`/`esMismaRuta` (insensibles a la caja, como
   * NTFS y APFS), y eso no es cosmética. Con dos criterios distintos sobre "¿esto está
   * dentro del proyecto?" en el mismo módulo, cortar y pegar en la misma carpeta con
   * rutas de caja distinta acababa en «No había nada que pegar.», y guardar un archivo
   * sin título dentro del proyecto lo dejaba «sin título» para siempre.
   */
  private relDesdeHost(abs: string): string | null {
    if (this.raiz === null) return null
    // La raíz no es "un archivo dentro".
    if (esMismaRuta(abs, this.raiz)) return null
    if (!estaDentroDe(abs, this.raiz)) return null
    const raiz = this.raiz.endsWith(path.sep) ? this.raiz : this.raiz + path.sep
    // Se corta por LONGITUD sobre `abs` tal cual, y NO se usa la versión en
    // minúsculas: la insensibilidad vive en la COMPARACIÓN, nunca en la ruta que se
    // devuelve al renderer — la pestaña tiene que enseñar el nombre que el usuario
    // reconoce.
    return abs.slice(raiz.length).split(path.sep).join('/')
  }

  /**
   * Lee un archivo como BYTES crudos para un visor no-textual (hoy: PDF). No
   * detecta ni descarta binario (justo lo contrario que leerArchivo). Trunca a
   * MAX_BINARIO_BYTES: un PDF incompleto no se puede pintar, así que el renderer
   * usa `truncado` para avisar en vez de renderizar basura.
   */
  async leerBinario(relPosix: string): Promise<ContenidoArchivoBinario> {
    const rel0 = normalizarRelativaProyecto(relPosix)
    if (esRutaVirtual(rel0) && this.jar !== null) {
      const bytes = await this.jar.leerBytes(this.absDelContenedor(rel0), rel0)
      // MISMO techo que un fichero de disco. El tope de zipRandom (64 MiB por entrada)
      // es más alto que MAX_BINARIO_BYTES, así que sin esto un PDF de 60 MiB dentro de
      // un .war cruzaría el IPC entero —por encima del límite que respeta el resto de
      // la app— y encima diría `truncado:false`, que es mentir.
      const truncado = bytes.length > MAX_BINARIO_BYTES
      const recorte = truncado ? bytes.subarray(0, MAX_BINARIO_BYTES) : bytes
      return { ruta: rel0, bytes: new Uint8Array(recorte), tamano: bytes.length, truncado }
    }

    const abs = this.resolverSeguro(relPosix)
    const rel = rel0
    const stat = await fs.stat(abs)
    if (!stat.isFile()) throw new Error(`No es un archivo: «${rel}».`)

    const truncado = stat.size > MAX_BINARIO_BYTES
    const buffer = truncado ? await leerPrefijo(abs, MAX_BINARIO_BYTES) : await fs.readFile(abs)
    // Uint8Array explícito: es lo que llega al renderer tras el structured-clone
    // del IPC y evita depender de que Electron convierta Buffer -> Uint8Array.
    return { ruta: rel, bytes: new Uint8Array(buffer), tamano: stat.size, truncado }
  }

  /**
   * Convierte un .docx a HTML con formato usando mammoth (MIT). Corre en el MAIN
   * (Node) para no arrastrar mammoth ni sus polyfills al bundle del renderer; el
   * renderer solo recibe HTML y lo sanea con DOMPurify antes de pintarlo. Solo
   * .docx moderno (OOXML); el .doc binario legado no está soportado.
   */
  async leerDocx(relPosix: string): Promise<ResultadoHtmlDocx> {
    const rel = normalizarRelativaProyecto(relPosix)
    // Un .docx DENTRO de un .jar/.war se lee igual que uno de disco: es una lectura,
    // y las lecturas bifurcan ANTES de `resolverSeguro`. Sin esta rama caía en la guarda
    // de ESCRITURA y el usuario recibía "no se puede modificar desde aquí" por haber
    // hecho doble clic para MIRAR: un mensaje que describe algo que nadie intentó.
    const buffer = await this.bytesParaVisor(rel, relPosix, txArchivos().documentoGrande)
    // La conversión OOXML->HTML de mammoth es CPU-pesada y SÍNCRONA: corre en un
    // worker_threads para no congelar el hilo main con un .docx grande/complejo.
    const { html, messages: mensajes } = await ejecutarTrabajadorArchivo<{ html: string; messages: string[] }>('docx-html', buffer)
    return { ruta: rel, html, mensajes }
  }

  /**
   * Lista el contenido de un .zip SIN descomprimirlo. fflate (MIT) recorre el
   * índice y, con un `filter` que siempre devuelve false, obtiene los metadatos
   * (nombre, tamaños) de cada entrada sin inflar sus datos: barato incluso para
   * zips grandes. Carpetas primero, luego por nombre.
   */
  async leerZip(relPosix: string): Promise<ListadoZip> {
    const rel = normalizarRelativaProyecto(relPosix)
    // Igual que leerDocx: un .zip dentro de un contenedor se LISTA, no se modifica.
    const buffer = await this.bytesParaVisor(rel, relPosix, txArchivos().comprimidoGrande)
    // El recorrido del índice del zip (unzipSync) es síncrono: en un zip con decenas
    // de miles de entradas bloqueaba el main. Corre en un worker; el orden se aplica
    // aquí (barato) para mantener la lógica de presentación en el servicio.
    const { entries: entradas } = await ejecutarTrabajadorArchivo<{ entries: EntradaListadoZip[] }>('zip-list', buffer)
    entradas.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    })
    return { ruta: rel, entradas }
  }

  /**
   * Abre el archivo o carpeta en el explorador del SO y lo deja seleccionado
   * (shell.showItemInFolder). Resuelve+valida la ruta igual que el resto
   * (anti-traversal): el renderer solo manda la ruta relativa.
   */
  async revelar(relPosix: string): Promise<void> {
    // Dentro de un .jar no hay nada que revelar en el Explorador de Windows, pero
    // "no hacer nada" sería peor: se COLAPSA al .jar que la contiene, que es la
    // respuesta útil a "enséñame dónde está esto".
    const abs = this.resolverSeguro(this.colapsarAContenedor(relPosix))
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
      if (bytes.length > MAX_BINARIO_BYTES) throw new Error(siEsGrande)
      return bytes
    }
    const abs = this.resolverSeguro(relPosix)
    const stat = await fs.stat(abs)
    if (!stat.isFile()) throw new Error(`No es un archivo: «${rel}».`)
    if (stat.size > MAX_BINARIO_BYTES) throw new Error(siEsGrande)
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
   * avise si no hay app asociada. resolverSeguro cubre el anti-traversal.
   */
  async abrirRuta(relPosix: string): Promise<string> {
    // Igual que reveal: se abre el .jar con la app del sistema, no una ruta que no
    // existe.
    // Con la guarda: abrir con la app del sistema un enlace que apunte fuera podría ejecutar un programa del host.
    const abs = await this.resolverSeguroReal(this.colapsarAContenedor(relPosix))
    return this.escritorio.abrirRuta(abs)
  }

  /**
   * Crea un archivo vacío o una carpeta llamado `nombre` DENTRO de `dirRelPosix`.
   * Valida el nombre (sin separadores ni '.'/'..') y que no exista ya. Devuelve la
   * ruta relativa del nuevo nodo. resolverSeguro cubre el anti-traversal.
   */
  async crearEntrada(dirRelPosix: string, nombre: string, tipo: 'file' | 'dir'): Promise<EntradaCreada> {
    const nombreLimpio = validarNombreArchivo(nombre)
    const dirRel = normalizarRelativaProyecto(dirRelPosix).replace(/\/+$/, '')
    const relPosix = dirRel ? `${dirRel}/${nombreLimpio}` : nombreLimpio
    const abs = await this.resolverSeguroReal(relPosix)
    // No pisar algo existente (archivo o carpeta con ese nombre).
    if (await existe(abs)) throw new Error(txArchivos().yaExiste(nombreLimpio))
    if (tipo === 'dir') {
      await fs.mkdir(abs)
    } else {
      // 'wx' = crear en exclusiva: falla si aparece entre el check y aquí (carrera).
      const descriptor = await fs.open(abs, 'wx')
      await descriptor.close()
    }
    return { ruta: relPosix }
  }

  /**
   * Renombra un archivo/carpeta a `nombreNuevo` DENTRO de su misma carpeta padre.
   * Valida el nombre y que el destino no exista. Devuelve la nueva ruta relativa.
   *
   * CAMBIAR SÓLO LAS MAYÚSCULAS (`Foo.txt` → `foo.txt`) TIENE QUE FUNCIONAR, y no lo
   * hacía. En APFS y en NTFS —los dos sistemas donde Tessera corre— el nombre no
   * distingue mayúsculas pero sí las conserva, así que el destino "ya existe": es el
   * propio archivo. Comparando con `===` no era ni el no-op (las cadenas difieren) ni
   * un destino libre, y el usuario recibía «Ya existe "foo.txt" en esa carpeta.» sin
   * manera de corregir la capitalización. Se distingue con `esMismaRuta`, que es el
   * comparador que este módulo ya usa en todas partes: mismo archivo con otra caja se
   * renombra sin más comprobación (`fs.rename` sí aplica el cambio de caja en los dos
   * sistemas); mismo archivo y misma caja sigue siendo el no-op de siempre.
   */
  async renombrar(relPosix: string, nombreNuevo: string): Promise<EntradaCreada> {
    const nombreLimpio = validarNombreArchivo(nombreNuevo)
    // Sin seguir el último tramo: renombrar un enlace renombra el enlace; basta con que su carpeta sea del proyecto.
    const abs = await this.resolverSeguroReal(relPosix, false)
    const rel = normalizarRelativaProyecto(relPosix).replace(/\/+$/, '')
    const barra = rel.lastIndexOf('/')
    const relPadre = barra < 0 ? '' : rel.slice(0, barra)
    const destRel = relPadre ? `${relPadre}/${nombreLimpio}` : nombreLimpio
    const destAbs = await this.resolverSeguroReal(destRel, false)
    if (destAbs === abs) return { ruta: rel } // mismo nombre EXACTO: no-op
    const soloOtraCaja = esMismaRuta(destAbs, abs)
    if (!soloOtraCaja && (await existe(destAbs))) throw new Error(txArchivos().yaExiste(nombreLimpio))
    await fs.rename(abs, destAbs)
    return { ruta: destRel }
  }

  /**
   * Mueve VARIOS archivos/carpetas DENTRO de `destDirRelPosix` (drag & drop),
   * conservando sus nombres.
   *
   * TODO O NADA CONTRA LAS COLISIONES: se valida la lista entera antes de tocar el
   * disco y, si algún nombre ya existe en el destino, no se mueve nada y se
   * devuelven los nombres en `conflictos`. Misma política que `importarDesdeHost`, y por
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
   * carpeta donde A ya está tiene que mover B, no fallar. `resolverSeguro` cubre el
   * anti-traversal y las rutas virtuales en los dos extremos.
   */
  async moverVarios(srcsRelPosix: readonly string[], destDirRelPosix: string): Promise<ResultadoMover> {
    const destDir = normalizarRelativaProyecto(destDirRelPosix).replace(/\/+$/, '')
    const destDirAbs = await this.resolverSeguroReal(destDir)
    const destStat = await fs.stat(destDirAbs).catch(() => null)
    if (!destStat?.isDirectory()) throw new Error(txArchivos().destinoNoCarpeta)

    interface TareaMovimiento {
      srcAbs: string
      destAbs: string
      rel: string
      nombre: string
    }
    const tareas: TareaMovimiento[] = []
    const nombres = new Set<string>()
    for (const src of srcsRelPosix) {
      const srcRel = normalizarRelativaProyecto(src).replace(/\/+$/, '')
      if (!srcRel) throw new Error(txArchivos().origenInvalido)
      const barra = srcRel.lastIndexOf('/')
      const padreSrc = barra < 0 ? '' : srcRel.slice(0, barra)
      if (destDir === padreSrc) continue // ya está ahí: no-op silencioso
      if (destDir === srcRel || destDir.startsWith(`${srcRel}/`)) {
        throw new Error(txArchivos().carpetaEnSiMisma)
      }
      const nombre = srcRel.slice(barra + 1)
      // Dos orígenes con el MISMO nombre (de carpetas distintas) colisionan ENTRE
      // ELLOS, y `exists` no puede verlo: cuando se comprueba el segundo, el primero
      // todavía no se ha movido. Sin esta guarda, el segundo `rename` pisaría al
      // primero y el archivo se perdería en silencio.
      //
      // Se compara con `rutaComparable`, NO con el nombre crudo: Windows y APFS
      // conservan la caja pero no la distinguen, así que `A.txt` y `a.txt` son el
      // mismo destino y con un Set sensible a mayúsculas se colaban los dos — el
      // mismo motivo por el que `rename` usa `esMismaRuta`.
      const clave = rutaComparable(nombre)
      if (nombres.has(clave)) {
        throw new Error(txArchivos().dosElementos(nombre))
      }
      nombres.add(clave)
      // Sin seguir el último tramo: mover un enlace mueve el enlace.
      const srcAbs = await this.resolverSeguroReal(srcRel, false)
      // El origen tiene que EXISTIR, y se comprueba en la validación por lo mismo que
      // las colisiones: sin esto, una selección de hace unos segundos cuyo segundo
      // elemento acaba de borrar un build reventaba con un ENOENT crudo A MITAD del
      // bucle, dejando el lote movido a medias — justo el estado que el todo-o-nada
      // existe para impedir. El `stat` cuesta lo mismo que el `exists` del destino.
      if (!(await existe(srcAbs))) throw new Error(txArchivos().yaNoExiste(nombre))
      const rel = destDir ? `${destDir}/${nombre}` : nombre
      tareas.push({ srcAbs, destAbs: await this.resolverSeguroReal(rel), rel, nombre })
    }
    if (tareas.length === 0) return { movidos: [], conflictos: [] }

    const conflictos: string[] = []
    for (const tarea of tareas) if (await existe(tarea.destAbs)) conflictos.push(tarea.nombre)
    if (conflictos.length > 0) return { movidos: [], conflictos }

    for (const tarea of tareas) await fs.rename(tarea.srcAbs, tarea.destAbs)
    this.log(`movidos ${tareas.length} elemento(s) a "${destDir || '.'}"`)
    return { movidos: tareas.map((j) => j.rel), conflictos: [] }
  }

  /**
   * PEGA en `destDir` lo que el usuario copió o cortó (menú contextual del
   * explorador y Ctrl+V). Ver PeticionPegar para por qué no reutiliza MOVE/IMPORT.
   *
   * OJO con `rutasHost` + `op:'cortar'`: esa combinación MUEVE (y por tanto puede
   * borrar) rutas de cualquier parte del disco, así que NO se expone por IPC. El
   * handler de `files:paste` solo construye la forma interna (`srcs` relativos); el
   * origen externo lo compone `pegarDesdePortapapeles`, en el main, a partir de lo que
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
  async pegar(req: OpcionesPegar): Promise<ResultadoPegar> {
    if (this.raiz === null) throw new Error(txArchivos().sinProyecto)
    const raizProyecto = this.raiz
    const destDir = normalizarRelativaProyecto(req.destDir).replace(/\/+$/, '')
    const destDirAbs = await this.resolverSeguroReal(destDir)
    const destStat = await fs.stat(destDirAbs).catch(() => null)
    if (!destStat?.isDirectory()) throw new Error(txArchivos().destinoNoCarpeta)

    // Origen unificado: interno (relativo) y externo (absoluto) acaban ambos en una
    // lista de rutas ABSOLUTAS ya validadas. `resolverSeguro` cubre el interno; el
    // externo es legítimamente de fuera y solo se comprueba que exista.
    const origenes: string[] = []
    for (const src of req.srcs ?? []) {
      const srcRel = normalizarRelativaProyecto(src).replace(/\/+$/, '')
      if (!srcRel) throw new Error(txArchivos().origenInvalido)
      // Siguiendo el enlace: copiar uno que apunte fuera traería al proyecto un archivo del host.
      origenes.push(await this.resolverSeguroReal(srcRel))
    }
    for (const rutaHost of req.rutasHost ?? []) origenes.push(path.resolve(rutaHost))
    if (origenes.length === 0) throw new Error(txArchivos().nadaQuePegar)
    if (req.nombre !== undefined && origenes.length > 1) {
      throw new Error(txArchivos().noRenombrarVarios)
    }

    const pegados: string[] = []
    const fallidos: string[] = []
    for (const srcAbs of origenes) {
      const r = await this.pegarUno(srcAbs, req, { rel: destDir, abs: destDirAbs, raizProyecto })
      switch (r.tipo) {
        case 'pegado':
          pegados.push(r.rel)
          break
        case 'fallido':
          fallidos.push(r.nombre)
          break
        case 'noop':
          break
        default: {
          const imposible: never = r
          throw new Error(`desenlace de pegado desconocido: ${JSON.stringify(imposible)}`)
        }
      }
    }

    this.log(`pegados ${pegados.length} elemento(s) en "${destDir || '.'}" (${fallidos.length} fallidos)`)
    // Solo se LANZA si no entró nada. Un fallo parcial se DEVUELVE: lanzarlo perdía
    // la lista de lo que sí se pegó y, en un CORTE, se saltaba el vaciado posterior
    // del portapapeles, que es justo lo que evita que el siguiente pegado falle sobre
    // rutas ya inexistentes.
    if (pegados.length === 0) {
      if (fallidos.length === 0) throw new Error(txArchivos().nadaPegado)
      const que = fallidos.length > 1 ? txArchivos().ninguno : `"${fallidos[0]}"`
      throw new Error(txArchivos().noSePudoPegar(que))
    }
    return { rutas: pegados, fallidos }
  }

  /**
   * Un elemento del pegado: `pegado` con la ruta relativa resultante, `fallido` con el nombre
   * del origen que no entró, o `noop`: un corte pegado donde ya estaba sin ruta que devolver.
   */
  private async pegarUno(
    srcAbs: string,
    req: OpcionesPegar,
    destino: { rel: string; abs: string; raizProyecto: string }
  ): Promise<DesenlacePegado> {
    const srcStat = await fs.stat(srcAbs).catch(() => null)
    const nombreOriginal = path.basename(srcAbs)
    if (!srcStat || (!srcStat.isFile() && !srcStat.isDirectory())) {
      return { tipo: 'fallido', nombre: nombreOriginal || '(sin nombre)' }
    }
    // Meter una carpeta dentro de sí misma (o de un descendiente) recursaría sin fin.
    if (srcStat.isDirectory() && estaDentroDe(destino.abs, srcAbs)) return { tipo: 'fallido', nombre: nombreOriginal }
    // Mover algo justo donde ya está es un no-op, no un error: pegar un CORTE en la
    // carpeta de origen debe dejarlo como estaba. Un COPIAR, en cambio, duplica.
    const mueve = req.op === 'cortar' && estaDentroDe(srcAbs, destino.raizProyecto)
    if (mueve && esMismaRuta(path.dirname(srcAbs), destino.abs)) {
      const yaEstaba = this.relDesdeHost(srcAbs)
      return yaEstaba !== null ? { tipo: 'pegado', rel: yaEstaba } : { tipo: 'noop' }
    }
    try {
      // El nombre de ORIGEN viene del sistema de archivos y por construcción ya es
      // legal: pasarlo por validarNombreArchivo —pensado para lo que se teclea en un
      // diálogo— lo recortaría, y copiar " nota.txt" acabaría creando "nota.txt",
      // un renombrado silencioso en mitad de lo que el usuario pidió como copia.
      // Solo se valida el nombre IMPUESTO por el llamador.
      const base = req.nombre !== undefined ? validarNombreArchivo(req.nombre) : nombreOriginal
      const nombre = await nombreDisponible(destino.abs, base)
      const destAbs = path.join(destino.abs, nombre)
      if (req.op === 'cortar') {
        await moverEntreVolumenes(srcAbs, destAbs)
      } else {
        await fs.cp(srcAbs, destAbs, { recursive: true, errorOnExist: true, force: false })
      }
      return { tipo: 'pegado', rel: destino.rel ? `${destino.rel}/${nombre}` : nombre }
    } catch {
      return { tipo: 'fallido', nombre: nombreOriginal }
    }
  }

  /**
   * Ruta ABSOLUTA del host de algo del proyecto, para el "Copiar ruta" del menú
   * contextual. Devuelve '' si la ruta no es válida, con el mismo criterio que
   * `urlArchivo`: un ítem de menú que falla en silencio es mejor que una excepción
   * cruzando el IPC por algo tan inocuo como copiar texto.
   *
   * NO comprueba que exista: copiar la ruta de algo recién borrado sigue siendo una
   * respuesta útil, y así no se paga un stat por cada clic.
   */
  async rutaAbs(relPosix: string): Promise<string> {
    try {
      // Para algo de dentro de un .jar no existe una ruta de Windows: devolver la
      // del contenedor a secas sería una ruta CREÍBLE PERO FALSA en el portapapeles.
      // Se devuelve el localizador completo `C:\…\x.jar!/com/A.class`, la forma `jar!/`
      // con que las trazas de la JVM nombran una clase, que sí identifica lo copiado.
      const enDisco = contenedorEnDiscoDe(relPosix)
      if (enDisco !== '') {
        const rel = normalizarRelativaProyecto(relPosix)
        return this.resolverProyecto(enDisco) + rel.slice(enDisco.length)
      }
      return this.resolverSeguro(relPosix)
    } catch {
      return ''
    }
  }

  /**
   * Trae al proyecto los archivos/carpetas que el usuario soltó sobre el árbol.
   * `rutasHost` son rutas absolutas del host que produjo Electron a partir de los
   * `File` soltados (ver PeticionImportar); el DESTINO sí pasa por resolverSeguro
   * (anti-traversal).
   *
   * MOVER o COPIAR se decide AQUÍ, por el origen, imitando al Explorador de
   * Windows: lo que viene de FUERA del proyecto se copia (el original en Descargas
   * queda intacto); lo que ya vive DENTRO se mueve (arrastrar una fila del árbol a
   * otra carpeta es reordenar, no duplicar). El renderer no elige: manda las rutas
   * y el main aplica la regla.
   *
   * Todo-o-nada ante colisiones: con `sobrescribir:false` NO toca nada si algún
   * nombre ya existe en el destino y devuelve la lista para que el renderer
   * confirme; con `sobrescribir:true` sobrescribe (al copiar, las carpetas se fusionan).
   */
  async importarDesdeHost(
    rutasHost: string[],
    destDirRelPosix: string,
    sobrescribir: boolean
  ): Promise<ResultadoImportar> {
    if (this.raiz === null) throw new Error(txArchivos().sinProyecto)
    const raizProyecto = this.raiz
    const destDir = normalizarRelativaProyecto(destDirRelPosix).replace(/\/+$/, '')
    const destDirAbs = await this.resolverSeguroReal(destDir)
    const destStat = await fs.stat(destDirAbs)
    if (!destStat.isDirectory()) throw new Error(txArchivos().destinoNoCarpeta)

    // Valida TODO antes de tocar NADA: el resultado es todo-o-nada.
    interface TareaImportacion {
      srcAbs: string
      destAbs: string
      rel: string
      nombre: string
      /** 'move' si el origen ya vive dentro del proyecto; 'copy' si viene de fuera. */
      modo: 'move' | 'copy'
    }
    const tareas: TareaImportacion[] = []
    for (const rutaHost of rutasHost) {
      const srcAbs = path.resolve(rutaHost)
      const nombre = path.basename(srcAbs)
      if (!nombre) throw new Error(txArchivos().origenInvalido)
      const srcStat = await fs.stat(srcAbs).catch(() => null)
      if (!srcStat) throw new Error(txArchivos().noSePudoLeer(nombre))
      if (!srcStat.isFile() && !srcStat.isDirectory()) throw new Error(txArchivos().noEsUnArchivo(nombre))
      const rel = destDir ? `${destDir}/${nombre}` : nombre
      const destAbs = await this.resolverSeguroReal(rel)
      // Meter una carpeta dentro de sí misma (o de un descendiente) recursaría sin fin.
      if (srcStat.isDirectory() && estaDentroDe(destDirAbs, srcAbs)) {
        throw new Error(txArchivos().noMoverEnSiMisma(nombre))
      }
      // Soltar algo justo donde ya está: no-op silencioso (cp/rename fallarían con src===dest).
      if (esMismaRuta(srcAbs, destAbs)) continue
      // (La raíz del proyecto la cubre ya la guarda de ciclo de arriba: todo destino
      // vive DENTRO de ella, así que soltarla en cualquier sitio es meterla en sí misma.)
      tareas.push({ srcAbs, destAbs, rel, nombre, modo: estaDentroDe(srcAbs, raizProyecto) ? 'move' : 'copy' })
    }

    if (!sobrescribir) {
      const conflictos: string[] = []
      for (const tarea of tareas) {
        if (await existe(tarea.destAbs)) conflictos.push(tarea.nombre)
      }
      if (conflictos.length > 0) return { importados: [], conflictos }
    }

    for (const tarea of tareas) {
      if (tarea.modo === 'move') {
        // `rename` no pisa un destino existente en Windows: con sobrescribir hay que
        // quitarlo antes (con `sobrescribir:false` este caso ya salió por `conflictos`).
        if (sobrescribir) await fs.rm(tarea.destAbs, { recursive: true, force: true })
        await fs.rename(tarea.srcAbs, tarea.destAbs)
      } else {
        await fs.cp(tarea.srcAbs, tarea.destAbs, {
          recursive: true,
          force: sobrescribir,
          errorOnExist: !sobrescribir
        })
      }
    }
    const movidos = tareas.filter((j) => j.modo === 'move').length
    this.log(
      `${tareas.length} elemento(s) en "${destDir || '.'}" (${movidos} movido(s), ${tareas.length - movidos} copiado(s))`
    )
    return { importados: tareas.map((j) => j.rel), conflictos: [] }
  }

  /**
   * URL `file://` de un ARCHIVO del proyecto, para el `DownloadURL` del arrastre
   * (ver FILE_URL y LateralExplorador). Devuelve '' si no existe o es una carpeta: Chromium no
   * sabe "descargar" un directorio, así que arrastrar carpetas fuera de la app no se
   * ofrece.
   *
   * resolverSeguro cubre el anti-traversal: solo se puede pedir la URL de algo que viva
   * dentro del proyecto activo.
   */
  async urlArchivo(relPosix: string): Promise<string> {
    let abs: string
    try {
      abs = this.resolverSeguro(relPosix)
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
   * `iniciarArrastre` tiene que arrancar en el mismo `webContents` que está viviendo el gesto
   * del ratón, y con la ventana de `ventana()` bastaría hoy pero no lo diría el código.
   *
   * Las rutas pasan por `resolverSeguro` como cualquier otra: una dentro de un `.jar`
   * o fuera del proyecto no llega a la API del sistema. Y se descarta lo que ya no
   * exista, porque `startDrag` aborta ENTERO si una sola ruta falta — con una
   * selección hecha hace unos segundos eso sería un gesto muerto sin explicación.
   */
  async iniciarArrastre(
    sender: Pick<WebContents, 'startDrag'>,
    rutasRelPosix: readonly string[],
    icono: string
  ): Promise<void> {
    const abs: string[] = []
    for (const rel of rutasRelPosix) {
      try {
        const p = await this.resolverSeguroReal(rel)
        if (await existe(p)) abs.push(p)
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
        rutasRelPosix.length === 1 ? txArchivos().nadaQueArrastrarUno : txArchivos().nadaQueArrastrarVarios
      )
    }
    const imagen = this.escritorio.imagenDesdeUrlDatos(icono)
    // `startDrag` LANZA con un icono vacío, así que un data-URL corrupto tumbaría el
    // arrastre entero. Con el respaldo, el gesto funciona aunque la imagen sea fea:
    // el usuario pidió sacar los archivos, no una estampita.
    const imagenIcono = imagen.isEmpty() ? this.escritorio.imagenDesdeUrlDatos(ICONO_ARRASTRE_MINIMO) : imagen
    if (imagenIcono.isEmpty()) return
    // `file` es obligatorio en el tipo aunque `files` lo sustituya: la doc de Electron
    // dice que cuando van los dos manda `files`, y el primero se repite ahí sólo para
    // satisfacer la firma. Sin él no compila; con él, el comportamiento es el de la
    // lista.
    sender.startDrag({ file: abs[0], files: [...abs], icon: imagenIcono })
  }

  /**
   * Elimina VARIOS archivos/carpetas (recursivo). resolverSeguro impide salir del
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
  async borrarVarios(rutasRelPosix: readonly string[]): Promise<ResultadoBorrar> {
    const objetivos: { rel: string; abs: string }[] = []
    for (const rel of rutasRelPosix) {
      // Sin seguir el último tramo: borrar un enlace quita el enlace, no lo que hay al otro lado.
      const abs = await this.resolverSeguroReal(rel, false)
      // Guarda extra: nunca borrar la raíz del proyecto en sí.
      if (abs === this.raiz) throw new Error(txArchivos().noEliminarRaiz)
      objetivos.push({ rel, abs })
    }
    const borrados: string[] = []
    const fallidos: string[] = []
    for (const { rel, abs } of objetivos) {
      try {
        await fs.rm(abs, { recursive: true, force: true })
        borrados.push(rel)
      } catch {
        fallidos.push(rel.slice(rel.lastIndexOf('/') + 1) || rel)
      }
    }
    if (objetivos.length > 0) {
      this.log(`eliminados ${borrados.length} elemento(s) (${fallidos.length} fallidos)`)
    }
    return { borrados, fallidos }
  }

  /**
   * (Re)arranca el watcher recursivo de la raíz activa. Cierra el anterior si lo
   * había. Sin ventana (ventana) o sin raíz, no hace nada. fs.watch recursivo
   * está soportado en Windows y macOS; ante cualquier fallo (p. ej. la carpeta
   * desapareció) NO propaga: el árbol simplemente deja de auto-refrescarse.
   */
  private iniciarVigilancia(): void {
    this.detenerVigilancia()
    if (!this.ventana || this.raiz === null) return
    try {
      this.vigilante = watch(this.raiz, { recursive: true }, (_evt, nombreArchivo) => {
        // Clasifica el cambio: 'noise' (node_modules / .git/objects) se ignora;
        // 'git' (HEAD/refs/packed-refs/logs/index — cambio de git relevante hecho
        // fuera de la app) emite files:gitChanged; el resto recarga el árbol.
        const tipo = nombreArchivo ? clasificarRuta(nombreArchivo) : 'file'
        if (tipo === 'noise') return
        if (tipo === 'git') {
          this.programarEventoGit()
          return
        }
        // Si el que cambió es un .jar/.war, se suelta su índice cacheado. La clave de
        // la caché ya lleva mtime y tamaño, así que la CORRECCIÓN no depende de esto
        // —un jar reconstruido nunca se sirve viejo—, pero sin soltarlo el índice
        // muerto se queda ocupando el presupuesto de memoria y desaloja a otros que
        // sí sirven. Pasa de verdad: un `mvn package` reescribe media carpeta lib/.
        if (nombreArchivo != null && this.jar !== null && esNombreContenedor(nombreArchivo)) {
          try {
            // El watcher entrega la ruta con el separador del HOST: la misma regla
            // por plataforma que el resto del servicio (en Mac un `\` del nombre no
            // se toca; en Windows es el separador y pasa a `/`).
            this.jar.invalidar(this.resolverProyecto(normalizarRelativaProyecto(nombreArchivo)))
          } catch {
            // Ruta rara del watcher: no es motivo para dejar de refrescar el árbol.
          }
        }
        this.programarEventoCambio(nombreArchivo)
      })
    } catch (err) {
      this.log(`watcher no disponible: ${err instanceof Error ? err.message : String(err)}`)
      this.vigilante = null
    }
  }

  /**
   * Teardown público (cierre de la app): cierra el FSWatcher recursivo y cancela sus
   * temporizadores pendientes, en vez de dejarlos vivos hasta que muera el proceso.
   */
  dispose(): void {
    this.detenerVigilancia()
  }

  /** Cierra el watcher y cancela los avisos pendientes. */
  private detenerVigilancia(): void {
    if (this.temporizadorVigilante) {
      clearTimeout(this.temporizadorVigilante)
      this.temporizadorVigilante = null
    }
    // Un cambio pendiente del proyecto ANTERIOR no debe entregarse tras re-apuntar.
    // Sus RUTAS tampoco: son relativas a la raíz vieja, y entregarlas contra la nueva
    // haría releer archivos que no tienen nada que ver.
    this.cambioPendiente = false
    this.rutasCambiadas.clear()
    this.cambioParcial = false
    if (this.temporizadorGit) {
      clearTimeout(this.temporizadorGit)
      this.temporizadorGit = null
    }
    if (this.vigilante) {
      this.vigilante.close()
      this.vigilante = null
    }
  }

  /**
   * Colapsa la ráfaga de eventos del watcher en avisos al renderer, con DOS frenos:
   *
   *   - debounce (DEBOUNCE_VIGILANTE_MS): un cambio aislado espera a que amaine la ráfaga
   *     de eventos que fs.watch emite por un solo guardado.
   *   - intervalo mínimo (INTERVALO_MIN_CAMBIOS_MS): entre dos avisos consecutivos.
   *
   * El segundo freno es el que faltaba, y es el importante. Un debounce por sí solo
   * NO acota una escritura SOSTENIDA: si el agente (o `npm install`) escribe cada
   * 250 ms, cada escritura supera el debounce de 200 ms y emite su propio evento.
   * Medido: 20 escrituras en 5 s producían 21 avisos, y cada aviso costaba re-listar
   * el árbol en el renderer MÁS un `git status` por repo. Con el intervalo mínimo la
   * misma ráfaga emite unos pocos avisos, sin perder ninguno: el último cambio
   * SIEMPRE se entrega (flanco de salida).
   */
  private programarEventoCambio(nombreArchivo?: string | null): void {
    this.cambioPendiente = true
    // Acumula QUÉ cambió durante la ventana de antirrebote. Con tope: un `npm
    // install` toca miles de archivos y mandarlos todos por IPC no le sirve a nadie.
    // Al desbordar se marca `parcial` en vez de entregar una lista truncada que
    // parezca completa: el renderer prefiere releer todo lo que tiene abierto (son
    // unas pocas pestañas) antes que perderse justo el archivo que importaba.
    if (nombreArchivo != null && nombreArchivo !== '') {
      if (this.rutasCambiadas.size < MAX_RUTAS_CAMBIADAS) {
        this.rutasCambiadas.add(normalizarRelativaProyecto(nombreArchivo))
      } else {
        this.cambioParcial = true
      }
    } else {
      this.cambioParcial = true // el watcher no dio nombre: no se puede acotar
    }
    if (this.temporizadorVigilante) return // ya hay un aviso programado; este cambio va en él
    const transcurrido = Date.now() - this.ultimaEmisionCambio
    const espera = Math.max(DEBOUNCE_VIGILANTE_MS, INTERVALO_MIN_CAMBIOS_MS - transcurrido)
    this.temporizadorVigilante = setTimeout(() => this.emitirEventoCambio(), espera)
  }

  /** Entrega el aviso pendiente (flanco de salida del throttle de arriba). */
  private emitirEventoCambio(): void {
    this.temporizadorVigilante = null
    if (!this.cambioPendiente) return
    this.cambioPendiente = false
    this.ultimaEmisionCambio = Date.now()
    const datos: EventoArchivosCambiados = {
      rutas: [...this.rutasCambiadas],
      parcial: this.cambioParcial
    }
    this.rutasCambiadas.clear()
    this.cambioParcial = false
    const ventana = this.ventana?.()
    if (ventana && !ventana.isDestroyed() && !ventana.webContents.isDestroyed()) {
      ventana.webContents.send(FILE_CHANNELS.CHANGED, datos)
    }
  }

  /** Colapsa la ráfaga de cambios de metadata git en un único aviso al renderer.
   *  Debounce mayor: una operación git (commit/merge) toca varios refs a la vez. */
  private programarEventoGit(): void {
    if (this.temporizadorGit) clearTimeout(this.temporizadorGit)
    this.temporizadorGit = setTimeout(() => {
      this.temporizadorGit = null
      const ventana = this.ventana?.()
      if (ventana && !ventana.isDestroyed() && !ventana.webContents.isDestroyed()) {
        ventana.webContents.send(FILE_CHANNELS.GIT_CHANGED)
      }
    }, DEBOUNCE_VIGILANTE_GIT_MS)
  }
}

/**
 * Corre una tarea CPU-pesada de visor (listar zip / convertir docx) en un
 * worker_threads EFÍMERO y devuelve su resultado, para no bloquear el hilo main.
 * Spawn-por-tarea (sin pool): son operaciones infrecuentes, así el worker no queda
 * residente. El buffer viaja por `workerData` (structured clone). El bundle del
 * worker se emite junto al main (ver electron.vite.config) como `fileWorker.js`.
 */
function ejecutarTrabajadorArchivo<T>(tipo: 'zip-list' | 'docx-html', bytes: Buffer): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const trabajador = new Worker(path.join(__dirname, 'fileWorker.js'), { workerData: { kind: tipo, bytes } })
    let terminado = false
    const terminar = (fn: () => void): void => {
      if (terminado) return
      terminado = true
      void trabajador.terminate()
      fn()
    }
    trabajador.once('message', (msg: { ok: boolean; result?: T; error?: string }) => {
      terminar(() =>
        msg && msg.ok
          ? resolver(msg.result as T)
          : rechazar(new Error(msg?.error ?? txArchivos().errorTrabajador))
      )
    })
    trabajador.once('error', (err) => terminar(() => rechazar(err)))
    trabajador.once('exit', (codigo) => {
      if (!terminado) {
        terminado = true
        rechazar(new Error(txArchivos().trabajadorSalio(codigo)))
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
const ENTRADAS_REF_GIT = new Set([
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
function clasificarRuta(nombreArchivo: string | Buffer): 'noise' | 'git' | 'file' {
  const segs = nombreArchivo.toString().split(/[/\\]/)
  if (segs.includes('node_modules')) return 'noise'
  const gi = segs.indexOf('.git')
  if (gi === -1) return 'file'
  const sub = segs[gi + 1]
  // Dentro de .git: solo refs/HEAD/logs cuentan; el resto (index, objects…) es ruido.
  return sub !== undefined && ENTRADAS_REF_GIT.has(sub) ? 'git' : 'noise'
}

/** Heurística de binario (byte NUL en el primer tramo); vive en `codificacionTexto` porque git también la usa. */
const esBinarioArchivo = esBufferBinario
