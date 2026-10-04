// =============================================================================
// El BARRIDO: recorrer un proyecto buscando texto, el motor de la búsqueda en archivos. Vive
// fuera de `workers/searchWorker.ts` para probarlo con `node` contra un árbol real; no importa
// `electron` (corre en un worker_thread). Dos fases en este orden: los archivos de texto del
// árbol y después los contenedores (.jar/.war…) y .class, para que la lista se llene en décimas
// de segundo. Lo caro se acota: `detectEncoding` en modo rápido, `zipRandom` lee solo el
// directorio central, y nunca se descompila (el pool de constantes responde en microsegundos;
// descompilar es cosa de la vista previa, para una fila).
// =============================================================================

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MAX_COINCIDENCIAS, buscarCoincidencias, type OpcionesBusqueda } from '../../shared/textSearch'
import type { CoincidenciaArchivo } from '../../shared/search-ipc'
import { componerRutaArchivo } from '../../shared/jarPath'
import { decodeText, detectEncoding, isBinaryBuffer } from '../files/textCodec'
import { cadenasDeClase, formaLegible } from '../java/poolConstantes'
import {
  MAX_ARCHIVO_BYTES,
  barrerComoTexto,
  entradaDeJarEsTexto,
  esBinarioPorExtension,
  esClase,
  esContenedor,
  saltarCarpeta
} from './exclusiones'
import {
  MAX_ENTRADA_BYTES,
  abrirLectorDeArchivo,
  lectorDeBuffer,
  leerEntrada,
  leerIndice,
  type EntradaZip,
  type LectorRango
} from '../java/zipRandom'

/**
 * Contexto de una línea en la fila del resultado. Recortar es obligatorio: una
 * línea de un .java generado puede tener 40 000 caracteres, y mandarla entera por
 * el IPC para pintar 80 sería tirar memoria en cada coincidencia.
 *
 * ERA 240 Y SATURABA LA LISTA. Con documentos —los .md de este repo, un .sql, un
 * .properties con un comentario largo— un "renglón" son párrafos enteros, y la
 * lista se convertía en un muro de texto en el que la coincidencia resaltada no
 * destacaba: doce filas de prosa a ancho completo. En un .java no se notaba porque
 * las líneas de código son cortas.
 *
 * 90 es el número porque la fila NO ES DONDE SE LEE EL CÓDIGO: para eso está la
 * vista previa de abajo, que enseña el archivo entero centrado en la coincidencia.
 * La fila solo tiene que dar la referencia suficiente para reconocerla —de qué va
 * esa línea— y dejar sitio al nombre del archivo. Con el tope de ancho del CSS
 * (la mitad de la fila), 90 caracteres es lo que cabe sin que se corte casi nunca.
 */
const MAX_TEXTO_FILA = 90
/**
 * Caracteres que se conservan ANTES de la coincidencia al recortar por la
 * izquierda. Bajó de 60 a 16 por lo mismo: lo que importa es que se VEA la
 * coincidencia, y con 60 caracteres delante quedaba empujada al centro de la fila
 * —o fuera, al recortar el CSS por la derecha—.
 */
const CONTEXTO_IZQUIERDA = 16

/**
 * Profundidad máxima de carpetas. No es una política de producto: es la red contra
 * un ciclo de enlaces simbólicos, que `readdir` recorrería para siempre.
 */
const MAX_PROFUNDIDAD = 40

/**
 * Tope de coincidencias POR NOMBRE de archivo, aparte del global.
 *
 * Existe porque la fase de nombres corre ENTERA antes que la de contenido y las
 * dos comparten el cupo de `MAX_COINCIDENCIAS`: sin un tope propio, una consulta
 * de una o dos letras sobre un árbol grande lo agota con puros nombres y el
 * barrido de contenido no llega a correr. El usuario vería "5000+" y CERO
 * coincidencias de contenido para una consulta que antes sí las devolvía —una
 * regresión silenciosa, porque nada distingue "no hay" de "no se buscó"—.
 *
 * 1000 deja el 80 % del cupo para el contenido, que es lo que se busca casi
 * siempre; los nombres son una ayuda para encontrar un archivo, no el grueso. Al
 * alcanzarlo se marca `truncado` (el contador dirá "N+") y la fase de nombres se
 * calla, pero el barrido SIGUE.
 */
