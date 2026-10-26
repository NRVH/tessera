// =============================================================================
// Contrato IPC del estado de Docker: el main avisa cuando deja de responder y cuando vuelve, para
// que las sesiones que esperaban a Docker se recuperen solas, y dice qué recursos tiene (el semáforo).
// Decisiones: docs/decisiones/sandbox/supervisor-de-contenedores.md
// =============================================================================

/** ¿Responde Docker? Lo sabe el supervisor de contenedores del main. */
export type EstadoDocker = 'disponible' | 'caido'

/** Canales de la disponibilidad de Docker. */
export const SANDBOX_ESTADO_CHANNELS = {
  /** main -> renderer: Docker cambió de disponibilidad. EstadoDocker. */
  DOCKER: 'sandbox:estado:docker',
  /** invoke: la memoria y los núcleos de Docker y los contenedores que corren. void -> RecursosDocker. */
  RECURSOS: 'sandbox:estado:recursos'
} as const

/** Lo que el semáforo del límite necesita saber de Docker en este equipo. */
export interface RecursosDocker {
  /** La memoria que tiene Docker (la de su máquina virtual en Windows y macOS); null si no responde. */
  memoriaBytes: number | null
  cpus: number | null
  /** Contenedores de Tessera que corren ahora (los de perfil y los de cuenta). */
  vivos: number
}
