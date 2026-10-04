// =============================================================================
// cacheEstadoRepos: lo último que se supo del working-tree de un OBJETIVO (proyecto
// + lista de repos), para que volver a un perfil no pase por el esqueleto de carga.
// Es una SIEMBRA: la generación sigue subiendo y se vuelve a preguntar todo.
// Reusa el LRU de `cacheGit`, con `.ts` explícito porque entra en la cadena de una
// prueba que corre con `node` a secas.
// Decisiones: docs/decisiones/git/cambios-caches-de-estado.md
// =============================================================================

// `.ts` explícito: este módulo entra en la cadena de una prueba que corre con `node` a secas.
import { cachePut } from './cacheGit.ts'
import type { RepoStatus } from '../../../../../shared/git-ipc.ts'

/** Cuántos objetivos se recuerdan (uno por proyecto y lista de repos): ocho cubren el ir y venir de una sesión. */
export const MAX_OBJETIVOS_RECORDADOS = 8

const recordado = new Map<string, ReadonlyMap<string, RepoStatus>>()

/** Clave de un objetivo; el separador es NUL porque `|` es legal en una ruta de macOS y colisionaría. */
export function claveObjetivoEstado(projectHostPath: string | null, reposKey: string): string {
  return `${projectHostPath ?? ''}\u0000${reposKey}`
}

/** Guarda lo que se sabe de un objetivo (un mapa vacío no se guarda); el desalojo lo hace `cachePut`. */
export function recordarEstadoRepos(clave: string, mapa: ReadonlyMap<string, RepoStatus>): void {
  if (mapa.size === 0) return
  cachePut(recordado, clave, mapa, MAX_OBJETIVOS_RECORDADOS)
}

/** Lo último que se supo de un objetivo, o `undefined` si es la primera visita. */
export function semillaEstadoRepos(clave: string): ReadonlyMap<string, RepoStatus> | undefined {
  return recordado.get(clave)
}


