// =============================================================================
// useRenombrarPerfil: estado del renombrado inline de una pestaña de perfil (id que se
// edita y borrador). Lo llama `useBandaPerfiles` (la banda y el selector del modo minimalista),
// que le pasa cómo cerrar el menú contextual. Depende del tipo `Profile` del main.
// =============================================================================
import { useState } from 'react'
import type { Perfil } from '../../../../main/perfiles/types'

interface OpcionesRenombrar {
  onRenombrarPerfil: (perfilId: string, nombre: string) => void
  cerrarMenu: () => void
}

/** Renombrado inline: `renombrandoId` es la pestaña (o la fila del selector) en edición y `draft` su texto. */
export function useRenombrarPerfil({ onRenombrarPerfil, cerrarMenu }: OpcionesRenombrar): {
  renombrandoId: string | null
  borrador: string
  setBorrador: (texto: string) => void
  iniciarRenombrado: (perfil: Perfil) => void
  confirmarRenombrado: () => void
  cancelarRenombrado: () => void
} {
  const [renombrandoId, setRenombrandoId] = useState<string | null>(null)
  const [borrador, setBorrador] = useState('')

  function iniciarRenombrado(perfil: Perfil): void {
    cerrarMenu()
    setRenombrandoId(perfil.id)
    setBorrador(perfil.nombre)
  }
  function confirmarRenombrado(): void {
    if (renombrandoId !== null) onRenombrarPerfil(renombrandoId, borrador)
    setRenombrandoId(null)
  }
  function cancelarRenombrado(): void {
    setRenombrandoId(null)
  }

  return { renombrandoId, borrador, setBorrador, iniciarRenombrado, confirmarRenombrado, cancelarRenombrado }
}
