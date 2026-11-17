// =============================================================================
// useBandaPerfiles: todo el estado de la banda de perfiles en un solo hook, para que
// `PestanasPerfil` quede en composición. Guarda el menú contextual y llama, en este orden,
// a useRenombrarPerfil, useArrastrePerfiles, useCrearPerfil y useAccionesPerfil.
// Depende del tipo `Profile` del main.
// =============================================================================
import { useState } from 'react'
import type { Perfil } from '../../../../main/perfiles/types'
import type { EstadoPuntoPerfil } from './estadosPunto'
import { useAccionesPerfil } from './useAccionesPerfil'
import { useArrastrePerfiles } from './useArrastrePerfiles'
import { useCrearPerfil } from './useCrearPerfil'
import { useRenombrarPerfil } from './useRenombrarPerfil'

interface OpcionesBanda {
  perfiles: Perfil[]
  working?: Set<string>
  /** Estado de hibernación de cada perfil; ausente => activo. */
  estadosPunto?: Record<string, EstadoPuntoPerfil>
  onAnadirPerfil: (nombre: string, color: string) => void
  onRenombrarPerfil: (perfilId: string, nombre: string) => void
  onCambiarColorPerfil: (perfilId: string, color: string) => void
  onAlternarRedHost: (perfilId: string, redHost: boolean) => void
  onAbrirReglas: (perfilId: string) => void
  onEliminarPerfil: (perfilId: string) => void
  onReordenarPerfiles: (idsOrdenados: string[]) => void
  onHibernarPerfil: (perfilId: string) => void
}

/** Posición del menú contextual y perfil sobre el que se abrió. */
export interface MenuAbierto {
  x: number
  y: number
  perfilId: string
}

/** Estado de la banda de perfiles: menú, renombrado, arrastre, creación y diálogos. */
export function useBandaPerfiles(opciones: OpcionesBanda): {
  menu: MenuAbierto | null
  setMenu: (menu: MenuAbierto | null) => void
  cerrarMenu: () => void
  renombrado: ReturnType<typeof useRenombrarPerfil>
  arrastre: ReturnType<typeof useArrastrePerfiles>
  crear: ReturnType<typeof useCrearPerfil>
  acciones: ReturnType<typeof useAccionesPerfil>
} {
  const [menu, setMenu] = useState<MenuAbierto | null>(null)
  const cerrarMenu = (): void => setMenu(null)
  const renombrado = useRenombrarPerfil({ ...opciones, cerrarMenu })
  const arrastre = useArrastrePerfiles(opciones.perfiles, opciones.onReordenarPerfiles)
  const crear = useCrearPerfil(opciones.perfiles, opciones.onAnadirPerfil)
  const acciones = useAccionesPerfil(opciones, cerrarMenu)
  return { menu, setMenu, cerrarMenu, renombrado, arrastre, crear, acciones }
}
