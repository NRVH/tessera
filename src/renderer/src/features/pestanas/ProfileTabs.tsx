// =============================================================================
// ProfileTabs (nivel 1): banda superior de perfiles a todo el ancho y editable: reordenar
// arrastrando, renombrar inline, menú contextual (color, red, hibernar, eliminar) y "+"
// para crear. Es una fila hermana de la barra de título, nunca hija suya.
// El estado vive en `useBandaPerfiles`; las pestañas y las capas, en sus propios archivos.
// Decisiones: docs/decisiones/renderer/banda-de-perfiles.md
// =============================================================================
import type { Profile } from '../../../../main/profiles/types'
import type { ProfileDotState } from './profileDotState'
import { CapasPerfil } from './CapasPerfil'
import { PestanaPerfil } from './PestanaPerfil'
import { ProfileDot } from './ProfileDot'
import { useBandaPerfiles } from './useBandaPerfiles'

export { ProfileDot }

interface ProfileTabsProps {
  profiles: Profile[]
  activeProfileId: string | null
  onSelectProfile: (profileId: string) => void
  onAddProfile: (nombre: string, color: string) => void
  onRenameProfile: (profileId: string, nombre: string) => void
  onRecolorProfile: (profileId: string, color: string) => void
  /** Activa/desactiva `redHost` (--network host): los puertos del perfil quedan en el equipo. */
  onToggleRedHost: (profileId: string, redHost: boolean) => void
  onDeleteProfile: (profileId: string) => void
  onReorderProfiles: (orderedIds: string[]) => void
  /** Hiberna el perfil: mata su contenedor y marca sus proyectos hibernados. */
  onHibernateProfile: (profileId: string) => void
  /** Estado visual del dot por perfil (hibernación). Ausente => 'active'. */
  dotStates: Record<string, ProfileDotState>
  /** ids de perfil con algún agente TERMINADO sin revisar: su dot brilla en su color. */
  attention?: Set<string>
  /** ids de perfil con alguna sesión TRABAJANDO: su dot late en su color. */
  working?: Set<string>
  /** Modo colapsado: la banda se reduce a la línea de color de cada perfil. */
  hideNames?: boolean
  /** Despliega la banda: renombrar necesita el input inline, que no cabe colapsada. */
  onShowNames?: () => void
}

/** Banda de perfiles (nivel 1 de pestañas). */
export function ProfileTabs(props: ProfileTabsProps): React.JSX.Element {
  const { profiles, activeProfileId, onSelectProfile, dotStates, attention, working } = props
  const hideNames = props.hideNames ?? false
  const banda = useBandaPerfiles(props)
  return (
    <div
      className={`tabs-profiles${hideNames ? ' names-hidden' : ''}`}
      role="tablist"
      aria-label="Perfiles"
    >
      {profiles.map((profile) => (
        <PestanaPerfil
          key={profile.id}
          profile={profile}
          active={profile.id === activeProfileId}
          dotState={dotStates[profile.id] ?? 'active'}
          hasAttention={attention?.has(profile.id) ?? false}
          isWorking={working?.has(profile.id) ?? false}
          arrastre={banda.arrastre}
          renombrado={banda.renombrado}
          onSelect={() => onSelectProfile(profile.id)}
          onMenu={(x, y) => banda.setMenu({ x, y, profileId: profile.id })}
        />
      ))}

      <button
        ref={banda.crear.addBtnRef}
        className="profile-add-btn"
        title="Agregar perfil"
        aria-label="Agregar perfil"
        onClick={banda.crear.openCreate}
      >
        +
      </button>

      <CapasPerfil profiles={profiles} working={working} banda={banda} />
    </div>
  )
}
