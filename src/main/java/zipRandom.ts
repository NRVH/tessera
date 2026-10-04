// =============================================================================
// Lee un ZIP (.jar/.war/.ear/.aar) POR RANGOS, sin cargarlo entero: la cola para el EOCD, el
// directorio central y la entrada que se abre. Infla con `zlib.inflateRaw` asíncrono y
// `maxOutputLength` (la defensa anti zip-bomb) en el pool de libuv. Cubre ZIP64, nombres en
// latin1 o UTF-8 (bit 11), las longitudes del cabecero local y un prefijo antes del archivo. Lo
// usan `JarService`, `ComprimidosService` y la búsqueda; `test-zip-random.mts` fabrica los casos.
// Decisiones: docs/decisiones/comprimidos/contenedores-como-carpetas.md
// =============================================================================

import { promises as fs } from 'node:fs'
import zlib from 'node:zlib'

/** Firmas de las estructuras del formato. */
const SIG_EOCD = 0x06054b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_EOCD64 = 0x06064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

/** Tamaños fijos de cabecero, antes de los campos de longitud variable. */
const LEN_EOCD = 22
const LEN_CENTRAL = 46
const LEN_LOCAL = 30

/**
 * Cuánta cola se lee para encontrar el EOCD: 64 KiB (el máximo que puede ocupar su
 * comentario) más el propio registro. Es una sola lectura y cubre el 100 % de los
 * casos legales.
 */
const COLA_EOCD = 0xffff + LEN_EOCD

/** Métodos de compresión que se saben leer. */
const METODO_STORED = 0
const METODO_DEFLATE = 8

/** Tope de entradas del directorio central. Lo que cuesta es el NÚMERO de entradas,
 *  no los bytes del archivo: un jar con más que esto se lista truncado y se avisa. */
export const MAX_ENTRADAS_INDICE = 200_000

/** Tope de bytes descomprimidos de UNA entrada. Se pasa a `inflateRaw`. */
export const MAX_ENTRADA_BYTES = 64 * 1024 * 1024

/** Lectura de un rango arbitrario de bytes. Abstrae "un fichero en disco" y "un
 *  buffer en memoria" (que es lo que es un jar anidado dentro de otro). */
export interface LectorRango {
  /** Tamaño total en bytes. */
  readonly tamano: number
  /** Devuelve exactamente `longitud` bytes desde `desde`. Lanza si no los hay. */
  leer(desde: number, longitud: number): Promise<Buffer>
  /** Libera el recurso. Idempotente. */
  cerrar(): Promise<void>
}

/** Una entrada del directorio central, ya parseada. Serializable tal cual por IPC. */
export interface EntradaZip {
  /** Ruta interna POSIX, tal como la guardó el zip. */
  nombre: string
  /** Tamaño descomprimido. */
  tamano: number
  /** Tamaño comprimido. */
  tamanoComprimido: number
  /** Método de compresión (0 stored, 8 deflate, otro = no se sabe leer). */
  metodo: number
  crc32: number
  /** Offset del cabecero LOCAL dentro del archivo. */
  offsetLocal: number
  /** Fecha de modificación en epoch ms (de la fecha MS-DOS del zip). */
  modificado: number
  /** true si el nombre termina en '/' (registro de directorio explícito). */
  esDir: boolean
  /** true si el nombre venía marcado como UTF-8 (bit 11 del general purpose flag). */
  utf8: boolean
}

/** El índice completo de un contenedor. */
export interface IndiceZip {
  entradas: EntradaZip[]
  /** Entradas que declara el EOCD; puede ser mayor que `entradas.length` si se truncó. */
  totalDeclarado: number
  truncado: boolean
  /** Avisos en español para la ficha: entradas descartadas, duplicados, etc. */
  avisos: string[]
}

/** Error con mensaje pensado para enseñárselo al usuario, no un err(14) en inglés. */
export class ErrorZip extends Error {
  constructor(mensaje: string, options?: { cause?: unknown }) {
    super(mensaje, options)
    this.name = 'ErrorZip'
  }
}

