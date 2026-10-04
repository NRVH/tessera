// =============================================================================
// blobCache: caché y PREFETCH de los blobs de git del visor de diff. Abrir un diff
// pide dos blobs por IPC y arrancar git es caro; el prefetch al pasar el ratón y la
// reutilización de lo ya pedido hacen que el clic se sienta instantáneo. Solo se
// RETIENE lo inmutable (un blob de commit por su hash real): lo mutable comparte la
// petición en vuelo y se descarta al resolver.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { BlobResult } from '../../../../../shared/git-ipc'
import type { DiffSide } from '../../editor'

// Las claves mutables llevan este ámbito (contenedora + perfil): la misma ruta relativa
// existe en varios proyectos y una petición en vuelo de otro no puede servirse aquí.
/** Ámbito actual: identifica la contenedora (y con ella el perfil) en las claves. */
let ambito = ''

/**
 * Fija el ámbito de la caché. Al CAMBIAR, tira las peticiones en vuelo: sus claves
 * ya no se pueden alcanzar, y dejarlas solo retendría memoria hasta que resuelvan.
 * Idempotente: llamarla con el mismo valor no hace nada.
 */
export function fijarAmbito(clave: string): void {
  if (clave === ambito) return
  ambito = clave
  inflight.clear()
}

/** Tope de entradas del LRU de blobs de commit (inmutables). */
const MAX_ENTRIES = 40

/** Espera del hover antes de disparar el prefetch (evita tormentas al barrer filas). */
export const PREFETCH_HOVER_MS = 120

/** Tope de prefetch simultáneos; si se llena, el prefetch se descarta (el clic lo traerá). */
const MAX_CONCURRENT_PREFETCH = 4

// LRU de blobs de COMMIT (inmutables): el orden de inserción es la recencia.
const cache = new Map<string, Promise<BlobResult>>()
// Peticiones EN VUELO de lados mutables: se borran al resolver, así nunca se sirve nada viejo.
const inflight = new Map<string, Promise<BlobResult>>()

const EMPTY: BlobResult = { exists: false, content: '' }

/** Un lado clasificado: su clave y si es RETENIBLE (commit por hash real). */
interface Classified {
  key: string
  immutable: boolean
}

/** ¿`hash` es un SHA real (retenible) y no el ref simbólico móvil `HEAD`? */
function isRealCommitHash(hash: string | undefined): boolean {
  return !!hash && /^[0-9a-f]{7,64}$/i.test(hash)
}

/** Clasifica un lado. Devuelve null para 'empty' (no hay git detrás). */
function classify(side: DiffSide): Classified | null {
  switch (side.source) {
    case 'empty':
      return null
    case 'commit':
      // Un SHA es único: se comparte entre proyectos y no lleva ámbito. `HEAD` (u otro
      // ref simbólico) se resuelve distinto en cada repo: mutable y con ámbito.
      return isRealCommitHash(side.hash)
        ? { key: `c:${side.hash}:${side.path}`, immutable: true }
        : { key: `${ambito}|h:${side.hash}:${side.path}`, immutable: false }
    case 'index':
      return { key: `${ambito}|i:${side.path}`, immutable: false }
    case 'worktree':
      return { key: `${ambito}|w:${side.path}`, immutable: false }
  }
}

/** Lanza la petición IPC cruda que corresponde al `source` del lado. */
function rawFetch(side: DiffSide): Promise<BlobResult> {
  if (side.source === 'worktree') return window.tessera.git.workingBlob(side.path)
  if (side.source === 'index') return window.tessera.git.indexBlob(side.path)
  // 'commit' (a 'empty' no se llega: se corta antes en fetchBlob)
  return window.tessera.git.blobAtCommit(side.hash as string, side.path)
}

function evictIfNeeded(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Devuelve el blob de un lado: del LRU si es inmutable, o la petición en vuelo si es mutable. */
export function fetchBlob(side: DiffSide): Promise<BlobResult> {
  const c = classify(side)
  if (c === null) return Promise.resolve(EMPTY)

  if (c.immutable) {
    const hit = cache.get(c.key)
    if (hit) {
      cache.delete(c.key)
      cache.set(c.key, hit) // pasa a ser el más reciente
      return hit
    }
    const p = rawFetch(side).catch((err: unknown) => {
      cache.delete(c.key) // un fallo no se cachea
      throw err
    })
    cache.set(c.key, p)
    evictIfNeeded()
    return p
  }

  // Mutable: dedupe SOLO en vuelo; al asentarse se elimina y el siguiente open relee.
  const pending = inflight.get(c.key)
  if (pending) return pending
  const p = rawFetch(side).finally(() => {
    inflight.delete(c.key)
  })
  inflight.set(c.key, p)
  return p
}

let activePrefetch = 0
function prefetchOne(side: DiffSide): void {
  // El lado de disco lo presta el registro de modelos (files.read), no esta caché, y
  // leer un archivo no paga el arranque de git: precalentarlo sería una lectura que
  // nadie consume.
  if (side.source === 'worktree') return
  const c = classify(side)
  if (c === null) return
  // Ya listo o ya en camino: engancha gratis, sin ocupar cupo de concurrencia.
  if ((c.immutable && cache.has(c.key)) || inflight.has(c.key)) {
    void fetchBlob(side).catch(() => {})
    return
  }
  if (activePrefetch >= MAX_CONCURRENT_PREFETCH) return // best-effort: el clic lo traerá
  activePrefetch++
  void fetchBlob(side)
    .catch(() => {})
    .finally(() => {
      activePrefetch--
    })
}

/** Precalienta AMBOS lados de un diff en background (best-effort: los errores se tragan). */
export function prefetchDiff(before: DiffSide, after: DiffSide): void {
  prefetchOne(before)
  prefetchOne(after)
}
