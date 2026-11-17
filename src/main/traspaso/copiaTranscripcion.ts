// =============================================================================
// El disco de la copia de una conversación entre cuentas: encontrar el transcript de un id en la carpeta de
// una cuenta, comparar cada archivo con lo que ya haya en el destino y copiar lo decidido sin dejar nunca un
// archivo a medias en el sitio del bueno. Se comprueban los enlaces bajo las carpetas que escribe un contenedor.
// Sin electron; lo usa `ServicioTraspaso` y lo prueba `test-traspaso.mts` sobre carpetas temporales.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { lstat, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { basenameSuelto } from '../conversaciones/slugProyecto.ts'
import { transcripcionesCodex, rutaPlana, transcripcionesClaude } from '../transcripts/listadoTranscripciones.ts'
import { pasaPorEnlace } from '../util/enlaces.ts'
import type { AgenteTraspaso, ArchivoACopiar, EstadoDestino } from './rutasTraspaso.ts'
import { txTraspaso } from './textos.ts'

const TROZO = 1024 * 1024

/** Error si `ruta` no queda dentro de `base` sin enlaces por medio. */
export async function exigirSinEnlaces(base: string, ruta: string): Promise<void> {
  if (await pasaPorEnlace(base, ruta)) throw new Error(txTraspaso().enlace)
}

/** El transcript principal de la conversación `id` en la carpeta de una cuenta, o null. */
export async function buscarTranscripcion(agente: AgenteTraspaso, base: string, id: string, rutaHostProyecto: string): Promise<string | null> {
  if (agente === 'codex') {
    const sufijo = `-${id}.jsonl`.toLowerCase()
    const todos = await transcripcionesCodex(base, undefined, { comprimidos: true })
    return todos.find((r) => rutaPlana(path.basename(r)).toLowerCase().endsWith(sufijo)) ?? null
  }
  const todos = await transcripcionesClaude(base, { nombreProyecto: basenameSuelto(rutaHostProyecto), respaldo: 'todas' })
  return todos.find((r) => path.basename(r) === `${id}.jsonl`) ?? null
}

