// =============================================================================
// MenuContextualPerfil: menú de clic derecho de una pestaña de perfil, agrupado por tipo
// de consecuencia, de lo inocuo a lo irreversible (identidad, configuración, ciclo de
// vida, destructivo). Eliminar queda al final, aislado por un separador y en rojo.
// Sin estado propio: `PestanasPerfil` le pasa las acciones. Depende de comun/MenuContextual.
// =============================================================================
import { IconoAjustes, IconoClavesSsh, IconoContenedor, IconoDescartar, IconoEliminar, IconoRed, IconoReglas, IconoRenombrar } from '../../comun/iconosMenu'
import { MenuContextual, SEP } from '../../comun/MenuContextual'
import type { Perfil } from '../../../../main/perfiles/types'
import { txPestanas } from './textos.ts'
import { txClavesAgente } from './textosClavesAgente.ts'

interface PropsMenuContextualPerfil {
  x: number
  y: number
  perfil: Perfil
  /** Cuántos perfiles hay: con uno solo no se puede eliminar. */
  totalPerfiles: number
  onCerrar: () => void
  onRenombrar: (perfil: Perfil) => void
  onColor: (perfil: Perfil) => void
  onRed: (perfilId: string) => void
  alClavesSsh: (perfil: string) => void
  onReglas: (perfilId: string) => void
  onHibernar: (perfil: Perfil) => void
  onEliminar: (perfil: Perfil) => void
}

/** Menú contextual de un perfil (renombrar, color, red, reglas para los agentes, hibernar, eliminar). */
export function MenuContextualPerfil({
  x,
  y,
  perfil,
  totalPerfiles,
  onCerrar,
  onRenombrar,
  onColor,
  onRed,
  alClavesSsh,
  onReglas,
  onHibernar,
  onEliminar
}: PropsMenuContextualPerfil): React.JSX.Element {
  const t = txPestanas().menu
  return (
    <MenuContextual
      x={x}
      y={y}
      onCerrar={onCerrar}
      items={[
        { icon: <IconoRenombrar />, label: t.renombrar, onClick: () => onRenombrar(perfil) },
        { icon: <IconoAjustes />, label: t.cambiarColor, onClick: () => onColor(perfil) },
        SEP,
        {
          icon: <IconoReglas />,
          label: t.reglas,
          onClick: () => onReglas(perfil.id)
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
              label: t.red(perfil.sandbox?.redHost === true),
              onClick: () => onRed(perfil.id)
            },
            { icon: <IconoClavesSsh />, label: txClavesAgente().menu, onClick: () => alClavesSsh(perfil.id) }
          ]
        },
        SEP,
        {
          icon: <IconoDescartar />,
          label: t.hibernar,
          detalle: t.hibernarDetalle,
          onClick: () => onHibernar(perfil)
        },
        SEP,
        {
          icon: <IconoEliminar />,
          label: t.eliminar,
          detalle: totalPerfiles <= 1 ? t.eliminarSinOtro : undefined,
          onClick: () => onEliminar(perfil),
          danger: true,
          // No dejar la app sin perfiles: con uno solo, no se puede eliminar.
          disabled: totalPerfiles <= 1
        }
      ]}
    />
  )
}