// ---------------------------------------------------------------------------
// Lectores
// ---------------------------------------------------------------------------

/**
 * Lector sobre un fichero del disco. Se abre, se usa y se CIERRA por operación: no
 * se cachean descriptores. Un `fs.open` cuesta ~0,1 ms, y mantener handles vivos
 * sobre los jars del proyecto justo mientras corre un `mvn package` es pedir
 * problemas que no compensan ese ahorro.
 */
export async function abrirLectorDeArchivo(abs: string): Promise<LectorRango> {
  const handle = await fs.open(abs, 'r')
  let cerrado = false
  try {
    const stat = await handle.stat()
    return {
      tamano: stat.size,
      async leer(desde: number, longitud: number): Promise<Buffer> {
        if (longitud <= 0) return Buffer.alloc(0)
        if (desde < 0 || desde + longitud > stat.size) {
          throw new ErrorZip('El archivo está incompleto o dañado (se pidió leer más allá de su final).')
        }
        const buf = Buffer.alloc(longitud)
        let leidos = 0
        while (leidos < longitud) {
          const { bytesRead } = await handle.read(buf, leidos, longitud - leidos, desde + leidos)
          if (bytesRead === 0) break
          leidos += bytesRead
        }
        if (leidos !== longitud) {
          throw new ErrorZip('El archivo está incompleto o dañado (lectura corta).')
        }
        return buf
      },
      async cerrar(): Promise<void> {
        if (cerrado) return
        cerrado = true
        await handle.close()
      }
    }
  } catch (err) {
    await handle.close().catch(() => undefined)
    throw err
  }
}

/**
 * Lector sobre un buffer ya en memoria: es lo que se usa para un jar ANIDADO, que
 * se infla una vez y se navega sin escribirlo a disco.
 */
export function lectorDeBuffer(bytes: Buffer): LectorRango {
  return {
    tamano: bytes.length,
    async leer(desde: number, longitud: number): Promise<Buffer> {
      if (longitud <= 0) return Buffer.alloc(0)
      if (desde < 0 || desde + longitud > bytes.length) {
        throw new ErrorZip('El archivo comprimido está incompleto o dañado.')
      }
      return bytes.subarray(desde, desde + longitud)
    },
    async cerrar(): Promise<void> {
      // Nada que liberar: el buffer lo posee quien lo creó.
    }
  }
}

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

/** Convierte la fecha/hora MS-DOS de un zip a epoch ms (hora local, como el formato). */
function fechaDos(hora: number, fecha: number): number {
  const anio = ((fecha >> 9) & 0x7f) + 1980
  const mes = ((fecha >> 5) & 0x0f) - 1
  const dia = fecha & 0x1f
  const h = (hora >> 11) & 0x1f
  const m = (hora >> 5) & 0x3f
  const s = (hora & 0x1f) * 2
  // Un zip puede traer una fecha imposible (mes 0, día 0). Date la normaliza en vez
  // de fallar, y una fecha rara es preferible a que no se pueda listar el jar.
  return new Date(anio, mes, dia < 1 ? 1 : dia, h, m, s).getTime()
}

/** Lee un uint64 poco-endian como number. Lanza si no cabe en un entero seguro. */
function leerU64(buf: Buffer, offset: number): number {
  const valor = buf.readBigUInt64LE(offset)
  if (valor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ErrorZip('El archivo declara tamaños que Tessera no puede manejar.')
  }
  return Number(valor)
}

/**
 * Busca el EOCD en la cola del archivo. Devuelve el buffer de la cola y la posición
 * del EOCD DENTRO de ese buffer.
 */
