// =============================================================================
// useBandaPerfiles: todo el estado de la banda de perfiles en un solo hook, para que
// `ProfileTabs` quede en composición. Guarda el menú contextual y llama, en este orden,
// a useRenombrarPerfil, useArrastrePerfiles, useCrearPerfil y useAccionesPerfil.
// Depende del tipo `Profile` del main.
// =============================================================================
import { useState } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import { useAccionesPerfil } from './useAccionesPerfil'
import { useArrastrePerfiles } from './useArrastrePerfiles'
import { useCrearPerfil } from './useCrearPerfil'
import { useRenombrarPerfil } from './useRenombrarPerfil'

interface OpcionesBanda {
  profiles: Profile[]
  hideNames?: boolean
  onShowNames?: () => void
  working?: Set<string>
  onAddProfile: (nombre: string, color: string) => void
  onRenameProfile: (profileId: string, nombre: string) => void
  onRecolorProfile: (profileId: string, color: string) => void
  onToggleRedHost: (profileId: string, redHost: boolean) => void
  onDeleteProfile: (profileId: string) => void
  onReorderProfiles: (orderedIds: string[]) => void
  onHibernateProfile: (profileId: string) => void
}

/** Posición del menú contextual y perfil sobre el que se abrió. */
export interface MenuAbierto {
  x: number
  y: number
  profileId: string
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
  const arrastre = useArrastrePerfiles(opciones.profiles, opciones.onReorderProfiles)
  const crear = useCrearPerfil(opciones.profiles, opciones.onAddProfile)
  const acciones = useAccionesPerfil(opciones, cerrarMenu)
  return { menu, setMenu, cerrarMenu, renombrado, arrastre, crear, acciones }
}