const MAX_NOMBRES = 1000

/** Jars anidados que se abren. `jarPath.MAX_ANIDAMIENTO` es 4; aquí basta con 1
 *  nivel dentro del .war, que es el caso real (`app.war!/WEB-INF/lib/x.jar`).
 *  Cada nivel más es un buffer inflado ENTERO en memoria. */
const MAX_JAR_ANIDADO = 1

export interface OpcionesBarrido {
  /** Raíz absoluta del proyecto (la contenedora). */
  raiz: string
  /**
   * Carpeta por la que EMPEZAR, relativa POSIX a `raiz`. `''` = todo el proyecto.
   *
   * Es el ámbito «en una carpeta» del modal. Va aparte de `raiz` a propósito y no
   * sustituyéndola: las rutas de las coincidencias tienen que seguir siendo
   * relativas a la RAÍZ DEL PROYECTO, porque es contra ella contra la que
   * resuelven la vista previa y "Abrir en el editor". Barrer pasando la subcarpeta
   * como raíz habría sido una línea menos y habría devuelto rutas que no abren.
   */
  subcarpeta?: string
  query: string
  opts: OpcionesBusqueda
  /** Se llama con cada coincidencia. Devuelve false para PARAR el barrido. */
  emitir: (c: CoincidenciaArchivo) => boolean
  /** Se consulta a menudo; true = alguien canceló. */
  cancelado?: () => boolean
}

export interface ResultadoBarrido {
  total: number
  archivos: number
  truncado: boolean
  cancelado: boolean
}

/**
 * Recorta una línea alrededor de la coincidencia y devuelve el texto y la columna
 * DENTRO de ese texto.
 *
 * El detalle que importa: si se recorta por la izquierda, la columna original ya no
 * sirve, y usarla pintaría el resaltado en el sitio equivocado. Por eso las dos
 * cosas salen de aquí juntas, y no se calculan por separado en dos sitios.
 */
function recortarLinea(
  cruda: string,
  inicioCrudo: number,
  finCrudo: number
): { texto: string; columna: number; longitud: number } {
  // SE QUITA LA SANGRÍA DE LA IZQUIERDA, como en cualquier IDE. Sin esto, cada fila
  // arranca donde la sangría de su código diga: una línea anidada cuatro niveles
  // empieza a media fila y la de al lado pegada al borde, así que la columna de
  // texto queda desalineada y con un hueco muerto a la izquierda del que nadie
  // puede leer nada. Lo que importa de una coincidencia es su TEXTO, no cuánto
  // sangraba en su archivo.
  //
  // Se hace AQUÍ y no en el CSS porque el desplazamiento tiene que descontarse de
  // `columna` en el mismo sitio: si se recortara al pintar, el resaltado se
  // quedaría corrido tantos caracteres como sangría tuviera la línea.
  const sangria = cruda.length - cruda.trimStart().length
  const linea = cruda.slice(sangria)
  const inicio = Math.max(0, inicioCrudo - sangria)
  const fin = Math.max(inicio, finCrudo - sangria)

  // Los tabuladores de en medio se dejan como están: convertirlos a espacios
  // cambiaría las longitudes y el CSS de la fila ya usa `white-space: pre`.
  if (linea.length <= MAX_TEXTO_FILA) {
    return { texto: linea, columna: inicio + 1, longitud: fin - inicio }
  }
  const desde = Math.max(0, inicio - CONTEXTO_IZQUIERDA)
  const hasta = Math.min(linea.length, desde + MAX_TEXTO_FILA)
  const prefijo = desde > 0 ? '…' : ''
  const sufijo = hasta < linea.length ? '…' : ''
  const texto = prefijo + linea.slice(desde, hasta) + sufijo
  const columna = inicio - desde + prefijo.length + 1
  // La coincidencia puede quedar cortada por el borde derecho; el largo se acota
  // a lo que de verdad hay en `texto`, o el resaltado se saldría de la cadena.
  const longitud = Math.min(fin - inicio, texto.length - (columna - 1))
  return { texto, columna, longitud: Math.max(0, longitud) }
}

