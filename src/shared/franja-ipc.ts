// =============================================================================
// Identidad de las ventanas de franja y confirmación de cierre tras devolver sus panes.
// El perfil identifica la hija bajo la principal que la abrió.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
export const PREFIJO_MARCO_FRANJA = 'tessera-franja-'

export const CANALES_FRANJA = {
  PEDIR_ACOPLE: 'franja:pedir-acople',
  CERRAR_ACOPLADA: 'franja:cerrar-acoplada',
  TRAER_AL_FRENTE: 'franja:traer-al-frente'
} as const
