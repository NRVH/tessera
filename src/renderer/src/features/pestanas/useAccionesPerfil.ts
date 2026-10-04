// =============================================================================
// useAccionesPerfil: acciones del menú de un perfil que abren un diálogo o un selector:
// cambiar color, eliminar, hibernar y red del contenedor. Guarda qué diálogo está abierto
// y el input <color> oculto. Lo llama `useBandaPerfiles`; depende del tipo `Profile` del main.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import { useRef, useState } from 'react'
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

export interface AccionesPerfil {
  deleting: Profile | null
  hibernating: HibernacionPendiente | null
  /** Perfil cuyo diálogo de red está abierto. */
  redModal: string | null
  colorInputRef: React.RefObject<HTMLInputElement>
  openColorPicker: (profile: Profile) => void
  requestDelete: (profile: Profile) => void
  requestHibernate: (profile: Profile, trabajando: boolean) => void
  abrirRed: (profileId: string) => void
  cerrarRed: () => void
  aplicarRed: (profile: Profile, redHost: boolean) => void
  elegirColor: (color: string) => void
  confirmarHibernacion: () => void
  cancelarHibernacion: () => void
  confirmarEliminar: () => void
  cancelarEliminar: () => void
}

// Input <color> oculto reutilizado para "Cambiar color" de un perfil existente: se le
// fija el valor y se dispara .click() para abrir el selector nativo.
function useSelectorColor(
  cerrarMenu: () => void,
  onRecolorProfile: (profileId: string, color: string) => void
): Pick<AccionesPerfil, 'colorInputRef' | 'openColorPicker' | 'elegirColor'> {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const colorTargetRef = useRef<string | null>(null)
  return {
    colorInputRef,
    openColorPicker: (profile) => {
      cerrarMenu()
      colorTargetRef.current = profile.id
      const input = colorInputRef.current
      if (input) {
        input.value = profile.color
        input.click()
      }
    },
    elegirColor: (color) => {
      const id = colorTargetRef.current
      if (id) onRecolorProfile(id, color)
    }
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