/**
 * Busca en un texto ya decodificado y emite una coincidencia por hit, con su
 * número de línea real.
 *
 * Se parte por líneas UNA vez y se busca línea a línea (en vez de buscar sobre el
 * texto entero y luego traducir desplazamiento -> línea): así el número de línea es
 * exacto sin mantener una tabla de offsets, y una coincidencia nunca puede cruzar
 * un salto de línea, que es lo que se quiere para una lista de resultados.
 */
function buscarEnTexto(
  contenido: string,
  ctx: { path: string; nombre: string },
  o: OpcionesBarrido,
  estado: { total: number; truncado: boolean }
): boolean {
  // \r\n y \r se cubren: un .java legacy en Windows los trae, y sin esto el \r
  // quedaría pegado al final de cada línea y ensuciaría la fila.
  const lineas = contenido.split(/\r\n|\r|\n/)
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]
    if (linea.length === 0) continue
    const hits = buscarCoincidencias(linea, o.query, o.opts)
    for (const h of hits) {
      const { texto, columna, longitud } = recortarLinea(linea, h.inicio, h.fin)
      estado.total++
      // `columnaArchivo` es la de la línea DE VERDAD (con su sangría y sin recorte);
      // `columna` es la del texto que se pinta en la fila. Ver el contrato: mezclarlas
      // deja el cursor de "Abrir en el editor" tantos caracteres antes como sangría
      // tuviera la línea.
      if (
        !o.emitir({
          path: ctx.path,
          nombre: ctx.nombre,
          linea: i + 1,
          columna,
          columnaArchivo: h.inicio + 1,
          longitud,
          texto,
          origen: 'texto'
        })
      ) {
        estado.truncado = true
        return false
      }
    }
  }
  return true
}

/**
 * Recorta una RUTA para la fila, POR EL MEDIO.
 *
 * Es otra función que `recortarLinea` y no un parámetro suyo, porque el criterio es
 * el contrario. En una línea de código lo que importa es el entorno de la
 * coincidencia, así que se recorta por los extremos; en una ruta importan LOS DOS
 * EXTREMOS —de qué carpeta cuelga y cómo se llama— y lo prescindible es el medio.
 *
 * Se vio en vivo: `codigo/java/com/ejemplo/digitalizacionswg/cliente/tool/Acceso….java`
 * son 91 caracteres, uno más que el tope, y el recorte de línea se comía la
 * izquierda entera dejando "…wg/cliente/tool/AccesoWebservice…". Justo la carpeta,
 * que es lo que se está preguntando al buscar un archivo por su nombre.
 *
 * `inicioNombre` es dónde empieza el último tramo; la cola SIEMPRE se conserva
 * entera, y la cabeza se queda con lo que sobre. Si ni el nombre solo cabe, se cae
 * al recorte de línea, que sí sabe centrarse en la coincidencia.
 */
function recortarRuta(
  rel: string,
  inicioNombre: number,
  inicioCrudo: number,
  finCrudo: number
): { texto: string; columna: number; longitud: number } {
  if (rel.length <= MAX_TEXTO_FILA) {
    return { texto: rel, columna: inicioCrudo + 1, longitud: finCrudo - inicioCrudo }
  }
  const cola = rel.slice(inicioNombre)
  const espacio = MAX_TEXTO_FILA - cola.length - 1 // el 1 es el '…'
  if (espacio <= 0) return recortarLinea(rel, inicioCrudo, finCrudo)
  const cabeza = rel.slice(0, espacio)
  const texto = `${cabeza}…${cola}`
  // La coincidencia va dentro del nombre, así que su columna es la del nombre
  // dentro de la cola, desplazada por la cabeza y el '…'.
  const columna = cabeza.length + 1 + (inicioCrudo - inicioNombre) + 1
  return { texto, columna, longitud: finCrudo - inicioCrudo }
}

