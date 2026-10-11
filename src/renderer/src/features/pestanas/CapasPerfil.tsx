// =============================================================================
// CapasPerfil: lo que la banda de perfiles superpone a sus pestañas: el selector de color,
// el menú contextual, el popover de creación y los diálogos. Sin estado propio:
// pinta lo que le pasa `ProfileTabs` desde `useBandaPerfiles`, en este orden de hijos.
// =============================================================================
import type { Profile } from '../../../../main/profiles/types'
import { CrearPerfilPopover } from './CrearPerfilPopover'
import { DialogosPerfil } from './DialogosPerfil'
import { MenuContextualPerfil } from './MenuContextualPerfil'
import { SelectorColorPerfil } from './SelectorColorPerfil'
import type { useBandaPerfiles } from './useBandaPerfiles'

type Banda = ReturnType<typeof useBandaPerfiles>

/** Selector de color, menú, popover de creación y diálogos de la banda de perfiles. */
export function CapasPerfil({
  profiles,
  working,
  banda
}: {
  profiles: Profile[]
  working?: Set<string>
  banda: Banda
}): React.JSX.Element {
  const { menu, cerrarMenu, renombrado, crear, acciones } = banda
  const perfilDelMenu = menu ? profiles.find((p) => p.id === menu.profileId) : undefined
  // El perfil vivo y no el del momento de abrir: su color cambia mientras se elige.
  const sel = acciones.selectorColor
  const perfilDelColor = sel ? profiles.find((p) => p.id === sel.profile.id) : undefined
  return (
    <>
      {sel && perfilDelColor && (
        <SelectorColorPerfil key={perfilDelColor.id} profile={perfilDelColor} x={sel.x} y={sel.y} onElegir={acciones.elegirColor} onCerrar={acciones.cerrarSelectorColor} />
      )}

      {menu && perfilDelMenu && (
        <MenuContextualPerfil
          x={menu.x}
          y={menu.y}
          profile={perfilDelMenu}
          totalPerfiles={profiles.length}
          working={working?.has(perfilDelMenu.id) ?? false}
          onClose={cerrarMenu}
          onRename={renombrado.startRename}
          onColor={acciones.openColorPicker}
          onRed={acciones.abrirRed}
          onHibernate={acciones.requestHibernate}
          onDelete={acciones.requestDelete}
        />
      )}

      {crear.creating && (
        <CrearPerfilPopover
          x={crear.creating.x}
          y={crear.creating.y}
          name={crear.newName}
          color={crear.newColor}
          onName={crear.setNewName}
          onColor={crear.setNewColor}
          onSubmit={crear.submitCreate}
          onCancel={crear.cancelCreate}
        />
      )}

      <DialogosPerfil profiles={profiles} acciones={acciones} />
    </>
  )
}
