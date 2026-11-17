// =============================================================================
// CapasPerfil: lo que la banda de perfiles superpone a sus pestañas: el selector de color,
// el menú contextual, el popover de creación y los diálogos. Sin estado propio:
// pinta lo que le pasa `PestanasPerfil` desde `useBandaPerfiles`, en este orden de hijos.
// =============================================================================
import type { Perfil } from '../../../../main/perfiles/types'
import { CrearPerfilPopover } from './CrearPerfilPopover'
import { DialogosPerfil } from './DialogosPerfil'
import { MenuContextualPerfil } from './MenuContextualPerfil'
import { SelectorColorPerfil } from './SelectorColorPerfil'
import type { useBandaPerfiles } from './useBandaPerfiles'

type Banda = ReturnType<typeof useBandaPerfiles>

/** Selector de color, menú, popover de creación y diálogos de la banda de perfiles. */
export function CapasPerfil({
  perfiles,
  banda
}: {
  perfiles: Perfil[]
  banda: Banda
}): React.JSX.Element {
  const { menu, cerrarMenu, renombrado, crear, acciones } = banda
  const perfilDelMenu = menu ? perfiles.find((p) => p.id === menu.perfilId) : undefined
  // El perfil vivo y no el del momento de abrir: su color cambia mientras se elige.
  const sel = acciones.selectorColor
  const perfilDelColor = sel ? perfiles.find((p) => p.id === sel.perfil.id) : undefined
  return (
    <>
      {sel && perfilDelColor && (
        <SelectorColorPerfil key={perfilDelColor.id} perfil={perfilDelColor} x={sel.x} y={sel.y} onElegir={acciones.elegirColor} onCerrar={acciones.cerrarSelectorColor} />
      )}

      {menu && perfilDelMenu && (
        <MenuContextualPerfil
          x={menu.x}
          y={menu.y}
          perfil={perfilDelMenu}
          totalPerfiles={perfiles.length}
          onCerrar={cerrarMenu}
          onRenombrar={renombrado.iniciarRenombrado}
          onColor={acciones.abrirSelectorColor}
          onRed={acciones.abrirRed}
          alClavesSsh={acciones.abrirClavesSsh}
          onReglas={acciones.abrirReglas}
          onHibernar={acciones.pedirHibernacion}
          onEliminar={acciones.pedirEliminar}
        />
      )}

      {crear.posicionCreacion && (
        <CrearPerfilPopover
          x={crear.posicionCreacion.x}
          y={crear.posicionCreacion.y}
          nombre={crear.nombreNuevo}
          color={crear.colorNuevo}
          onNombre={crear.setNombreNuevo}
          onColor={crear.setColorNuevo}
          onEnviar={crear.enviarCreacion}
          onCancelar={crear.cancelarCreacion}
        />
      )}

      <DialogosPerfil perfiles={perfiles} acciones={acciones} />
    </>
  )
}