/**
 * Emite una coincidencia por NOMBRE DE ARCHIVO. `rel` es la ruta relativa (o
 * virtual, dentro de un jar) y `nombre` su último tramo.
 *
 * SE RESALTA SOBRE LA RUTA Y NO SOBRE EL NOMBRE SUELTO, y ese es el punto de la
 * función: quien busca "FileService.ts" quiere saber DÓNDE está, así que la fila
 * enseña `src/main/files/FileService.ts` con el nombre marcado. Para eso el
 * desplazamiento del hit hay que trasladarlo del nombre a la ruta completa, que es
 * exactamente el off-by-one que se cometería calculándolo en el sitio de llamada.
 *
 * NO SE MIRA NI EL TAMAÑO NI SI ES BINARIO: casar un nombre no exige leer el
 * archivo, así que aquí SÍ entran los .png, los .jar y los de 200 MB. Es lo que se
 * pidió —"archivos de cualquier extensión"— y además es gratis.
 */
function emitirNombre(
  rel: string,
  nombre: string,
  o: OpcionesBarrido,
  estado: { total: number; truncado: boolean; archivos: Set<string>; nombres: number }
): boolean {
  const hits = buscarCoincidencias(nombre, o.query, o.opts)
  if (hits.length === 0) return true
  // Cupo de nombres agotado: se calla y se marca, pero devuelve `true` para que el
  // barrido SIGA. Devolver `false` aquí es lo que dejaría al usuario sin contenido.
  if (estado.nombres >= MAX_NOMBRES) {
    estado.truncado = true
    return true
  }
  estado.nombres++
  // Una sola fila por archivo aunque el nombre case dos veces ("test-test.ts"):
  // la fila señala el ARCHIVO, y repetirlo no añade nada.
  const desplazamiento = rel.length - nombre.length
  const h = hits[0]
  const { texto, columna, longitud } = recortarRuta(
    rel,
    desplazamiento,
    desplazamiento + h.inicio,
    desplazamiento + h.fin
  )
  estado.total++
  estado.archivos.add(rel)
  if (
    !o.emitir({
      path: rel,
      nombre,
      linea: 0,
      columna,
      columnaArchivo: 0,
      longitud,
      texto,
      origen: 'archivo'
    })
  ) {
    estado.truncado = true
    return false
  }
  return true
}

/**
 * Busca en las CADENAS del pool de constantes de una clase compilada.
 *
 * `linea: 0` y `origen: 'clase'` no son un valor centinela perezoso: el pool no
 * tiene líneas, y fabricar un número sería mentir en la única columna que el
 * usuario usa para orientarse. La fila enseña la constante que casó, y la vista
 * previa —que sí descompila— es la que da el código.
 */
function buscarEnClase(
  bytes: Buffer,
  ctx: { path: string; nombre: string },
  o: OpcionesBarrido,
  estado: { total: number; truncado: boolean }
): boolean {
  const cadenas = cadenasDeClase(bytes)
  // Una misma cadena aparece muchas veces en un pool (cada referencia la reusa),
  // y el nombre de la propia clase sale en casi todas las entradas. Sin dedup, una
  // sola clase llenaría la lista entera con la misma fila repetida.
  const vistas = new Set<string>()
  for (const cadena of cadenas) {
    for (const candidata of [cadena, formaLegible(cadena)]) {
      if (candidata === null || vistas.has(candidata)) continue
      const hits = buscarCoincidencias(candidata, o.query, o.opts)
      if (hits.length === 0) continue
      vistas.add(candidata)
      const h = hits[0]
      const { texto, columna, longitud } = recortarLinea(candidata, h.inicio, h.fin)
      estado.total++
      // Sin línea tampoco hay columna de archivo: 0, igual que `linea`. Fingir una
      // sería mentir dos veces sobre el mismo sitio inexistente.
      if (
        !o.emitir({
          path: ctx.path,
          nombre: ctx.nombre,
          linea: 0,
          columna,
          columnaArchivo: 0,
          longitud,
          texto,
          origen: 'clase'
        })
      ) {
        estado.truncado = true
        return false
      }
    }
  }
  return true
}

