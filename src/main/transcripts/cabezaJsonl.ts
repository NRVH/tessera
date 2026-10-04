// =============================================================================
// Lectura por líneas de la cabeza de un transcript JSONL sin exigir que cada línea quepa en el
// presupuesto: una línea gigante (una imagen pegada, en base64) se compacta quitándole las
// tiradas largas de base64 y, si aun así no cabe, se salta hasta su salto de línea. Lo que se
// lee de más por esas líneas también tiene tope. Con líneas normales lee y devuelve lo mismo
// que un corte fijo de `presupuesto` bytes.
// Lo usan `ConversationsReader`, `TurnWatcher` y `ContextReader`. Decisiones: docs/decisiones/agentes/conversaciones-cabeza-por-lineas.md
// =============================================================================

import { open } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import type { LineaJsonl } from '../util/jsonlCola.ts'

/** Topes de la lectura de cabeza. */
export interface OpcionesCabeza {
  /** Bytes de contenido GUARDADO a partir de los cuales se deja de leer (la última línea, a medias, se tira). */
  presupuesto: number
  /** Bytes LEÍDOS del fichero, como mucho, aunque lo guardado no llegue al presupuesto. */
  lecturaMax: number
  /** Tamaño de cada lectura. */
  trozo?: number
}

/** Una línea más larga que esto (o que un cuarto del presupuesto) se compacta: por debajo, ninguna se toca. */
const UMBRAL_COMPACTAR = 64 * 1024
/**
 * Un escape JSON entero, que se deja tal cual, o una tirada de alfabeto base64, que se quita. Al
 * consumir cada escape como una unidad, una tirada nunca empieza en la letra de un `\n` ni en los
 * dígitos de un `é`: quitarlos dejaría una barra suelta y la línea ya no sería JSON.
 */
const ESCAPE_O_TIRADA = /\\(?:u[0-9a-fA-F]{4}|[^])|[A-Za-z0-9+/=]{256,}/g
/**
 * Tope de lo leído de más: con estas líneas compactadas o saltadas ya y este múltiplo del
 * presupuesto quitado, la siguiente línea gigante corta la lectura (se tira, como en un corte
 * fijo). Las primeras líneas gigantes se leen enteras: ahí va el título con su imagen.
 */
const LINEAS_QUITADAS_TOPE = 3
const FACTOR_QUITADO_TOPE = 4

/**
 * Quita las tiradas largas de base64 de un texto que no empieza a mitad de un escape. Dentro de un
 * JSON solo pueden estar en una cadena (no llevan comillas), y los escapes se respetan.
 */
export function compactarBase64(texto: string): string {
  return texto.replace(ESCAPE_O_TIRADA, (m) => (m.startsWith('\\') ? m : ''))
}

/** Estado de la línea que se está montando. */
interface LineaEnCurso {
  /** Lo guardado de la línea; ya compactado si `compactando`. */
  texto: string
  /** Al compactar, el final aún sin compactar: un escape JSON partido entre dos trozos. */
  cola: string
  compactando: boolean
  descartando: boolean
  /** Bytes de esta línea que no se guardan (base64 quitado, o la línea entera si se salta). */
  quitado: number
}

/** Cuentas de la lectura entera, para acotar lo que se lee de más. */
interface Recuento {
  presupuesto: number
  quitados: number
  lineasQuitadas: number
}

const lineaVacia = (): LineaEnCurso => ({ texto: '', cola: '', compactando: false, descartando: false, quitado: 0 })

/**
 * Las líneas de la cabeza de `file`, en crudo y sin las vacías, en el orden del fichero. Se
 * deja de leer al llegar a `presupuesto` bytes guardados (la línea a medias se tira, como en
 * un corte fijo), a `lecturaMax` leídos o al tope de lo leído de más.
 */
export async function leerCabezaJsonl(file: string, opts: OpcionesCabeza): Promise<string[]> {
  const trozo = opts.trozo ?? 64 * 1024
  const handle = await open(file, 'r')
  const decoder = new StringDecoder('utf8')
  const lineas: string[] = []
  const linea = lineaVacia()
  const cuenta: Recuento = { presupuesto: opts.presupuesto, quitados: 0, lineasQuitadas: 0 }
  let leidos = 0
  try {
    const buf = Buffer.alloc(trozo)
    while (leidos < opts.lecturaMax) {
      const { bytesRead } = await handle.read(buf, 0, Math.min(trozo, opts.lecturaMax - leidos), leidos)
      if (bytesRead === 0) {
        cerrarLinea(linea, lineas, cuenta) // fin del fichero: la última línea, sin salto, está entera
        break
      }
      leidos += bytesRead
      if (!trocear(decoder.write(buf.subarray(0, bytesRead)), linea, lineas, cuenta)) break
      if (leidos - cuenta.quitados >= opts.presupuesto) break
    }
  } finally {
    await handle.close()
  }
  return lineas
}

/**
 * Como `leerCabezaJsonl`, pero con las líneas ya parseadas (las que no son JSON se saltan). Es lo
 * que quieren los lectores que solo sacan la meta (`cwd`, subagente) de la cabecera.
 */
