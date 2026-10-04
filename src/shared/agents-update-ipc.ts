// =============================================================================
// Contrato IPC de «Actualizar agentes» del modo Docker: los CLI vienen horneados en la imagen
// y el self-update dentro del contenedor no persiste, así que se rehornea la imagen sin caché
// y se recrean los contenedores (los paneles se recuperan solos).
//   invoke RUN -> AgentsUpdateResult; send PROGRESS (líneas del build).
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================

/** Canales de «Actualizar agentes». */
export const AGENTS_UPDATE_CHANNELS = {
  /** invoke: reconstruye la imagen y recrea contenedores. -> AgentsUpdateResult. */
  RUN: 'agentsUpdate:run',
  /** send (main -> renderer): línea de progreso del build/recreación. AgentsUpdateProgress. */
  PROGRESS: 'agentsUpdate:progress'
} as const

/** Resultado de «Actualizar agentes»: las versiones horneadas o el error. */
export interface AgentsUpdateResult {
  ok: boolean
  /** Versión de Codex horneada tras el build (p.ej. "codex-cli 0.143.0"). */
  codex: string
  /** Versión de Claude Code horneada tras el build. */
  claude: string
  /** Mensaje de error si falló. */
  error?: string
}

/** Una línea de progreso del build o de la recreación. */
export interface AgentsUpdateProgress {
  line: string
  /**
   * Principio, final o fallo de un rebuild AUTOMÁTICO (el de `ensureImage`, no el botón),
   * para que el renderer avise aunque el modal esté cerrado; ausente en el resto de líneas.
   */
  fase?: 'inicio' | 'fin' | 'error'
}
