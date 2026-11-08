// =============================================================================
// Contrato IPC del contexto global de los agentes: leerlo y guardarlo desde el diálogo del contexto, y el aviso
// de que cambió (lo puede cambiar una propuesta aceptada en otra ventana). Lo sirve `src/main/contexto/ipc.ts`.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

export const CONTEXTO_CHANNELS = {
  /** invoke: -> ContextoGlobal. */
  LEER: 'contexto:global:leer',
  /** invoke: Partial<ContextoGlobal> -> ContextoGlobal (las partes recibidas sobre lo vigente, ya normalizado). */
  GUARDAR: 'contexto:global:guardar',
  /** main -> renderer: ContextoGlobal. */
  CAMBIO: 'contexto:global:cambio'
} as const
