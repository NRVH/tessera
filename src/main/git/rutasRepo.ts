// =============================================================================
// Traducción de rutas entre el espacio del renderer (POSIX, relativo a la CONTENEDORA) y el
// de git (relativo a la raíz del repo), y la guarda anti-traversal antes de tocar disco.
// Puro: sin electron ni git. Lo usan `NucleoGit` y las operaciones de git del main.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import * as path from 'node:path'
import { normalizarRelativaProyecto } from '../../shared/rutasHost'
import type { RepoCtx } from './tipos'

/** Normaliza un `path.relative` a POSIX; "." se colapsa a "" (misma carpeta). */
export function toPosixRel(rel: string): string {
  const posix = rel.split(path.sep).join('/')
  return posix === '.' ? '' : posix
}

/** ¿El tramo relativo apunta FUERA (sube con "..") o no es relativo en absoluto? */
export function isOutward(rel: string): boolean {
  return rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)
}

/** Ruta del renderer YA normalizada que, por su forma, nombra un archivo: solo la crea `relDeArchivo`. */
export type RelArchivo = string & { readonly __marca: 'RelArchivo' }

/**
 * La ruta del renderer normalizada, o `null` si por su FORMA no nombra un archivo: vacía, `.`,
 * con un tramo `..` o con barra final (una carpeta: su pathspec casa todo lo de debajo). Pura:
 * va antes de resolver el repo y de tomar el candado. Una carpeta SIN barra no se distingue por
 * la forma; eso lo decide `ls-files` en cada operación. Los blancos de los extremos solo cuentan
 * para decidir si está vacía: no se recortan del nombre (`a.txt ` es otro archivo que `a.txt`).
 */
export function relDeArchivo(relPosix: string): RelArchivo | null {
  const rel = normalizarRelativaProyecto(relPosix)
  const forma = rel.trim()
  if (forma === '' || forma === '.' || forma.endsWith('/') || forma.split('/').includes('..')) {
    return null
  }
  return rel as RelArchivo
}

/**
 * La ruta en el REPO del archivo, o `null` si traduce a '' (la ruta igual al prefijo de un
 * multi-repo): tras `:(top,literal)` sería el repo ENTERO. Con `relDeArchivo` antes, es la
 * invariante «el pathspec nombra UN archivo» en un solo sitio para preparar, quitar y descartar.
 */
export function repoPathDeArchivo(rel: RelArchivo, ctx: RepoCtx): string | null {
  const repoPath = traducirARepo(rel, ctx)
  return repoPath === '' ? null : repoPath
}

/**
 * Clave para comparar una ruta que devuelve git con la pedida: git imprime el nombre del índice,
 * en NFC aunque el disco lo tenga descompuesto (macOS) y con la caja del índice aunque el sistema
 * no distinga mayúsculas. El casado ya lo hizo git; la clave solo sirve para reconocerlo.
 */
export function claveNombreGit(p: string): string {
  return p.normalize('NFC').toLowerCase()
}

/** ¿La ruta que devuelve git es el archivo pedido? (ver `claveNombreGit`). */
export function mismoNombreGit(deGit: string, pedido: string): boolean {
  return claveNombreGit(deGit) === claveNombreGit(pedido)
}

/**
 * Deriva la traducción de rutas de un repo según dónde cuelgue de la contenedora: coinciden
 * (identidad), repo dentro (`prefix`, multi-repo) o contenedora dentro del repo (`inner`,
 * monorepo). Ante cualquier otra topología cae a identidad, que es el lado seguro.
 */
export function derivePrefixes(
  contenedora: string | null,
  repoRoot: string
): { prefix: string; inner: string } {
  if (contenedora === null) return { prefix: '', inner: '' }

  const down = toPosixRel(path.relative(contenedora, repoRoot))
  if (down === '') return { prefix: '', inner: '' } // coinciden
  if (!isOutward(down)) return { prefix: down, inner: '' } // repo dentro de contenedora

  const up = toPosixRel(path.relative(repoRoot, contenedora))
  if (up !== '' && !isOutward(up)) return { prefix: '', inner: up } // contenedora dentro de repo

  return { prefix: '', inner: '' }
}

/**
 * Ruta relativa a la CONTENEDORA (POSIX) → relativa al REPO. Con `prefix` lo QUITA, con
 * `inner` lo AÑADE; una ruta que no cuelga del repo se deja tal cual (git no la casará).
 * Devuelve '' con una ruta vacía o igual al prefijo: quien la use debe rechazarla.
 */
export function toRepoPath(relPosix: string, ctx: RepoCtx): string {
  return traducirARepo(normalizarRelativaProyecto(relPosix), ctx)
}

/** `toRepoPath` sobre una ruta ya normalizada. */
function traducirARepo(rel: string, ctx: RepoCtx): string {
  if (ctx.inner) return rel ? `${ctx.inner}/${rel}` : ctx.inner
  if (!ctx.prefix) return rel
  if (rel === ctx.prefix) return ''
  const prefixWithSlash = `${ctx.prefix}/`
  return rel.startsWith(prefixWithSlash) ? rel.slice(prefixWithSlash.length) : rel
}

/**
 * Ruta relativa al REPO (como la devuelve git) → relativa a la CONTENEDORA. Devuelve `null`
 * si cae fuera de ella (solo con `inner`): esos archivos se descartan en vez de mostrarse.
 */
export function toProjectPath(repoPosixPath: string, ctx: RepoCtx): string | null {
  if (ctx.prefix) return `${ctx.prefix}/${repoPosixPath}`
  if (!ctx.inner) return repoPosixPath
  if (repoPosixPath === ctx.inner) return ''
  const innerWithSlash = `${ctx.inner}/`
  return repoPosixPath.startsWith(innerWithSlash) ? repoPosixPath.slice(innerWithSlash.length) : null
}

/** Ruta ABSOLUTA de un path relativo al repo, o `null` si escapa de su raíz (anti-traversal). */
export function resolveInsideRepo(repoPath: string, ctx: RepoCtx): string | null {
  const abs = path.resolve(ctx.root, repoPath)
  if (abs !== ctx.root && !abs.startsWith(ctx.root + path.sep)) return null
  return abs
}
