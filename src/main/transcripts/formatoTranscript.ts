// =============================================================================
// Metadatos de la cabecera de un transcript: de qué proyecto es (`cwd`) y si es de un subagente.
// Criterio único para el anillo de contexto, el vigilante de turnos y el historial: dos copias
// divergirían sin que nada falle.
// La detección de subagentes de Codex es positiva (tres señales cualesquiera) y no exige
// `thread_source: 'user'`, para que un CLI viejo no deje al usuario sin anillo. Módulo puro.
// Decisiones: docs/decisiones/agentes/turnos-marcas-del-transcript.md
// =============================================================================

import type { LineaJsonl } from '../util/jsonlCola.ts'
import type { AgenteTranscript } from './marcasTurno.ts'

export interface MetaTranscript {
  /** Directorio de trabajo declarado; null si el transcript no lo dice. */
  cwd: string | null
  /** Rollout de subagente de Codex (ver cabecera). Siempre false en Claude Code. */
  subagente: boolean
}

/** ¿El `session_meta` de un rollout de Codex dice que es de un SUBAGENTE? */
export function esRolloutDeSubagente(sessionMeta: Record<string, unknown>): boolean {
  if (sessionMeta.thread_source === 'subagent') return true
  if (typeof sessionMeta.parent_thread_id === 'string') return true
  const source = sessionMeta.source
  return typeof source === 'object' && source !== null && 'subagent' in source
}

/**
 * Metadatos a partir de las primeras líneas del transcript. En Codex todo vive en la
 * PRIMERA línea (`session_meta`): si no lo trae, no lo traerá nadie. En Claude Code el
 * `cwd` se repite en cada línea y basta la primera que lo declare.
 */
export function metaDeCabecera(agente: AgenteTranscript, lineas: LineaJsonl[]): MetaTranscript {
  if (agente === 'codex') {
    for (const obj of lineas) {
      if (obj.type !== 'session_meta') continue
      const p = obj.payload
      if (!p) break
      return {
        cwd: typeof p.cwd === 'string' ? p.cwd : null,
        subagente: esRolloutDeSubagente(p)
      }
    }
    return { cwd: null, subagente: false }
  }
  for (const obj of lineas) {
    if (typeof obj.cwd === 'string') return { cwd: obj.cwd, subagente: false }
  }
  return { cwd: null, subagente: false }
}
