// =============================================================================
// jarPath: la gramática de las rutas que apuntan DENTRO de un contenedor (.jar/.war/.ear/
// .aar), para expandirlo en el árbol como si fuera una carpeta.
// Ruta virtual: `lib/comunes.jar!/com/ejemplo/Nota.class`, POSIX y relativa a la
// contenedora. El `!/` solo corta tras una extensión de `EXT_CONTENEDOR` (`!` es legal en
// nombres de Windows). El parentesco se pregunta a `esDescendiente`, no a `startsWith`.
// Puro y sin plataforma: no toca el disco.
// Decisiones: docs/decisiones/shared/ruta-virtual-de-contenedor.md
// =============================================================================

/** Separador virtual contenedor/entrada: la convención de las URL `jar:` de Java. */
export const SEP_ARCHIVO = '!/'

/**
 * Extensiones que el árbol expande como si fueran carpetas. `.zip` NO entra
 * (ver DESCARTES): conserva su visor de listado.
 */
export const EXT_CONTENEDOR: ReadonlySet<string> = new Set(['jar', 'war', 'ear', 'aar'])

/**
 * Niveles de anidamiento admitidos. `app.war!/WEB-INF/lib/dep.jar!/…` son 2; 4 deja
 * margen para casos raros y acota el trabajo del servicio (cada nivel es un buffer
 * inflado en memoria). Pasarse devuelve null, no una ruta truncada.
 */
export const MAX_ANIDAMIENTO = 4

/** Una ruta virtual ya partida en el contenedor de disco y la cadena de entradas. */
export interface RutaArchivo {
  /** Ruta EN DISCO del contenedor, POSIX relativa a la contenedora. Nunca lleva `!/`. */
  contenedor: string
  /**
   * `entradas[0]` es relativa al contenedor de disco; `entradas[i]` a lo que nombra
   * `entradas[i-1]`. Longitud >= 1. La última puede ser '' (= la RAÍZ de ese archivo).
   */
  entradas: string[]
}

/**
 * Quita las anclas iniciales. Y NADA MÁS: en particular NO traduce `\` a `/`.
 *
 * POR QUÉ ESTE MÓDULO NO SABE DE PLATAFORMAS, aunque su gemelo del main sí. Aquí las
 * rutas son SIEMPRE relativas al proyecto y con separadores POSIX: es el invariante
 * del IPC («el renderer nunca ve ni envía rutas del host»), y la traducción de
 * separadores ocurre UNA vez, en la frontera del main (`normalizarRelativaProyecto`
 * en `shared/rutasHost.ts`, que sí toma la plataforma). En este espacio una barra
 * invertida no es un separador: es un carácter del NOMBRE, en las dos plataformas.
 *
 * SE PROBÓ pasarle la plataforma y llamar a `normalizarRelativaProyecto`, para no
 * repetir la regla. Se retiró, y el motivo no es de estilo: ese módulo importa
 * `plataformaActual()`, que lee `process.platform`, y este archivo lo importa el
 * RENDERER (Sidebar → treeFlatten → jarPath), donde `process` no existe con
 * `contextIsolation` + `sandbox`. El resultado medido fue el panel del árbol de
 * archivos entero caído con «process is not defined» en la app empaquetada. Un módulo
 * de `shared/` que el renderer importa no puede depender de `process`.
 *
 * SE EXPORTA (como `normalizarRutaVirtual`) porque fuera de aquí había una copia a
 * mano que además convertía `\` en `/`: `JarService.partirOEnRaiz`. Con una carpeta
 * llamada `a\b` —legal en macOS— los hijos del jar volvían con la ruta partida en dos
 * y cada clic acababa en ENOENT. La regla tiene un solo dueño para que no vuelva a
 * reescribirse distinta en otro sitio.
 */
function normalizar(ruta: string): string {
  return ruta.replace(/^\/+/, '')
}

export { normalizar as normalizarRutaVirtual }

/** Último segmento tras '/' (el basename "plano", sin mirar fronteras de archivo). */
function ultimoSegmento(ruta: string): string {
  const barra = ruta.lastIndexOf('/')
  return barra < 0 ? ruta : ruta.slice(barra + 1)
}

