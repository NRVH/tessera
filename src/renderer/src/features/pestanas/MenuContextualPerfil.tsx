// =============================================================================
// MenuContextualPerfil: menú de clic derecho de una pestaña de perfil, agrupado por tipo
// de consecuencia, de lo inocuo a lo irreversible (identidad, configuración, ciclo de
// vida, destructivo). Eliminar queda al final, aislado por un separador y en rojo.
// Sin estado propio: `ProfileTabs` le pasa las acciones. Depende de comun/ContextMenu.
// =============================================================================
import { IconoAjustes, IconoDescartar, IconoEliminar, IconoRed, IconoRenombrar } from '../../comun/iconosMenu'
import { ContextMenu, SEP } from '../../comun/ContextMenu'
import type { Profile } from '../../../../main/profiles/types'

interface MenuContextualPerfilProps {
  x: number
  y: number
  profile: Profile
  /** Cuántos perfiles hay: con uno solo no se puede eliminar. */
  totalPerfiles: number
  /** ¿Algún agente de este perfil está a mitad de turno? Es el mismo Set que pulsa su dot. */
  working: boolean
  onClose: () => void
  onRename: (profile: Profile) => void
  onColor: (profile: Profile) => void
  onRed: (profileId: string) => void
  onHibernate: (profile: Profile, working: boolean) => void
  onDelete: (profile: Profile) => void
}

/** Menú contextual de un perfil (renombrar, color, red, hibernar, eliminar). */
export function MenuContextualPerfil({
  x,
  y,
  profile,
  totalPerfiles,
  working,
  onClose,
  onRename,
  onColor,
  onRed,
  onHibernate,
  onDelete
}: MenuContextualPerfilProps): React.JSX.Element {
  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        { icon: <IconoRenombrar />, label: 'Renombrar', onClick: () => onRename(profile) },
        { icon: <IconoAjustes />, label: 'Cambiar color', onClick: () => onColor(profile) },
        SEP,
        {
          // Abre un diálogo (los puntos suspensivos lo indican) y el rótulo nombra el modo
          // ACTUAL, que es cierto en las dos plataformas; dónde acaban los puertos lo dice
          // el diálogo, con el nombre del sistema de quien mira.
          icon: <IconoRed />,
          label: `Red del contenedor: ${profile.sandbox?.redHost === true ? 'anfitrión' : 'aislada'}…`,
          onClick: () => onRed(profile.id)
        },
        SEP,
        {
          // Hibernar libera RAM sin cerrar la app. Solo lleva "…" si hay un agente trabajando,
          // porque entonces abre una confirmación (se pierde su turno).
          icon: <IconoDescartar />,
          label: working ? 'Hibernar perfil…' : 'Hibernar perfil',
          onClick: () => onHibernate(profile, working)
        },
        SEP,
        {
          icon: <IconoEliminar />,
          label: 'Eliminar perfil…',
          onClick: () => onDelete(profile),
          danger: true,
          // No dejar la app sin perfiles: con uno solo, no se puede eliminar.
          disabled: totalPerfiles <= 1
        }
      ]}
    />
  )
}
