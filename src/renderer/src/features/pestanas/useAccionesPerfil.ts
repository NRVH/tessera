// =============================================================================
// useAccionesPerfil: acciones del menú de un perfil que abren un diálogo o un selector:
// cambiar color, eliminar, hibernar, red del contenedor y reglas para los agentes (`useReglasPerfil`).
// Guarda qué diálogo está abierto y dónde se abre el selector de color. Lo llama `useBandaPerfiles`;
// depende del tipo `Profile` del main.
// Decisiones: docs/decisiones/renderer/red-del-contenedor.md
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import type { TerminalesEnMarcha } from '../../../../shared/terminal-ipc'
import { useReglasPerfil, type AccionesReglas } from './useReglasPerfil'
import { decidirTrasConsulta, type ConfirmacionHibernar, type DecisionTrasConsulta } from './confirmaciones'
import type { ProfileDotState } from './profileDotState'

/** Perfil pendiente de confirmar la hibernación, con lo que el diálogo tiene que nombrar. */
export interface HibernacionPendiente {
  profile: Profile
  confirmacion: ConfirmacionHibernar
}

/** Cambio de red pendiente de confirmar: el modo se persiste al confirmar, no antes. */
export interface RedPendiente {
  profile: Profile
  redHost: boolean
  confirmacion: ConfirmacionHibernar
}

interface OpcionesAcciones {
  /** Los perfiles vivos: al volver una consulta se comprueba que el perfil siga existiendo. */
  profiles?: Profile[]
  /** Hibernación de cada perfil; ausente => activo. */
  dotStates?: Record<string, ProfileDotState>
  /** ids de perfil con alguna sesión trabajando. */
  working?: Set<string>
  onRecolorProfile: (profileId: string, color: string) => void
  onToggleRedHost: (profileId: string, redHost: boolean) => void
  /** Abre el contexto de los agentes en las reglas del perfil. */
  onAbrirReglas: (profileId: string) => void
  onDeleteProfile: (profileId: string) => void
  onHibernateProfile: (profileId: string) => void
}

/** El selector de color abierto: de qué perfil y dónde (bajo su pestaña). */
export interface SelectorColorAbierto {
  profile: Profile
  x: number
  y: number
}

export interface AccionesPerfil extends AccionesReglas {
  clavesSsh: string | null
  abrirClavesSsh: (perfil: string) => void
  cerrarClavesSsh: () => void
  deleting: Profile | null
  hibernating: HibernacionPendiente | null
  /** Perfil cuyo diálogo de red está abierto. */
  redModal: string | null
  /** Cambio de red que espera confirmación (corta un agente o lo que ejecuta una terminal). */
  cambiandoRed: RedPendiente | null
  selectorColor: SelectorColorAbierto | null
  openColorPicker: (profile: Profile) => void
  cerrarSelectorColor: () => void
  requestDelete: (profile: Profile) => void
  requestHibernate: (profile: Profile) => void
  abrirRed: (profileId: string) => void
  cerrarRed: () => void
  aplicarRed: (profile: Profile, redHost: boolean) => void
  elegirColor: (profileId: string, color: string) => void
  confirmarHibernacion: () => void
  cancelarHibernacion: () => void
  confirmarRed: () => void
  cancelarRed: () => void
  confirmarEliminar: () => void
  cancelarEliminar: () => void
}

/** Ancho del selector de color (`.selector-color` en styles.css, igual que «Nuevo perfil»), para centrarlo bajo la pestaña. */
const ANCHO_SELECTOR = 300

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

/**
 * El diálogo de red y su confirmación. Se confirma ANTES de persistir: si se guardara el modo y
 * luego se preguntara, cancelar dejaría el perfil marcado con una red que su contenedor no tiene.
 */
function useCambioRed(
  consultar: Consultar,
  onToggleRedHost: (profileId: string, redHost: boolean) => void,
  onHibernateProfile: (profileId: string) => void
): Pick<AccionesPerfil, 'redModal' | 'cambiandoRed' | 'abrirRed' | 'cerrarRed' | 'aplicarRed' | 'confirmarRed' | 'cancelarRed'> {
  const [redModal, setRedModal] = useState<string | null>(null)
  const [cambiandoRed, setCambiandoRed] = useState<RedPendiente | null>(null)
  // Aplicar la red es reiniciar el contenedor: el perfil se hiberna con el modo nuevo, así que
  // pregunta con la misma regla que «Hibernar el perfil».
  const aplicar = (profileId: string, redHost: boolean): void => {
    onToggleRedHost(profileId, redHost)
    onHibernateProfile(profileId)
  }
  return {
    redModal,
    cambiandoRed,
    abrirRed: setRedModal,
    cerrarRed: () => setRedModal(null),
    aplicarRed: (profile, redHost) => {
      setRedModal(null)
      consultar(profile.id, (decision) => {
        if (decision.tipo === 'nada') return
        // Un perfil ya hibernado no tiene qué cortar: el modo nuevo se guarda igual.
        if (decision.tipo === 'preguntar') setCambiandoRed({ profile, redHost, confirmacion: decision.confirmacion })
        else aplicar(profile.id, redHost)
      })
    },
    confirmarRed: () => {
      if (cambiandoRed) aplicar(cambiandoRed.profile.id, cambiandoRed.redHost)
      setCambiandoRed(null)
    },
    cancelarRed: () => setCambiandoRed(null)
  }
}

