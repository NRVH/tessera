// =============================================================================
// Contrato IPC del registro de salud: lo que la ventana le cuenta al main de sí misma (solo en
// alpha). Solo renderer -> main, sin respuesta: el main sanea y anota (`RegistroSalud`).
// Decisiones: docs/decisiones/app/registro-de-salud.md
// =============================================================================

export const SALUD_CHANNELS = {
  /** renderer->main: lo que le fue lento a la ventana en un periodo (`ResumenRenderer`). */
  RENDERER: 'salud:renderer',
  /** renderer->main: la ventana quedó tapada o vuelve a verse ('tapada' | 'a-la-vista'). */
  VISIBILIDAD: 'salud:visibilidad'
} as const
