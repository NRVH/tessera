// =============================================================================
// Refcount del montaje de credencial `/agent-config/<tipo>/<cuenta>` por (perfil,
// agente, cuenta). La apertura lo toma ANTES de tocar Docker y el cierre lo suelta; solo
// al llegar a 0 se desmonta. El mapa vive en `NucleoAgente.configRefs`.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import type { Agente } from '../../profiles/types'

/** Clave del refcount de credencial: `${profileId}/${agente}/${accountId}`. */
export function cfgRefKey(profileId: string, agente: Agente, accountId: string): string {
  return `${profileId}/${agente}/${accountId}`
}

/** +1 al refcount de una credencial. */
export function acquireConfigRef(refs: Map<string, number>, key: string): void {
  refs.set(key, (refs.get(key) ?? 0) + 1)
}

/** −1 al refcount; true si llegó a 0 y hay que desmontar la credencial. */
export function releaseConfigRef(refs: Map<string, number>, key: string): boolean {
  const n = (refs.get(key) ?? 0) - 1
  if (n <= 0) {
    refs.delete(key)
    return true
  }
  refs.set(key, n)
  return false
}