export async function leerCabezaParseada(file: string, opts: OpcionesCabeza): Promise<LineaJsonl[]> {
  const out: LineaJsonl[] = []
  for (const cruda of await leerCabezaJsonl(file, opts)) {
    try {
      out.push(JSON.parse(cruda.trim()))
    } catch {
      // línea corrupta o a medio escribir: se ignora, el resto del hilo sigue válido
    }
  }
  return out
}

/** Reparte un trozo ya decodificado entre líneas. Devuelve `false` si hay que dejar de leer. */
function trocear(texto: string, linea: LineaEnCurso, lineas: string[], cuenta: Recuento): boolean {
  const partes = texto.split('\n')
  for (let i = 0; i < partes.length; i++) {
    if (!anadir(linea, partes[i], cuenta)) return false
    // La última parte no lleva salto detrás: la línea sigue en el próximo trozo.
    if (i < partes.length - 1) cerrarLinea(linea, lineas, cuenta)
  }
  return true
}

/** Cierra la línea en curso: la guarda si sirve y deja `linea` lista para la siguiente. */
function cerrarLinea(linea: LineaEnCurso, lineas: string[], cuenta: Recuento): void {
  const texto = linea.texto + linea.cola
  if (linea.compactando && !linea.descartando && !esJson(texto)) {
    // Red de seguridad: si compactada ya no es JSON, se salta entera y no gasta presupuesto. La
    // original no se puede conservar: se ha ido compactando por trozos al leerla.
    quitar(linea, cuenta, Buffer.byteLength(texto))
  } else if (!linea.descartando && texto.trim()) {
    lineas.push(texto)
  }
  if (linea.quitado > 0) cuenta.lineasQuitadas++
  Object.assign(linea, lineaVacia())
}

/** Añade `parte` a la línea en curso. Devuelve `false` si la lectura debe parar antes de ella. */
function anadir(linea: LineaEnCurso, parte: string, cuenta: Recuento): boolean {
  if (linea.descartando) {
    quitar(linea, cuenta, Buffer.byteLength(parte))
    return true
  }
  // Con un presupuesto pequeño el umbral baja con él: si no, el primer tramo de una línea
  // gigante (aún sin compactar) agotaría el presupuesto y se cortaría la lectura en ella.
  const umbral = Math.min(UMBRAL_COMPACTAR, Math.floor(cuenta.presupuesto / 4))
  let pendiente = parte
  if (!linea.compactando) {
    if (linea.texto.length + parte.length <= umbral) {
      linea.texto += parte
      return true
    }
    if (topeDeQuitadoAlcanzado(cuenta)) return false
    // Empieza a compactarse desde el principio de la línea, que nunca está a mitad de un escape.
    pendiente = linea.texto + parte
    Object.assign(linea, { texto: '', compactando: true })
  }
  compactarEnCurso(linea, pendiente, cuenta)
  if (linea.texto.length + linea.cola.length >= cuenta.presupuesto) {
    // Ni compactada cabe: no es una imagen sino texto enorme. Se salta entera.
    quitar(linea, cuenta, Buffer.byteLength(linea.texto + linea.cola))
    Object.assign(linea, { texto: '', cola: '', descartando: true })
  }
  return true
}

/** Compacta `parte` a continuación de lo ya compactado, sin partir un escape entre dos trozos. */
function compactarEnCurso(linea: LineaEnCurso, parte: string, cuenta: Recuento): void {
  const pendiente = linea.cola + parte
  const corte = corteSinEscapeAMedias(pendiente)
  const compacta = compactarBase64(pendiente.slice(0, corte))
  // Lo quitado es base64, ASCII: un carácter es un byte.
  quitar(linea, cuenta, corte - compacta.length)
  linea.texto += compacta
  linea.cola = pendiente.slice(corte)
}

/**
 * Dónde cortar `texto` para compactar lo de delante sin partir un escape: antes de la barra de un
 * `\` o un `\u` + menos de 4 dígitos con que termine. Con barras pares, la última es la letra de
 * un `\\` y nada queda a medias.
 */
function corteSinEscapeAMedias(texto: string): number {
  let fin = texto.length
  let digitos = 0
  while (digitos < 3 && fin > 0 && /[0-9a-fA-F]/.test(texto[fin - 1])) {
    fin--
    digitos++
  }
  fin = fin > 0 && texto[fin - 1] === 'u' ? fin - 1 : texto.length
  let barras = 0
  while (fin - barras > 0 && texto[fin - barras - 1] === '\\') barras++
  return barras % 2 === 1 ? fin - 1 : texto.length
}

/** ¿Hay que dejar de leer antes de la siguiente línea gigante? Ver `LINEAS_QUITADAS_TOPE`. */
function topeDeQuitadoAlcanzado(cuenta: Recuento): boolean {
  return cuenta.lineasQuitadas >= LINEAS_QUITADAS_TOPE && cuenta.quitados >= FACTOR_QUITADO_TOPE * cuenta.presupuesto
}

function quitar(linea: LineaEnCurso, cuenta: Recuento, bytes: number): void {
  linea.quitado += bytes
  cuenta.quitados += bytes
}

function esJson(texto: string): boolean {
  try {
    JSON.parse(texto)
    return true
  } catch {
    return false
  }
}
