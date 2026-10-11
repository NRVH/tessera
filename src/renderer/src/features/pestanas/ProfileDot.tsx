// =============================================================================
// ProfileDot: punto de color de un perfil con su estado de hibernación y la actividad
// de su agente. Lo pintan la banda de perfiles y el título de las casillas del mosaico
// de agentes, para que el punto diga lo mismo en los dos sitios.
// Solo depende del tipo `ProfileDotState`.
// =============================================================================
import type { ProfileDotState } from './profileDotState'

/** Lo que dice el dot de la actividad (también su clase CSS): esperar gana a trabajar, y trabajar al halo. */
type ActividadDot = 'esperando' | 'working' | 'attention'

const TITULOS: Record<ActividadDot, string> = {
  esperando: 'Un agente te está esperando',
  working: 'Trabajando…',
  attention: 'Un agente terminó y aún no lo revisas'
}

function actividadDelDot(working: boolean, attention: boolean, waiting: boolean): ActividadDot | null {
  if (waiting) return 'esperando'
  if (working) return 'working'
  return attention ? 'attention' : null
}

/**
 * Dot del perfil: spinner al hibernar o despertar, anillo hueco si está hibernado y el
 * color del perfil (con latido si trabaja, halo si algo terminó sin revisar) si está activo.
 */
export function ProfileDot({
  state,
  color,
  working = false,
  attention = false,
  waiting = false
}: {
  state: ProfileDotState
  color: string
  /** Alguna sesión del perfil TRABAJA: el dot LATE en su propio color. */
  working?: boolean
  /** Algo TERMINÓ sin revisar: el dot brilla (halo) en su propio color. */
  attention?: boolean
  /** Un agente del perfil TE ESPERA: un anillo parpadea alrededor del dot. Gana a los demás: es lo único que no avanza sin ti. */
  waiting?: boolean
}): React.JSX.Element {
  if (state === 'hibernating' || state === 'waking') {
    return (
      <span
        className="profile-tab-dot spinner"
        style={{ borderTopColor: color }}
        title={state === 'waking' ? 'Despertando…' : 'Hibernando…'}
        aria-label={state === 'waking' ? 'despertando' : 'hibernando'}
      />
    )
  }
  if (state === 'hibernated') {
    // Anillo hueco del color del perfil: hibernado se lee por la forma y no por el tono,
    // que ya dice de qué perfil es. El color va inline porque el CSS no conoce el del perfil.
    return (
      <span
        className="profile-tab-dot hibernated"
        style={{ boxShadow: `inset 0 0 0 1.5px ${color}` }}
        title="Hibernado"
        aria-label="hibernado"
      />
    )
  }
  const actividad = actividadDelDot(working, attention, waiting)
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
      title={actividad === null ? undefined : TITULOS[actividad]}
    />
  )
}
