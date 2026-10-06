// =============================================================================
// Escaneo de los repos git de una carpeta abierta: la raíz si lo es y los repos que cuelgan de ella
// (un `.git` directorio o archivo: worktrees y submódulos; solo se mira su presencia). Hasta dónde se
// baja lo decide `shared/reposAnidados.ts`: en una raíz que es repo, solo sus hijos directos; en una
// que no, varios niveles, sin entrar en un repo ya encontrado ni en dependencias o compilados.
// Nunca lanza `git`: `readdir` y `stat` asíncronos con tope de concurrencia propio (`mapaConTope`) y
// un tope de carpetas leídas, porque corre en un handler IPC que el renderer re-dispara con cada
// ráfaga del watcher y cada foco de la ventana. Lo usa `WorkspaceService`; `test-scan-repos.mts` lo fija.
// =============================================================================

import { readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import type { DetectedRepo } from '../../shared/workspace-ipc'
import { profundidadDeRepos, seBajaA } from '../../shared/reposAnidados.ts'
import { mapaConTope } from '../util/mapaConTope.ts'

export type { DetectedRepo }

/**
 * `stat` en vuelo a la vez: el mismo tope medido para la cola de git, que deja el retraso del
 * bucle de eventos en decenas de ms. No se reutiliza esa cola a propósito: es global y la
 * comparten los spawns de git, y mil `stat` dejarían a git sin plazas.
 */
const TOPE_STAT = 16

/**
 * Carpetas que se leen como mucho en un escaneo. Con la carpeta padre de muchos proyectos abierta,
 * bajar varios niveles sin tope sería leer media unidad; lo que quede más allá no se ofrece.
 */
export const TOPE_CARPETAS_LEIDAS = 2000

/** ¿Existe `<dir>/.git` (como directorio O como archivo)? Nunca lanza. */
async function hasGitEntry(dir: string): Promise<boolean> {
  try {
    // stat sigue el `.git` sea dir o archivo; si no existe, lanza -> false.
    await stat(path.join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/** Una carpeta por leer: su ruta absoluta y la relativa a la raíz (POSIX), para ordenar. */
interface Pendiente {
  abs: string
  rel: string
}

/** Lo que sale de mirar una subcarpeta: un repo, una carpeta a la que bajar, o nada. */
type Hallazgo = { repo: DetectedRepo; rel: string } | { bajar: Pendiente } | null

/**
 * Escanea `projectHostPath` y devuelve los repos detectados: primero la raíz (si lo es) y luego los
 * de dentro, ordenados por su ruta relativa de forma estable (los de una misma carpeta quedan
 * juntos). Si la carpeta no existe o es ilegible, devuelve lista vacía.
 */
export async function scanRepos(projectHostPath: string): Promise<DetectedRepo[]> {
  const root = path.resolve(projectHostPath)
  const repos: DetectedRepo[] = []

  // (a) ¿La propia carpeta abierta es un repo? (el caso de "hoy": un solo repo)
  const raizEsRepo = await hasGitEntry(root)
  if (raizEsRepo) {
    repos.push({ name: path.basename(root), repoHostPath: root, isRoot: true })
  }

  // (b) Los repos de dentro, nivel a nivel.
  const hijos: { repo: DetectedRepo; rel: string }[] = []
  const profundidad = profundidadDeRepos(raizEsRepo)
  let nivel: Pendiente[] = [{ abs: root, rel: '' }]
  let leidas = 0
  for (let n = 1; n <= profundidad && nivel.length > 0; n++) {
    const aLeer = nivel.slice(0, Math.max(0, TOPE_CARPETAS_LEIDAS - leidas))
    leidas += aLeer.length
    const listados = await mapaConTope(aLeer, TOPE_STAT, async (dir) => ({ dir, entradas: await leerCarpeta(dir.abs) }))
    const candidatas = listados.flatMap(({ dir, entradas }) => entradas.filter((e) => e.name !== '.git').map((e) => ({ dir, e })))
    const bajarMas = n < profundidad
    const hallazgos = await mapaConTope(candidatas, TOPE_STAT, async ({ dir, e }): Promise<Hallazgo> => {
      const abs = path.join(dir.abs, e.name)
      const rel = dir.rel === '' ? e.name : `${dir.rel}/${e.name}`
      if (!(await isDirLike(e, abs))) return null
      if (await hasGitEntry(abs)) return { repo: { name: e.name, repoHostPath: abs, isRoot: false }, rel }
      // Por un enlace no se baja: un repo enlazado sí cuenta, pero seguirlos podría dar vueltas.
      return bajarMas && e.isDirectory() && seBajaA(e.name) ? { bajar: { abs, rel } } : null
    })
    nivel = []
    for (const h of hallazgos) {
      if (h === null) continue
      if ('repo' in h) hijos.push(h)
      else nivel.push(h.bajar)
    }
  }

  // Orden estable por ruta relativa (la raíz, si está, va primero).
  hijos.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  repos.push(...hijos.map((h) => h.repo))
  return repos
}

/** Entradas de una carpeta, o ninguna si no existe o no se puede leer. */
async function leerCarpeta(abs: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * ¿La entrada es una carpeta (o un symlink que apunta a una)? Con `withFileTypes`
 * un symlink se reporta como symlink; resolvemos su tipo con un `stat` extra
 * (que sigue el enlace) solo en ese caso, para no perder repos enlazados.
 */
async function isDirLike(entry: import('node:fs').Dirent, absPath: string): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (entry.isSymbolicLink()) {
    try {
      return (await stat(absPath)).isDirectory()
    } catch {
      return false
    }
  }
  return false
}
