// =============================================================================
// Ficheros del portapapeles del sistema, en el main: en Windows por los formatos registrados del
// Shell (`Shell IDList Array`, `Preferred DropEffect`, `FileNameW`) con PowerShell de reserva para
// la lista completa; en macOS por el plist de `NSFilenamesPboardType` o `public.file-url`. Un
// sondeo barato para el menú contextual y la lista completa solo al pegar; un fallo es «no pega»,
// nunca «pierde datos». El portapapeles entra por `adaptadores/portapapelesElectron.ts`.
// Decisiones: docs/decisiones/explorador/portapapeles-del-sistema.md
// =============================================================================

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PortapapelesSistema } from './adaptadores/portapapelesElectron'
import { esMac, esWindows } from '../../shared/plataforma'
import { MAX_TEXTO_SONDEO, type ClipboardProbe } from '../../shared/clipboard-ipc'
import type { PasteResult } from '../../shared/files-ipc'

const execFileAsync = promisify(execFile)

/** Ficheros del portapapeles. Interno del main: el renderer nunca ve estas rutas. */
interface ClipboardFiles {
  /** Rutas ABSOLUTAS del host. Vacío si no se pudo leer. */
  paths: string[]
  effect: 'copy' | 'cut'
}

/**
 * Lo que `pasteFromClipboard` necesita del subsistema de ficheros, declarado de
 * forma ESTRUCTURAL para no importar FileService: así este módulo no arrastra medio
 * main a su grafo (ni al de su test) y sigue siendo el único sitio que sabe de
 * formatos del Shell.
 */
type Pegar = (opts: {
  destDir: string
  hostPaths: string[]
  op: 'copiar' | 'cortar'
  nombre?: string
}) => Promise<PasteResult>

// -----------------------------------------------------------------------------
// Nombres REGISTRADOS de los formatos del Shell (Shlobj.h). Estas cadenas SÍ
// resuelven al id correcto con RegisterClipboardFormat, porque son exactamente los
// nombres que registra el propio Explorador. (Compárese con 'CF_HDROP', que no.)
// -----------------------------------------------------------------------------
/** CFSTR_FILENAMEW: UN solo fichero, UTF-16LE, NUL-terminado. */
const FMT_FILENAME_W = 'FileNameW'
/** CFSTR_SHELLIDLIST: estructura CIDA. Primer DWORD = cidl = nº de elementos. */
const FMT_SHELL_IDLIST = 'Shell IDList Array'
/** CFSTR_PREFERREDDROPEFFECT: un DWORD con un DROPEFFECT. */
const FMT_DROP_EFFECT = 'Preferred DropEffect'

/** MIME que Chromium sintetiza en availableFormats() cuando hay CF_HDROP/FileName(W). */
const MIME_FILES = 'text/uri-list'
/** MIME que Chromium sintetiza cuando hay CF_DIB (un bitmap EN MEMORIA). */
const MIME_IMAGE = 'image/png'

const DROPEFFECT_COPY = 1
const DROPEFFECT_MOVE = 2

/** Tope del spawn de PowerShell: medido en ~220 ms; 5 s ya es "algo va muy mal". */
const PS_TIMEOUT_MS = 5_000

// El tope del texto del sondeo vive en el CONTRATO (`MAX_TEXTO_SONDEO`), no aquí:
// el renderer necesita el mismo número para recortar su marca antes de compararla.
// Ver el comentario de la constante — con varias rutas copiadas, tenerlo sólo en este
// lado hacía que el portapapeles interno caducara solo y en silencio.

// -----------------------------------------------------------------------------
// (a) SONDEO BARATO — se llama al abrir el menú contextual.
// -----------------------------------------------------------------------------

/**
 * Qué hay en el portapapeles, en el mínimo de llamadas posible.
 *
 * `availableFormats()` es la ÚNICA API de Electron que en Windows refleja de verdad
 * CF_HDROP: por dentro es GetStandardFormats(), que solo hace
 * IsClipboardFormatAvailable (SIN OpenClipboard) y traduce a nombres MIME:
 *     'text/uri-list' <=> CF_HDROP || CFSTR_FILENAMEW || CFSTR_FILENAME
 *     'image/png'     <=> CF_DIB
 *
 * PRIORIDAD FICHEROS > IMAGEN: si aparecen los dos (raro pero posible), en un
 * explorador de ARCHIVOS lo que el usuario quiere pegar es el fichero original —con
 * su nombre, sus bytes y su EXIF—, no un PNG rasterizado de nuevo.
 *
 * Solo TEXTO -> 'none' con el texto adjunto, y el llamador decide: no pinta "Pegar"
 * salvo que ese texto sea la marca de su propio portapapeles interno.
 */
