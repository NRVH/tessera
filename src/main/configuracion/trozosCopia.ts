// =============================================================================
// El historial de la copia (versión 2) en trozos, escrito y leído en streaming: la primera línea es la
// cabecera con el contenido (`cifradoFrase.ts`), luego un trozo por línea y uno de cierre. Cada línea lleva en
// claro la fuente (cuenta) de su trozo, para saltar sin abrirlos los de las no elegidas; el trozo, ≤ 4 MiB de un
// archivo, va en zstd y, con frase, en AES-256-GCM con la fuente, el índice y el hash de la cabecera como datos
// autenticados. El de cierre fija el total y un hash encadenado de todas las líneas: quitar, mover, duplicar,
// cortar o tocar un trozo se nota también si se saltó. Decisiones: docs/decisiones/configuracion/historial-en-la-copia.md
// =============================================================================

import { createCipheriv, createDecipheriv, createHash, hkdfSync } from 'node:crypto'
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { open, readFile, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { zstdCompress, zstdDecompress } from 'node:zlib'
import { TROZO_MAXIMO, VERSION_SIN_HISTORIAL, leerArchivoCopia, validarArchivoCopia, type ArchivoCopia, type LecturaCabecera } from './cifradoFrase.ts'
import { txConfiguracion } from './textos.ts'

const comprimir = promisify(zstdCompress)
const descomprimir = promisify(zstdDecompress)

/** Lo que cierra la primera línea: el archivo entero sigue siendo JSON válido (una Tessera anterior lee su versión). */
export const SUFIJO_CABECERA = ',"trozos":['
const CIERRE = ']}'
/** Lo que ocupa como mucho la descripción de un trozo (ruta incluida). */
const META_MAXIMA = 64 * 1024
/** Lo que puede pesar una línea de trozo: el trozo comprimido (o no), sellado y en base64, con holgura. */
const LINEA_TROZO_MAXIMA = 8 * 1024 * 1024
/** El contenido de siempre (perfiles, conexiones…): el tope de una copia sin historial y de la primera línea de una con él. */
export const TOPE_CABECERA = 64 * 1024 * 1024
/** `"<fuente>:<trozo en base64>",` o, la de cierre, `"fin:<trozo>"` sin coma. */
const LINEA_TROZO = /^"(\d{1,9}|fin):([A-Za-z0-9+/]*={0,2})"(,?)$/
/** La fuente que autentica el trozo de cierre: ninguna de verdad llega a ella. */
const FUENTE_CIERRE = 0xffffffff
/** Cómo empieza una copia de cualquier versión, y la primera línea de la versión 2 (sin sangrar). */
const INICIO_COPIA = /^\s*\{\s*"tessera"\s*:\s*"configuracion"\s*[,}]/
const INICIO_CON_HISTORIAL = '{"tessera":"configuracion",'

/** Un trozo con datos: la parte `parte` de un archivo de una fuente (cuenta) del historial. */
export interface MetaArchivo {
  t: 'archivo'
  i: number
  fuente: number
  /** Relativa a la carpeta de la cuenta, con `/`. */
  ruta: string
  parte: number
  ultima: boolean
}

interface MetaFin {
  t: 'fin'
  i: number
  /** Cuántos trozos tiene el historial, el de cierre incluido. */
  trozos: number
  archivos: number
  /** El hash encadenado de la cabecera y de cada línea de trozo anterior, en base64. */
  cadena: string
}

/** Cómo se sellan los trozos de UN archivo: su subclave (null sin frase) y el hash de su primera línea. */
export interface SelloTrozos {
  clave: Buffer | null
  cabecera: Buffer
}

/** Una línea más pasó por el hash encadenado. */
const encadenar = (cadena: Buffer, linea: string): Buffer => createHash('sha256').update(cadena).update(linea, 'utf8').digest()

export const hashLinea = (linea: string): Buffer => createHash('sha256').update(linea, 'utf8').digest()

export function lineaCabecera(archivo: ArchivoCopia): string {
  return JSON.stringify(archivo).slice(0, -1) + SUFIJO_CABECERA
}

/** La cabecera de la primera línea de un archivo de la versión 2, comprobada como la de la versión 1. */
export function archivoDeLinea(linea: string, versionMaxima?: number): LecturaCabecera {
  const noEs: LecturaCabecera = { ok: false, error: txConfiguracion().archivo.noEsCopia }
  if (!linea.endsWith(SUFIJO_CABECERA)) return noEs
  let raw: unknown
  try {
    raw = JSON.parse(linea.slice(0, -SUFIJO_CABECERA.length) + '}')
  } catch {
    return noEs
  }
  const leido = validarArchivoCopia(raw, versionMaxima)
  if (leido.ok && leido.archivo.version === VERSION_SIN_HISTORIAL) return { ok: false, error: txConfiguracion().archivo.faltaContenido }
  return leido
}

/**
 * El sello de los trozos de un archivo, por el hash de su primera línea. La subclave sale de la clave de la
 * frase con HKDF (sal del archivo): los nonces de contador nunca coinciden con el aleatorio del contenido.
 */
export function selloDe(cabecera: Buffer, claveFrase: Buffer | null, sal: string | null): SelloTrozos {
  if (claveFrase === null || sal === null) return { clave: null, cabecera }
  return { clave: Buffer.from(hkdfSync('sha256', claveFrase, Buffer.from(sal, 'base64'), 'tessera-historial-v2', 32)), cabecera }
}

function u64(n: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(n))
  return b
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

const nonce = (i: number): Buffer => Buffer.concat([Buffer.alloc(4), u64(i)])
const aadTrozo = (s: SelloTrozos, i: number, final: boolean, fuente: number): Buffer =>
  Buffer.concat([s.cabecera, u64(i), Buffer.from([final ? 1 : 0]), u32(fuente)])

function codificar(meta: MetaArchivo | MetaFin, datos: Buffer): Buffer {
  const m = Buffer.from(JSON.stringify(meta), 'utf8')
  return Buffer.concat([u32(m.length), m, datos])
}

/** Comprime y, con clave, cifra un trozo de la fuente `fuente` (`FUENTE_CIERRE` el de cierre). */
export async function sellarTrozo(s: SelloTrozos, i: number, final: boolean, fuente: number, plano: Buffer): Promise<Buffer> {
  const comprimido = await comprimir(plano)
  if (s.clave === null) return comprimido
  const c = createCipheriv('aes-256-gcm', s.clave, nonce(i))
  c.setAAD(aadTrozo(s, i, final, fuente))
  return Buffer.concat([c.update(comprimido), c.final(), c.getAuthTag()])
}

/** Lo contrario de `sellarTrozo`; lanza si el trozo no es el `i` de esa fuente en este archivo o está tocado. */
export async function abrirTrozo(s: SelloTrozos, i: number, final: boolean, fuente: number, sellado: Buffer): Promise<Buffer> {
  const danado = (): Error => new Error(txConfiguracion().archivo.historialDanado)
  let comprimido = sellado
  if (s.clave !== null) {
    if (sellado.length < 16) throw danado()
    try {
      const d = createDecipheriv('aes-256-gcm', s.clave, nonce(i))
      d.setAAD(aadTrozo(s, i, final, fuente))
      d.setAuthTag(sellado.subarray(sellado.length - 16))
      comprimido = Buffer.concat([d.update(sellado.subarray(0, sellado.length - 16)), d.final()])
    } catch {
      throw danado()
    }
  }
  try {
    // El tope corta una bomba de descompresión: un trozo nunca pasa de su contenido y su descripción.
    return await descomprimir(comprimido, { maxOutputLength: TROZO_MAXIMO + META_MAXIMA + 4 })
  } catch {
    throw danado()
  }
}

function decodificar(plano: Buffer): { meta: Record<string, unknown>; datos: Buffer } {
  const danado = new Error(txConfiguracion().archivo.historialDanado)
  if (plano.length < 4) throw danado
  const largo = plano.readUInt32BE(0)
  if (largo > META_MAXIMA || 4 + largo > plano.length) throw danado
  let meta: unknown
  try {
    meta = JSON.parse(plano.subarray(4, 4 + largo).toString('utf8'))
  } catch {
    throw danado
  }
  if (typeof meta !== 'object' || meta === null) throw danado
  return { meta: meta as Record<string, unknown>, datos: plano.subarray(4 + largo) }
}

/** Un archivo que desapareció o está bloqueado al ir a abrirlo (un CLI lo comprimió o lo borró): se salta. */
export function archivoQueSeFue(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EBUSY'
}

/** Escribe un archivo de la versión 2 en un temporal al lado y lo pone en su sitio al cerrar. */
export class EscritorCopia {
  private i = 0
  private archivos = 0
  private error: Error | null = null
  private cadena: Buffer
  private readonly flujo: WriteStream
  private readonly tmp: string
  private readonly destino: string
  private readonly sello: SelloTrozos

  private constructor(flujo: WriteStream, tmp: string, destino: string, sello: SelloTrozos) {
    this.flujo = flujo
    this.tmp = tmp
    this.destino = destino
    this.sello = sello
    this.cadena = sello.cabecera
  }

  static async abrir(destino: string, archivo: ArchivoCopia, claveFrase: Buffer | null): Promise<EscritorCopia> {
    const tmp = `${destino}.tessera-tmp`
    const flujo = createWriteStream(tmp)
    await once(flujo, 'open')
    const linea = lineaCabecera(archivo)
    const e = new EscritorCopia(flujo, tmp, destino, selloDe(hashLinea(linea), claveFrase, archivo.cifrado?.sal ?? null))
    // Un error de disco entre dos escrituras no tumba el proceso: se lanza en la siguiente.
    flujo.on('error', (err) => {
      e.error ??= err
    })
    await e.escribir(`${linea}\n`)
    return e
  }

  private async escribir(texto: string): Promise<void> {
    if (this.error) throw this.error
    if (!this.flujo.write(texto)) await once(this.flujo, 'drain')
  }

  private async trozo(meta: MetaArchivo | MetaFin, datos: Buffer): Promise<void> {
    const final = meta.t === 'fin'
    const fuente = meta.t === 'fin' ? FUENTE_CIERRE : meta.fuente
    const sellado = await sellarTrozo(this.sello, meta.i, final, fuente, codificar(meta, datos))
    const linea = `"${final ? 'fin' : fuente}:${sellado.toString('base64')}"${final ? '' : ','}`
    this.cadena = encadenar(this.cadena, linea)
    await this.escribir(`${linea}\n`)
  }

  /**
   * Añade los primeros `bytes` de un archivo, en trozos de como mucho `TROZO_MAXIMO`. False, sin escribir
   * nada, si el archivo ya no se puede abrir (`archivoQueSeFue`); cualquier otro fallo lanza.
   */
  async archivo(fuente: number, ruta: string, abs: string, bytes: number): Promise<boolean> {
    let f: FileHandle
    try {
      f = await open(abs, 'r')
    } catch (err) {
      if (archivoQueSeFue(err)) return false
      throw err
    }
    try {
      const buf = Buffer.alloc(Math.min(TROZO_MAXIMO, Math.max(1, bytes)))
      let desde = 0
      for (let parte = 0; ; parte++) {
        const largo = Math.min(buf.length, bytes - desde)
        const { bytesRead } = largo > 0 ? await f.read(buf, 0, largo, desde) : { bytesRead: 0 }
        desde += bytesRead
        // Si el archivo menguó entre el listado y aquí, se cierra con lo que había.
        const ultima = desde >= bytes || bytesRead < largo
        await this.trozo({ t: 'archivo', i: this.i++, fuente, ruta, parte, ultima }, Buffer.from(buf.subarray(0, bytesRead)))
        if (ultima) break
      }
      this.archivos++
      return true
    } finally {
      await f.close()
    }
  }

  async cerrar(): Promise<void> {
    const i = this.i++
    await this.trozo({ t: 'fin', i, trozos: i + 1, archivos: this.archivos, cadena: this.cadena.toString('base64') }, Buffer.alloc(0))
    await this.escribir(`${CIERRE}\n`)
    this.flujo.end()
    await once(this.flujo, 'finish')
    if (this.error) throw this.error
    await rename(this.tmp, this.destino)
  }

  /** Cierra el flujo (esperando a que suelte el archivo: en Windows no se borra abierto) y borra el temporal. */
  async abortar(): Promise<void> {
    if (!this.flujo.closed) {
      const cerrado = once(this.flujo, 'close').catch(() => {})
      this.flujo.destroy()
      await cerrado
    }
    await rm(this.tmp, { force: true })
  }
}

/** Una línea pasó de su tope antes de acabar. */
export class LineaDemasiadoLarga extends Error {}

/** Las líneas de un archivo, sin el salto, con un tope para la primera y otro para el resto. */
export async function* lineasDe(ruta: string, topePrimera: number, topeResto: number): AsyncGenerator<string> {
  const flujo = createReadStream(ruta, { highWaterMark: 1024 * 1024 })
  let partes: Buffer[] = []
  let largo = 0
  let primera = true
  try {
    for await (const trozo of flujo as AsyncIterable<Buffer>) {
      let desde = 0
      for (let nl = trozo.indexOf(0x0a, desde); nl >= 0; nl = trozo.indexOf(0x0a, desde)) {
        partes.push(trozo.subarray(desde, nl))
        yield Buffer.concat(partes).toString('utf8').replace(/\r$/, '')
        partes = []
        largo = 0
        primera = false
        desde = nl + 1
      }
      partes.push(trozo.subarray(desde))
      largo += trozo.length - desde
      if (largo > (primera ? topePrimera : topeResto)) throw new LineaDemasiadoLarga(txConfiguracion().archivo.historialDanado)
    }
    if (largo > 0) yield Buffer.concat(partes).toString('utf8').replace(/\r$/, '')
  } finally {
    flujo.destroy()
  }
}

async function primerosBytes(ruta: string, n: number): Promise<Buffer> {
  const f = await open(ruta, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await f.read(buf, 0, n, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await f.close()
  }
}

/** La cabecera de una copia en disco y, si es de la versión 2, el hash de su primera línea (null en la 1). */
export type CabeceraEnDisco = { ok: true; archivo: ArchivoCopia; hash: Buffer | null } | { ok: false; error: string }

/**
 * Lee la cabecera de una copia de cualquier versión. Antes de cargar nada mira que el archivo empiece como
 * una copia, y ni la primera línea de la versión 2 ni el archivo entero de la 1 pasan de `TOPE_CABECERA`.
 */
export async function leerCabeceraCopia(ruta: string, versionMaxima?: number): Promise<CabeceraEnDisco> {
  const t = txConfiguracion()
  const inicio = (await primerosBytes(ruta, 256)).toString('utf8')
  if (!INICIO_COPIA.test(inicio)) return { ok: false, error: t.archivo.noEsCopia }
  if (inicio.startsWith(INICIO_CON_HISTORIAL)) {
    let linea: string | null = null
    try {
      for await (const l of lineasDe(ruta, TOPE_CABECERA, TOPE_CABECERA)) {
        linea = l
        break
      }
    } catch (err) {
      if (err instanceof LineaDemasiadoLarga) return { ok: false, error: t.demasiadoGrande }
      throw err
    }
    if (linea !== null && linea.endsWith(SUFIJO_CABECERA)) {
      const leido = archivoDeLinea(linea, versionMaxima)
      return leido.ok ? { ok: true, archivo: leido.archivo, hash: hashLinea(linea) } : leido
    }
  }
  if ((await stat(ruta)).size > TOPE_CABECERA) return { ok: false, error: t.demasiadoGrande }
  const leido = leerArchivoCopia(await readFile(ruta, 'utf8'), versionMaxima)
  return leido.ok ? { ok: true, archivo: leido.archivo, hash: null } : leido
}

/** Lo que trae un trozo de datos ya abierto. */
export interface TrozoArchivo {
  meta: MetaArchivo
  datos: Buffer
}

function metaArchivo(m: Record<string, unknown>, i: number, fuente: number): MetaArchivo {
  const ok =
    m.t === 'archivo' && m.i === i && m.fuente === fuente && typeof m.ruta === 'string' && m.ruta !== '' &&
    Number.isInteger(m.parte) && (m.parte as number) >= 0 && typeof m.ultima === 'boolean'
  if (!ok) throw new Error(txConfiguracion().archivo.historialDanado)
  return m as unknown as MetaArchivo
}

/** Comprueba que las partes de cada archivo llegan seguidas y completas. */
function seguida(previo: MetaArchivo | null, m: MetaArchivo): void {
  const abierto = previo !== null && !previo.ultima
  const sigue = abierto && previo.fuente === m.fuente && previo.ruta === m.ruta && m.parte === previo.parte + 1
  if (m.parte === 0 ? abierto : !sigue) throw new Error(txConfiguracion().archivo.historialDanado)
}

/**
 * Los trozos de datos de un archivo de la versión 2, abiertos y en orden; con `elegidas`, solo los de esas
 * fuentes: los demás se saltan sin descifrar, pero pasan por el hash encadenado que comprueba el cierre. La
 * primera línea tiene que ser la que se abrió (`hashCabecera`): si el archivo cambió desde entonces, error.
 * Lanza ante cualquier trozo que falte, sobre, se repita, cambie de sitio o esté tocado, y si el archivo acaba
 * sin su trozo de cierre. Lo de un trozo saltado se nota al llegar al cierre; lo de uno abierto, al abrirlo.
 */
export async function* leerTrozos(ruta: string, hashCabecera: Buffer, sello: SelloTrozos, elegidas?: ReadonlySet<number>): AsyncGenerator<TrozoArchivo> {
  const t = txConfiguracion().archivo
  let i = 0
  let fin = false
  let cerrado = false
  let previo: MetaArchivo | null = null
  let primera = true
  let cadena = sello.cabecera
  for await (const l of lineasDe(ruta, TOPE_CABECERA, LINEA_TROZO_MAXIMA)) {
    if (primera) {
      if (!hashLinea(l).equals(hashCabecera)) throw new Error(t.cambioArchivo)
      primera = false
      continue
    }
    if (cerrado) {
      if (l === '') continue
      throw new Error(t.historialDanado)
    }
    if (l === CIERRE && fin) {
      cerrado = true
      continue
    }
    if (fin) throw new Error(t.historialDanado)
    const { fuente, sellado } = partirLinea(l)
    if (fuente === null) {
      await comprobarCierre(sello, i, sellado, cadena, previo)
      fin = true
    } else {
      if (elegidas === undefined || elegidas.has(fuente)) {
        const { meta, datos } = decodificar(await abrirTrozo(sello, i, false, fuente, sellado))
        const a = metaArchivo(meta, i, fuente)
        seguida(previo, a)
        previo = a
        yield { meta: a, datos }
      }
      cadena = encadenar(cadena, l)
    }
    i++
  }
  if (primera || !cerrado) throw new Error(t.historialIncompleto)
}

/** La fuente (null en la de cierre) y el trozo sellado de una línea; lanza si la línea no tiene su forma. */
function partirLinea(l: string): { fuente: number | null; sellado: Buffer } {
  const m = LINEA_TROZO.exec(l)
  // Solo la de cierre va sin coma detrás, y solo ella se llama `fin`.
  if (!m || (m[3] === '') !== (m[1] === 'fin')) throw new Error(txConfiguracion().archivo.historialDanado)
  return { fuente: m[1] === 'fin' ? null : Number(m[1]), sellado: Buffer.from(m[2], 'base64') }
}

/** El trozo de cierre: su sitio, el total, el hash encadenado de lo anterior y que no deja un archivo a medias. */
async function comprobarCierre(sello: SelloTrozos, i: number, sellado: Buffer, cadena: Buffer, previo: MetaArchivo | null): Promise<void> {
  const { meta } = decodificar(await abrirTrozo(sello, i, true, FUENTE_CIERRE, sellado))
  const ok = meta.t === 'fin' && meta.i === i && meta.trozos === i + 1 && meta.cadena === cadena.toString('base64') && (previo === null || previo.ultima)
  if (!ok) throw new Error(txConfiguracion().archivo.historialDanado)
}
