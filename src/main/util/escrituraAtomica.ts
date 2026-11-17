// =============================================================================
// Escritura CRASH-SAFE de los JSON de estado (workspace, perfiles, cuentas, conexiones…): tmp
// completo + `fsync` (un `rename` sin `fsync` es atómico frente a lectores pero no garantiza los
// datos en disco); copia del destino actual a `<target>.bak` solo si es un JSON legible (nunca se
// pisa un respaldo bueno con un primario corrupto); `rename` atómico con reintentos ante los
// bloqueos transitorios de Windows (antivirus, indexador); `fsync` del directorio. El tmp tiene
// nombre fijo por destino: quien escribe el mismo archivo serializa sus escrituras.
// Decisiones: docs/decisiones/workspace/estado-persistido-crash-safe.md
// =============================================================================

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** ¿Contenido usable como respaldo? No vacío + JSON parseable (todos los consumidores
 *  guardan JSON). Evita pisar un `.bak` bueno con un primario corrupto/truncado. */
function esRespaldoValido(contenido: string): boolean {
  if (contenido.trim().length === 0) return false
  try {
    JSON.parse(contenido)
    return true
  } catch {
    return false
  }
}

/** Códigos de error TRANSITORIOS típicos de Windows (AV/indexer bloquean el archivo). */
function esTransitorio(err: unknown): boolean {
  const codigo = (err as { code?: string } | null)?.code
  return codigo === 'EPERM' || codigo === 'EACCES' || codigo === 'EBUSY'
}

/** Sleep SÍNCRONO (para el reintento del camino sync). */
function esperarSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const INTENTOS_RENOMBRAR = 6

/** `rename` con los reintentos ante los bloqueos transitorios de Windows. */
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

/**
 * Para carpetas en las que escribe alguien de menos confianza, como las montadas en un contenedor: el
 * temporal lleva un nombre imposible de adivinar y `wx` falla si ya existe, y `rename` sustituye un
 * enlace en el destino en vez de seguirlo. Los nombres fijos de `escribirArchivoAtomico` sí seguirían un enlace.
 */
export async function escribirSinSeguirEnlaces(destino: string, contenido: string, modo?: number): Promise<void> {
  await mkdir(dirname(destino), { recursive: true })
  const temporal = `${destino}.${randomUUID()}.tmp`
  try {
    const archivo = await open(temporal, 'wx', modo)
    try {
      await archivo.writeFile(contenido, 'utf-8')
      await archivo.sync()
    } finally {
      await archivo.close()
    }
    await renombrarConReintentos(temporal, destino)
  } catch (err) {
    await unlink(temporal).catch(() => undefined)
    throw err
  }
}

/** Igual que `escribirSinSeguirEnlaces`, pero SÍNCRONO. */
export function escribirSinSeguirEnlacesSync(destino: string, contenido: string): void {
  mkdirSync(dirname(destino), { recursive: true })
  const temporal = `${destino}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporal, 'wx')
    try {
      writeFileSync(fd, contenido, 'utf-8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    for (let i = 0; ; i++) {
      try {
        renameSync(temporal, destino)
        return
      } catch (err) {
        if (i >= INTENTOS_RENOMBRAR - 1 || !esTransitorio(err)) throw err
        esperarSync(30 * (i + 1))
      }
    }
  } catch (err) {
    rmSync(temporal, { force: true })
    throw err
  }
}

// ---------------------------------------------------------------------------
// Async (para stores con escritura debounced/asíncrona: workspaceStateStore).
// ---------------------------------------------------------------------------

/** Escribe `data` en `target` de forma atómica + durable (fsync) + con respaldo `.bak`. */
export async function escribirArchivoAtomico(destino: string, datos: string): Promise<void> {
  await mkdir(dirname(destino), { recursive: true })
  const tmp = `${destino}.tmp`
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(datos, 'utf-8') // writeFile hace loop -> escribe TODO
    await fh.sync() // fsync: durabilidad del contenido
  } finally {
    await fh.close()
  }
  await respaldarActual(destino)
  await renombrarConReintentos(tmp, destino)
  await fsyncDir(dirname(destino))
}

/** Guarda el destino ACTUAL en `.bak` (atómico) SOLO si es un respaldo fiable. */
async function respaldarActual(destino: string): Promise<void> {
  let cur: string
  try {
    cur = await readFile(destino, 'utf-8')
  } catch {
    return // aún no hay primario (primer guardado)
  }
  if (!esRespaldoValido(cur)) return // primario corrupto: NO pisar el .bak bueno
  const bakTmp = `${destino}.bak.tmp`
  // Sin fsync: el `.bak` es red SECUNDARIA (el primario ya es durable); basta con que
  // sea atómico frente a lectores para no dejar un respaldo a medio escribir.
  await writeFile(bakTmp, cur, 'utf-8')
  await rename(bakTmp, `${destino}.bak`)
}

/** fsync del directorio (durabilidad del rename). Best-effort: en Windows no aplica
 *  (el journal de NTFS cubre el rename) y `open` de un directorio puede fallar. */
async function fsyncDir(dir: string): Promise<void> {
  try {
    const dh = await open(dir, 'r')
    try {
      await dh.sync()
    } finally {
      await dh.close()
    }
  } catch {
    // Windows / SO sin fsync de directorio: sin efecto.
  }
}

// ---------------------------------------------------------------------------
// Sync (para stores que persisten en línea: profiles/store, AccountStore).
// ---------------------------------------------------------------------------

/** Igual que `escribirArchivoAtomico`, pero SÍNCRONO. */
export function escribirArchivoAtomicoSync(destino: string, datos: string): void {
  mkdirSync(dirname(destino), { recursive: true })
  const tmp = `${destino}.tmp`
  writeFileSync(tmp, datos, 'utf-8') // writeFileSync hace loop -> escribe TODO
  const fd = openSync(tmp, 'r+')
  try {
    fsyncSync(fd) // fsync: durabilidad del contenido
  } finally {
    closeSync(fd)
  }
  respaldarActualSync(destino)
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, destino)
      break
    } catch (err) {
      if (i >= INTENTOS_RENOMBRAR - 1 || !esTransitorio(err)) throw err
      esperarSync(30 * (i + 1))
    }
  }
  fsyncDirSync(dirname(destino))
}

function respaldarActualSync(destino: string): void {
  if (!existsSync(destino)) return
  let cur: string
  try {
    cur = readFileSync(destino, 'utf-8')
  } catch {
    return
  }
  if (!esRespaldoValido(cur)) return
  const bakTmp = `${destino}.bak.tmp`
  writeFileSync(bakTmp, cur, 'utf-8')
  renameSync(bakTmp, `${destino}.bak`)
}

function fsyncDirSync(dir: string): void {
  try {
    const fd = openSync(dir, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Windows / SO sin fsync de directorio: sin efecto.
  }
}