export function probeClipboard(pp: PortapapelesSistema): ClipboardProbe {
  // macOS tiene su propio camino: NSPasteboard, con los mismos dos preguntas pero
  // otras respuestas. Ver `sondearMac`.
  if (esMac()) return sondearMac(pp)

  // En cualquier otro sistema (Linux) solo se informa del TEXTO: no hay
  // implementación de lectura de ficheros, y anunciar 'files' ofrecería un "Pegar"
  // que no podría cumplir. El texto sí, porque es lo que valida el portapapeles
  // INTERNO del explorador, que funciona en cualquier plataforma.
  if (!esWindows()) {
    return { kind: 'none', count: 0, effect: 'copy', texto: safeReadText(pp) }
  }

  const formats = pp.formatos()

  if (formats.includes(MIME_FILES)) {
    // Estos dos readBuffer SÍ adquieren el portapapeles (ScopedClipboard::Acquire
    // reintenta 5 veces con Sleep(5) => hasta ~20 ms cada uno si otra app lo tiene
    // pillado). Por eso son solo DOS, y solo cuando ya sabemos que hay ficheros:
    // llamar a readBuffer de un formato AUSENTE cuesta más que de uno presente,
    // porque Chromium cae en ExtractCustomPlatformNames() y vuelve a adquirirlo.
    return {
      kind: 'files',
      count: parseCidaCount(safeReadBuffer(pp, FMT_SHELL_IDLIST)),
      effect: parseDropEffect(safeReadBuffer(pp, FMT_DROP_EFFECT))
    }
  }

  // OJO: aquí NO se llama a clipboard.readImage(). readImage() hace ReadPng(), que
  // gira un RunLoop ANIDADO y codifica el DIB entero en el thread pool: decenas de
  // ms y una imagen completa en memoria solo para responder un sí/no que
  // availableFormats() ya respondió gratis.
  if (formats.includes(MIME_IMAGE)) return { kind: 'image', count: 1, effect: 'copy' }

  return { kind: 'none', count: 0, effect: 'copy', texto: safeReadText(pp) }
}

/**
 * `readBuffer` tolerante. Nunca lanza: un portapapeles que otra app tiene bloqueado
 * o un formato ausente valen 0 bytes, no una excepción que impida abrir el menú.
 */
function safeReadBuffer(pp: PortapapelesSistema, format: string): Buffer {
  try {
    return pp.leerBuffer(format)
  } catch {
    return Buffer.alloc(0)
  }
}

/** Texto del portapapeles, recortado y a prueba de fallos (ver MAX_TEXTO_SONDEO). */
function safeReadText(pp: PortapapelesSistema): string {
  try {
    return pp.leerTexto().slice(0, MAX_TEXTO_SONDEO)
  } catch {
    return ''
  }
}

// -----------------------------------------------------------------------------
// macOS — NSPasteboard
// -----------------------------------------------------------------------------

/**
 * Formato de NSPasteboard con la lista COMPLETA de rutas, como plist XML. Es el
 * equivalente de CF_HDROP: lo pone el Finder al copiar uno o varios ficheros.
 */
const FMT_MAC_NOMBRES = 'NSFilenamesPboardType'
/**
 * Formato con UNA sola ruta, como `file://` URL. Respaldo: hay orígenes (una app que
 * comparte un único documento) que ponen esto y no la lista.
 */
const FMT_MAC_URL = 'public.file-url'

