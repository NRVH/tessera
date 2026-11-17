// =============================================================================
// useReglasPerfil: «Reglas para los agentes…» del menú de un perfil abre el contexto de los agentes en las
// reglas de ese perfil. Antes pregunta si hay una propuesta pendiente (el aviso pudo perderse), para que el
// diálogo la ofrezca. Cómo se abre el contexto llega de quien compone la banda: la feature de agentes ya
// depende de esta, y esta no puede depender de aquella. Lo llama `useAccionesPerfil`.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import { refrescarPropuesta } from './storePropuestasReglas'

/** Lo que expone el hook. */
export interface AccionesReglas {
  abrirReglas: (perfilId: string) => void
}

export function useReglasPerfil(onAbrirReglas: (perfilId: string) => void): AccionesReglas {
  return {
    abrirReglas: (perfilId) => {
      void refrescarPropuesta(perfilId)
      onAbrirReglas(perfilId)
    }
  }
}
