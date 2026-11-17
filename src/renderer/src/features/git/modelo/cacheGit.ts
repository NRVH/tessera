// =============================================================================
// cacheGit: cachés a nivel de MÓDULO (sobreviven al desmontaje del panel) de lo que
// cuesta traer por IPC en la vista de git: commits y ramas de la vista sin filtrar
// de cada (repo, rama) y el cursor recordado por repo. Dos topes (entradas y
// commits) y purga por señal explícita (commit, HEAD movido, recargar), no por tiempo.
// Decisiones: docs/decisiones/git/cambios-caches-de-estado.md
// =============================================================================

import type { Rama, Commit } from '../../../../../shared/git-ipc'

/**
 * Tope de commits que se PIDEN por IPC por defecto (`git --max-count`): acota carga,
 * parseo e IPC en repos gigantes. Si se alcanza, la UI ofrece cargar el historial completo.
 */
export const LIMITE_CARGA_POR_DEFECTO = 2000

/**
 * Tope de entradas: sin él, las cachés de módulo crecerían con cada (repo, rama) visitado.
 * Se desaloja la más antigua. 32 y no 12: con varios perfiles y proyectos 12 desalojaba
 * justo el perfil al que se vuelve. Medido: 2000 commits ≈ 592 KB en JSON, un repo normal
 * ≈ 76 KB.
 */
export const MAX_ENTRADAS_CACHE = 32

/**
 * Tope de COMMITS retenidos entre todas las entradas de `commitsCache`. Contar entradas no
 * basta: «cargar todo» hace que UNA sea el repo entero. 60 000 son ~30 MB.
 */
export const MAX_COMMITS_RETENIDOS = 60_000

/** Una página de historial cacheada. `completo` = es el historial COMPLETO, no una página. */
export interface CommitsCacheados {
  commits: Commit[]
  completo: boolean
}

/** Clave: `claveCommits(rutaHostRepo, rama)` de filtrosLog. */
export const commitsCache = new Map<string, CommitsCacheados>()
/** Clave: rutaHostRepo. */
export const cacheRamas = new Map<string, Rama[]>()

/** Lo último que se miraba en un repo: el commit marcado y el archivo marcado dentro de él. */
export interface SeleccionRecordada {
  hash: string
  /** Ruta marcada en el árbol del commit; null si no había ninguna. */
  ruta: string | null
}

/**
 * Dónde se quedó el cursor en cada repo (clave: rutaHostRepo). Vive junto a la lista a la
 * que apunta: el panel se desmonta al cerrar la franja y los dos duran lo mismo. Es por
 * repo y no por (repo, rama) porque un commit suele estar en varias ramas. `purgarRepo`
 * no la toca: el commit que mirabas casi siempre sigue existiendo.
 */
export const seleccionCache = new Map<string, SeleccionRecordada>()

/** Recuerda dónde está el cursor de un repo. Un `hash` vacío no se guarda: limpiar
 *  la selección al filtrar no puede borrar la memoria. */
export function recordarSeleccion(rutaHostRepo: string | null, sel: SeleccionRecordada): void {
  if (rutaHostRepo === null || rutaHostRepo === '' || sel.hash === '') return
  guardarEnCache(seleccionCache, rutaHostRepo, sel)
}

/**
 * Qué selección hay que restaurar al reabrir la vista, o null si no hay ninguna utilizable:
 * un commit recordado puede haber desaparecido (rebase, `--amend`) y restaurarlo dejaría
 * el detalle enseñando un commit invisible.
 */
export function seleccionARestaurar(
  rutaHostRepo: string | null,
  commits: readonly Commit[] | null
): SeleccionRecordada | null {
  if (rutaHostRepo === null || commits === null) return null
  const sel = seleccionCache.get(rutaHostRepo)
  if (sel === undefined) return null
  return commits.some((c) => c.hash === sel.hash) ? sel : null
}

/**
 * Guarda en la caché desalojando la entrada más antigua si se pasa del tope. `max` es
 * parámetro para que `cacheEstadoRepos` reuse la política en vez de copiarla.
 */
export function guardarEnCache<K, V>(cache: Map<K, V>, clave: K, valor: V, max = MAX_ENTRADAS_CACHE): void {
  cache.delete(clave) // re-insertar la mueve al final: la recién usada es la más "nueva"
  cache.set(clave, valor)
  if (cache.size > max) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
}

// Commits retenidos AHORA MISMO, llevados a mano: TODO borrado pasa por `borrarCommits`.
let commitsRetenidos = 0

/** Cuántos commits hay retenidos. Existe para poder AFIRMARLO en la prueba. */
export function totalCommitsRetenidos(): number {
  return commitsRetenidos
}

/** ÚNICO punto que quita una entrada de commits, para que el contador no se olvide. */
function borrarCommits(clave: string): void {
  const previo = commitsCache.get(clave)
  if (previo === undefined) return
  commitsRetenidos -= previo.commits.length
  commitsCache.delete(clave)
}

/**
 * Guarda una página de historial respetando los DOS topes. Desaloja por antigüedad y
 * nunca la entrada recién escrita, aunque ella sola pase del tope de commits: borrar
 * lo que se está mirando sería la peor forma de cumplir el presupuesto.
 */
export function ponerCommits(clave: string, valor: CommitsCacheados): void {
  borrarCommits(clave) // re-insertar la mueve al final (LRU por orden de inserción)
  commitsCache.set(clave, valor)
  commitsRetenidos += valor.commits.length
  for (const k of commitsCache.keys()) {
    if (commitsCache.size <= MAX_ENTRADAS_CACHE && commitsRetenidos <= MAX_COMMITS_RETENIDOS) break
    if (k === clave) continue // nunca la recién guardada
    borrarCommits(k)
  }
}

/** Purga lo cacheado de un repo (commits de todas sus ramas y sus ramas) cuando su historial cambió de verdad. */
export function purgarRepo(rutaHostRepo: string): void {
  const prefijo = `${rutaHostRepo}\n`
  for (const k of [...commitsCache.keys()]) {
    // Por `borrarCommits` (mantiene el contador), sobre una COPIA de las claves.
    if (k.startsWith(prefijo)) borrarCommits(k)
  }
  cacheRamas.delete(rutaHostRepo)
}
