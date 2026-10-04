// =============================================================================
// Contrato IPC de la hibernación: libera RAM a demanda sin cerrar la app, SOLO por perfil
// (el contenedor es por perfil). Cierra las sesiones del perfil y para su contenedor; nunca
// toca otro perfil. El estado 'hibernated' lo marca y lo persiste el renderer, y
// deshibernar es perezoso: entrar al perfil recrea lo que haga falta.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================

/** Canales de la hibernación. */
export const HIBERNATE_CHANNELS = {
  /** invoke: hiberna un PERFIL entero (todos sus proyectos). HibernateProfileRequest -> HibernateResult. */
  PROFILE: 'hibernate:profile'
} as const

/** Petición para hibernar un perfil entero. */
export interface HibernateProfileRequest {
  profileId: string
}

/** Resultado de una hibernación (de perfil). */
export interface HibernateResult {
  /** ids de las sesiones cerradas (agente + terminal). Vacío si no había ninguna. */
  closedSessionIds: string[]
  /** ¿El contenedor del perfil sigue vivo tras hibernar? Siempre `false` (murió);
   *  el renderer lo usa solo como confirmación/telemetría. */
  containerAlive: boolean
}
