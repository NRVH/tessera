// =============================================================================
// useReglasPerfil: el diálogo de las reglas de un perfil abierto desde su menú. Al abrirlo pregunta si
// hay una propuesta pendiente (el aviso pudo perderse) y, si la hay, el diálogo deja revisarla: se cierra
// y se abre la revisión de `CapaPropuestasReglas`. Lo llama `useAccionesPerfil`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { useState } from 'react'
import { refrescarPropuesta, revisarPropuesta } from './storePropuestasReglas'

/** Lo que expone el hook. */
export interface AccionesReglas {
  /** Perfil cuyo diálogo de reglas para los agentes está abierto. */
  reglasModal: string | null
  abrirReglas: (profileId: string) => void
  cerrarReglas: () => void
  guardarReglas: (profileId: string, reglas: string) => void
  /** Desde el aviso del diálogo: lo cierra y abre la revisión de la propuesta. */
  revisarPropuesta: (profileId: string) => void
}

/** El diálogo de reglas de un perfil: qué perfil lo tiene abierto, cómo se guarda y el paso a la propuesta. */
export function useReglasPerfil(onSetReglas: (profileId: string, reglas: string) => void): AccionesReglas {
  const [reglasModal, setReglasModal] = useState<string | null>(null)
  return {
    reglasModal,
    abrirReglas: (profileId) => {
      setReglasModal(profileId)
      void refrescarPropuesta(profileId)
    },
    cerrarReglas: () => setReglasModal(null),
    guardarReglas: (profileId, reglas) => {
      onSetReglas(profileId, reglas)
      setReglasModal(null)
    },
    revisarPropuesta: (profileId) => {
      setReglasModal(null)
      void revisarPropuesta(profileId)
    }
  }
}
