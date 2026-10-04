// =============================================================================
// useCrearPerfil: estado del popover de creación de perfil (posición, nombre y color) y
// el botón "+" que lo ancla. Lo llama `ProfileTabs`. El color inicial sale de
// `paletaPerfiles`, módulo puro aparte para que su prueba corra con `node` sin JSX.
// =============================================================================
import { useRef, useState } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import { colorPorDefecto } from './paletaPerfiles'

function pickDefaultColor(profiles: Profile[]): string {
  return colorPorDefecto(profiles.map((p) => p.color))
}

/** Creación de perfil: `creating` es la posición del popover (null = cerrado). */
export function useCrearPerfil(
  profiles: Profile[],
  onAddProfile: (nombre: string, color: string) => void
): {
  creating: { x: number; y: number } | null
  newName: string
  newColor: string
  setNewName: (v: string) => void
  setNewColor: (v: string) => void
  addBtnRef: React.RefObject<HTMLButtonElement>
  openCreate: () => void
  submitCreate: () => void
  cancelCreate: () => void
} {
  const [creating, setCreating] = useState<{ x: number; y: number } | null>(null)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#61afef')
  const addBtnRef = useRef<HTMLButtonElement>(null)

  function openCreate(): void {
    const rect = addBtnRef.current?.getBoundingClientRect()
    const width = 240
    const left = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) : 100
    setNewName('')
    setNewColor(pickDefaultColor(profiles))
    setCreating({ x: left, y: rect ? rect.bottom + 4 : 44 })
  }
  function submitCreate(): void {
    if (newName.trim() === '') return
    onAddProfile(newName.trim(), newColor)
    setCreating(null)
  }
  function cancelCreate(): void {
    setCreating(null)
  }

  return {
    creating,
    newName,
    newColor,
    setNewName,
    setNewColor,
    addBtnRef,
    openCreate,
    submitCreate,
    cancelCreate
  }
}
