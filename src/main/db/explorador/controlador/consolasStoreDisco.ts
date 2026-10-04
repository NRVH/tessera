// =============================================================================
// Disco de las consolas: leer los bytes con su versión (el SHA-256 del contenido), borrar (a la papelera inyectada o
// `unlink` si está vacía) y renombrar con los reintentos de Windows. No conoce el índice ni la plataforma.
// Decisiones: docs/decisiones/bd/explorador-consolas-persistencia.md
// =============================================================================

import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { open, readFile, rename, stat, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { DB_CONSOLA_MAX_BYTES } from '../../../../shared/db-explorador-ipc.ts'
import { codigoFs, ErrorConsolas, esTransitorio } from './consolasStoreErrores.ts'

/** Versión de un archivo que no está en disco. */
export const AUSENTE = 'ausente'
/** Por encima de esto, un archivo no puede ser "solo espacios": se da por no vacío sin leerlo. */
const UMBRAL_VACIO_BYTES = 64 * 1024
const INTENTOS_RENOMBRAR = 6

/** Versión de un contenido: su tamaño en bytes y el SHA-256 de esos bytes. Opaca para el renderer. */
export function versionDe(bytes: Uint8Array): string {
  return `${bytes.length}:${createHash('sha256').update(bytes).digest('base64url')}`
}

/** Versión de una consola recién creada (vacía): la de cero bytes. */
export const VERSION_VACIA = versionDe(new Uint8Array(0))

function sinBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
}

/** Texto de una consola leída del disco: UTF-8 y sin el BOM que deja algún editor. */
export function textoDe(bytes: Buffer): string {
  return sinBom(bytes.toString('utf-8'))
}

/**
 * Los bytes de la consola y su versión, sin decodificar: solo hace falta el texto si hay
 * conflicto. null si no existe. Sobre un tope de tamaño lanza `ErrorConsolas('tamano')`.
 */
export async function leerBytesConsola(ruta: string): Promise<{ bytes: Buffer; version: string } | null> {
  let fh: FileHandle
  try {
    fh = await open(ruta, 'r')
  } catch (err) {
    if (codigoFs(err) === 'ENOENT') return null
    throw err
  }
  try {
    const grande = new ErrorConsolas(
      'tamano',
      `El archivo de la consola supera ${DB_CONSOLA_MAX_BYTES / (1024 * 1024)} MiB; ábrelo como archivo.`
    )
    if ((await fh.stat()).size > DB_CONSOLA_MAX_BYTES) throw grande
    const bytes = await fh.readFile()
    // Pudo crecer entre el `stat` y la lectura (alguien que va añadiendo): el tope es de lo leído.
    if (bytes.length > DB_CONSOLA_MAX_BYTES) throw grande
    return { bytes, version: versionDe(bytes) }
  } finally {
    await fh.close()
  }
}

/**
 * Quita el archivo de una consola: `unlink` si está vacía (mandar a la papelera un archivo
 * vacío es ruido) y, si no, a la papelera. Si la papelera falla NO se borra en firme.
 */
export async function eliminarArchivoConsola(ruta: string, nombre: string, papelera: (rutaAbs: string) => Promise<void>): Promise<void> {
  let st: Stats
  try {
    st = await stat(ruta)
  } catch (err) {
    if (codigoFs(err) === 'ENOENT') return
    throw err
  }
  const vacia = st.size === 0 || (st.size <= UMBRAL_VACIO_BYTES && sinBom(await readFile(ruta, 'utf-8')).trim() === '')
  if (vacia) {
    await unlink(ruta)
  } else {
    try {
      await papelera(ruta)
    } catch {
      throw new ErrorConsolas('papelera', `No se pudo mover «${nombre}» a la papelera.`)
    }
  }
  // Restos del escritor atómico: sin su archivo no los lee nadie.
  for (const resto of [ruta + '.tmp', ruta + '.bak']) await unlink(resto).catch(() => undefined)
}

/** `rename` con los reintentos de Windows (antivirus o indexador bloquean unos ms). */
export async function renombrarConReintentos(origen: string, destino: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(origen, destino)
      return
    } catch (err) {
      if (i >= INTENTOS_RENOMBRAR - 1 || !esTransitorio(err)) throw err
      await new Promise((r) => setTimeout(r, 30 * (i + 1)))
    }
  }
}