/**
 * Sondeo barato en macOS.
 *
 * LO QUE SE MIDIÓ ANTES DE ESCRIBIR ESTO (sonda con Electron 33 sobre macOS 26): al
 * copiar un fichero, `availableFormats()` devuelve exactamente `["text/uri-list"]` —el
 * MISMO nombre MIME que Chromium usa en Windows para CF_HDROP—, así que la guarda de
 * "¿hay ficheros?" es idéntica en las dos plataformas y no hace falta un formato
 * propio. Lo que cambia es de dónde se sacan las rutas.
 *
 * EL RECUENTO SÍ CUESTA UNA LECTURA, al revés que en Windows. Allí el CIDA da la
 * cuenta en su primer DWORD y se lee sin adquirir el portapapeles; aquí hay que leer
 * el plist entero y contar sus `<string>`. Se acepta: son unos cientos de bytes y una
 * expresión regular, muy por debajo del coste de abrir un menú contextual, y sin la
 * cuenta el menú no puede decir "Pegar 3 elementos".
 *
 * NO EXISTE "CORTAR" DE FICHEROS EN macOS, y por eso el efecto es SIEMPRE 'copy'. No
 * es una simplificación: el Finder no tiene "Cortar" — mueve al PEGAR (⌥⌘V), y esa
 * decisión la toma el destino, no el origen, así que el portapapeles no lleva ninguna
 * marca equivalente a CFSTR_PREFERREDDROPEFFECT. Devolver 'copy' es lo correcto, y
 * además es el lado seguro del error que ya documenta `parseDropEffect`: equivocarse
 * hacia copiar deja un duplicado; hacia cortar, le borra un fichero al usuario.
 */
function sondearMac(pp: PortapapelesSistema): ClipboardProbe {
  const formats = pp.formatos()
  if (!formats.includes(MIME_FILES)) {
    if (formats.includes(MIME_IMAGE)) return { kind: 'image', count: 1, effect: 'copy' }
    return { kind: 'none', count: 0, effect: 'copy', texto: safeReadText(pp) }
  }
  const rutas = rutasDelPortapapelesMac(pp)
  // `text/uri-list` estaba anunciado pero no se pudo sacar ni una ruta: se informa de
  // que NO hay ficheros pegables, en vez de ofrecer un "Pegar" que no haría nada.
  if (rutas.length === 0) return { kind: 'none', count: 0, effect: 'copy', texto: safeReadText(pp) }
  return { kind: 'files', count: rutas.length, effect: 'copy' }
}

/**
 * Las rutas absolutas del portapapeles de macOS. Vacío si no hay ninguna.
 *
 * Dos fuentes, en orden: la lista completa (`NSFilenamesPboardType`, un plist XML) y,
 * si no está, la URL única (`public.file-url`). Las dos se comprobaron con la sonda.
 */
function rutasDelPortapapelesMac(pp: PortapapelesSistema): string[] {
  const plist = safeRead(pp, FMT_MAC_NOMBRES)
  if (plist !== '') {
    const rutas = parsePlistRutas(plist)
    if (rutas.length > 0) return rutas
  }
  const url = safeRead(pp, FMT_MAC_URL)
  const ruta = rutaDesdeFileUrl(url)
  return ruta === null ? [] : [ruta]
}

/**
 * Rutas de un plist XML de NSFilenamesPboardType.
 *
 * SE PARSEA CON UNA EXPRESIÓN Y NO CON UN PARSER DE XML porque la forma está fijada
 * por AppKit y es siempre la misma —un `<array>` de `<string>`—, y meter una
 * dependencia de XML en el main para leer esto sería desproporcionado. Lo que sí hay
 * que hacer bien es DESESCAPAR las cinco entidades de XML: un fichero llamado
 * `a&b.txt` viaja como `a&amp;b.txt`, y sin desescapar la ruta no existe y el pegado
 * falla con "no such file" sobre un nombre que el usuario ve escrito distinto.
 *
 * Exportada para poder probarla con `node` a secas: es lógica pura sobre una cadena.
 */
export function parsePlistRutas(xml: string): string[] {
  const rutas: string[] = []
  const re = /<string>([\s\S]*?)<\/string>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const ruta = desescaparXml(m[1])
    // Solo rutas ABSOLUTAS. El plist de este formato siempre las trae así; cualquier
    // otra cosa es un formato que no esperábamos, y montar un pegado sobre ella sería
    // resolverla contra un cwd que aquí no significa nada.
    if (ruta.startsWith('/')) rutas.push(ruta)
  }
  return rutas
}

/** Las cinco entidades que AppKit escapa al serializar el plist. */
function desescaparXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // `&amp;` va la ÚLTIMA a propósito: si fuera la primera, un `&amp;lt;` literal
    // (un fichero llamado "&lt;") se convertiría en `&lt;` y luego en `<`, cambiando
    // el nombre. Deshaciendo el ampersand al final, cada entidad se resuelve una vez.
    .replace(/&amp;/g, '&')
}