/** Decodifica unos bytes como texto, o null si son binarios. */
function comoTexto(bytes: Buffer): string | null {
  if (isBinaryBuffer(bytes)) return null
  return decodeText(bytes, detectEncoding(bytes, false, { rapido: true }))
}

/**
 * Barre un contenedor (.jar/.war/.ear/.aar). `rutaBase` es la ruta relativa POSIX
 * del contenedor (que puede ser ella misma virtual, si es un jar anidado).
 */
async function barrerContenedor(
  lector: LectorRango,
  rutaBase: string,
  nivel: number,
  o: OpcionesBarrido,
  estado: { total: number; truncado: boolean; archivos: Set<string>; nombres: number }
): Promise<boolean> {
  const indice = await leerIndice(lector)
  // Los jars anidados se dejan para el final del contenedor, por el mismo motivo
  // que el texto va antes que los contenedores en el barrido general.
  const anidados: EntradaZip[] = []

  for (const entrada of indice.entradas) {
    if (o.cancelado?.() === true) return false
    if (entrada.esDir) continue
    const rutaVirtual = componerRutaArchivo(rutaBase, [entrada.nombre])
    const nombre = entrada.nombre.slice(entrada.nombre.lastIndexOf('/') + 1)

    // El NOMBRE de la entrada, aquí y no en la fase 0: el índice del jar ya está
    // leído, así que casarlo es gratis, y una fase aparte obligaría a abrir cada
    // contenedor dos veces. Sale antes que el contenido de esa misma entrada, que
    // es el orden que se quiere.
    if (!emitirNombre(rutaVirtual, nombre, o, estado)) return false

    if (esContenedor(entrada.nombre)) {
      if (nivel < MAX_JAR_ANIDADO) anidados.push(entrada)
      continue
    }

    const esUnaClase = esClase(entrada.nombre)
    if (!esUnaClase && !entradaDeJarEsTexto(entrada.nombre)) continue
    // El tope de texto vale igual dentro del jar: es el que garantiza que lo
    // encontrado se pueda abrir entero después.
    if (!esUnaClase && entrada.tamano > MAX_ARCHIVO_BYTES) continue

    let bytes: Buffer
    try {
      bytes = await leerEntrada(lector, entrada, { maxBytes: MAX_ARCHIVO_BYTES })
    } catch {
      // Entrada con compresión rara, corrupta o que se pasa del tope: se salta.
      // Un jar malo no puede tumbar la búsqueda entera.
      continue
    }

    const antes = estado.total
    let sigue: boolean
    if (esUnaClase) {
      sigue = buscarEnClase(bytes, { path: rutaVirtual, nombre }, o, estado)
    } else {
      const texto = comoTexto(bytes)
      sigue = texto === null ? true : buscarEnTexto(texto, { path: rutaVirtual, nombre }, o, estado)
    }
    if (estado.total > antes) estado.archivos.add(rutaVirtual)
    if (!sigue) return false
  }

  for (const entrada of anidados) {
    if (o.cancelado?.() === true) return false
    const rutaVirtual = componerRutaArchivo(rutaBase, [entrada.nombre])
    let bytes: Buffer
    try {
      // Un jar anidado SÍ se infla entero: no hay forma de leer por rangos dentro
      // de una entrada comprimida. Es el motivo de que el nivel esté acotado.
      bytes = await leerEntrada(lector, entrada, { maxBytes: MAX_ENTRADA_BYTES })
    } catch {
      continue
    }
    const dentro = lectorDeBuffer(bytes)
    try {
      if (!(await barrerContenedor(dentro, rutaVirtual, nivel + 1, o, estado))) return false
    } catch {
      // Jar anidado ilegible: se salta, como cualquier otra entrada mala.
    } finally {
      await dentro.cerrar()
    }
  }
  return true
}