async function localizarEocd(lector: LectorRango): Promise<{ cola: Buffer; pos: number; base: number }> {
  if (lector.tamano < LEN_EOCD) {
    throw new ErrorZip('El archivo es demasiado pequeño para ser un .jar o .zip válido.')
  }
  const longitud = Math.min(COLA_EOCD, lector.tamano)
  const base = lector.tamano - longitud
  const cola = await lector.leer(base, longitud)
  // Hacia atrás: si el comentario contuviera por casualidad la firma, gana el EOCD
  // real, que está más cerca del final.
  for (let i = cola.length - LEN_EOCD; i >= 0; i--) {
    if (cola.readUInt32LE(i) === SIG_EOCD) {
      const lenComentario = cola.readUInt16LE(i + 20)
      // Comprobación de coherencia: el comentario debe llegar justo al final.
      if (i + LEN_EOCD + lenComentario === cola.length) return { cola, pos: i, base }
    }
  }
  throw new ErrorZip('No parece un archivo comprimido válido (no se encontró su índice).')
}

/** Localización del directorio central, resolviendo ZIP64 si hace falta. */
async function localizarDirectorioCentral(
  lector: LectorRango
): Promise<{ offset: number; tamano: number; total: number }> {
  const { cola, pos, base } = await localizarEocd(lector)
  let total = cola.readUInt16LE(pos + 10)
  let tamano = cola.readUInt32LE(pos + 12)
  let offset = cola.readUInt32LE(pos + 16)

  const necesitaZip64 = total === 0xffff || tamano === 0xffffffff || offset === 0xffffffff
  // Dónde acaba REALMENTE el directorio central. Sin ZIP64 es el propio EOCD; con
  // ZIP64 es el registro EOCD64, que se interpone entre ambos (ver abajo).
  let finRealDelCentral = base + pos
  if (necesitaZip64) {
    // El localizador ZIP64 va inmediatamente ANTES del EOCD.
    const posLocalizador = pos - 20
    if (posLocalizador < 0 || cola.readUInt32LE(posLocalizador) !== SIG_EOCD64_LOCATOR) {
      throw new ErrorZip('El archivo dice ser ZIP64 pero le falta su índice extendido.')
    }
    const offsetEocd64 = leerU64(cola, posLocalizador + 8)
    const eocd64 = await lector.leer(offsetEocd64, 56)
    if (eocd64.readUInt32LE(0) !== SIG_EOCD64) {
      throw new ErrorZip('El índice extendido (ZIP64) del archivo está dañado.')
    }
    total = leerU64(eocd64, 32)
    tamano = leerU64(eocd64, 40)
    offset = leerU64(eocd64, 48)
    finRealDelCentral = offsetEocd64
  }

  // Un jar con bytes antepuestos (un .exe autoejecutable) desplaza todos los offsets; se
  // corrige con la diferencia entre dónde dice el índice que acaba el directorio central y
  // dónde acaba de verdad. OJO CON ZIP64: el final real NO es el EOCD clásico; el orden
  // físico es [central][EOCD64][localizador][EOCD], y comparar contra el EOCD clásico daba
  // una diferencia fantasma de 76 bytes o más (el EOCD64 admite un sector extensible) que
  // listaba VACÍO y sin error todo ZIP64 legítimo. Por eso la referencia es
  // `finRealDelCentral`, que en ZIP64 es el propio EOCD64. Un ZIP64 CON prefijo no se
  // soporta: el offset del localizador vendría desplazado, su firma no casaría y se lanza
  // un ErrorZip, preferible a un listado vacío que parece un jar sin contenido.
  if (offset + tamano !== finRealDelCentral && finRealDelCentral - tamano >= 0) {
    offset = finRealDelCentral - tamano
  }
  return { offset, tamano, total }
}

