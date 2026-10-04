// =============================================================================
// Índice de las consolas (`consolas/indice.json`) y su reconciliación con los archivos del disco: forma de una entrada,
// lectura tolerante del JSON, listado de archivos y emparejado de una entrada sin archivo con un archivo sin entrada.
// Decisiones: docs/decisiones/bd/explorador-consolas-persistencia.md
// =============================================================================

import type { Stats } from 'node:fs'
import { readdir } from 'node:fs/promises'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc.ts'
import { codigoFs } from './consolasStoreErrores.ts'
import {
  claveNombre,
  EXT,
  EXTENSIONES,
  nombreSeguro,
  rutaDeConsola,
  type ExtensionConsola
} from './consolasStoreNombres.ts'

export const CARPETA = 'consolas'
export const INDICE = 'indice.json'
/** Tope de un nombre de esquema guardado en el índice (Oracle 128, PG 63: holgado). */
export const ESQUEMA_MAX = 1024

/** Una consola del índice. */
export interface EntradaIndice {
  id: string
  conexionId: string
  /** Nombre del archivo sin extensión, tal como está en disco. */
  nombre: string
  creadaEn: number
  /** Esquema elegido en la consola (`CONSOLA_ESQUEMA`); ausente = el de la conexión. */
  esquema?: string
  /** Extensión del archivo si NO es `.sql`. */
  extension?: ExtensionConsola
}

/** Un archivo de consola en disco. */
export interface ArchivoConsola {
  /** Nombre real, sin extensión. */
  nombre: string
  ext: ExtensionConsola
}

/** El índice y el disco, reconciliados. */
export interface EstadoCarpeta {
  carpeta: string
  entradas: EntradaIndice[]
  /** Archivos de consola en disco: `claveArchivo` -> nombre real y extensión. */
  disco: Map<string, ArchivoConsola>
}

/** La extensión de una entrada del índice (sin `extension` = `.sql`). */
export function extDe(e: Pick<EntradaIndice, 'extension'>): ExtensionConsola {
  return e.extension ?? EXT
}

/** Clave de un ARCHIVO de consola: el nombre normalizado y su extensión. */
export function claveArchivo(nombre: string, ext: ExtensionConsola): string {
  return claveNombre(nombre) + ext
}

/** ¿Algún archivo de consola (de cualquier extensión) usa ya este nombre? */
export function nombreEnDisco(disco: Map<string, ArchivoConsola>, clave: string): boolean {
  for (const a of disco.values()) if (claveNombre(a.nombre) === clave) return true
  return false
}

/** La información de una consola para el renderer (solo la ruta relativa POSIX, nunca la del host). */
export function infoDe(perfilId: string, e: EntradaIndice, st: Stats): DbConsolaInfo {
  const info: DbConsolaInfo = {
    id: e.id,
    perfilId,
    conexionId: e.conexionId,
    nombre: e.nombre,
    rutaRelativa: `${CARPETA}/${e.nombre}${extDe(e)}`,
    modificadaEn: st.mtimeMs,
    bytes: st.size
  }
  if (e.esquema !== undefined) info.esquema = e.esquema
  return info
}

/** El texto del índice -> entradas válidas (lo inválido se descarta entrada a entrada); null si no es un índice. */
export function parsearIndice(bruto: string, carpeta: string): EntradaIndice[] | null {
  let doc: unknown
  try {
    doc = JSON.parse(bruto)
  } catch {
    return null
  }
  const lista = (doc as { consolas?: unknown } | null)?.consolas
  if (!Array.isArray(lista)) return null
  const ids = new Set<string>()
  const nombres = new Set<string>()
  const out: EntradaIndice[] = []
  for (const e of lista as Array<Partial<EntradaIndice> | null>) {
    const entrada = entradaDelIndice(e, carpeta, ids, nombres)
    if (entrada) out.push(entrada)
  }
  return out
}

