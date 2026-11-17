// =============================================================================
// PestanasPerfil (nivel 1): banda superior de perfiles a todo el ancho y editable: reordenar
// arrastrando, renombrar inline, menú contextual (color, red, hibernar, eliminar) y "+"
// para crear. Es una fila hermana de la barra de título, nunca hija suya.
// El estado vive en `useBandaPerfiles`; las pestañas y las capas, en sus propios archivos.
// Decisiones: docs/decisiones/renderer/banda-de-perfiles.md
// =============================================================================
import type { Perfil } from '../../../../main/perfiles/types'
import type { EstadoPuntoPerfil } from './estadosPunto'
import { CapasPerfil } from './CapasPerfil'
import { PestanaPerfil } from './PestanaPerfil'
import { PuntoColorPerfil } from './PuntoColorPerfil'
import { txPestanas } from './textos.ts'
import { useBandaPerfiles } from './useBandaPerfiles'

export { PuntoColorPerfil }

interface PropsPestanasPerfil {
  perfiles: Perfil[]
  perfilActivoId: string | null
  onSeleccionarPerfil: (perfilId: string) => void
  onAnadirPerfil: (nombre: string, color: string) => void
  onRenombrarPerfil: (perfilId: string, nombre: string) => void
  onCambiarColorPerfil: (perfilId: string, color: string) => void
  /** Activa/desactiva `redHost` (--network host): los puertos del perfil quedan en el equipo. */
  onAlternarRedHost: (perfilId: string, redHost: boolean) => void
  /** Abre el contexto de los agentes en las reglas del perfil. */
  onAbrirReglas: (perfilId: string) => void
  onEliminarPerfil: (perfilId: string) => void
  onReordenarPerfiles: (idsOrdenados: string[]) => void
  /** Hiberna el perfil: mata su contenedor y marca sus proyectos hibernados. */
  onHibernarPerfil: (perfilId: string) => void
  /** Estado visual del dot por perfil (hibernación). Ausente => 'active'. */
  estadosPunto: Record<string, EstadoPuntoPerfil>
  /** ids de perfil con algún agente TERMINADO sin revisar: su dot brilla en su color. */
  atencion?: Set<string>
  /** ids de perfil con alguna sesión TRABAJANDO: su dot late en su color. */
  working?: Set<string>
  /** ids de perfil con algún agente que TE ESPERA: un anillo parpadea en su dot. */
  esperando?: Set<string>
}

/** Banda de perfiles (nivel 1 de pestañas). En el modo minimalista no se monta: la sustituye `SelectorPerfil`. */
export function PestanasPerfil(props: PropsPestanasPerfil): React.JSX.Element {
  const { perfiles, perfilActivoId, onSeleccionarPerfil, estadosPunto, atencion, working, esperando } = props
  const banda = useBandaPerfiles(props)
  return (
    <div className="tabs-profiles" role="tablist" aria-label={txPestanas().perfil.perfiles}>
      {perfiles.map((perfil) => (
        <PestanaPerfil
          key={perfil.id}
          perfil={perfil}
          activa={perfil.id === perfilActivoId}
          estadoPunto={estadosPunto[perfil.id] ?? 'active'}
          tieneAtencion={atencion?.has(perfil.id) ?? false}
          isWorking={working?.has(perfil.id) ?? false}
          estaEsperando={esperando?.has(perfil.id) ?? false}
          arrastre={banda.arrastre}
          renombrado={banda.renombrado}
          onSeleccionar={() => onSeleccionarPerfil(perfil.id)}
          onMenu={(x, y) => banda.setMenu({ x, y, perfilId: perfil.id })}
        />
      ))}

      <button
        ref={banda.crear.botonAnadirRef}
        className="profile-add-btn"
        title={txPestanas().perfil.agregar}
        aria-label={txPestanas().perfil.agregar}
        onClick={banda.crear.abrirCreacion}
      >
        +
      </button>

      <CapasPerfil perfiles={perfiles} banda={banda} />
    </div>
  )
}
