// =============================================================================
// Qué archivos de la carpeta de una cuenta son conversaciones y viajan en la copia: una lista de lo que
// entra, nunca de lo que se excluye. Claude Code: `projects/<carpeta>/<id>.jsonl` y los de sus subagentes
// (`projects/<carpeta>/<id>/subagents/**/*.jsonl`); Codex: `sessions/**/rollout-*.jsonl[.zst]`. Lo mismo
// decide qué se acepta al importar. Sin seguir enlaces y con rutas relativas con `/`.
// Decisiones: docs/decisiones/configuracion/historial-en-la-copia.md
// =============================================================================

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AgenteHistorial } from '../../shared/copia-configuracion-ipc.ts'
import { mapaConTope } from '../util/mapaConTope.ts'

const RESERVADOS = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i
/** Los `stat` a la vez al medir una carpeta: miles de conversaciones sin ahogar el bucle de eventos. */
const STAT_EN_VUELO = 32

/** Un tramo de ruta que se puede escribir tal cual en cualquier sistema y no sube ni salta a otra raíz. */
export function tramoSeguro(t: string): boolean {
  if (t === '' || t === '.' || t === '..' || t.length > 255) return false
  if (/[\\/:*?"<>|]/.test(t) || /[. ]$/.test(t) || [...t].some((c) => c.charCodeAt(0) < 0x20)) return false
  return !RESERVADOS.test(t)
}

/** ¿Es una conversación de ese agente esta ruta relativa a la carpeta de la cuenta (con `/`)? */
export function esConversacion(agente: AgenteHistorial, rel: string): boolean {
  const tramos = rel.split('/')
  if (!tramos.every(tramoSeguro)) return false
  const nombre = tramos[tramos.length - 1]
  if (agente === 'codex') return tramos[0] === 'sessions' && tramos.length >= 2 && /^rollout-.*\.jsonl(\.zst)?$/.test(nombre)
  if (tramos[0] !== 'projects' || !nombre.endsWith('.jsonl')) return false
  return tramos.length === 3 || (tramos.length >= 5 && tramos[3] === 'subagents')
}

/** La conversación en sí (no el hilo de un subagente): la que se cuenta. */
export function esPrincipal(agente: AgenteHistorial, rel: string): boolean {
  return agente === 'codex' || rel.split('/').length === 3
}

/** Un archivo de conversación de una cuenta. */
export interface ArchivoHistorial {
  /** Relativa a la carpeta de la cuenta, con `/`. */
  rel: string
  abs: string
  bytes: number
}

/** Bajo `dir`, las rutas relativas de los archivos regulares; los enlaces simbólicos no se siguen ni se cuentan. */
async function recorrer(dir: string, rel: string, fuera: string[]): Promise<void> {
  let entradas
  try {
    entradas = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entradas) {
    const r = rel === '' ? e.name : `${rel}/${e.name}`
    if (e.isDirectory()) await recorrer(path.join(dir, e.name), r, fuera)
    else if (e.isFile()) fuera.push(r)
  }
}

/** Las conversaciones de la carpeta de una cuenta, con su tamaño; ninguna si la carpeta no existe. */
export async function listarConversaciones(agente: AgenteHistorial, base: string): Promise<ArchivoHistorial[]> {
  const raiz = agente === 'codex' ? 'sessions' : 'projects'
  const rels: string[] = []
  await recorrer(path.join(base, raiz), raiz, rels)
  const elegidas = rels.filter((r) => esConversacion(agente, r)).sort()
  const leidas = await mapaConTope(elegidas, STAT_EN_VUELO, async (rel): Promise<ArchivoHistorial | null> => {
    const abs = path.join(base, ...rel.split('/'))
    try {
      return { rel, abs, bytes: (await stat(abs)).size }
    } catch {
      return null // borrado entre el listado y aquí
    }
  })
  return leidas.filter((a): a is ArchivoHistorial => a !== null)
}

/** Lo que vive una lista en la caché de la vista previa: lo que tarda alguien en marcar y desmarcar perfiles. */
const VIDA_PREVIA_MS = 30_000

/**
 * `listarConversaciones` con la lista de cada carpeta guardada un rato: la vista previa del diálogo de exportar
 * se pide en cada clic y no vuelve a recorrer lo que acaba de recorrer. Exportar lista siempre de nuevo.
 */
export function listarConCache(ahora: () => number = Date.now): typeof listarConversaciones {
  const cache = new Map<string, { hasta: number; lista: Promise<ArchivoHistorial[]> }>()
  return (agente, base) => {
    const clave = `${agente}\0${base}`
    const t = ahora()
    for (const [k, v] of cache) if (v.hasta <= t) cache.delete(k)
    const hay = cache.get(clave)
    if (hay) return hay.lista
    const lista = listarConversaciones(agente, base)
    cache.set(clave, { hasta: t + VIDA_PREVIA_MS, lista })
    lista.catch(() => cache.delete(clave))
    return lista
  }
}
