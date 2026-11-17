// =============================================================================
// cacheBlobs: caché y PREFETCH de los blobs de git del visor de diff. Abrir un diff
// pide dos blobs por IPC y arrancar git es caro; el prefetch al pasar el ratón y la
// reutilización de lo ya pedido hacen que el clic se sienta instantáneo. Solo se
// RETIENE lo inmutable (un blob de commit por su hash real): lo mutable comparte la
// petición en vuelo y se descarta al resolver.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { ResultadoBlob } from '../../../../../shared/git-ipc'
import type { LadoDiff } from '../../editor'

/** Tope de entradas del LRU de blobs de commit (inmutables). */
const MAX_ENTRADAS = 40

/** Espera del hover antes de disparar el prefetch (evita tormentas al barrer filas). */
export const PRECARGA_HOVER_MS = 120

/** Tope de prefetch simultáneos; si se llena, el prefetch se descarta (el clic lo traerá). */
const MAX_PRECARGA_SIMULTANEA = 4

// LRU de blobs de COMMIT (inmutables): el orden de inserción es la recencia.
const cache = new Map<string, Promise<ResultadoBlob>>()
// Peticiones EN VUELO de lados mutables: se borran al resolver, así nunca se sirve nada viejo.
const inflight = new Map<string, Promise<ResultadoBlob>>()

const VACIO: ResultadoBlob = { existe: false, contenido: '' }

/** Un lado clasificado: su clave y si es RETENIBLE (commit por hash real). */
interface Classified {
  clave: string
  inmutable: boolean
}

/** ¿`hash` es un SHA real (retenible) y no el ref simbólico móvil `HEAD`? */
function esHashCommitReal(hash: string | undefined): boolean {
  return !!hash && /^[0-9a-f]{7,64}$/i.test(hash)
}

/**
 * Clasifica un lado de un diff del proyecto `raiz`. Devuelve null para 'empty' (no hay git
 * detrás). Las claves mutables llevan la contenedora: la misma ruta relativa existe en varios
 * proyectos y una petición en vuelo de otro no puede servirse aquí.
 */
function classify(lado: LadoDiff, raiz: string): Classified | null {
  switch (lado.origen) {
    case 'empty':
      return null
    case 'commit':
      // Un SHA es único: se comparte entre proyectos y no lleva contenedora. `HEAD` (u otro
      // ref simbólico) se resuelve distinto en cada repo: mutable y con contenedora.
      return esHashCommitReal(lado.hash)
        ? { clave: `c:${lado.hash}:${lado.ruta}`, inmutable: true }
        : { clave: `${raiz}|h:${lado.hash}:${lado.ruta}`, inmutable: false }
    case 'index':
      return { clave: `${raiz}|i:${lado.ruta}`, inmutable: false }
    case 'worktree':
      return { clave: `${raiz}|w:${lado.ruta}`, inmutable: false }
  }
}

/** Lanza la petición IPC cruda que corresponde al `source` del lado. */
function traerCrudo(lado: LadoDiff, raiz: string): Promise<ResultadoBlob> {
  if (lado.origen === 'worktree') return window.tessera.git.leerBlobWorktree(raiz, lado.ruta)
  if (lado.origen === 'index') return window.tessera.git.leerBlobIndice(raiz, lado.ruta)
  // 'commit' (a 'empty' no se llega: se corta antes en traerBlob)
  return window.tessera.git.leerBlobEnCommit(raiz, lado.hash as string, lado.ruta)
}

function desalojarSiHaceFalta(): void {
  while (cache.size > MAX_ENTRADAS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Devuelve el blob de un lado del proyecto `raiz`: del LRU si es inmutable, o la petición en vuelo si es mutable. */
export function traerBlob(lado: LadoDiff, raiz: string): Promise<ResultadoBlob> {
  const c = classify(lado, raiz)
  if (c === null) return Promise.resolve(VACIO)

  if (c.inmutable) {
    const coincidencia = cache.get(c.clave)
    if (coincidencia) {
      cache.delete(c.clave)
      cache.set(c.clave, coincidencia) // pasa a ser el más reciente
      return coincidencia
    }
    const p = traerCrudo(lado, raiz).catch((err: unknown) => {
      cache.delete(c.clave) // un fallo no se cachea
      throw err
    })
    cache.set(c.clave, p)
    desalojarSiHaceFalta()
    return p
  }

  // Mutable: dedupe SOLO en vuelo; al asentarse se elimina y el siguiente open relee.
  const pendiente = inflight.get(c.clave)
  if (pendiente) return pendiente
  const p = traerCrudo(lado, raiz).finally(() => {
    inflight.delete(c.clave)
  })
  inflight.set(c.clave, p)
  return p
}

let precargasActivas = 0
function precargarUno(lado: LadoDiff, raiz: string): void {
  // El lado de disco lo presta el registro de modelos (files.leerArchivo), no esta caché, y
  // leer un archivo no paga el arranque de git: precalentarlo sería una lectura que
  // nadie consume.
  if (lado.origen === 'worktree') return
  const c = classify(lado, raiz)
  if (c === null) return
  // Ya listo o ya en camino: engancha gratis, sin ocupar cupo de concurrencia.
  if ((c.inmutable && cache.has(c.clave)) || inflight.has(c.clave)) {
    void traerBlob(lado, raiz).catch(() => {})
    return
  }
  if (precargasActivas >= MAX_PRECARGA_SIMULTANEA) return // best-effort: el clic lo traerá
  precargasActivas++
  void traerBlob(lado, raiz)
    .catch(() => {})
    .finally(() => {
      precargasActivas--
    })
}

/** Precalienta AMBOS lados de un diff del proyecto `raiz` en background (best-effort: los errores se tragan). */
export function precargarDiff(antes: LadoDiff, despues: LadoDiff, raiz: string): void {
  precargarUno(antes, raiz)
  precargarUno(despues, raiz)
}
