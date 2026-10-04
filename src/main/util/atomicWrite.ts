// =============================================================================
// Escritura CRASH-SAFE de los JSON de estado (workspace, perfiles, cuentas, conexiones…): tmp
// completo + `fsync` (un `rename` sin `fsync` es atómico frente a lectores pero no garantiza los
// datos en disco); copia del destino actual a `<target>.bak` solo si es un JSON legible (nunca se
// pisa un respaldo bueno con un primario corrupto); `rename` atómico con reintentos ante los
// bloqueos transitorios de Windows (antivirus, indexador); `fsync` del directorio. El tmp tiene
// nombre fijo por destino: quien escribe el mismo archivo serializa sus escrituras.
// Decisiones: docs/decisiones/workspace/estado-persistido-crash-safe.md
// =============================================================================

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** ¿Contenido usable como respaldo? No vacío + JSON parseable (todos los consumidores
 *  guardan JSON). Evita pisar un `.bak` bueno con un primario corrupto/truncado. */
function isGoodBackup(content: string): boolean {
  if (content.trim().length === 0) return false
  try {
    JSON.parse(content)
    return true
  } catch {
    return false
  }
}

/** Códigos de error TRANSITORIOS típicos de Windows (AV/indexer bloquean el archivo). */
function isTransient(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

/** Sleep SÍNCRONO (para el reintento del camino sync). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const RENAME_ATTEMPTS = 6

// ---------------------------------------------------------------------------
// Async (para stores con escritura debounced/asíncrona: workspaceStateStore).
// ---------------------------------------------------------------------------

/** Escribe `data` en `target` de forma atómica + durable (fsync) + con respaldo `.bak`. */
export async function writeFileAtomic(target: string, data: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(data, 'utf-8') // writeFile hace loop -> escribe TODO
    await fh.sync() // fsync: durabilidad del contenido
  } finally {
    await fh.close()
  }
  await backupCurrent(target)
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, target)
      break
    } catch (err) {
      if (i >= RENAME_ATTEMPTS - 1 || !isTransient(err)) throw err
      await new Promise((r) => setTimeout(r, 30 * (i + 1)))
    }
  }
  await fsyncDir(dirname(target))
}

/** Guarda el destino ACTUAL en `.bak` (atómico) SOLO si es un respaldo fiable. */
async function backupCurrent(target: string): Promise<void> {
  let cur: string
  try {
    cur = await readFile(target, 'utf-8')
  } catch {
    return // aún no hay primario (primer guardado)
  }
  if (!isGoodBackup(cur)) return // primario corrupto: NO pisar el .bak bueno
  const bakTmp = `${target}.bak.tmp`
  // Sin fsync: el `.bak` es red SECUNDARIA (el primario ya es durable); basta con que
  // sea atómico frente a lectores para no dejar un respaldo a medio escribir.
  await writeFile(bakTmp, cur, 'utf-8')
  await rename(bakTmp, `${target}.bak`)
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

/** Igual que `writeFileAtomic`, pero SÍNCRONO. */
export function writeFileAtomicSync(target: string, data: string): void {
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  writeFileSync(tmp, data, 'utf-8') // writeFileSync hace loop -> escribe TODO
  const fd = openSync(tmp, 'r+')
  try {
    fsyncSync(fd) // fsync: durabilidad del contenido
  } finally {
    closeSync(fd)
  }
  backupCurrentSync(target)
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, target)
      break
    } catch (err) {
      if (i >= RENAME_ATTEMPTS - 1 || !isTransient(err)) throw err
      sleepSync(30 * (i + 1))
    }
  }
  fsyncDirSync(dirname(target))
}

function backupCurrentSync(target: string): void {
  if (!existsSync(target)) return
  let cur: string
  try {
    cur = readFileSync(target, 'utf-8')
  } catch {
    return
  }
  if (!isGoodBackup(cur)) return
  const bakTmp = `${target}.bak.tmp`
  writeFileSync(bakTmp, cur, 'utf-8')
  renameSync(bakTmp, `${target}.bak`)
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
