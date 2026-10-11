// =============================================================================
// useRenombrarPerfil: estado del renombrado inline de una pestaña de perfil (id que se
// edita y borrador). Lo llama `useBandaPerfiles` (la banda y el selector del modo minimalista),
// que le pasa cómo cerrar el menú contextual. Depende del tipo `Profile` del main.
// =============================================================================
import { useState } from 'react'
import type { Profile } from '../../../../main/profiles/types'

interface OpcionesRenombrar {
  onRenameProfile: (profileId: string, nombre: string) => void
  cerrarMenu: () => void
}

/** Renombrado inline: `renamingId` es la pestaña (o la fila del selector) en edición y `draft` su texto. */
export function useRenombrarPerfil({ onRenameProfile, cerrarMenu }: OpcionesRenombrar): {
  renamingId: string | null
  draft: string
  setDraft: (texto: string) => void
  startRename: (profile: Profile) => void
  commitRename: () => void
  cancelRename: () => void
} {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startRename(profile: Profile): void {
    cerrarMenu()
    setRenamingId(profile.id)
    setDraft(profile.nombre)
  }
  function commitRename(): void {
    if (renamingId !== null) onRenameProfile(renamingId, draft)
    setRenamingId(null)
  }
  function cancelRename(): void {
    setRenamingId(null)
  }

  return { renamingId, draft, setDraft, startRename, commitRename, cancelRename }
}
