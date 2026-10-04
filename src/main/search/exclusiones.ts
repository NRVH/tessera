// =============================================================================
// Qué NO se barre al buscar en archivos. Módulo PURO (sin fs ni electron): decide por nombre y
// tamaño. Tres cribas en el orden en que salen baratas: carpeta por nombre (ni se entra),
// extensión binaria conocida (ni se abre) y tamaño tras el `stat`. La criba definitiva de
// binarios es `isBinaryBuffer` (`files/textCodec.ts`), que mira el contenido: la extensión solo
// ahorra trabajo. Es una lista fija y no el `.gitignore`: exigiría un repo por cada sub-repo de la
// contenedora y un `.gitignore` agresivo esconde archivos sin decirlo. .jar y .class no cuentan
// como binarios aquí: tienen camino propio (índice del zip, pool de constantes).
// =============================================================================

/**
 * Carpetas en las que no se entra, por nombre exacto (en minúsculas).
 *
 * `.git` y `node_modules` son el mismo criterio que `FileService.classifyPath` ya
 * encierra para el watcher del árbol; aquí por fin tiene nombre y test. El resto
 * son metadatos de herramienta: nunca contienen código del usuario, y `.gradle`
 * o `.idea` sueltan miles de archivos que solo aportan ruido.
 *
 * NO están `target`, `build`, `dist`, `out` ni `bin`: son nombres de carpeta
 * legítimos en proyectos reales (`src/main/bin`, un `build/` escrito a mano), y
 * saltárselos escondería resultados de verdad. Lo generado que hay dentro suele
 * ser .class y .jar, que tienen su propio camino, o binarios que caen en la criba
 * de contenido.
 */
export const SALTAR_CARPETAS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  '.gradle',
  '.mvn',
  // Carpeta de datos de la propia Tessera dentro de un proyecto.
  '.tessera'
])

/**
 * Extensiones que NO se abren: se sabe por el nombre que no son texto. Solo evita
 * trabajo, no cambia el veredicto (lo daría igual `isBinaryBuffer`).
 *
 * `.jar`, `.war`, `.ear`, `.aar` y `.class` NO entran aquí a propósito: ver la
 * cabecera. `.zip` tampoco, pero por otro motivo: no es un contenedor navegable en
 * Tessera (`EXT_CONTENEDOR` de jarPath lo deja fuera), así que se salta como el
 * binario que es.
 */
export const EXT_BINARIAS: ReadonlySet<string> = new Set([
  // Imágenes
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'icns', 'webp', 'avif', 'tif', 'tiff',
  'heic', 'heif', 'jxl', 'jp2', 'psd', 'ai',
  // Documentos y comprimidos (el .zip incluido: no es contenedor navegable)
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'cab', 'msi',
  // Ejecutables y objetos
  'exe', 'dll', 'so', 'dylib', 'obj', 'o', 'a', 'lib', 'pdb', 'bin', 'pyc', 'pyo',
  // Fuentes tipográficas
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // Multimedia
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'mp4', 'avi', 'mkv', 'mov', 'wmv',
  'webm', 'flv',
  // Bases de datos y volcados
  'db', 'sqlite', 'sqlite3', 'mdb', 'dat', 'iso', 'dmg'
])

/**
 * Tope de tamaño de un archivo de texto que se barre.
 *
 * Es EL MISMO que `MAX_FILE_BYTES` del editor, y esa igualdad es deliberada: si la
 * búsqueda encontrara algo en un archivo que el editor no puede abrir entero, el
 * "Abrir en el editor" llevaría a una vista truncada donde la coincidencia puede
 * no estar. Lo que se busca y lo que se puede abrir tienen que ser lo mismo.
 */
export const MAX_ARCHIVO_BYTES = 2 * 1024 * 1024

/** Extensión en minúsculas, sin punto. '' si no tiene. */
export function extensionDe(nombre: string): string {
  const base = nombre.toLowerCase().split(/[\\/]/).pop() ?? ''
  const punto = base.lastIndexOf('.')
  // `punto <= 0` cubre "sin extensión" y los dotfiles (".gitignore" no tiene
  // extensión "gitignore": es un nombre que empieza por punto).
  return punto <= 0 ? '' : base.slice(punto + 1)
}

/** ¿Se entra en esta carpeta? Recibe el NOMBRE, no la ruta. */
export function saltarCarpeta(nombre: string): boolean {
  return SALTAR_CARPETAS.has(nombre.toLowerCase())
}

/** ¿Se sabe por el nombre que no es texto? (criba barata, no definitiva) */
export function esBinarioPorExtension(nombre: string): boolean {
  return EXT_BINARIAS.has(extensionDe(nombre))
}

/** ¿Es un contenedor navegable (.jar/.war/.ear/.aar)? Tiene camino propio. */
export function esContenedor(nombre: string): boolean {
  const ext = extensionDe(nombre)
  return ext === 'jar' || ext === 'war' || ext === 'ear' || ext === 'aar'
}

/** ¿Es una clase compilada? Tiene camino propio (pool de constantes). */
export function esClase(nombre: string): boolean {
  return extensionDe(nombre) === 'class'
}

/**
 * ¿Este archivo entra en el barrido de TEXTO? Solo por su nombre y tamaño; el
 * contenido lo juzga después `isBinaryBuffer`.
 */
export function barrerComoTexto(nombre: string, bytes: number): boolean {
  if (bytes > MAX_ARCHIVO_BYTES) return false
  if (esContenedor(nombre) || esClase(nombre)) return false
  return !esBinarioPorExtension(nombre)
}

/**
 * Extensiones de las entradas de un contenedor que se leen como TEXTO.
 *
 * Aquí la política se invierte —lista blanca, no negra— y no por gusto: inflar una
 * entrada de un jar cuesta de verdad (lectura por rangos + inflate), y un jar
 * trae cientos de entradas que no son ni texto ni clases. Fuera de un jar el
 * reparto es el contrario (casi todo es texto), así que allí compensa la lista
 * negra. Es la misma decisión medida al revés, no una incoherencia.
 */
export const EXT_TEXTO_EN_JAR: ReadonlySet<string> = new Set([
  'java', 'kt', 'groovy', 'scala', 'sql', 'xml', 'xsd', 'xsl', 'xslt', 'wsdl',
  'properties', 'txt', 'json', 'yml', 'yaml', 'html', 'htm', 'jsp', 'jspf', 'tld',
  'css', 'js', 'md', 'csv', 'ini', 'cfg', 'conf', 'sh', 'bat', 'ftl', 'vm'
])

/**
 * ¿Se lee esta entrada de un contenedor como texto?
 *
 * `META-INF/services/*` se acepta POR PREFIJO y antes de mirar nada más. Son
 * archivos de texto por definición del formato, y es donde se declara qué
 * implementación carga un `ServiceLoader` — justo lo que uno busca cuando algo
 * "no se registra". El prefijo tiene que mandar porque esos archivos se llaman
 * como la interfaz que declaran (`javax.sql.DataSource`), así que PARECEN tener
 * extensión ("datasource") y una lista blanca por extensión los descartaría.
 */
export function entradaDeJarEsTexto(nombreEntrada: string): boolean {
  if (nombreEntrada.toUpperCase().startsWith('META-INF/SERVICES/')) return true
  const ext = extensionDe(nombreEntrada)
  if (ext === 'mf') return true
  return EXT_TEXTO_EN_JAR.has(ext)
}