/** Extensión en minúsculas, sin punto; '' si no tiene. */
function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.')
  return punto <= 0 ? '' : nombre.slice(punto + 1).toLowerCase()
}

/**
 * ¿El nombre de un archivo es de los que el árbol expande? Insensible a mayúsculas
 * (`LIBRERIA.JAR` en un proyecto legacy es lo normal, no la excepción).
 */
export function esNombreContenedor(nombre: string): boolean {
  return EXT_CONTENEDOR.has(extensionDe(nombre))
}

/** Posiciones de los `!/` que SÍ cortan (los que van tras un nombre de contenedor). */
function cortesValidos(norm: string): number[] {
  const cortes: number[] = []
  let desde = 0
  for (;;) {
    const i = norm.indexOf(SEP_ARCHIVO, desde)
    if (i < 0) break
    if (esNombreContenedor(ultimoSegmento(norm.slice(0, i)))) cortes.push(i)
    // Se avanza UNA posición, no la longitud del separador: un nombre de entrada
    // patológico que empiece por '!' no debe hacernos saltar el siguiente corte.
    desde = i + 1
  }
  return cortes
}

/** ¿Lleva al menos un punto de corte VÁLIDO? Barato: no toca disco. */
export function esRutaVirtual(ruta: string): boolean {
  return cortesValidos(normalizar(ruta)).length > 0
}

/**
 * ¿Esta ruta TOCA un contenedor, aunque no sea una ruta virtual bien formada?
 *
 * Cubre `esRutaVirtual` y además la forma DEGENERADA `x.jar!`: un `!` de corte sin
 * la barra que lo completa. Nadie la escribe a propósito, pero sale sola de
 * `parentDir('x.jar!/A.class')`, que es lo que calcula el destino al soltar algo
 * sobre una clase en la RAÍZ de un jar. Y como no contiene `!/`, `esRutaVirtual` la
 * daba por buena: se colaba por la guarda del main como si fuera una ruta de disco
 * real y reventaba con un ENOENT crudo en vez de un mensaje humano.
 *
 * Es el predicado que deben usar las guardas de ESCRITURA. Para leer sigue valiendo
 * `esRutaVirtual`, porque una ruta degenerada no apunta a ninguna entrada leíble.
 */
export function tocaContenedor(ruta: string): boolean {
  const norm = normalizar(ruta)
  if (cortesValidos(norm).length > 0) return true
  return norm.endsWith('!') && esNombreContenedor(ultimoSegmento(norm.slice(0, -1)))
}

/**
 * Parte una ruta virtual. Devuelve null si no hay ningún corte válido (una ruta de
 * disco normal, incluida la de un `.jar` "pelado") o si se pasa de MAX_ANIDAMIENTO.
 *
 * OJO: `parseRutaArchivo('lib/foo.jar')` es null POR CONTRATO — no hay `!/`—, y esa
 * es justo la ruta con la que el árbol pide la PRIMERA expansión. Quien enrute debe
 * comprobar además `esNombreContenedor(basename)`; con solo este parser, expandir un
 * jar por primera vez no funcionaría nunca.
 */
export function parseRutaArchivo(
  ruta: string
): RutaArchivo | null {
  const norm = normalizar(ruta)
  const cortes = cortesValidos(norm)
  if (cortes.length === 0) return null
  if (cortes.length > MAX_ANIDAMIENTO) return null

  const entradas: string[] = []
  for (let k = 0; k < cortes.length; k++) {
    const desde = cortes[k] + SEP_ARCHIVO.length
    const hasta = k + 1 < cortes.length ? cortes[k + 1] : norm.length
    entradas.push(norm.slice(desde, hasta))
  }
  return { contenedor: norm.slice(0, cortes[0]), entradas }
}

/** Inversa de parseRutaArchivo. componer('a/x.jar', ['com/A.class']) -> 'a/x.jar!/com/A.class'. */
export function componerRutaArchivo(
  contenedor: string,
  entradas: readonly string[]
): string {
  let salida = normalizar(contenedor)
  for (const entrada of entradas) salida += SEP_ARCHIVO + normalizar(entrada)
  return salida
}

