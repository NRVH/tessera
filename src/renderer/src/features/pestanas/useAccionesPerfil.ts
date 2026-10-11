// =============================================================================
// useAccionesPerfil: acciones del menú de un perfil que abren un diálogo o un selector:
// cambiar color, eliminar, hibernar y red del contenedor. Guarda qué diálogo está abierto
// y dónde se abre el selector de color. Lo llama `useBandaPerfiles`; depende del tipo `Profile` del main.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import { useState } from 'react'
import type { Profile } from '../../../../main/profiles/types'

/**
 * Perfil pendiente de confirmar la hibernación. `redHost` viaja cuando viene de aplicar un
 * cambio de red: el modo se persiste al confirmar, no antes.
 */
export interface HibernacionPendiente {
  profile: Profile
  redHost?: boolean
}

interface OpcionesAcciones {
  /** ids de perfil con alguna sesión trabajando. */
  working?: Set<string>
  onRecolorProfile: (profileId: string, color: string) => void
  onToggleRedHost: (profileId: string, redHost: boolean) => void
  onDeleteProfile: (profileId: string) => void
  onHibernateProfile: (profileId: string) => void
}

/** El selector de color abierto: de qué perfil y dónde (bajo su pestaña). */
export interface SelectorColorAbierto {
  profile: Profile
  x: number
  y: number
}

export interface AccionesPerfil {
  deleting: Profile | null
  hibernating: HibernacionPendiente | null
  /** Perfil cuyo diálogo de red está abierto. */
  redModal: string | null
  selectorColor: SelectorColorAbierto | null
  openColorPicker: (profile: Profile) => void
  cerrarSelectorColor: () => void
  requestDelete: (profile: Profile) => void
  requestHibernate: (profile: Profile, trabajando: boolean) => void
  abrirRed: (profileId: string) => void
  cerrarRed: () => void
  aplicarRed: (profile: Profile, redHost: boolean) => void
  elegirColor: (profileId: string, color: string) => void
  confirmarHibernacion: () => void
  cancelarHibernacion: () => void
  confirmarEliminar: () => void
  cancelarEliminar: () => void
}

/** Ancho del selector de color (`.selector-color`), para centrarlo bajo la pestaña. */
const ANCHO_SELECTOR = 264

/**
 * «Cambiar color» abre el selector bajo la pestaña del perfil, centrado en ella y sin salirse
 * de la ventana. Sin la pestaña a la vista (banda plegada) cae bajo el borde de arriba.
 */
function useSelectorColor(
  cerrarMenu: () => void,
  onRecolorProfile: (profileId: string, color: string) => void
): Pick<AccionesPerfil, 'selectorColor' | 'openColorPicker' | 'cerrarSelectorColor' | 'elegirColor'> {
  const [selectorColor, setSelectorColor] = useState<SelectorColorAbierto | null>(null)
  return {
    selectorColor,
    openColorPicker: (profile) => {
      cerrarMenu()
      const pestana = document.querySelector<HTMLElement>(`.profile-tab[data-perfil-id="${CSS.escape(profile.id)}"]`)
      const caja = pestana?.getBoundingClientRect()
      const centro = caja ? caja.left + caja.width / 2 : window.innerWidth / 2
      const x = Math.max(8, Math.min(window.innerWidth - ANCHO_SELECTOR - 8, centro - ANCHO_SELECTOR / 2))
      // Con la banda plegada la pestaña sigue en el DOM con unos px de alto: el tope de 40 lo
      // saca de debajo de la barra de título.
      setSelectorColor({ profile, x, y: Math.max(caja?.bottom ?? 0, 40) + 6 })
    },
    cerrarSelectorColor: () => setSelectorColor(null),
    elegirColor: onRecolorProfile
  }
}

/** Estado de los diálogos de perfil (eliminar, hibernar, red) y del selector de color. */
export function useAccionesPerfil(
  { working, onRecolorProfile, onToggleRedHost, onDeleteProfile, onHibernateProfile }: OpcionesAcciones,
  cerrarMenu: () => void
): AccionesPerfil {
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const [hibernating, setHibernating] = useState<HibernacionPendiente | null>(null)
  const [redModal, setRedModal] = useState<string | null>(null)
  const selectorColor = useSelectorColor(cerrarMenu, onRecolorProfile)

  // Hibernar mata los ptys del perfil: si hay un agente trabajando se pregunta; si no,
  // se ejecuta directo. Solo el agente es una señal fiable: las terminales de shell no
  // tienen detección de actividad, y el texto del diálogo avisa de que también se cierran.
  function requestHibernate(profile: Profile, trabajando: boolean): void {
    cerrarMenu()
    if (trabajando) setHibernating({ profile })
    else onHibernateProfile(profile.id)
  }

  // Se confirma ANTES de persistir: si se guardara el modo y luego se preguntara, cancelar
  // dejaría el perfil marcado con una red que su contenedor no tiene. Con un agente a mitad
  // de turno se pasa por la misma confirmación que "Hibernar perfil".
  function aplicarRed(profile: Profile, redHost: boolean): void {
    setRedModal(null)
    if (working?.has(profile.id)) setHibernating({ profile, redHost })
    else {
      onToggleRedHost(profile.id, redHost)
      onHibernateProfile(profile.id)
    }
  }

  function confirmarHibernacion(): void {
    if (!hibernating) return
    // El modo de red se persiste AQUÍ, al confirmar, no al pulsar "Aplicar".
    if (hibernating.redHost !== undefined) {
      onToggleRedHost(hibernating.profile.id, hibernating.redHost)
    }
    onHibernateProfile(hibernating.profile.id)
    setHibernating(null)
  }

  function confirmarEliminar(): void {
    if (!deleting) return
    onDeleteProfile(deleting.id)
    setDeleting(null)
  }

  return {
    ...selectorColor,
    deleting,
    hibernating,
    redModal,
    requestDelete: (profile) => {
      cerrarMenu()
      setDeleting(profile)
    },
    requestHibernate,
    abrirRed: setRedModal,
    cerrarRed: () => setRedModal(null),
    aplicarRed,
    confirmarHibernacion,
    cancelarHibernacion: () => setHibernating(null),
    confirmarEliminar,
    cancelarEliminar: () => setDeleting(null)
  }
}
