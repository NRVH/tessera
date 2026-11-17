// =============================================================================
// PuntoColorPerfil: punto de color de un perfil con su estado de hibernación y la actividad
// de su agente. Lo pintan la banda de perfiles y el título de las casillas del mosaico
// de agentes, para que el punto diga lo mismo en los dos sitios.
// Solo depende del tipo `EstadoPuntoPerfil`.
// =============================================================================
import type { EstadoPuntoPerfil } from './estadosPunto'
import { txPestanas } from './textos.ts'

/** Lo que dice el dot de la actividad (también su clase CSS): esperar gana a trabajar, y trabajar al halo. */
type ActividadPunto = 'esperando' | 'working' | 'attention'

function titulosActividad(): Record<ActividadPunto, string> {
  const t = txPestanas().perfil
  return { esperando: t.puntoEsperando, working: t.puntoTrabajando, attention: t.puntoAtencion }
}

function actividadDelPunto(working: boolean, atencion: boolean, esperando: boolean): ActividadPunto | null {
  if (esperando) return 'esperando'
  if (working) return 'working'
  return atencion ? 'attention' : null
}

/**
 * Dot del perfil: spinner al hibernar o despertar, anillo hueco si está hibernado y el
 * color del perfil (con latido si trabaja, halo si algo terminó sin revisar) si está activo.
 */
export function PuntoColorPerfil({
  estado,
  color,
  working = false,
  atencion = false,
  esperando = false
}: {
  estado: EstadoPuntoPerfil
  color: string
  /** Alguna sesión del perfil TRABAJA: el dot LATE en su propio color. */
  working?: boolean
  /** Algo TERMINÓ sin revisar: el dot brilla (halo) en su propio color. */
  atencion?: boolean
  /** Un agente del perfil TE ESPERA: un anillo parpadea alrededor del dot. Gana a los demás: es lo único que no avanza sin ti. */
  esperando?: boolean
}): React.JSX.Element {
  const t = txPestanas().perfil
  if (estado === 'hibernating' || estado === 'waking') {
    return (
      <span
        className="profile-tab-dot spinner"
        style={{ borderTopColor: color }}
        title={estado === 'waking' ? t.despertando : t.hibernando}
        aria-label={estado === 'waking' ? t.despertandoAria : t.hibernandoAria}
      />
    )
  }
  if (estado === 'hibernated') {
    // Anillo hueco del color del perfil: hibernado se lee por la forma y no por el tono,
    // que ya dice de qué perfil es. El color va inline porque el CSS no conoce el del perfil.
    return (
      <span
        className="profile-tab-dot hibernated"
        style={{ boxShadow: `inset 0 0 0 1.5px ${color}` }}
        title={t.hibernado}
        aria-label={t.hibernadoAria}
      />
    )
  }
  const actividad = actividadDelPunto(working, atencion, esperando)
  const halo = actividad === 'attention'
  return (
    <span
      className={`profile-tab-dot${actividad === null ? '' : ` ${actividad}`}`}
      // `color` inline alimenta el currentColor del latido y del anillo (animaciones CSS) y del halo.
      style={{
        background: color,
        color,
        ...(halo ? { boxShadow: `0 0 6px 1px ${color}` } : {})
      }}
      title={actividad === null ? undefined : titulosActividad()[actividad]}
    />
  )
}