/**
 * Ruta absoluta a partir de una `file://` URL. null si no lo es.
 *
 * `decodeURIComponent` es obligatorio: un fichero con espacios llega como
 * `file:///Users/ana/dos%20con%20espacio.txt`, y sin decodificar la ruta no existe.
 * Exportada por lo mismo que `parsePlistRutas`: es lógica pura y tiene test.
 */
export function rutaDesdeFileUrl(url: string): string | null {
  const limpia = url.trim()
  if (!limpia.startsWith('file://')) return null
  try {
    const ruta = decodeURIComponent(new URL(limpia).pathname)
    return ruta.startsWith('/') ? ruta : null
  } catch {
    // Una URL mal formada no es motivo para tumbar el menú contextual.
    return null
  }
}

/** `clipboard.read` tolerante. Nunca lanza (mismo criterio que `safeReadBuffer`). */
function safeRead(pp: PortapapelesSistema, formato: string): string {
  try {
    return pp.leer(formato)
  } catch {
    return ''
  }
}

/**
 * Nº de elementos a partir del CIDA de CFSTR_SHELLIDLIST. Estructura documentada:
 *     typedef struct _IDA { UINT cidl; UINT aoffset[1]; } CIDA;
 * `aoffset` tiene cidl+1 entradas (la 0 es la carpeta padre), así que el tamaño
 * mínimo creíble es 4 + (cidl+1)*4. Esa comprobación es lo que evita interpretar
 * basura como "ocho millones de ficheros".
 *
 * Devuelve 0 cuando NO se puede saber: este formato lo pone el Shell, y un gestor de
 * archivos de terceros puede publicar únicamente CF_HDROP. 0 significa "no sé",
 * nunca "cero" — el llamador lo trata cayendo al camino general.
 */
export function parseCidaCount(buf: Buffer): number {
  if (buf.length < 8) return 0
  const cidl = buf.readUInt32LE(0)
  if (cidl === 0 || cidl > 100_000) return 0
  if (buf.length < 4 + (cidl + 1) * 4) return 0
  return cidl
}

/**
 * ¿COPIAR o CORTAR? DWORD de CFSTR_PREFERREDDROPEFFECT.
 *
 * Se prueban BITS, no igualdad, porque el Explorador de Windows pone **5**
 * (DROPEFFECT_COPY|DROPEFFECT_LINK) al copiar y **2** (DROPEFFECT_MOVE) al cortar:
 * un `v === DROPEFFECT_COPY` fallaría con el 5 real y trataría un COPIAR como CORTAR.
 *
 * Ante ambigüedad (3 = COPY|MOVE, o formato ausente) gana COPIAR: equivocarse hacia
 * copiar deja un duplicado; hacia cortar, le borra un fichero al usuario.
 */
export function parseDropEffect(buf: Buffer): 'copy' | 'cut' {
  if (buf.length < 4) return 'copy'
  const v = buf.readUInt32LE(0)
  return (v & DROPEFFECT_MOVE) !== 0 && (v & DROPEFFECT_COPY) === 0 ? 'cut' : 'copy'
}

// -----------------------------------------------------------------------------
// (b) LISTA COMPLETA — se llama al hacer CLIC en "Pegar".
// -----------------------------------------------------------------------------

/**
 * Rutas absolutas de TODOS los ficheros del portapapeles, más si fue copiar o cortar.
 *
 * Dos niveles, del barato al caro:
 *   1) UN solo elemento (según el CIDA) -> CFSTR_FILENAMEW ya trae su ruta completa.
 *      Instantáneo y sin procesos; cubre el caso mayoritario. Se AUTOVALIDA con
 *      existsSync: si la ruta no existe, no nos la creemos y caemos al nivel 2.
 *   2) Varios elementos, o el nivel 1 no cuadró -> PowerShell. CFSTR_FILENAMEW NO
 *      vale aquí: la doc de Microsoft dice que transfiere "a single file", así que
 *      con 5 ficheros copiados devolvería el primero SIN avisar. Es el modo de fallo
 *      más traicionero de todo esto, y por eso el nivel 1 exige `count === 1`.
 */
