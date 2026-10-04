// =============================================================================
// Escaneo de repos git de PRIMER NIVEL en una carpeta abierta: la raíz si lo es y cada subcarpeta
// directa con un `.git` (directorio o archivo: worktrees y submódulos; solo se mira su presencia).
// Nunca baja más ni lanza `git`: un `readdir` y un `stat` por candidata, asíncronos y con tope de
// concurrencia propio (`mapaConTope`), porque corre en un handler IPC y el renderer lo re-dispara
// con cada ráfaga del watcher y cada foco de la ventana; síncrono paraba el main hasta segundos
// con la carpeta padre de todos los proyectos. Lo usa `WorkspaceService`; `test-scan-repos.mts` lo fija.
// =============================================================================

import { readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import type { DetectedRepo } from '../../shared/workspace-ipc'
import { mapaConTope } from '../util/mapaConTope.ts'

export type { DetectedRepo }

/**
 * `stat` en vuelo a la vez: el mismo tope medido para la cola de git, que deja el retraso del
 * bucle de eventos en decenas de ms. No se reutiliza esa cola a propósito: es global y la
 * comparten los spawns de git, y mil `stat` dejarían a git sin plazas.
 */
const TOPE_STAT = 16

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

/**
 * Escanea `projectHostPath` y devuelve los repos detectados: primero la raíz (si
 * lo es) y luego cada subcarpeta DIRECTA que sea repo, ordenadas por `name` de
 * forma estable. Si la carpeta no existe o es ilegible, devuelve lista vacía.
 */
export async function scanRepos(projectHostPath: string): Promise<DetectedRepo[]> {
  const root = path.resolve(projectHostPath)
  const repos: DetectedRepo[] = []

  // (a) ¿La propia carpeta abierta es un repo? (el caso de "hoy": un solo repo)
  if (await hasGitEntry(root)) {
    repos.push({ name: path.basename(root), repoHostPath: root, isRoot: true })
  }

  // (b) Subcarpetas DIRECTAS que sean repos. Un único readdir del primer nivel.
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    // Carpeta inexistente / ilegible: solo podemos reportar lo de (a), si algo.
    return repos
  }

  // Candidatas: se descarta por nombre ANTES de tocar el disco. `.git` de la raíz
  // es una entrada más aquí, pero nunca contiene un `.git` anidado, así que no se
  // auto-detecta; aun así lo saltamos explícito por claridad.
  const candidatas = entries.filter((e) => e.name !== '.git')

  const resultados = await mapaConTope(candidatas, TOPE_STAT, async (entry) => {
    const childPath = path.join(root, entry.name)
    if (!(await isDirLike(entry, childPath))) return null
    if (!(await hasGitEntry(childPath))) return null
    return { name: entry.name, repoHostPath: childPath, isRoot: false } as DetectedRepo
  })

  const children = resultados.filter((r): r is DetectedRepo => r !== null)

  // Orden estable de los hijos por name (la raíz, si está, va primero).
  children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  repos.push(...children)
  return repos
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
