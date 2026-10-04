// =============================================================================
// Agente que se muestra de un perfil: el elegido por el usuario si es válido y, si
// no, el primero disponible. Los agentes son fijos del producto (iguales en todo
// perfil). Puro: lo usan la columna, los puntos de proyecto y el mosaico.
// =============================================================================
import { AGENTES_DISPONIBLES, type Agente } from '../../../../main/profiles/types'

/** Agente a mostrar para un perfil; null si no hay perfil. */
export function resolveSelectedAgent(
  profileId: string | null,
  selectedByProfile: Record<string, Agente>
): Agente | null {
  if (!profileId) return null
  const sel = selectedByProfile[profileId]
  if (sel && AGENTES_DISPONIBLES.includes(sel)) return sel
  return AGENTES_DISPONIBLES[0]
}