export async function readClipboardFiles(pp: PortapapelesSistema): Promise<ClipboardFiles> {
  const probe = probeClipboard(pp)
  if (probe.kind !== 'files') return { paths: [], effect: 'copy' }

  // macOS: las rutas ya vienen enteras en el plist de NSPasteboard, así que no hay
  // "dos niveles" que escalar ni ningún subproceso que lanzar — el equivalente al
  // PowerShell del nivel 2 de Windows no hace falta. Se filtran por existencia por el
  // mismo motivo que allí: el portapapeles puede referirse a algo ya borrado, y es
  // mejor pegar de menos que fallar entero.
  if (esMac()) {
    return { paths: rutasDelPortapapelesMac(pp).filter((p) => existsSync(p)), effect: 'copy' }
  }

  if (probe.count === 1) {
    const single = parseFileNameW(safeReadBuffer(pp, FMT_FILENAME_W))
    // OJO: `has('FileNameW')` NO sirve de guarda. ClipboardWin::IsFormatAvailable
    // tiene un caso especial que, para el id de FileNameW, responde
    // ReadFilenamesAvailable() -> true también cuando el origen solo puso CF_HDROP.
    // O sea: puede decir "disponible" y devolver 0 bytes. Se comprueba el RESULTADO.
    if (single && existsSync(single)) return { paths: [single], effect: probe.effect }
  }

  return { paths: await readFileDropListViaPowerShell(), effect: probe.effect }
}

/**
 * Ruta de CFSTR_FILENAMEW: UTF-16LE NUL-terminada dentro de un bloque que puede ser
 * MÁS GRANDE que la cadena (ReadData devuelve GlobalSize(), y el origen suele
 * reservar MAX_PATH*2 dejando relleno detrás). De ahí el corte en el primer NUL.
 * El `- (length % 2)` cubre un GlobalSize impar, que en 'ucs2' dejaría un byte suelto.
 */
export function parseFileNameW(buf: Buffer): string {
  if (buf.length < 2) return ''
  const s = buf.toString('ucs2', 0, buf.length - (buf.length % 2))
  const nul = s.indexOf('\0')
  return (nul === -1 ? s : s.slice(0, nul)).trim()
}

/**
 * Lista COMPLETA vía PowerShell. Es la única vía sin dependencias nativas que ve
 * todos los ficheros: `Get-Clipboard -Format FileDropList` lee CF_HDROP de verdad
 * (id 15), que es justo lo que la API de Electron no puede pedir.
 *
 * Decisiones de la invocación, todas por un motivo MEDIDO en Windows 11 / PS 5.1:
 *
 *   -EncodedCommand (base64 de UTF-16LE) en vez de -Command: pasando el script como
 *      argumento, entre el quoting de Node y el reparseo de PowerShell las comillas
 *      desaparecen y el script llega roto ("if( -eq ){NULL}"). Con -EncodedCommand no
 *      hay quoting que valga. Además ExecutionPolicy no aplica (solo afecta a .ps1).
 *
 *   -STA: redundante (powershell.exe arranca en STA desde WinPS 3.0), pero el
 *      portapapeles de WinForms EXIGE STA y es mejor que esa dependencia esté escrita
 *      en la línea de comandos que suponiendo un default.
 *
 *   $ProgressPreference='SilentlyContinue': sin esto PS 5.1 escribe en stderr un
 *      "#< CLIXML ... Preparando módulos para el primer uso" que PARECE un error y no
 *      lo es. Aquí se decide por el parseo del stdout, nunca por stderr.
 *
 *   ConvertTo-Json -InputObject (NO por tubería): con `| ConvertTo-Json` el pipeline
 *      desenrolla el array y un resultado vacío se serializa como {} en vez de [].
 *      Medido: `@{p=@()} | ConvertTo-Json` -> {"p":{}} ; con -InputObject -> {"p":[]}.
 *
 *   [Console]::OutputEncoding = UTF8: las rutas con acentos salen intactas y SIN BOM
 *      en PS 5.1 redirigido, así que JSON.parse las digiere tal cual.
 *
 * NO se hace `Add-Type -AssemblyName System.Windows.Forms`: Get-Clipboard la carga
 * sola y sale más barato (medido: ~220 ms sin Add-Type frente a ~670 ms con él).
 *
 * Best-effort: cualquier fallo devuelve [] y el llamador enseña "no se pudo leer el
 * portapapeles". Nunca lanza hacia el IPC.
 */