/**
 * Recorre el árbol emitiendo SOLO coincidencias por nombre de archivo.
 *
 * ES UNA PASADA APARTE Y VA LA PRIMERA, y las dos cosas son a propósito. Va la
 * primera porque es lo que se pidió: "que me muestre los archivos con la
 * coincidencia y DESPUÉS lo que encontró dentro de cada archivo". Y va aparte
 * porque mezclarla con la pasada de texto las entrelazaría —el nombre de un
 * archivo de la última carpeta saldría detrás del contenido de la primera— y ese
 * orden es justamente lo que se quiere garantizar.
 *
 * LA GARANTÍA ES SOBRE EL ÁRBOL DE DISCO, y conviene decirlo con precisión porque
 * es fácil leer de más: los nombres de las entradas de DENTRO de un .jar NO salen
 * aquí, sino en la pasada de contenedores, que va la última. Adelantarlos exigiría
 * abrir y leer el índice de cada jar en la fase 0 y volver a leerlo después —el
 * doble de trabajo en la parte más cara del barrido— para adelantar unas filas que
 * casi nunca son lo que se busca. Dentro de cada contenedor sí se respeta: el
 * nombre de una entrada sale antes que su contenido.
 *
 * Cuesta poco: aquí no se lee ni un byte de ningún archivo, solo entradas de
 * directorio, que además el sistema acaba de cachear para la pasada siguiente.
 */
async function barrerNombres(
  abs: string,
  rel: string,
  profundidad: number,
  o: OpcionesBarrido,
  estado: { total: number; truncado: boolean; archivos: Set<string>; nombres: number }
): Promise<boolean> {
  if (profundidad > MAX_PROFUNDIDAD) return true
  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return true
  }
  for (const d of dirents) {
    if (o.cancelado?.() === true) return false
    const hijoRel = rel === '' ? d.name : `${rel}/${d.name}`
    if (d.isDirectory()) {
      if (saltarCarpeta(d.name)) continue
      if (!(await barrerNombres(path.join(abs, d.name), hijoRel, profundidad + 1, o, estado))) {
        return false
      }
      continue
    }
    // Las CARPETAS no se emiten: lo que se busca es un archivo, y una carpeta no se
    // puede abrir en el editor ni enseñar en la vista previa. Para acotar por
    // carpeta está el selector de ámbito.
    if (!d.isFile()) continue
    if (!emitirNombre(hijoRel, d.name, o, estado)) return false
  }
  return true
}

/**
 * Recorre el árbol una vez, en dos pasadas lógicas: emite el texto según lo
 * encuentra y ANOTA los contenedores y las clases para después.
 */
async function barrerArbol(
  abs: string,
  rel: string,
  profundidad: number,
  o: OpcionesBarrido,
  estado: { total: number; truncado: boolean; archivos: Set<string>; nombres: number },
  aplazados: { ruta: string; abs: string; clase: boolean }[]
): Promise<boolean> {
  if (profundidad > MAX_PROFUNDIDAD) return true
  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    // Carpeta que desapareció o sin permisos: no es motivo para abortar el barrido.
    return true
  }

  for (const d of dirents) {
    if (o.cancelado?.() === true) return false
    const hijoAbs = path.join(abs, d.name)
    const hijoRel = rel === '' ? d.name : `${rel}/${d.name}`

    if (d.isDirectory()) {
      if (saltarCarpeta(d.name)) continue
      if (!(await barrerArbol(hijoAbs, hijoRel, profundidad + 1, o, estado, aplazados))) return false
      continue
    }
    // Los symlinks quedan fuera, igual que en el árbol del explorador
    // (`FileService.listDir`): un enlace a /  convertiría el barrido en infinito.
    if (!d.isFile()) continue

    if (esContenedor(d.name) || esClase(d.name)) {
      aplazados.push({ ruta: hijoRel, abs: hijoAbs, clase: esClase(d.name) })
      continue
    }

    // El filtro por NOMBRE va antes del `stat`, y el orden importa: `stat` es una
    // llamada al sistema por archivo, y en Windows con Defender delante eso se nota
    // (medido en este repo: 228 ms solo de stats sobre 2743 archivos). Preguntando
    // primero por la extensión, los binarios conocidos no llegan a costar ninguna.
    if (esBinarioPorExtension(d.name)) continue

    let tam: number
    try {
      tam = (await fs.stat(hijoAbs)).size
    } catch {
      continue
    }
    if (!barrerComoTexto(d.name, tam)) continue

    let bytes: Buffer
    try {
      bytes = await fs.readFile(hijoAbs)
    } catch {
      continue
    }
    const texto = comoTexto(bytes)
    if (texto === null) continue
    const antes = estado.total
    const sigue = buscarEnTexto(texto, { path: hijoRel, nombre: d.name }, o, estado)
    if (estado.total > antes) estado.archivos.add(hijoRel)
    if (!sigue) return false
  }
  return true
}