/** ¿Tiene la forma y el nombre de una consola que se puede abrir? Una extensión desconocida la descarta. */
function esEntradaUsable(e: Partial<EntradaIndice> | null, carpeta: string): e is EntradaIndice {
  if (!e || typeof e.id !== 'string' || e.id === '' || typeof e.conexionId !== 'string') return false
  if (!nombreSeguro(e.nombre)) return false
  if (e.extension !== undefined && e.extension !== EXT && !EXTENSIONES.includes(e.extension)) return false
  try {
    rutaDeConsola(carpeta, e.nombre, e.extension ?? EXT)
  } catch {
    return false
  }
  return true
}

/** Una entrada saneada, o null si no vale o repite el id o el nombre (sin distinguir mayúsculas) de otra. */
function entradaDelIndice(
  e: Partial<EntradaIndice> | null,
  carpeta: string,
  ids: Set<string>,
  nombres: Set<string>
): EntradaIndice | null {
  if (!esEntradaUsable(e, carpeta)) return null
  const k = claveNombre(e.nombre)
  if (ids.has(e.id) || nombres.has(k)) return null
  ids.add(e.id)
  nombres.add(k)
  const entrada: EntradaIndice = {
    id: e.id,
    conexionId: e.conexionId,
    nombre: e.nombre,
    creadaEn: typeof e.creadaEn === 'number' && Number.isFinite(e.creadaEn) ? e.creadaEn : 0
  }
  // Un esquema raro no invalida la entrada: se ignora y la consola usa el de la conexión.
  if (typeof e.esquema === 'string' && e.esquema !== '' && e.esquema.length <= ESQUEMA_MAX) entrada.esquema = e.esquema
  if (e.extension !== undefined && e.extension !== EXT) entrada.extension = e.extension
  return entrada
}

/** Archivos de consola de la carpeta (sin los restos `.tmp`/`.bak` del escritor atómico). */
export async function leerArchivosConsola(carpeta: string): Promise<Map<string, ArchivoConsola>> {
  const out = new Map<string, ArchivoConsola>()
  let dirents
  try {
    dirents = await readdir(carpeta, { withFileTypes: true })
  } catch (err) {
    if (codigoFs(err) === 'ENOENT' || codigoFs(err) === 'ENOTDIR') return out
    throw err
  }
  for (const d of dirents) {
    if (!d.isFile()) continue
    const ext = EXTENSIONES.find((x) => d.name.endsWith(x))
    if (ext === undefined) continue
    const nombre = d.name.slice(0, -ext.length)
    if (!nombreSeguro(nombre)) continue
    const k = claveArchivo(nombre, ext)
    if (!out.has(k)) out.set(k, { nombre, ext })
  }
  return out
}

/**
 * Empareja el índice con el disco. Una entrada sin archivo y un archivo sin entrada se
 * emparejan solo si son EXACTAMENTE uno y uno de la MISMA extensión (lo mismo cubre un `mv`
 * hecho por fuera); con más no hay forma honrada de saber qué va con qué. `cambiado`: hay que
 * reescribir el índice.
 */
export function reconciliar(leidas: EntradaIndice[], disco: Map<string, ArchivoConsola>): { entradas: EntradaIndice[]; cambiado: boolean } {
  const usadas = new Set<string>()
  const faltan: EntradaIndice[] = []
  const entradas: EntradaIndice[] = []
  let cambiado = false
  for (const e of leidas) {
    const k = claveArchivo(e.nombre, extDe(e))
    const real = disco.get(k)
    if (real === undefined) {
      faltan.push(e)
      continue
    }
    usadas.add(k)
    if (real.nombre !== e.nombre) {
      // Renombrado por fuera cambiando solo mayúsculas o normalización.
      entradas.push({ ...e, nombre: real.nombre })
      cambiado = true
    } else {
      entradas.push(e)
    }
  }
  // Solo se CUENTAN los huérfanos de la extensión de la que falta: un `.js` suelto no puede
  // impedir que se recupere una `.sql` renombrada por fuera.
  const huerfanos = faltan.length === 1 ? [...disco.entries()].filter(([k, a]) => !usadas.has(k) && a.ext === extDe(faltan[0])) : []
  if (faltan.length === 1 && huerfanos.length === 1) {
    entradas.push({ ...faltan[0], nombre: huerfanos[0][1].nombre })
    cambiado = true
  } else if (faltan.length > 0) {
    cambiado = true
  }
  return { entradas, cambiado }
}
