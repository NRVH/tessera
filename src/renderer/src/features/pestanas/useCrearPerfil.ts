// =============================================================================
// useCrearPerfil: estado del popover de creación de perfil (posición, nombre y color) y
// el botón "+" que lo ancla. Lo llama `PestanasPerfil`. El color inicial sale de
// `paletaPerfiles`, módulo puro aparte para que su prueba corra con `node` sin JSX.
// =============================================================================
import { useRef, useState } from 'react'
import type { Perfil } from '../../../../main/perfiles/types'
import { colorPorDefecto } from './paletaPerfiles'

function elegirColorDefecto(perfiles: Perfil[]): string {
  return colorPorDefecto(perfiles.map((p) => p.color))
}

/** Creación de perfil: `creating` es la posición del popover (null = cerrado). */
export function useCrearPerfil(
  perfiles: Perfil[],
  onAnadirPerfil: (nombre: string, color: string) => void
): {
  posicionCreacion: { x: number; y: number } | null
  nombreNuevo: string
  colorNuevo: string
  setNombreNuevo: (v: string) => void
  setColorNuevo: (v: string) => void
  botonAnadirRef: React.RefObject<HTMLButtonElement>
  abrirCreacion: () => void
  enviarCreacion: () => void
  cancelarCreacion: () => void
} {
  const [posicionCreacion, setPosicionCreacion] = useState<{ x: number; y: number } | null>(null)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [colorNuevo, setColorNuevo] = useState('#61afef')
  const botonAnadirRef = useRef<HTMLButtonElement>(null)

  function abrirCreacion(): void {
    const rect = botonAnadirRef.current?.getBoundingClientRect()
    // Que quepa en la ventana lo decide el popover, que conoce su ancho real (`CrearPerfilPopover`).
    const izquierda = rect ? rect.left : 100
    setNombreNuevo('')
    setColorNuevo(elegirColorDefecto(perfiles))
    setPosicionCreacion({ x: izquierda, y: rect ? rect.bottom + 4 : 44 })
  }
  function enviarCreacion(): void {
    if (nombreNuevo.trim() === '') return
    onAnadirPerfil(nombreNuevo.trim(), colorNuevo)
    setPosicionCreacion(null)
  }
  function cancelarCreacion(): void {
    setPosicionCreacion(null)
  }

  return {
    posicionCreacion,
    nombreNuevo,
    colorNuevo,
    setNombreNuevo,
    setColorNuevo,
    botonAnadirRef,
    abrirCreacion,
    enviarCreacion,
    cancelarCreacion
  }
}
