// =============================================================================
// listadoTranscripts: dónde están en disco los transcripts de una cuenta, sin recorrer
// la carpeta entera. Claude Code: `<base>/projects/<carpeta>/<sessionId>.jsonl`, con la
// criba por nombre de carpeta ANTES de leerla. Codex: `<base>/sessions/**/rollout-*.jsonl`.
// Sin electron y con el `fs` inyectable; lo usan ConversationsReader y ContextReader.
// Decisiones: docs/decisiones/agentes/conversaciones-criba-por-carpeta.md
// =============================================================================

import type { Dirent, Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { carpetaPuedeSerDe } from '../conversations/slugProyecto.ts'
import { mapaConTope } from '../util/mapaConTope.ts'

/** Lo que se necesita del sistema de archivos; las pruebas lo sustituyen para contar llamadas. */
export interface FsListado {
  readdir: (dir: string, opts: { withFileTypes: true }) => Promise<Dirent[]>
  stat: (ruta: string) => Promise<Stats>
}

const FS_REAL: FsListado = { readdir, stat }

/** Lecturas de carpeta y `stat` en vuelo a la vez: no ahogar el bucle de eventos. */
const TOPE_ES = 16

export interface OpcionesClaude {
  /** Nombre de la carpeta del proyecto (el último tramo de su ruta); sin él se listan todas. */
  nombreProyecto?: string
  /**
   * Qué hacer si las carpetas que pasan la criba no dan NINGÚN transcript: mirar todas
   * (el panel y el anillo, que no deben quedarse vacíos si la criba falla) o ninguna (el
   * camino caliente de reanudar, donde casi siempre es un proyecto sin historial).
   */
  respaldo: 'todas' | 'ninguna'
  fs?: FsListado
}

async function entradas(fs: FsListado, dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return [] // la carpeta no existe todavía (cuenta sin estrenar) o no se puede leer
  }
}

/** Los `*.jsonl` de primer nivel de unas carpetas de proyecto; no baja a `<sessionId>/…`. */
async function transcriptsDe(fs: FsListado, carpetas: readonly string[]): Promise<string[]> {
  const porCarpeta = await mapaConTope(carpetas, TOPE_ES, async (carpeta) => {
    const hijos = await entradas(fs, carpeta)
    return hijos.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => path.join(carpeta, e.name))
  })
  return porCarpeta.flat()
}

/**
 * Transcripts de Claude Code de una cuenta: solo los de nivel superior de cada carpeta de
 * `<base>/projects`, así que los hilos de subagente (`<sessionId>/subagents/…`) no cuentan.
 */
export async function transcriptsClaude(base: string, opciones: OpcionesClaude): Promise<string[]> {
  const fs = opciones.fs ?? FS_REAL
  const raiz = path.join(base, 'projects')
  const carpetas = (await entradas(fs, raiz)).filter((e) => e.isDirectory()).map((e) => e.name)
  const rutas = (nombres: readonly string[]): string[] => nombres.map((n) => path.join(raiz, n))
  const { nombreProyecto } = opciones
  if (!nombreProyecto) return transcriptsDe(fs, rutas(carpetas))
  const cribadas = carpetas.filter((c) => carpetaPuedeSerDe(c, nombreProyecto))
  const deCribadas = await transcriptsDe(fs, rutas(cribadas))
  if (deCribadas.length > 0 || opciones.respaldo === 'ninguna') return deCribadas
  const resto = carpetas.filter((c) => !cribadas.includes(c))
  return transcriptsDe(fs, rutas(resto))
}

async function rolloutsBajo(fs: FsListado, dir: string): Promise<string[]> {
  const fuera: string[] = []
  for (const e of await entradas(fs, dir)) {
    const ruta = path.join(dir, e.name)
    if (e.isDirectory()) fuera.push(...(await rolloutsBajo(fs, ruta)))
    else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) fuera.push(ruta)
  }
  return fuera
}

/**
 * Rollouts de Codex de una cuenta: los de `<base>/sessions` (agrupados por fecha). Lo
 * archivado y lo temporal (`archived_sessions/`, `.tmp/`) no son conversaciones vivas.
 */
export async function rolloutsCodex(base: string, fs: FsListado = FS_REAL): Promise<string[]> {
  return rolloutsBajo(fs, path.join(base, 'sessions'))
}

/** Un transcript con su `stat` (fecha de última escritura y tamaño). */
export interface ArchivoConFecha {
  archivo: string
  st: Stats
}

/** Hace `stat` de cada archivo con tope de concurrencia; omite los que ya no están. */
export async function conFechas(
  archivos: readonly string[],
  fs: FsListado = FS_REAL,
  tope: number = TOPE_ES
): Promise<ArchivoConFecha[]> {
  const todos = await mapaConTope(archivos, tope, async (archivo) => {
    try {
      return { archivo, st: await fs.stat(archivo) }
    } catch {
      return null // borrado entre el listado y aquí
    }
  })
  return todos.filter((x): x is ArchivoConFecha => x !== null)
}
