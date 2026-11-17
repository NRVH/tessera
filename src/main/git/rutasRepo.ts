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
export function aRelativaPosix(rel: string): string {
  const posix = rel.split(path.sep).join('/')
  return posix === '.' ? '' : posix
}

/** ¿El tramo relativo apunta FUERA (sube con "..") o no es relativo en absoluto? */
export function saleDeLaRaiz(rel: string): boolean {
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
export function rutaRepoDeArchivo(rel: RelArchivo, ctx: RepoCtx): string | null {
  const rutaRepo = traducirARepo(rel, ctx)
  return rutaRepo === '' ? null : rutaRepo
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
 * (identidad), repo dentro (`prefijo`, multi-repo) o contenedora dentro del repo (`interior`,
 * monorepo). Ante cualquier otra topología cae a identidad, que es el lado seguro.
 */
export function derivarPrefijos(
  contenedora: string | null,
  raizRepo: string
): { prefijo: string; interior: string } {
  if (contenedora === null) return { prefijo: '', interior: '' }

  const haciaRepo = aRelativaPosix(path.relative(contenedora, raizRepo))
  if (haciaRepo === '') return { prefijo: '', interior: '' } // coinciden
  if (!saleDeLaRaiz(haciaRepo)) return { prefijo: haciaRepo, interior: '' } // repo dentro de contenedora

  const haciaContenedora = aRelativaPosix(path.relative(raizRepo, contenedora))
  if (haciaContenedora !== '' && !saleDeLaRaiz(haciaContenedora)) return { prefijo: '', interior: haciaContenedora } // contenedora dentro de repo

  return { prefijo: '', interior: '' }
}

/**
 * Ruta relativa a la CONTENEDORA (POSIX) → relativa al REPO. Con `prefijo` lo QUITA, con
 * `interior` lo AÑADE; una ruta que no cuelga del repo se deja tal cual (git no la casará).
 * Devuelve '' con una ruta vacía o igual al prefijo: quien la use debe rechazarla.
 */
export function aRutaRepo(relPosix: string, ctx: RepoCtx): string {
  return traducirARepo(normalizarRelativaProyecto(relPosix), ctx)
}

/** `aRutaRepo` sobre una ruta ya normalizada. */
function traducirARepo(rel: string, ctx: RepoCtx): string {
  if (ctx.interior) return rel ? `${ctx.interior}/${rel}` : ctx.interior
  if (!ctx.prefijo) return rel
  if (rel === ctx.prefijo) return ''
  const prefijoConBarra = `${ctx.prefijo}/`
  return rel.startsWith(prefijoConBarra) ? rel.slice(prefijoConBarra.length) : rel
}

/**
 * Ruta relativa al REPO (como la devuelve git) → relativa a la CONTENEDORA. Devuelve `null`
 * si cae fuera de ella (solo con `interior`): esos archivos se descartan en vez de mostrarse.
 */
export function aRutaProyecto(rutaPosixRepo: string, ctx: RepoCtx): string | null {
  if (ctx.prefijo) return `${ctx.prefijo}/${rutaPosixRepo}`
  if (!ctx.interior) return rutaPosixRepo
  if (rutaPosixRepo === ctx.interior) return ''
  const interiorConBarra = `${ctx.interior}/`
  return rutaPosixRepo.startsWith(interiorConBarra) ? rutaPosixRepo.slice(interiorConBarra.length) : null
}

/** Ruta ABSOLUTA de un path relativo al repo, o `null` si escapa de su raíz (anti-traversal). */
export function resolverDentroDelRepo(rutaRepo: string, ctx: RepoCtx): string | null {
  const abs = path.resolve(ctx.raiz, rutaRepo)
  if (abs !== ctx.raiz && !abs.startsWith(ctx.raiz + path.sep)) return null
  return abs
}