/** Los archivos bajo una carpeta, con su ruta relativa; ninguno si no existe o si ella misma es un enlace. */
export async function archivosBajo(dir: string): Promise<string[]> {
  let entradas
  try {
    if (!(await lstat(dir)).isDirectory()) return []
    entradas = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const fuera: string[] = []
  for (const e of entradas) {
    if (e.isDirectory()) fuera.push(...(await archivosBajo(path.join(dir, e.name))).map((r) => path.join(e.name, r)))
    else if (e.isFile()) fuera.push(e.name)
  }
  return fuera
}

async function tamano(ruta: string): Promise<number | null> {
  try {
    return (await stat(ruta)).size
  } catch {
    return null
  }
}

/** ¿Son iguales los primeros `n` bytes de los dos archivos? Por trozos: un transcript puede pesar cientos de megas. */
async function mismoPrincipio(a: string, b: string, n: number): Promise<boolean> {
  const fa = await open(a, 'r')
  const fb = await open(b, 'r')
  try {
    const ba = Buffer.alloc(Math.min(TROZO, Math.max(1, n)))
    const bb = Buffer.alloc(ba.length)
    for (let desde = 0; desde < n; desde += ba.length) {
      const largo = Math.min(ba.length, n - desde)
      const [ra, rb] = await Promise.all([fa.read(ba, 0, largo, desde), fb.read(bb, 0, largo, desde)])
      if (ra.bytesRead !== largo || rb.bytesRead !== largo || !ba.subarray(0, largo).equals(bb.subarray(0, largo))) return false
    }
    return true
  } finally {
    await fa.close()
    await fb.close()
  }
}

/**
 * Cuántos bytes del principio de un archivo llegan hasta su última línea completa (terminada en `\n`), según
 * su tamaño ahora. Un CLI que sigue escribiendo puede dejar la última línea a medias; copiarla así dejaría
 * al destino un JSON roto. Sin ningún salto de línea, 0.
 */
export async function bytesHastaLineaCompleta(ruta: string): Promise<number> {
  const f = await open(ruta, 'r')
  try {
    const { size } = await f.stat()
    const buf = Buffer.alloc(Math.min(TROZO, Math.max(1, size)))
    for (let fin = size; fin > 0; fin -= buf.length) {
      const desde = Math.max(0, fin - buf.length)
      const largo = fin - desde
      const { bytesRead } = await f.read(buf, 0, largo, desde)
      const i = buf.subarray(0, bytesRead).lastIndexOf(0x0a)
      if (i >= 0) return desde + i + 1
    }
    return 0
  } finally {
    await f.close()
  }
}

/** Cómo está `destino` frente a `origen` (sus primeros `bytes`, si se dan): no está, es igual, es su principio o es otra cosa. */
export async function compararConDestino(origen: string, destino: string, bytes?: number): Promise<EstadoDestino> {
  const tamanoDestino = await tamano(destino)
  if (tamanoDestino === null) return 'falta'
  const tamanoOrigen = bytes ?? (await tamano(origen))
  if (tamanoOrigen === null || tamanoDestino > tamanoOrigen || !(await mismoPrincipio(origen, destino, tamanoDestino))) return 'distinto'
  return tamanoDestino === tamanoOrigen ? 'igual' : 'prefijo'
}

/**
 * Copia los primeros `bytes` de `origen` (todo, sin ellos) a `destino`, que se crea nuevo. El origen se abre una
 * sola vez y su descriptor tiene que ser el archivo normal que había en la ruta justo antes: si un tramo se cambió
 * por un enlace entre medias, no se copia.
 */
async function copiarPrefijo(origen: string, destino: string, bytes?: number): Promise<void> {
  const entrada = await lstat(origen)
  if (!entrada.isFile() || entrada.isSymbolicLink()) throw new Error(txTraspaso().enlace)
  const fo = await open(origen, 'r')
  try {
    const abierto = await fo.stat()
    if (entrada.dev !== abierto.dev || entrada.ino !== abierto.ino) throw new Error(txTraspaso().enlace)
    const n = bytes ?? abierto.size
    const fd = await open(destino, 'wx')
    try {
      const buf = Buffer.alloc(Math.min(TROZO, Math.max(1, n)))
      for (let desde = 0; desde < n; ) {
        const { bytesRead } = await fo.read(buf, 0, Math.min(buf.length, n - desde), desde)
        if (bytesRead === 0) break
        await fd.write(buf, 0, bytesRead)
        desde += bytesRead
      }
    } finally {
      await fd.close()
    }
  } finally {
    await fo.close()
  }
}

/**
 * Copia lo decidido: cada archivo a un temporal al lado y luego en su sitio, para no dejar uno a medias. Sin
 * enlaces bajo `baseDestino` si se da, antes de crear carpetas y antes de ponerlo en su sitio. El temporal se crea
 * nuevo para no escribir a través de un enlace con su mismo nombre.
 */
export async function copiarArchivos(archivos: readonly ArchivoACopiar[], baseDestino: string | null): Promise<void> {
  for (const a of archivos) {
    const tmp = `${a.destino}.tessera-copia`
    if (baseDestino !== null) await exigirSinEnlaces(baseDestino, tmp)
    await mkdir(path.dirname(a.destino), { recursive: true })
    try {
      await rm(tmp, { force: true, recursive: true })
      await copiarPrefijo(a.origen, tmp, a.bytes)
      if (baseDestino !== null) await exigirSinEnlaces(baseDestino, a.destino)
      await rename(tmp, a.destino)
    } catch (err) {
      try {
        await rm(tmp, { force: true, recursive: true })
      } catch {
        // El fallo de limpieza no debe ocultar el error de la copia.
      }
      throw err
    }
  }
}