/**
 * El archivo que contiene DIRECTAMENTE esta entrada (prefijo hasta el ÚLTIMO `!/`).
 * En un anidado devuelve el contenedor INTERNO, que puede ser a su vez virtual.
 * '' si la ruta no es virtual.
 */
export function archivoContenedorDe(
  ruta: string
): string {
  const norm = normalizar(ruta)
  const cortes = cortesValidos(norm)
  return cortes.length === 0 ? '' : norm.slice(0, cortes[cortes.length - 1])
}

/**
 * El contenedor de PRIMER nivel: el único que existe de verdad en disco y el único
 * que `resolveSafe` puede traducir. '' si la ruta no es virtual.
 */
export function contenedorEnDiscoDe(
  ruta: string
): string {
  const norm = normalizar(ruta)
  const cortes = cortesValidos(norm)
  return cortes.length === 0 ? '' : norm.slice(0, cortes[0])
}

/**
 * Nombre para mostrar: el basename que NO cruza la frontera `!/`. Para la raíz de un
 * contenedor (`x.jar!/`) devuelve el nombre del propio contenedor, que es lo que el
 * usuario espera leer en una pestaña.
 */
export function nombreDeRuta(ruta: string): string {
  const norm = normalizar(ruta)
  const partido = parseRutaArchivo(norm)
  if (partido === null) return ultimoSegmento(norm)
  const ultima = partido.entradas[partido.entradas.length - 1]
  if (ultima === '') {
    // Raíz del contenedor: su nombre es el del archivo que la contiene.
    return nombreDeRuta(archivoContenedorDe(norm))
  }
  return ultimoSegmento(ultima)
}

/**
 * parentDir consciente de la frontera:
 *   'lib/x.jar!/com/a' -> 'lib/x.jar!/com'
 *   'lib/x.jar!/com'   -> 'lib/x.jar'          (cruza la frontera hacia el contenedor)
 *   'lib/x.jar'        -> 'lib'
 *   'x'                -> ''
 */
export function padreDeRuta(ruta: string): string {
  const norm = normalizar(ruta)
  const partido = parseRutaArchivo(norm)
  if (partido === null) {
    const barra = norm.lastIndexOf('/')
    return barra < 0 ? '' : norm.slice(0, barra)
  }
  const ultima = partido.entradas[partido.entradas.length - 1]
  const barra = ultima.lastIndexOf('/')
  if (barra >= 0) {
    const entradas = partido.entradas.slice(0, -1)
    entradas.push(ultima.slice(0, barra))
    return componerRutaArchivo(partido.contenedor, entradas)
  }
  // Estamos en el primer nivel dentro del contenedor: el padre es el contenedor.
  return archivoContenedorDe(norm)
}

/**
 * ¿`ruta` está DENTRO de `ancestro`? Acepta '/' Y '!/' como frontera, que es lo que
 * arregla los dos `startsWith(base + '/')` del árbol. Es estricto: una ruta no es
 * descendiente de sí misma, así que el llamador escribe la comprobación completa
 * como `p === base || esDescendiente(base, p)` — igual de legible que hoy.
 */
export function esDescendiente(
  ancestro: string,
  ruta: string
): boolean {
  const base = normalizar(ancestro)
  const hijo = normalizar(ruta)
  if (base === '') return hijo !== ''
  return hijo.startsWith(base + '/') || hijo.startsWith(base + SEP_ARCHIVO)
}

/**
 * Versión de la plataforma Java a partir del `major` del class file, en el formato
 * habitual ("bytecode version: 46.0 (Java 1.2)").
 *
 * El salto está en 49: hasta Java 1.4 la numeración es 1.x, y desde Java 5 es
 * plana. Ese mismo 49 es la frontera de `EnclosingMethod`, y por eso importa aquí
 * más de lo que parece: por debajo, los .class de clases anónimas no dicen a qué
 * método pertenecen, y un decompilador que dependa de ese atributo emite código
 * inválido (`new Foo$1(this)`) en vez de la clase anónima original.
 */
export function plataformaDeMajor(major: number): string {
  if (!Number.isInteger(major) || major < 45 || major > 99) return `desconocida (${major})`
  return major >= 49 ? `Java ${major - 44}` : `Java 1.${major - 44}`
}
