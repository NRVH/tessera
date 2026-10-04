// =============================================================================
// Tintas de los perfiles para la ventana: la del perfil activo (de ella cuelga
// `--perfil`), la del resaltado de búsquedas a luminosidad legible y la de cada
// perfil para el cursor de sus terminales. Un color que no es hex no se publica.
// =============================================================================
import { useMemo } from 'react'
import { hexARgb, tintaPerfil, tintaResaltado } from './colorPerfil'
import type { UseTabs } from './useTabs'

/** Tintas del perfil activo y de todos los perfiles. */
export interface TintasPerfil {
  tintaPerfilActivo: string | null
  resaltadoPerfil: string | null
  tintasPorPerfil: Record<string, string>
}

/** Tintas derivadas de los colores de los perfiles. */
export function useTintasPerfil(tabs: UseTabs): TintasPerfil {
  const color = tabs.activeProfile?.color
  // Una variable con valor inválido no cae al fallback del `var()`: se descarta aquí.
  const tintaPerfilActivo = useMemo(() => {
    if (!color) return null
    if (hexARgb(color) === null) return null
    return tintaPerfil(color)
  }, [color])
  const resaltadoPerfil = useMemo(() => {
    if (!color) return null
    const tinta = tintaResaltado(color)
    return /^#[0-9a-f]{6}$/i.test(tinta) ? tinta : null
  }, [color])
  // Los panes de shell viven para todos los perfiles a la vez: cada uno necesita la suya.
  const tintasPorPerfil = useMemo(() => {
    const m: Record<string, string> = {}
    for (const p of tabs.profiles) if (p.color) m[p.id] = tintaPerfil(p.color)
    return m
  }, [tabs.profiles])
  return { tintaPerfilActivo, resaltadoPerfil, tintasPorPerfil }
}
