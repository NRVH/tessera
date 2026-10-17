// =============================================================================
// Agente que se muestra de un perfil: el elegido por el usuario si está entre los disponibles
// de ese sitio y, si no, el primero. Los disponibles dependen del proyecto (su modo y lo que el
// perfil ocultó): por defecto, los de serie. Puro: lo usan la columna, los puntos de proyecto y
// el mosaico.
// =============================================================================
import type { IdAgente } from '../../../../shared/agentesManuales'
import { AGENTES_DE_SERIE, agenteAMostrar } from './agentesDelProyecto.ts'

/** Agente a mostrar para un perfil entre `disponibles`; null si no hay perfil o no hay ninguno. */
export function resolveSelectedAgent(
  profileId: string | null,
  selectedByProfile: Record<string, IdAgente>,
  disponibles: readonly IdAgente[] = AGENTES_DE_SERIE
): IdAgente | null {
  if (!profileId) return null
  return agenteAMostrar(disponibles, selectedByProfile[profileId])
}