/** Las terminales del perfil y cuántas ejecutan algo; null si el main no contestó. */
async function terminalesDe(profileId: string): Promise<TerminalesEnMarcha | null> {
  try {
    return await window.tessera.terminal.enMarcha(profileId)
  } catch (err) {
    console.error('[perfil] terminal.enMarcha falló:', err)
    return null
  }
}

type Consultar = (profileId: string, alVolver: (decision: DecisionTrasConsulta) => void) => void

/**
 * Mira qué cortaría hibernar un perfil. La consulta tarda (hasta unos segundos en Windows): el
 * cursor lo dice, un segundo gesto sobre el mismo perfil se ignora y, al volver, se decide con el
 * estado de ese momento (perfil borrado, ya hibernado, agente que empezó a trabajar) y no con el
 * de la pulsación.
 */
function useConsultaPerfil({ profiles, dotStates, working }: OpcionesAcciones): Consultar {
  const vivo = useRef({ profiles, dotStates, working })
  useEffect(() => {
    vivo.current = { profiles, dotStates, working }
  })
  const enVuelo = useRef(new Set<string>())
  const [cuantas, setCuantas] = useState(0)
  useEffect(() => {
    document.body.classList.toggle('consultando-perfil', cuantas > 0)
    return () => document.body.classList.remove('consultando-perfil')
  }, [cuantas])
  return (profileId, alVolver) => {
    if (enVuelo.current.has(profileId)) return
    enVuelo.current.add(profileId)
    setCuantas(enVuelo.current.size)
    void terminalesDe(profileId).then((terminales) => {
      enVuelo.current.delete(profileId)
      setCuantas(enVuelo.current.size)
      const { profiles: perfiles, dotStates: estados, working: trabajando } = vivo.current
      const estado = estados?.[profileId]
      alVolver(
        decidirTrasConsulta(
          {
            existe: perfiles?.some((p) => p.id === profileId) === true,
            hibernado: estado === 'hibernated' || estado === 'hibernating',
            trabajando: trabajando?.has(profileId) === true
          },
          terminales
        )
      )
    })
  }
}

/** Estado de los diálogos de perfil (eliminar, hibernar, red, reglas) y del selector de color. */
export function useAccionesPerfil(opciones: OpcionesAcciones, cerrarMenu: () => void): AccionesPerfil {
  const [clavesSsh, fijarClavesSsh] = useState<string | null>(null)
  const { onRecolorProfile, onToggleRedHost, onAbrirReglas, onDeleteProfile, onHibernateProfile } = opciones
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const [hibernating, setHibernating] = useState<HibernacionPendiente | null>(null)
  const consultar = useConsultaPerfil(opciones)
  const red = useCambioRed(consultar, onToggleRedHost, onHibernateProfile)
  const reglas = useReglasPerfil(onAbrirReglas)
  const selectorColor = useSelectorColor(cerrarMenu, onRecolorProfile)

  // Hibernar mata los ptys del perfil: se pregunta si se corta algo (un agente trabajando o una
  // terminal que ejecuta algo, `confirmaciones.ts`); si no, se ejecuta directo.
  function requestHibernate(profile: Profile): void {
    cerrarMenu()
    consultar(profile.id, (decision) => {
      if (decision.tipo === 'preguntar') setHibernating({ profile, confirmacion: decision.confirmacion })
      else if (decision.tipo === 'ejecutar') onHibernateProfile(profile.id)
    })
  }

  function confirmarHibernacion(): void {
    if (!hibernating) return
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
    clavesSsh,
    abrirClavesSsh: (perfil) => { cerrarMenu(); fijarClavesSsh(perfil) },
    cerrarClavesSsh: () => fijarClavesSsh(null),
    ...red,
    deleting,
    hibernating,
    ...reglas,
    requestDelete: (profile) => {
      cerrarMenu()
      setDeleting(profile)
    },
    requestHibernate,
    confirmarHibernacion,
    cancelarHibernacion: () => setHibernating(null),
    confirmarEliminar,
    cancelarEliminar: () => setDeleting(null)
  }
}
