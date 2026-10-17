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
import { txPestanas } from './textos.ts'
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
  /** ids de perfil con algún agente que TE ESPERA: un anillo parpadea en su dot. */
  waiting?: Set<string>
}

/** Banda de perfiles (nivel 1 de pestañas). En el modo minimalista no se monta: la sustituye `SelectorPerfil`. */
export function ProfileTabs(props: ProfileTabsProps): React.JSX.Element {
  const { profiles, activeProfileId, onSelectProfile, dotStates, attention, working, waiting } = props
  const banda = useBandaPerfiles(props)
  return (
    <div className="tabs-profiles" role="tablist" aria-label={txPestanas().perfil.perfiles}>
      {profiles.map((profile) => (
        <PestanaPerfil
          key={profile.id}
          profile={profile}
          active={profile.id === activeProfileId}
          dotState={dotStates[profile.id] ?? 'active'}
          hasAttention={attention?.has(profile.id) ?? false}
          isWorking={working?.has(profile.id) ?? false}
          isWaiting={waiting?.has(profile.id) ?? false}
          arrastre={banda.arrastre}
          renombrado={banda.renombrado}
          onSelect={() => onSelectProfile(profile.id)}
          onMenu={(x, y) => banda.setMenu({ x, y, profileId: profile.id })}
        />
      ))}

      <button
        ref={banda.crear.addBtnRef}
        className="profile-add-btn"
        title={txPestanas().perfil.agregar}
        aria-label={txPestanas().perfil.agregar}
        onClick={banda.crear.openCreate}
      >
        +
      </button>

      <CapasPerfil profiles={profiles} working={working} banda={banda} />
    </div>
  )
}