async function readFileDropListViaPowerShell(): Promise<string[]> {
  const script = [
    `$ProgressPreference = 'SilentlyContinue'`,
    `[Console]::OutputEncoding = [Text.Encoding]::UTF8`,
    `$files = Get-Clipboard -Format FileDropList`,
    `$paths = @()`,
    `if ($null -ne $files) { $paths = @($files | ForEach-Object { $_.FullName }) }`,
    `ConvertTo-Json -Compress -InputObject @{ paths = [string[]]$paths }`
  ].join('; ')

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      { timeout: PS_TIMEOUT_MS, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    )
    return parseFileDropListJson(stdout)
  } catch (err) {
    console.error('[tessera] no se pudo leer la lista de ficheros del portapapeles:', err)
    return []
  }
}

/**
 * Parseo del JSON de PowerShell. PURO a propósito: es lo único de este camino que
 * puede equivocarse sin un portapapeles de verdad delante, así que se prueba solo.
 */
export function parseFileDropListJson(stdout: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stdout.trim())
    const paths = (parsed as { paths?: unknown })?.paths
    if (!Array.isArray(paths)) return []
    return paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
  } catch {
    return []
  }
}

// -----------------------------------------------------------------------------
// (c) PEGAR en el proyecto lo que haya en el portapapeles.
// -----------------------------------------------------------------------------

/**
 * Vuelca el BITMAP del portapapeles a un PNG temporal y devuelve su ruta absoluta,
 * o null si no hay imagen (o falla el volcado). Escritura asíncrona para no bloquear
 * el hilo del main con imágenes grandes.
 *
 * Lo comparten el pegado en el árbol y el de la terminal (clipboard:saveImage), que
 * hacían lo mismo por separado.
 */
export async function saveClipboardImageToTemp(
  pp: PortapapelesSistema,
  prefijo = 'clip'
): Promise<string | null> {
  const png = pp.imagenPng()
  if (png.length === 0) return null
  const filePath = join(pp.rutaTemporal(), `${prefijo}_${Date.now()}.png`)
  try {
    await writeFile(filePath, png)
  } catch (err) {
    console.error('[tessera] no se pudo guardar la imagen del portapapeles:', err)
    return null
  }
  return filePath
}

/**
 * Pega en `destDir` lo que haya en el portapapeles del sistema. El llamador solo
 * aporta el destino y la función que escribe en disco.
 *
 * TODO lo peligroso se decide AQUÍ, en el main, y ese es el motivo de que exista esta
 * función en vez de dejar que el renderer componga la petición: las rutas de origen
 * salen del portapapeles, y "copiar o cortar" sale del Preferred DropEffect leído en
 * este mismo instante. Un renderer no puede pedir que se mueva —ni que se borre— una
 * ruta arbitraria del disco, porque no elige ninguna de las dos cosas.
 *
 * Por el mismo motivo el `effect` se lee aquí y no se recicla del sondeo que abrió el
 * menú: entre abrir el menú y pulsar "Pegar" pasa tiempo indeterminado, y el dato que
 * decide si se BORRA el original tiene que ser fresco.
 */
export async function pasteFromClipboard(
  pp: PortapapelesSistema,
  destDir: string,
  pegar: Pegar
): Promise<PasteResult> {
  const probe = probeClipboard(pp)

  if (probe.kind === 'files') {
    const { paths, effect } = await readClipboardFiles(pp)
    if (paths.length === 0) throw new Error('No se pudo leer lo que hay en el portapapeles.')
    const op = effect === 'cut' ? 'cortar' : 'copiar'
    const res = await pegar({ destDir, hostPaths: paths, op })
    // Tras un CORTAR, Windows espera que el destino avise al origen por OLE
    // (CFSTR_PASTESUCCEEDED), cosa imposible sin código nativo. Vaciar el
    // portapapeles evita que el Explorador deje los iconos atenuados y que un
    // segundo pegado falle sobre rutas que ya no existen. Se vacía aunque el pegado
    // haya sido PARCIAL: lo que se movió, movido está, y reintentar el resto con
    // rutas medio muertas produce justo el error incomprensible que esto evita.
    if (op === 'cortar') pp.vaciar()
    return res
  }

  if (probe.kind === 'image') {
    const tmp = await saveClipboardImageToTemp(pp, 'tessera_pegar')
    if (tmp === null) throw new Error('No se pudo leer la imagen del portapapeles.')
    return pegar({ destDir, hostPaths: [tmp], op: 'copiar', nombre: 'imagen.png' })
  }

  throw new Error('No hay archivos ni imágenes en el portapapeles.')
}