/** Aplica los valores ZIP64 del campo extra 0x0001 a una entrada, si están. */
function aplicarZip64(
  extra: Buffer,
  campos: { tamano: number; tamanoComprimido: number; offsetLocal: number }
): void {
  let i = 0
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i)
    const len = extra.readUInt16LE(i + 2)
    if (id === 0x0001) {
      const bloque = extra.subarray(i + 4, i + 4 + len)
      let j = 0
      // El orden es fijo, y SOLO aparecen los campos que estaban saturados.
      if (campos.tamano === 0xffffffff && j + 8 <= bloque.length) {
        campos.tamano = leerU64(bloque, j)
        j += 8
      }
      if (campos.tamanoComprimido === 0xffffffff && j + 8 <= bloque.length) {
        campos.tamanoComprimido = leerU64(bloque, j)
        j += 8
      }
      if (campos.offsetLocal === 0xffffffff && j + 8 <= bloque.length) {
        campos.offsetLocal = leerU64(bloque, j)
        j += 8
      }
      return
    }
    i += 4 + len
  }
}

/**
 * Lee el directorio central completo y devuelve el índice. Es la única operación
 * cuyo coste crece con el archivo, y crece con su NÚMERO DE ENTRADAS, no con su
 * tamaño: por eso el tope es MAX_ENTRADAS_INDICE y no un número de bytes.
 */
export async function leerIndice(lector: LectorRango): Promise<IndiceZip> {
  const { offset, tamano, total } = await localizarDirectorioCentral(lector)
  if (offset + tamano > lector.tamano) {
    throw new ErrorZip('El índice del archivo apunta fuera de él (está dañado o incompleto).')
  }
  const central = await lector.leer(offset, tamano)

  const entradas: EntradaZip[] = []
  const avisos: string[] = []
  const vistos = new Set<string>()
  let duplicados = 0
  let i = 0
  let truncado = false

  while (i + LEN_CENTRAL <= central.length) {
    if (central.readUInt32LE(i) !== SIG_CENTRAL) break
    const flags = central.readUInt16LE(i + 8)
    const metodo = central.readUInt16LE(i + 10)
    const hora = central.readUInt16LE(i + 12)
    const fecha = central.readUInt16LE(i + 14)
    const crc32 = central.readUInt32LE(i + 16)
    const lenNombre = central.readUInt16LE(i + 28)
    const lenExtra = central.readUInt16LE(i + 30)
    const lenComentario = central.readUInt16LE(i + 32)
    const campos = {
      tamano: central.readUInt32LE(i + 24),
      tamanoComprimido: central.readUInt32LE(i + 20),
      offsetLocal: central.readUInt32LE(i + 42)
    }
    const inicioNombre = i + LEN_CENTRAL
    const inicioExtra = inicioNombre + lenNombre
    const finRegistro = inicioExtra + lenExtra + lenComentario
    if (finRegistro > central.length) {
      avisos.push('El índice del archivo se corta a mitad de una entrada; se listó lo que se pudo leer.')
      truncado = true
      break
    }

    if (lenExtra > 0) aplicarZip64(central.subarray(inicioExtra, inicioExtra + lenExtra), campos)

    // GOTCHA 2: el bit 11 decide la codificación del nombre. Sin él es CP437/latin1, y
    // leerlo como UTF-8 destroza los acentos de los recursos de un jar antiguo.
    const utf8 = (flags & 0x800) !== 0
    const crudo = central.subarray(inicioNombre, inicioExtra)
    const nombre = (utf8 ? crudo.toString('utf8') : crudo.toString('latin1')).replace(/\\/g, '/')

    i = finRegistro

    // Nombres tóxicos: un NUL rompería las claves compuestas del renderer, y un
    // nombre absoluto o con '..' es zip-slip. No se abren y se cuentan.
    if (nombre.includes('\u0000') || nombre.startsWith('/') || nombre.split('/').includes('..')) {
      avisos.push(`Se ignoró una entrada con un nombre no admitido: ${JSON.stringify(nombre.slice(0, 80))}`)
      continue
    }
    if (nombre === '') continue

    if (vistos.has(nombre)) {
      duplicados++
      continue
    }
    vistos.add(nombre)

    entradas.push({
      nombre,
      tamano: campos.tamano,
      tamanoComprimido: campos.tamanoComprimido,
      metodo,
      crc32,
      offsetLocal: campos.offsetLocal,
      modificado: fechaDos(hora, fecha),
      esDir: nombre.endsWith('/'),
      utf8
    })

    if (entradas.length >= MAX_ENTRADAS_INDICE) {
      truncado = true
      avisos.push(
        `El archivo tiene más de ${MAX_ENTRADAS_INDICE.toLocaleString('es')} entradas; se listaron las primeras.`
      )
      break
    }
  }

  if (duplicados > 0) {
    avisos.push(`Se ignoraron ${duplicados} entrada(s) repetida(s); se conservó la primera de cada nombre.`)
  }

  return { entradas, totalDeclarado: total, truncado, avisos }
}

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