/**
 * Barre `raiz` buscando `query`. Emite por callback y devuelve el recuento.
 * NUNCA lanza por un archivo concreto: un proyecto real tiene archivos ilegibles,
 * jars corruptos y carpetas sin permisos, y ninguno de ellos puede tumbar la
 * búsqueda entera.
 */
export async function barrer(o: OpcionesBarrido): Promise<ResultadoBarrido> {
  const estado = { total: 0, truncado: false, archivos: new Set<string>(), nombres: 0 }
  if (o.query === '') return { total: 0, archivos: 0, truncado: false, cancelado: false }

  const aplazados: { ruta: string; abs: string; clase: boolean }[] = []
  // El recorrido ARRANCA en la subcarpeta pero SIGUE numerando las rutas desde la
  // raíz: `rel` empieza valiendo la subcarpeta, así que todo lo que salga de aquí
  // es relativo al proyecto y se puede abrir. Los contenedores se recogen durante
  // este mismo recorrido (`aplazados`), de modo que acotar la carpeta acota
  // también los .jar y las .class sin ninguna rama aparte.
  const sub = (o.subcarpeta ?? '').replace(/^\/+|\/+$/g, '')
  const arranque = sub === '' ? o.raiz : path.join(o.raiz, sub)

  // FASE 0: los NOMBRES de archivo. Primero porque es lo que se pidió ver primero,
  // y porque no lee ni un byte: las filas aparecen casi al instante.
  // Si la fase de nombres ya llenó el cupo (o la cancelaron), no se sigue: el
  // veredicto se compone abajo con las mismas reglas que el resto de fases.
  const nombresCompleto = await barrerNombres(arranque, sub, 0, o, estado)
  const completo = nombresCompleto && (await barrerArbol(arranque, sub, 0, o, estado, aplazados))

  if (completo) {
    for (const item of aplazados) {
      if (o.cancelado?.() === true) break
      const nombre = item.ruta.slice(item.ruta.lastIndexOf('/') + 1)
      const antes = estado.total
      if (item.clase) {
        try {
          const bytes = await fs.readFile(item.abs)
          if (!buscarEnClase(bytes, { path: item.ruta, nombre }, o, estado)) break
        } catch {
          continue
        }
      } else {
        let lector: LectorRango
        try {
          lector = await abrirLectorDeArchivo(item.abs)
        } catch {
          continue
        }
        try {
          if (!(await barrerContenedor(lector, item.ruta, 0, o, estado))) break
        } catch {
          // Contenedor ilegible (no es un zip, truncado, ZIP64 raro): se salta.
        } finally {
          await lector.cerrar()
        }
      }
      if (estado.total > antes && item.clase) estado.archivos.add(item.ruta)
    }
  }

  return {
    total: estado.total,
    archivos: estado.archivos.size,
    truncado: estado.truncado || estado.total >= MAX_COINCIDENCIAS,
    cancelado: o.cancelado?.() === true
  }
}
