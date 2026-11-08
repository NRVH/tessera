// =============================================================================
// MenuContextualPerfil: menú de clic derecho de una pestaña de perfil, agrupado por tipo
// de consecuencia, de lo inocuo a lo irreversible (identidad, configuración, ciclo de
// vida, destructivo). Eliminar queda al final, aislado por un separador y en rojo.
// Sin estado propio: `ProfileTabs` le pasa las acciones. Depende de comun/ContextMenu.
// =============================================================================
import { IconoAjustes, IconoClavesSsh, IconoContenedor, IconoDescartar, IconoEliminar, IconoRed, IconoReglas, IconoRenombrar } from '../../comun/iconosMenu'
import { ContextMenu, SEP } from '../../comun/ContextMenu'
import type { Profile } from '../../../../main/profiles/types'
import { txPestanas } from './textos.ts'
import { txClavesAgente } from './textosClavesAgente.ts'

interface MenuContextualPerfilProps {
  x: number
  y: number
  profile: Profile
  /** Cuántos perfiles hay: con uno solo no se puede eliminar. */
  totalPerfiles: number
  onClose: () => void
  onRename: (profile: Profile) => void
  onColor: (profile: Profile) => void
  onRed: (profileId: string) => void
  alClavesSsh: (perfil: string) => void
  onReglas: (profileId: string) => void
  onHibernate: (profile: Profile) => void
  onDelete: (profile: Profile) => void
}

/** Menú contextual de un perfil (renombrar, color, red, reglas para los agentes, hibernar, eliminar). */
export function MenuContextualPerfil({
  x,
  y,
  profile,
  totalPerfiles,
  onClose,
  onRename,
  onColor,
  onRed,
  alClavesSsh,
  onReglas,
  onHibernate,
  onDelete
}: MenuContextualPerfilProps): React.JSX.Element {
  const t = txPestanas().menu
  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        { icon: <IconoRenombrar />, label: t.renombrar, onClick: () => onRename(profile) },
        { icon: <IconoAjustes />, label: t.cambiarColor, onClick: () => onColor(profile) },
        SEP,
        {
          icon: <IconoReglas />,
          label: t.reglas,
          onClick: () => onReglas(profile.id)
        },
        // Las reglas valen para todos los agentes; esto, solo para los que trabajan en contenedores.
        {
          icon: <IconoContenedor />,
          label: t.agentesDocker,
          submenu: [
            {
              // Abre un diálogo (los puntos suspensivos lo indican) y el rótulo nombra el modo
              // ACTUAL, que es cierto en las dos plataformas; dónde acaban los puertos lo dice
              // el diálogo, con el nombre del sistema de quien mira.
              icon: <IconoRed />,
              label: t.red(profile.sandbox?.redHost === true),
              onClick: () => onRed(profile.id)
            },
            { icon: <IconoClavesSsh />, label: txClavesAgente().menu, onClick: () => alClavesSsh(profile.id) }
          ]
        },
        SEP,
        {
          icon: <IconoDescartar />,
          label: t.hibernar,
          detalle: t.hibernarDetalle,
          onClick: () => onHibernate(profile)
        },
        SEP,
        {
          icon: <IconoEliminar />,
          label: t.eliminar,
          detalle: totalPerfiles <= 1 ? t.eliminarSinOtro : undefined,
          onClick: () => onDelete(profile),
          danger: true,
          // No dejar la app sin perfiles: con uno solo, no se puede eliminar.
          disabled: totalPerfiles <= 1
        }
      ]}
    />
  )
}