/**
 * Inflate DEFLATE crudo en el pool de libuv (ver cabecera: por qué no el `Sync`).
 *
 * Envuelto a mano y no con `promisify` porque así el tope viaja en las opciones sin
 * una firma intermedia, y porque el error que sale de `maxOutputLength` tiene que
 * llegar tal cual al `catch` del llamador, que es quien sabe qué entrada era.
 */
function inflarRaw(datos: Buffer, maxBytes: number): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    zlib.inflateRaw(datos, { maxOutputLength: maxBytes }, (err, salida) => {
      if (err) rechazar(err)
      else resolver(salida)
    })
  })
}

/**
 * Devuelve los bytes DESCOMPRIMIDOS de una entrada.
 *
 * GOTCHA 1: las longitudes de nombre/extra se leen del cabecero LOCAL, nunca del
 * central. En un jar firmado no coinciden, y usar las del central desplaza el
 * inicio de los datos.
 */
export async function leerEntrada(
  lector: LectorRango,
  entrada: EntradaZip,
  opciones: { maxBytes?: number } = {}
): Promise<Buffer> {
  const maxBytes = opciones.maxBytes ?? MAX_ENTRADA_BYTES
  if (entrada.esDir) return Buffer.alloc(0)
  if (entrada.tamano > maxBytes) {
    throw new ErrorZip(
      `«${entrada.nombre}» ocupa ${Math.round(entrada.tamano / 1024 / 1024)} MB descomprimido y supera el máximo que Tessera abre.`
    )
  }
  if (entrada.metodo !== METODO_STORED && entrada.metodo !== METODO_DEFLATE) {
    throw new ErrorZip(
      `«${entrada.nombre}» usa una compresión que Tessera no sabe leer (método ${entrada.metodo}). ` +
        'Ábrelo con una herramienta externa.'
    )
  }

  const local = await lector.leer(entrada.offsetLocal, LEN_LOCAL)
  if (local.readUInt32LE(0) !== SIG_LOCAL) {
    throw new ErrorZip(`El archivo está dañado: la entrada «${entrada.nombre}» no está donde dice su índice.`)
  }
  const lenNombre = local.readUInt16LE(26)
  const lenExtra = local.readUInt16LE(28)
  const inicioDatos = entrada.offsetLocal + LEN_LOCAL + lenNombre + lenExtra

  const comprimidos = await lector.leer(inicioDatos, entrada.tamanoComprimido)
  if (entrada.metodo === METODO_STORED) {
    if (comprimidos.length > maxBytes) {
      throw new ErrorZip(`«${entrada.nombre}» supera el máximo que Tessera abre.`)
    }
    return comprimidos
  }

  try {
    // maxOutputLength LANZA en vez de reservar: es la defensa anti zip-bomb, y la
    // forma asíncrona la conserva igual y trabaja en el pool de libuv (ver el ADR).
    return await inflarRaw(comprimidos, maxBytes)
  } catch (err) {
    throw new ErrorZip(
      `No se pudo descomprimir «${entrada.nombre}» (puede estar dañada o cifrada).`,
      { cause: err }
    )
  }
}
